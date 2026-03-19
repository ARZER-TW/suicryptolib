/**
 * Browser-compatible crypto utilities for the sealed auction demo.
 * Uses Web Crypto API (available in all modern browsers).
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
 * Compute SHA-256 hash (synchronous, using a simple JS implementation).
 * For the demo, we use a sync hash to avoid async complexity in the UI.
 * Returns hex string.
 *
 * @param {Uint8Array} data
 * @returns {string} hex-encoded hash
 */
export function createHash(data) {
  // Simple SHA-256 for demo purposes
  // In production, use Web Crypto API: await crypto.subtle.digest('SHA-256', data)
  return syncSha256Hex(data);
}

/**
 * Minimal synchronous SHA-256 (for demo UI responsiveness).
 * Based on the FIPS 180-4 specification.
 */
function syncSha256Hex(message) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  let H0 = 0x6a09e667, H1 = 0xbb67ae85, H2 = 0x3c6ef372, H3 = 0xa54ff53a;
  let H4 = 0x510e527f, H5 = 0x9b05688c, H6 = 0x1f83d9ab, H7 = 0x5be0cd19;

  const msgLen = message.length;
  const bitLen = msgLen * 8;

  // Padding
  const padded = new Uint8Array(Math.ceil((msgLen + 9) / 64) * 64);
  padded.set(message);
  padded[msgLen] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen, false);

  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
  const ch = (x, y, z) => ((x & y) ^ (~x & z)) >>> 0;
  const maj = (x, y, z) => ((x & y) ^ (x & z) ^ (y & z)) >>> 0;
  const sigma0 = (x) => (rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22)) >>> 0;
  const sigma1 = (x) => (rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25)) >>> 0;
  const gamma0 = (x) => (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
  const gamma1 = (x) => (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const W = new Uint32Array(64);
    for (let t = 0; t < 16; t++) {
      W[t] = view.getUint32(offset + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      W[t] = (gamma1(W[t - 2]) + W[t - 7] + gamma0(W[t - 15]) + W[t - 16]) >>> 0;
    }

    let a = H0, b = H1, c = H2, d = H3, e = H4, f = H5, g = H6, h = H7;

    for (let t = 0; t < 64; t++) {
      const T1 = (h + sigma1(e) + ch(e, f, g) + K[t] + W[t]) >>> 0;
      const T2 = (sigma0(a) + maj(a, b, c)) >>> 0;
      h = g; g = f; f = e; e = (d + T1) >>> 0;
      d = c; c = b; b = a; a = (T1 + T2) >>> 0;
    }

    H0 = (H0 + a) >>> 0; H1 = (H1 + b) >>> 0;
    H2 = (H2 + c) >>> 0; H3 = (H3 + d) >>> 0;
    H4 = (H4 + e) >>> 0; H5 = (H5 + f) >>> 0;
    H6 = (H6 + g) >>> 0; H7 = (H7 + h) >>> 0;
  }

  return [H0, H1, H2, H3, H4, H5, H6, H7]
    .map((h) => h.toString(16).padStart(8, "0"))
    .join("");
}
