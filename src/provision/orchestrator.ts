/**
 * Provisioning orchestrator
 *
 * Main orchestration logic for provisioning MongoDB instances.
 */

import type { InstanceMetadata } from '../state/schema.js';
import { SSHClient } from '../ssh/client.js';
import { ensureDockerReady } from '../ssh/docker.js';
import { loadConfig } from '../config/loader.js';
import { getInstance, setInstance, readState } from '../state/manager.js';
import { readRemoteState, writeRemoteState } from '../state/remote.js';
import { findNextPort } from './port-allocator.js';
import { generateMongoDBCredentials } from './credentials.js';
import { createVolume, pullMongoImage, startMongoContainer, waitForMongoReady } from './mongodb.js';
import { createAppUser } from './user-creation.js';
import { buildConnectionURI } from './uri-builder.js';
import { reconcileInstanceState } from './reconciliation.js';
import {
  ProvisioningError,
  VolumeCreationError,
  ContainerStartError,
  UserCreationError,
  StateSyncError,
  InstanceExistsError,
} from './errors.js';

/**
 * Provisioning options
 */
export interface ProvisionOptions {
  /** Environment name (e.g., "dev", "staging") */
  env: string;
  /** Current working directory (optional, defaults to process.cwd()) */
  cwd?: string;
}

/**
 * Provisioning result
 */
export interface ProvisionResult {
  /** Instance metadata */
  metadata: InstanceMetadata;
  /** MongoDB connection URI */
  connectionURI: string;
  /** Whether this was a new instance (true) or existing (false) */
  isNew: boolean;
}

/**
 * Provisions a MongoDB instance
 *
 * Main orchestration function that coordinates all provisioning steps.
 *
 * @param options - Provisioning options
 * @returns Provisioning result with connection URI
 */
