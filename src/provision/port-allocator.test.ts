import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validatePort,
  getUsedPortsFromLocalState,
  getAllUsedPorts,
  findNextPort,
  PortAllocationError,
} from "./port-allocator.js";
import type { DbxState } from "../state/schema.js";

const createEmptyState = (): DbxState => ({ instances: {} });

const createStateWithPorts = (ports: number[]): DbxState => {
  const state: DbxState = { instances: {} };
  ports.forEach((port, i) => {
    state.instances[`project/env${i}`] = {
      port,
      dbName: `db${i}`,
      username: `user${i}`,
      password: "pass",
      rootPassword: "rootpass",
      volume: `vol${i}`,
      containerName: `container${i}`,
      createdAt: new Date().toISOString(),
    };
  });
  return state;
};

describe("validatePort", () => {
  it("accepts valid ports", () => {
    expect(() => validatePort(1024)).not.toThrow();
    expect(() => validatePort(27017)).not.toThrow();
    expect(() => validatePort(65535)).not.toThrow();
  });

  it("throws for ports below minimum", () => {
    expect(() => validatePort(1023)).toThrow(PortAllocationError);
    expect(() => validatePort(80)).toThrow("below minimum valid port");
  });

  it("throws for ports above maximum", () => {
    expect(() => validatePort(65536)).toThrow(PortAllocationError);
    expect(() => validatePort(70000)).toThrow("exceeds maximum port");
  });

  it("warns for high port numbers", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    validatePort(65500);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("near maximum")
    );
    warnSpy.mockRestore();
  });
});

describe("getUsedPortsFromLocalState", () => {
  it("returns empty set for empty state", () => {
    const state = createEmptyState();
    const ports = getUsedPortsFromLocalState(state);
    expect(ports.size).toBe(0);
  });

  it("returns all ports from state", () => {
    const state = createStateWithPorts([27017, 27018, 27019]);
    const ports = getUsedPortsFromLocalState(state);
    expect(ports).toEqual(new Set([27017, 27018, 27019]));
  });
});

describe("getAllUsedPorts", () => {
  it("merges local and remote state ports", () => {
    const local = createStateWithPorts([27017, 27018]);
    const remote = createStateWithPorts([27018, 27019]);
    const ports = getAllUsedPorts(local, remote);
    expect(ports).toEqual(new Set([27017, 27018, 27019]));
  });

  it("includes docker ports", () => {
    const local = createStateWithPorts([27017]);
    const dockerPorts = new Set([27018, 27019]);
    const ports = getAllUsedPorts(local, undefined, dockerPorts);
    expect(ports).toEqual(new Set([27017, 27018, 27019]));
  });

  it("handles undefined remote state", () => {
    const local = createStateWithPorts([27017]);
    const ports = getAllUsedPorts(local);
    expect(ports).toEqual(new Set([27017]));
  });
});

describe("findNextPort", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns basePort when no ports are used", () => {
    const state = createEmptyState();
    const port = findNextPort(state, 27017);
    expect(port).toBe(27017);
  });

  it("returns next available port when basePort is used", () => {
    const state = createStateWithPorts([27017]);
    const port = findNextPort(state, 27017);
    expect(port).toBe(27018);
  });

  it("fills gaps in port allocation", () => {
    const state = createStateWithPorts([27017, 27019]);
    const port = findNextPort(state, 27017);
    expect(port).toBe(27018);
  });

  it("skips multiple consecutive used ports", () => {
    const state = createStateWithPorts([27017, 27018, 27019]);
    const port = findNextPort(state, 27017);
    expect(port).toBe(27020);
  });

  it("considers remote state when allocating", () => {
    const local = createStateWithPorts([27017]);
    const remote = createStateWithPorts([27018]);
    const port = findNextPort(local, 27017, remote);
    expect(port).toBe(27019);
  });

  it("considers docker ports when allocating", () => {
    const local = createEmptyState();
    const dockerPorts = new Set([27017, 27018]);
    const port = findNextPort(local, 27017, undefined, dockerPorts);
    expect(port).toBe(27019);
  });

  it("throws for invalid basePort", () => {
    const state = createEmptyState();
    expect(() => findNextPort(state, 1000)).toThrow(PortAllocationError);
  });
});
