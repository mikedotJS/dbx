/**
 * Port allocation for MongoDB instances
 *
 * Allocates unique ports starting from basePort, detecting conflicts with existing instances.
 */

import type { DbxState } from '../state/schema.js';

/**
 * Minimum valid port number
 */
const MIN_PORT = 1024;

/**
 * Maximum valid port number
 */
const MAX_PORT = 65535;

/**
 * Warning threshold for high port allocation
 */
const HIGH_PORT_WARNING = 65500;

/**
 * Port allocation error
 */
export class PortAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortAllocationError';
  }
}

/**
 * Validates that a port is within the valid range
 *
 * @param port - Port number to validate
 * @throws PortAllocationError if port is outside valid range
 */
export function validatePort(port: number): void {
  if (port < MIN_PORT) {
    throw new PortAllocationError(
      `Port allocation failed: port ${port} is below minimum valid port ${MIN_PORT}`
    );
  }

  if (port > MAX_PORT) {
    throw new PortAllocationError(
      `Port allocation failed: port ${port} exceeds maximum port ${MAX_PORT}`
    );
  }

  if (port >= HIGH_PORT_WARNING) {
    console.warn(
      `Warning: Allocated port ${port} is near maximum. Consider destroying unused instances.`
    );
  }
}

/**
 * Extracts all used ports from local state
 *
 * @param localState - Local state object
 * @returns Set of used port numbers
 */
export function getUsedPortsFromLocalState(localState: DbxState): Set<number> {
  const ports = new Set<number>();

  for (const instance of Object.values(localState.instances)) {
    ports.add(instance.port);
  }

  return ports;
}

/**
 * Merges ports from local and remote state
 *
 * @param localState - Local state object
 * @param remoteState - Remote state object (optional)
 * @returns Set of all used port numbers
 */
export function getAllUsedPorts(localState: DbxState, remoteState?: DbxState): Set<number> {
  const ports = getUsedPortsFromLocalState(localState);

  if (remoteState) {
    for (const instance of Object.values(remoteState.instances)) {
      ports.add(instance.port);
    }
  }

  return ports;
}

/**
 * Finds the next available port starting from basePort
 *
 * Uses sequential allocation: basePort, basePort+1, basePort+2, etc.
 * Fills gaps if ports are deallocated.
 *
 * @param localState - Local state object
 * @param basePort - Starting port for allocation
 * @param remoteState - Remote state object (optional)
 * @returns Next available port number
 * @throws PortAllocationError if no ports available in valid range
 */
export function findNextPort(
  localState: DbxState,
  basePort: number,
  remoteState?: DbxState
): number {
  // Validate base port
  validatePort(basePort);

  // Get all used ports from both local and remote state
  const usedPorts = getAllUsedPorts(localState, remoteState);

  // Find next available port sequentially
  let port = basePort;

  while (port <= MAX_PORT) {
    if (!usedPorts.has(port)) {
      // Validate the allocated port
      validatePort(port);

      // Log allocation decision
      console.log(
        `Allocated port: ${port} (basePort: ${basePort}, existing ports: ${Array.from(usedPorts).sort((a, b) => a - b).join(', ') || 'none'})`
      );

      return port;
    }
    port++;
  }

  // No ports available
  throw new PortAllocationError(
    `No available ports: all ports from ${basePort} to ${MAX_PORT} are in use. Consider destroying unused instances.`
  );
}
