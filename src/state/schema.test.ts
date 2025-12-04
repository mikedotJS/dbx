import { describe, it, expect } from "vitest";
import {
  createEmptyState,
  createInstanceKey,
  validateInstanceKey,
  validateState,
  getInstanceType,
  StateValidationError,
} from "./schema.js";
import type { InstanceMetadata } from "./schema.js";

const createValidInstance = (
  overrides: Partial<InstanceMetadata> = {}
): InstanceMetadata => ({
  port: 27017,
  dbName: "test_db",
  username: "test_user",
  password: "secret",
  rootPassword: "rootsecret",
  volume: "dbx_test_vol",
  containerName: "dbx_test_container",
  createdAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("createEmptyState", () => {
  it("creates state with empty instances", () => {
    const state = createEmptyState();
    expect(state).toEqual({ instances: {} });
  });
});

describe("createInstanceKey", () => {
  it("creates key in project/env format", () => {
    expect(createInstanceKey("my-app", "dev")).toBe("my-app/dev");
    expect(createInstanceKey("project", "staging")).toBe("project/staging");
  });
});

describe("validateInstanceKey", () => {
  it("accepts valid keys", () => {
    expect(() => validateInstanceKey("project/env")).not.toThrow();
    expect(() => validateInstanceKey("my-app/production")).not.toThrow();
  });

  it("throws for keys without separator", () => {
    expect(() => validateInstanceKey("projectenv")).toThrow(
      StateValidationError
    );
  });

  it("throws for keys with multiple separators", () => {
    expect(() => validateInstanceKey("project/env/extra")).toThrow(
      StateValidationError
    );
  });

  it("throws for empty project", () => {
    expect(() => validateInstanceKey("/env")).toThrow(StateValidationError);
  });

  it("throws for empty env", () => {
    expect(() => validateInstanceKey("project/")).toThrow(StateValidationError);
  });
});

describe("validateState", () => {
  it("accepts valid empty state", () => {
    const state = createEmptyState();
    expect(() => validateState(state)).not.toThrow();
  });

  it("accepts valid state with instances", () => {
    const state = {
      instances: {
        "my-app/dev": createValidInstance(),
      },
    };
    expect(() => validateState(state)).not.toThrow();
  });

  it("throws for null state", () => {
    expect(() => validateState(null)).toThrow(StateValidationError);
  });

  it("throws for state without instances", () => {
    expect(() => validateState({})).toThrow(
      'must contain an "instances" object'
    );
  });

  it("throws for invalid instance key", () => {
    const state = {
      instances: {
        "invalid-key": createValidInstance(),
      },
    };
    expect(() => validateState(state)).toThrow("Invalid instance key format");
  });

  it("throws for missing required fields", () => {
    const requiredFields = [
      "port",
      "dbName",
      "username",
      "password",
      "rootPassword",
      "volume",
      "containerName",
      "createdAt",
    ];

    for (const field of requiredFields) {
      const instance = createValidInstance();
      delete (instance as unknown as Record<string, unknown>)[field];
      const state = { instances: { "project/env": instance } };
      expect(() => validateState(state)).toThrow(
        `Missing required field "${field}"`
      );
    }
  });

  it("throws for invalid port type", () => {
    const instance = createValidInstance();
    (instance as unknown as Record<string, unknown>).port = "27017";
    const state = { instances: { "project/env": instance } };
    expect(() => validateState(state)).toThrow("must be a number");
  });

  it("throws for invalid string field types", () => {
    const instance = createValidInstance();
    (instance as unknown as Record<string, unknown>).dbName = 123;
    const state = { instances: { "project/env": instance } };
    expect(() => validateState(state)).toThrow("must be a string");
  });

  it("accepts valid type field", () => {
    const mongoInstance = createValidInstance({ type: "mongodb" });
    const pgInstance = createValidInstance({ type: "postgresql" });
    expect(() =>
      validateState({ instances: { "project/dev": mongoInstance } })
    ).not.toThrow();
    expect(() =>
      validateState({ instances: { "project/staging": pgInstance } })
    ).not.toThrow();
  });

  it("throws for invalid type field", () => {
    const instance = createValidInstance();
    (instance as unknown as Record<string, unknown>).type = "mysql";
    const state = { instances: { "project/env": instance } };
    expect(() => validateState(state)).toThrow(
      "must be 'mongodb' or 'postgresql'"
    );
  });
});

describe("getInstanceType", () => {
  it("returns mongodb when type is mongodb", () => {
    const instance = createValidInstance({ type: "mongodb" });
    expect(getInstanceType(instance)).toBe("mongodb");
  });

  it("returns postgresql when type is postgresql", () => {
    const instance = createValidInstance({ type: "postgresql" });
    expect(getInstanceType(instance)).toBe("postgresql");
  });

  it("defaults to mongodb when type is undefined", () => {
    const instance = createValidInstance();
    delete instance.type;
    expect(getInstanceType(instance)).toBe("mongodb");
  });
});