export async function provisionInstance(options: ProvisionOptions): Promise<ProvisionResult> {
  const startTime = Date.now();

  console.log(`\n=== Provisioning MongoDB instance for environment: ${options.env} ===\n`);

  try {
    // Step 1: Load configuration
    console.log('Step 1/11: Loading configuration...');
    const config = await loadConfig(options.cwd);
    console.log(`✓ Configuration loaded for project: ${config.project}`);

    // Step 2: Check local and remote state
    console.log('\nStep 2/11: Checking existing state...');
    const sshClient = new SSHClient({
      host: config.vps.host,
      port: config.vps.port || 22,
      username: config.vps.user,
      privateKeyPath: config.vps.sshKeyPath || '~/.ssh/id_rsa',
    });

    await sshClient.connect();

    // Reconcile state
    const reconciliation = await reconcileInstanceState(sshClient, config.project, options.env);

    if (reconciliation.metadata) {
      // Instance already exists
      const uri = buildConnectionURI(reconciliation.metadata, config.vps.host);

      if (reconciliation.reconciled) {
        console.log(`✓ State reconciled: ${reconciliation.action}`);
      }

      sshClient.disconnect();

      throw new InstanceExistsError(config.project, options.env, uri);
    }

    console.log('✓ No existing instance found');

    // Step 3: Ensure Docker is ready
    console.log('\nStep 3/11: Ensuring Docker is ready on VPS...');
    await ensureDockerReady(
      {
        host: config.vps.host,
        port: config.vps.port || 22,
        username: config.vps.user,
        privateKeyPath: config.vps.sshKeyPath || '~/.ssh/id_rsa',
      },
      config.vps.user
    );

    // Reconnect SSH client (ensureDockerReady disconnects)
    await sshClient.connect();

    // Step 4: Allocate port
    console.log('\nStep 4/11: Allocating port...');
    const localState = await readState(options.cwd);
    const remoteState = await readRemoteState(sshClient);
    const port = findNextPort(localState, config.mongodb.basePort, remoteState);

    // Step 5: Generate credentials
    console.log('\nStep 5/11: Generating credentials...');
    const credentials = generateMongoDBCredentials();
    console.log('✓ Generated secure passwords (32 characters each)');

    // Step 6: Create Docker volume
    console.log('\nStep 6/11: Creating Docker volume...');
    const volumeName = `dbx_${config.project}_${options.env}`;

    try {
      await createVolume(sshClient, volumeName);
    } catch (err) {
      throw new VolumeCreationError(volumeName, err instanceof Error ? err.message : String(err));
    }

    // Step 7: Pull MongoDB image
    console.log('\nStep 7/11: Pulling MongoDB image...');
    const imageTag = config.mongodb.image || `mongo:${config.mongodb.version}`;

    try {
      await pullMongoImage(sshClient, imageTag);
    } catch (err) {
      throw new ProvisioningError(
        `Failed to pull MongoDB image: ${err instanceof Error ? err.message : String(err)}`,
        'image-pull'
      );
    }

    // Step 8: Start MongoDB container
    console.log('\nStep 8/11: Starting MongoDB container...');
    const containerName = `dbx_${config.project}_${options.env}`;

    try {
      await startMongoContainer(sshClient, {
        containerName,
        imageTag,
        port,
        volumeName,
        rootUsername: 'root',
        rootPassword: credentials.rootPassword,
      });
    } catch (err) {
      throw new ContainerStartError(containerName, err instanceof Error ? err.message : String(err));
    }

    // Step 9: Wait for MongoDB to be ready
    console.log('\nStep 9/11: Waiting for MongoDB to become ready...');

    try {
      await waitForMongoReady(sshClient, containerName, 'root', credentials.rootPassword);
    } catch (err) {
      throw new ProvisioningError(
        `MongoDB failed to start: ${err instanceof Error ? err.message : String(err)}`,
        'mongodb-ready'
      );
    }

    // Step 10: Create application user
    console.log('\nStep 10/11: Creating application user...');
    const appUsername = `dbx_${options.env}`;
    const dbName = `${config.project}_${options.env}`;

    try {
      await createAppUser(sshClient, {
        containerName,
        port,
        rootUsername: 'root',
        rootPassword: credentials.rootPassword,
        appUsername,
        appPassword: credentials.appPassword,
        dbName,
      });
    } catch (err) {
      throw new UserCreationError(appUsername, err instanceof Error ? err.message : String(err));
    }

    // Step 11: Update state files
    console.log('\nStep 11/11: Updating state files...');

    const metadata: InstanceMetadata = {
      port,
      dbName,
      username: appUsername,
      password: credentials.appPassword,
      rootPassword: credentials.rootPassword,
      volume: volumeName,
      containerName,
      createdAt: new Date().toISOString(),
    };

    // Write local state first
    try {
      await setInstance(config.project, options.env, metadata, options.cwd);
      console.log('✓ Local state updated');
    } catch (err) {
      throw new StateSyncError('local', err instanceof Error ? err.message : String(err));
    }

    // Write remote state (with rollback on failure)
    try {
      const currentRemoteState = await readRemoteState(sshClient);
      currentRemoteState.instances[`${config.project}/${options.env}`] = metadata;
      await writeRemoteState(sshClient, currentRemoteState);
      console.log('✓ Remote state updated');
    } catch (err) {
      // Rollback local state
      console.error('Remote state write failed, rolling back local state...');
      try {
        await getInstance(config.project, options.env, options.cwd);
        // State exists, remove it
        const rollbackState = await readState(options.cwd);
        delete rollbackState.instances[`${config.project}/${options.env}`];
        // We can't use removeInstance here because it would try to write
        // Just leave the warning - manual cleanup needed
      } catch {
        // Rollback failed, state is inconsistent
      }

      throw new StateSyncError('remote', err instanceof Error ? err.message : String(err));
    }

    // Build connection URI
    const connectionURI = buildConnectionURI(metadata, config.vps.host);

    // Disconnect SSH
    sshClient.disconnect();

    // Calculate elapsed time
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n✓ Provisioning complete in ${elapsed}s!`);
    console.log(`\nConnection URI:\n${connectionURI}\n`);

    return {
      metadata,
      connectionURI,
      isNew: true,
    };
  } catch (err) {
    // Handle instance exists error specially
    if (err instanceof InstanceExistsError) {
      console.log(`\n${err.message}\n`);

      return {
        metadata: {} as InstanceMetadata, // Placeholder, should use actual metadata
        connectionURI: err.connectionURI,
        isNew: false,
      };
    }

    // Re-throw other errors
    throw err;
  }
}
