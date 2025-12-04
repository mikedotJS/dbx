import { describe, it, expect } from "vitest";
import {
  buildConnectionURI,
  buildConnectionURIMasked,
  buildPostgresConnectionURI,
  buildPostgresConnectionURIMasked,
  buildConnectionURIAuto,
  buildConnectionURIMaskedAuto,
  validateMetadataForURI,
} from "./uri-builder.js";
import type { InstanceMetadata } from "../state/schema.js";

const createMockMetadata = (
  overrides: Partial<InstanceMetadata> = {}
): InstanceMetadata => ({
  port: 27018,
  dbName: "test_db",
  username: "test_user",
  password: "secret123",
  rootPassword: "rootsecret",
  volume: "dbx_test_vol",
  containerName: "dbx_test_container",
  createdAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("buildConnectionURI", () => {
  it("builds MongoDB URI with all components", () => {
    const metadata = createMockMetadata();
    const uri = buildConnectionURI(metadata, "192.168.1.100");
    expect(uri).toBe(
      "mongodb://test_user:secret123@192.168.1.100:27018/test_db?authSource=admin"
    );
  });

  it("handles special characters in password (not encoded)", () => {
    const metadata = createMockMetadata({ password: "pass@word!" });
    const uri = buildConnectionURI(metadata, "localhost");
    expect(uri).toContain("pass@word!");
  });
});

describe("buildConnectionURIMasked", () => {
  it("masks password with ***", () => {
    const metadata = createMockMetadata();
    const uri = buildConnectionURIMasked(metadata, "192.168.1.100");
    expect(uri).toBe(
      "mongodb://test_user:***@192.168.1.100:27018/test_db?authSource=admin"
    );
    expect(uri).not.toContain("secret123");
  });
});

describe("buildPostgresConnectionURI", () => {
  it("builds PostgreSQL URI with all components", () => {
    const metadata = createMockMetadata({ type: "postgresql", port: 5433 });
    const uri = buildPostgresConnectionURI(metadata, "192.168.1.100");
    expect(uri).toBe(
      "postgresql://test_user:secret123@192.168.1.100:5433/test_db"
    );
  });
});

describe("buildPostgresConnectionURIMasked", () => {
  it("masks password with ***", () => {
    const metadata = createMockMetadata({ type: "postgresql", port: 5433 });
    const uri = buildPostgresConnectionURIMasked(metadata, "192.168.1.100");
    expect(uri).toBe("postgresql://test_user:***@192.168.1.100:5433/test_db");
  });
});

describe("buildConnectionURIAuto", () => {
  it("returns MongoDB URI for mongodb type", () => {
    const metadata = createMockMetadata({ type: "mongodb" });
    const uri = buildConnectionURIAuto(metadata, "localhost");
    expect(uri).toMatch(/^mongodb:\/\//);
  });

  it("returns MongoDB URI when type is undefined (backward compat)", () => {
    const metadata = createMockMetadata();
    delete metadata.type;
    const uri = buildConnectionURIAuto(metadata, "localhost");
    expect(uri).toMatch(/^mongodb:\/\//);
  });

  it("returns PostgreSQL URI for postgresql type", () => {
    const metadata = createMockMetadata({ type: "postgresql" });
    const uri = buildConnectionURIAuto(metadata, "localhost");
    expect(uri).toMatch(/^postgresql:\/\//);
  });
});

describe("buildConnectionURIMaskedAuto", () => {
  it("returns masked MongoDB URI for mongodb type", () => {
    const metadata = createMockMetadata({ type: "mongodb" });
    const uri = buildConnectionURIMaskedAuto(metadata, "localhost");
    expect(uri).toMatch(/^mongodb:\/\//);
    expect(uri).toContain(":***@");
  });

  it("returns masked PostgreSQL URI for postgresql type", () => {
    const metadata = createMockMetadata({ type: "postgresql" });
    const uri = buildConnectionURIMaskedAuto(metadata, "localhost");
    expect(uri).toMatch(/^postgresql:\/\//);
    expect(uri).toContain(":***@");
  });
});

describe("validateMetadataForURI", () => {
  it("passes for valid metadata", () => {
    const metadata = createMockMetadata();
    expect(() => validateMetadataForURI(metadata)).not.toThrow();
  });

  it("throws for missing username", () => {
    const metadata = createMockMetadata({ username: "" });
    expect(() => validateMetadataForURI(metadata)).toThrow(
      'missing required field "username"'
    );
  });

  it("throws for missing password", () => {
    const metadata = createMockMetadata({ password: "" });
    expect(() => validateMetadataForURI(metadata)).toThrow(
      'missing required field "password"'
    );
  });

  it("throws for missing port", () => {
    const metadata = createMockMetadata();
    (metadata as unknown as Record<string, unknown>).port = undefined;
    expect(() => validateMetadataForURI(metadata)).toThrow(
      'missing required field "port"'
    );
  });

  it("throws for missing dbName", () => {
    const metadata = createMockMetadata({ dbName: "" });
    expect(() => validateMetadataForURI(metadata)).toThrow(
      'missing required field "dbName"'
    );
  });
});
