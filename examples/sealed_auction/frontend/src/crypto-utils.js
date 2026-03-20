/**
 * Browser-compatible crypto utilities for the sealed auction demo.
 * Uses Web Crypto API for SHA-256 (guaranteed match with Move's std::hash::sha2_256).
 */

/**
 * Generate cryptographically secure random bytes.
 * @param {number} length
 * @returns {Uint8Array}
 */
export function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Compute SHA-256 hash using Web Crypto API.
 * Returns hex string.
 *
 * This uses the exact same SHA-256 algorithm as Move's std::hash::sha2_256(),
 * ensuring commit-time hash matches reveal-time verification on-chain.
 *
 * @param {Uint8Array} data
 * @returns {Promise<string>} hex-encoded hash
 */
export async function createHash(data) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Convert hex string to Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
