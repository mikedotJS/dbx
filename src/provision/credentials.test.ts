import { describe, it, expect } from "vitest";
import {
  generatePassword,
  validatePassword,
  encodePasswordForURI,
  generateDatabaseCredentials,
} from "./credentials.js";

describe("generatePassword", () => {
  it("generates password with default length of 32", () => {
    const password = generatePassword();
    expect(password).toHaveLength(32);
  });

  it("generates password with custom length", () => {
    const password = generatePassword(24);
    expect(password).toHaveLength(24);
  });

  it("throws error for length below minimum (16)", () => {
    expect(() => generatePassword(15)).toThrow(
      "Password length must be at least 16 characters"
    );
  });

  it("generates unique passwords", () => {
    const passwords = new Set(
      Array.from({ length: 100 }, () => generatePassword())
    );
    expect(passwords.size).toBe(100);
  });

  it("uses only allowed characters", () => {
    const allowedChars =
      "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#$%^&*-_=+";
    const password = generatePassword();
    for (const char of password) {
      expect(allowedChars).toContain(char);
    }
  });

  it("excludes ambiguous and URI-problematic characters", () => {
    const forbidden = ["l", "I", "O", "0", "1", "@", "/", ":", "?"];
    const passwords = Array.from({ length: 50 }, () => generatePassword());
    for (const password of passwords) {
      for (const char of forbidden) {
        expect(password).not.toContain(char);
      }
    }
  });
});

describe("validatePassword", () => {
  it("returns true for valid password", () => {
    expect(validatePassword("Abc123!@defghijk")).toBe(true);
  });

  it("returns false for password below minimum length", () => {
    expect(validatePassword("Abc123!")).toBe(false);
  });

  it("returns false for password without lowercase", () => {
    expect(validatePassword("ABC123!@DEFGHIJK")).toBe(false);
  });

  it("returns false for password without uppercase", () => {
    expect(validatePassword("abc123!@defghijk")).toBe(false);
  });

  it("returns false for password without digit", () => {
    expect(validatePassword("Abcdef!@ghijklmn")).toBe(false);
  });

  it("returns false for password without special character", () => {
    expect(validatePassword("Abc123defghijklm")).toBe(false);
  });
});

describe("encodePasswordForURI", () => {
  it("encodes special characters", () => {
    expect(encodePasswordForURI("pass@word")).toBe("pass%40word");
    expect(encodePasswordForURI("p/a:s?s")).toBe("p%2Fa%3As%3Fs");
  });

  it("preserves safe characters", () => {
    expect(encodePasswordForURI("password123")).toBe("password123");
  });
});

describe("generateDatabaseCredentials", () => {
  it("generates both root and app passwords", () => {
    const creds = generateDatabaseCredentials();
    expect(creds.rootPassword).toBeDefined();
    expect(creds.appPassword).toBeDefined();
  });

  it("generates different passwords for root and app", () => {
    const creds = generateDatabaseCredentials();
    expect(creds.rootPassword).not.toBe(creds.appPassword);
  });

  it("generates passwords with default length", () => {
    const creds = generateDatabaseCredentials();
    expect(creds.rootPassword).toHaveLength(32);
    expect(creds.appPassword).toHaveLength(32);
  });
});
