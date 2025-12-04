import { describe, it, expect } from "vitest";
import {
  validateConfig,
  ConfigValidationError,
  getDatabaseEngine,
} from "./schema.js";
import type { DbxConfig } from "./schema.js";

const createValidMongoConfig = (
  overrides: Partial<DbxConfig> = {}
): Record<string, unknown> => ({
  project: "test-project",
  defaultEnv: "dev",
  vps: {
    host: "192.168.1.100",
    user: "ubuntu",
    sshKeyPath: "~/.ssh/id_ed25519",
    port: 22,
  },
  mongodb: {
    version: "7",
    basePort: 27017,
  },
  ...overrides,
});

const createValidPostgresConfig = (): Record<string, unknown> => ({
  project: "test-project",
  defaultEnv: "dev",
  vps: {
    host: "192.168.1.100",
    user: "ubuntu",
  },
  postgresql: {
    version: "16",
    basePort: 5432,
  },
});

describe("validateConfig", () => {
  describe("valid configs", () => {
    it("accepts valid MongoDB config", () => {
      const config = createValidMongoConfig();
      expect(() => validateConfig(config)).not.toThrow();
    });

    it("accepts valid PostgreSQL config", () => {
      const config = createValidPostgresConfig();
      expect(() => validateConfig(config)).not.toThrow();
    });

    it("accepts config without optional sshKeyPath", () => {
      const config = createValidMongoConfig();
      delete (config.vps as Record<string, unknown>).sshKeyPath;
      expect(() => validateConfig(config)).not.toThrow();
    });

    it("accepts config without optional vps.port", () => {
      const config = createValidMongoConfig();
      delete (config.vps as Record<string, unknown>).port;
      expect(() => validateConfig(config)).not.toThrow();
    });
  });

  describe("invalid configs", () => {
    it("throws for null config", () => {
      expect(() => validateConfig(null)).toThrow(ConfigValidationError);
    });

    it("throws for non-object config", () => {
      expect(() => validateConfig("string")).toThrow("must be an object");
    });

    it("throws for missing project", () => {
      const config = createValidMongoConfig();
      delete config.project;
      expect(() => validateConfig(config)).toThrow("project");
    });

    it("throws for empty project", () => {
      const config = createValidMongoConfig({ project: "  " } as DbxConfig);
      expect(() => validateConfig(config)).toThrow("project");
    });

    it("throws for missing defaultEnv", () => {
      const config = createValidMongoConfig();
      delete config.defaultEnv;
      expect(() => validateConfig(config)).toThrow("defaultEnv");
    });

    it("throws for missing vps", () => {
      const config = createValidMongoConfig();
      delete config.vps;
      expect(() => validateConfig(config)).toThrow("vps");
    });

    it("throws for missing vps.host", () => {
      const config = createValidMongoConfig();
      delete (config.vps as Record<string, unknown>).host;
      expect(() => validateConfig(config)).toThrow("vps.host");
    });

    it("throws for missing vps.user", () => {
      const config = createValidMongoConfig();
      delete (config.vps as Record<string, unknown>).user;
      expect(() => validateConfig(config)).toThrow("vps.user");
    });

    it("throws for invalid vps.port", () => {
      const config = createValidMongoConfig();
      (config.vps as Record<string, unknown>).port = 70000;
      expect(() => validateConfig(config)).toThrow("vps.port");
    });

    it("throws for missing database config", () => {
      const config = createValidMongoConfig();
      delete config.mongodb;
      expect(() => validateConfig(config)).toThrow("mongodb or postgresql");
    });

    it("throws for having both mongodb and postgresql", () => {
      const config = createValidMongoConfig();
      config.postgresql = { version: "16", basePort: 5432 };
      expect(() => validateConfig(config)).toThrow(
        "cannot have both mongodb and postgresql"
      );
    });
  });

  describe("mongodb validation", () => {
    it("throws for missing mongodb.version", () => {
      const config = createValidMongoConfig();
      delete (config.mongodb as Record<string, unknown>).version;
      expect(() => validateConfig(config)).toThrow("mongodb.version");
    });

    it("throws for invalid mongodb.version format", () => {
      const config = createValidMongoConfig();
      (config.mongodb as Record<string, unknown>).version = "latest";
      expect(() => validateConfig(config)).toThrow("mongodb.version");
    });

    it("accepts valid version formats", () => {
      const versions = ["7", "6.0", "5.0.12"];
      for (const version of versions) {
        const config = createValidMongoConfig();
        (config.mongodb as Record<string, unknown>).version = version;
        expect(() => validateConfig(config)).not.toThrow();
      }
    });

    it("throws for missing mongodb.basePort", () => {
      const config = createValidMongoConfig();
      delete (config.mongodb as Record<string, unknown>).basePort;
      expect(() => validateConfig(config)).toThrow("mongodb.basePort");
    });

    it("throws for invalid mongodb.basePort", () => {
      const config = createValidMongoConfig();
      (config.mongodb as Record<string, unknown>).basePort = 80;
      expect(() => validateConfig(config)).toThrow("mongodb.basePort");
    });
  });

  describe("postgresql validation", () => {
    it("throws for invalid postgresql.version format", () => {
      const config = createValidPostgresConfig();
      (config.postgresql as Record<string, unknown>).version = "latest";
      expect(() => validateConfig(config)).toThrow("postgresql.version");
    });

    it("throws for invalid postgresql.basePort", () => {
      const config = createValidPostgresConfig();
      (config.postgresql as Record<string, unknown>).basePort = 100;
      expect(() => validateConfig(config)).toThrow("postgresql.basePort");
    });
  });
});

describe("getDatabaseEngine", () => {
  it("returns mongodb for mongodb config", () => {
    const config = validateConfig(createValidMongoConfig());
    expect(getDatabaseEngine(config)).toBe("mongodb");
  });

  it("returns postgresql for postgresql config", () => {
    const config = validateConfig(createValidPostgresConfig());
    expect(getDatabaseEngine(config)).toBe("postgresql");
  });
});
