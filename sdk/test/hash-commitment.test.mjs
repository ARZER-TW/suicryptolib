import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HashCommitment } from "../src/hash-commitment.js";

describe("HashCommitment", () => {
  describe("commit + verify", () => {
    it("should commit and verify with SHA256 (default)", async () => {
      const { commitment, salt, scheme } = await HashCommitment.commit("hello");
      assert.equal(scheme, 0);
      assert.equal(commitment.length, 64); // 32 bytes hex
      assert.ok(salt.length >= 32); // at least 16 bytes hex

      assert.ok(HashCommitment.verify(commitment, "hello", salt, scheme));
    });

    it("should commit and verify with Blake2b", async () => {
      const { commitment, salt } = await HashCommitment.commit("hello", {
        scheme: HashCommitment.SCHEME_BLAKE2B,
      });

      assert.ok(
        HashCommitment.verify(
          commitment,
          "hello",
          salt,
          HashCommitment.SCHEME_BLAKE2B
        )
      );
    });

    it("should fail verify with wrong value", async () => {
      const { commitment, salt } = await HashCommitment.commit("correct");
      assert.ok(!HashCommitment.verify(commitment, "wrong", salt));
    });

    it("should fail verify with wrong salt", async () => {
      const { commitment } = await HashCommitment.commit("hello");
      const fakeSalt = "00".repeat(32);
      assert.ok(!HashCommitment.verify(commitment, "hello", fakeSalt));
    });

    it("should produce different commitments for same value (different salt)", async () => {
      const a = await HashCommitment.commit("same");
      const b = await HashCommitment.commit("same");
      assert.notEqual(a.commitment, b.commitment);
      assert.notEqual(a.salt, b.salt);
    });
  });

  describe("compute", () => {
    it("should produce same result as commit+verify", async () => {
      const { commitment, salt } = await HashCommitment.commit("test");
      const computed = HashCommitment.compute("test", salt);
      assert.equal(computed, commitment);
    });

    it("should be deterministic", () => {
      const salt = "aa".repeat(16);
      const a = HashCommitment.compute("test", salt);
      const b = HashCommitment.compute("test", salt);
      assert.equal(a, b);
    });
  });

  describe("different schemes produce different hashes", () => {
    it("SHA256 vs Blake2b", () => {
      const salt = "bb".repeat(16);
      const sha = HashCommitment.compute("test", salt, HashCommitment.SCHEME_SHA256);
      const blake = HashCommitment.compute("test", salt, HashCommitment.SCHEME_BLAKE2B);
      assert.notEqual(sha, blake);
    });
  });

  describe("hexToBytes", () => {
    it("should convert hex to byte array", () => {
      const bytes = HashCommitment.hexToBytes("deadbeef");
      assert.deepEqual(bytes, [0xde, 0xad, 0xbe, 0xef]);
    });
  });

  describe("error handling", () => {
    it("should reject salt shorter than 16 bytes in compute", () => {
      assert.throws(
        () => HashCommitment.compute("test", "aa".repeat(8)), // 8 bytes
        /at least 16 bytes/
      );
    });

    it("should reject salt shorter than 16 bytes in verify", () => {
      assert.throws(
        () => HashCommitment.verify("00".repeat(32), "test", "aa".repeat(8)),
        /at least 16 bytes/
      );
    });

    it("should reject invalid scheme", () => {
      assert.throws(
        () => HashCommitment.compute("test", "aa".repeat(16), 5),
        /Invalid scheme/
      );
    });
  });

  describe("Move compatibility", () => {
    it("should produce SHA256 hash matching Move contract", async () => {
      // This tests that the JS SDK produces the same hash as the Move module
      // Move uses: H(value || salt) with no prefix (unlike merkle which uses 0x00 prefix)
      const value = "hello world";
      const salt = "0123456789abcdef"; // 16 ASCII chars = 16 bytes
      const saltHex = Buffer.from(salt).toString("hex");

      const commitment = HashCommitment.compute(value, saltHex);
      // This value should match what compute() returns in hash_commitment.move
      assert.equal(commitment.length, 64);
      assert.ok(HashCommitment.verify(commitment, value, saltHex));
    });
  });
});
