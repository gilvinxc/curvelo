import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "../src/lib/trackerTokens.js";

describe("tracker token encryption", () => {
  it("round-trips a token", () => {
    const cipher = encryptToken("secret-token-123");
    expect(cipher).not.toBe("secret-token-123");
    expect(decryptToken(cipher)).toBe("secret-token-123");
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    expect(encryptToken("abc")).not.toBe(encryptToken("abc"));
  });

  it("fails on tampered ciphertext", () => {
    const cipher = encryptToken("abc");
    const tampered = cipher.slice(0, -4) + "AAAA";
    expect(() => decryptToken(tampered)).toThrow();
  });
});
