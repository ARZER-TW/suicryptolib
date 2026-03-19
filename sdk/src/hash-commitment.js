/**
 * Hash-based Commitment Scheme (off-chain)
 *
 * Mirrors suicryptolib::hash_commitment Move module.
 * Computes C = H(value || salt) where H is SHA256, Blake2b, or Keccak256.
 *
 * Usage:
 *   const { commitment, salt } = HashCommitment.commit("my_secret_bid");
 *   // ... submit commitment to chain ...
 *   // ... later, reveal value + salt ...
 *   const valid = HashCommitment.verify(commitment, "my_secret_bid", salt);
 */
import { createHash } from "crypto";

const SCHEME_SHA256 = 0;
const SCHEME_BLAKE2B = 1;
const SCHEME_KECCAK256 = 2;

const MIN_SALT_LENGTH = 16;

/**
 * Generate cryptographically secure random salt.
 * @param {number} length - Salt length in bytes (default 32, minimum 16)
 * @returns {Uint8Array}
 */
async function generateSalt(length = 32) {
  if (length < MIN_SALT_LENGTH) {
    throw new Error(`Salt must be at least ${MIN_SALT_LENGTH} bytes`);
  }
  const { randomBytes } = await import("crypto");
  return randomBytes(length);
}

/**
 * Hash data using the specified scheme.
 * @param {Buffer|Uint8Array} data
 * @param {number} scheme - 0=SHA256, 1=Blake2b, 2=Keccak256
 * @returns {Buffer} 32-byte hash
 */
function hashWithScheme(data, scheme) {
  if (scheme === SCHEME_SHA256) {
    return createHash("sha256").update(data).digest();
  } else if (scheme === SCHEME_BLAKE2B) {
    return createHash("blake2b512")
      .update(data)
      .digest()
      .subarray(0, 32); // blake2b256
  } else if (scheme === SCHEME_KECCAK256) {
    // Node.js doesn't have keccak natively, use sha3-256 workaround
    // Note: Keccak256 != SHA3-256. For production, use a keccak library.
    // For now, we support SHA256 and Blake2b which cover most use cases.
    throw new Error(
      "Keccak256 requires a dedicated library (e.g., js-sha3). Use SHA256 or Blake2b for off-chain."
    );
  } else {
    throw new Error(`Invalid scheme: ${scheme}. Must be 0, 1, or 2.`);
  }
}

export const HashCommitment = {
  /** Scheme constants */
  SCHEME_SHA256,
  SCHEME_BLAKE2B,
  SCHEME_KECCAK256,

  /**
   * Create a commitment to a value.
   *
   * @param {string|Uint8Array} value - The value to commit to
   * @param {object} [options]
   * @param {number} [options.scheme=0] - Hash scheme (0=SHA256, 1=Blake2b)
   * @param {number} [options.saltLength=32] - Salt length in bytes
   * @returns {Promise<{commitment: string, salt: string, scheme: number}>}
   *   commitment and salt as hex strings
   */
  async commit(value, options = {}) {
    const { scheme = SCHEME_SHA256, saltLength = 32 } = options;

    const valueBytes = typeof value === "string" ? Buffer.from(value) : value;
    const saltBytes = await generateSalt(saltLength);

    const data = Buffer.concat([valueBytes, saltBytes]);
    const hash = hashWithScheme(data, scheme);

    return {
      commitment: hash.toString("hex"),
      salt: Buffer.from(saltBytes).toString("hex"),
      scheme,
    };
  },

  /**
   * Verify that a (value, salt) pair opens a commitment.
   *
   * @param {string} commitmentHex - The commitment hash as hex
   * @param {string|Uint8Array} value - The revealed value
   * @param {string} saltHex - The revealed salt as hex
   * @param {number} [scheme=0] - Hash scheme
   * @returns {boolean}
   */
  verify(commitmentHex, value, saltHex, scheme = SCHEME_SHA256) {
    const valueBytes = typeof value === "string" ? Buffer.from(value) : value;
    const saltBytes = Buffer.from(saltHex, "hex");

    if (saltBytes.length < MIN_SALT_LENGTH) {
      throw new Error(`Salt must be at least ${MIN_SALT_LENGTH} bytes`);
    }

    const data = Buffer.concat([valueBytes, saltBytes]);
    const computed = hashWithScheme(data, scheme);

    return computed.toString("hex") === commitmentHex;
  },

  /**
   * Compute commitment from known value and salt (for reconstruction).
   *
   * @param {string|Uint8Array} value
   * @param {string} saltHex - Salt as hex string
   * @param {number} [scheme=0]
   * @returns {string} commitment as hex
   */
  compute(value, saltHex, scheme = SCHEME_SHA256) {
    const valueBytes = typeof value === "string" ? Buffer.from(value) : value;
    const saltBytes = Buffer.from(saltHex, "hex");

    if (saltBytes.length < MIN_SALT_LENGTH) {
      throw new Error(`Salt must be at least ${MIN_SALT_LENGTH} bytes`);
    }

    const data = Buffer.concat([valueBytes, saltBytes]);
    return hashWithScheme(data, scheme).toString("hex");
  },

  /**
   * Convert commitment hex to Move-compatible bytes (for transaction args).
   * @param {string} hex
   * @returns {number[]} byte array suitable for tx.pure.vector('u8', ...)
   */
  hexToBytes(hex) {
    return Array.from(Buffer.from(hex, "hex"));
  },
};
