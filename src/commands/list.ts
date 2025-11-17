/**
 * List command - display provisioned environments
 *
 * Outputs a table of environments known to local state.
 */

import { Command } from 'commander';
import { access } from 'fs/promises';
import { join } from 'path';
import { loadConfig } from '../config/loader.js';
import { readState } from '../state/manager.js';
import { ConfigValidationError } from '../config/schema.js';
import { StateValidationError } from '../state/schema.js';

type InstanceRow = {
  env: string;
  dbName: string;
  host: string;
  port: number;
  engine: string;
  status: string;
};

const ENGINE_NAME = 'mongodb';

function formatTable(rows: InstanceRow[]): string {
  const headers: Array<keyof InstanceRow> = ['env', 'host', 'port', 'dbName', 'engine', 'status'];
  const headerTitles: Record<keyof InstanceRow, string> = {
    env: 'ENV',
    dbName: 'DB NAME',
    host: 'HOST',
    port: 'PORT',
    engine: 'ENGINE',
    status: 'STATUS',
  };

  const widths = headers.map((key) => {
    const headerWidth = headerTitles[key].length;
    const rowWidth = Math.max(
      ...rows.map((row) => String(row[key]).length),
      headerWidth
    );
    return rowWidth;
  });

  const renderRow = (row: Record<string, string>): string =>
    headers
      .map((key, idx) => {
        const value = row[key] ?? '';
        return value.padEnd(widths[idx], ' ');
      })
      .join('  ');

  const headerRow = renderRow(
    headers.reduce<Record<string, string>>((acc, key) => {
      acc[key] = headerTitles[key];
      return acc;
    }, {})
  );

  const separator = widths
    .map((w) => '-'.repeat(w))
    .join('  ');

  const dataRows = rows.map((row) =>
    renderRow({
      env: row.env,
      host: row.host,
      port: String(row.port),
      dbName: row.dbName,
      engine: row.engine,
      status: row.status,
    })
  );

  return [headerRow, separator, ...dataRows].join('\n');
}

function parseEnvFromKey(key: string): string {
  const parts = key.split('/');
  return parts.length === 2 ? parts[1] : key;
}

async function runList(): Promise<void> {
  try {
    const config = await loadConfig();

    const statePath = join(process.cwd(), '.dbx', 'state.json');
    try {
      await access(statePath);
    } catch {
      console.error('State file not found. Run `dbx init` or `dbx up` to create state.');
      process.exit(1);
    }

    const state = await readState();
    const instanceEntries = Object.entries(state.instances);

    if (instanceEntries.length === 0) {
      console.log('No environments found. Run `dbx up` to provision an environment.');
      process.exit(0);
    }

    const rows: InstanceRow[] = instanceEntries.map(([key, instance]) => ({
      env: parseEnvFromKey(key),
      dbName: instance.dbName,
      host: config.vps.host,
      port: instance.port,
      engine: ENGINE_NAME,
      status: 'unknown',
    }));

    console.log(formatTable(rows));
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error(`Configuration error: ${err.message}`);
      process.exit(1);
    }
    if (err instanceof StateValidationError) {
      console.error(`State file is invalid: ${err.message}`);
      console.error('Fix the state file or reprovision the environment.');
      process.exit(1);
    }

    console.error(`Failed to list environments: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Registers the list command with Commander
 *
 * @param program - Commander program instance
 */
export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List provisioned environments with host, port, and status')
    .action(runList);
}
