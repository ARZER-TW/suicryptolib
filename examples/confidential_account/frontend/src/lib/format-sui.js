/**
 * Convert snarkjs proof output to Sui's Arkworks compressed format.
 *
 * snarkjs outputs: uncompressed affine coordinates as decimal strings
 * Sui expects: Arkworks compressed format (LE x-coord + Y sign bit)
 */

const BN254_P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function bigintToBytes32LE(value) {
  const buf = new Uint8Array(32);
  let v = BigInt(value);
  for (let i = 0; i < 32; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function serializeG1Compressed(point) {
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);
  if (x === 0n && y === 0n) {
    const buf = new Uint8Array(32);
    buf[31] = 0x40;
    return buf;
  }
  const xBytes = bigintToBytes32LE(x);
  if (y > BN254_P / 2n) xBytes[31] |= 0x80;
  return xBytes;
}

function serializeG2Compressed(point) {
  const xC0 = BigInt(point[0][0]);
  const xC1 = BigInt(point[0][1]);
  const yC0 = BigInt(point[1][0]);
  const yC1 = BigInt(point[1][1]);
  const c0 = bigintToBytes32LE(xC0);
  const c1 = bigintToBytes32LE(xC1);
  const yNeg = yC1 !== 0n ? yC1 > BN254_P / 2n : yC0 > BN254_P / 2n;
  if (yNeg) c1[31] |= 0x80;
  const r = new Uint8Array(64);
  r.set(c0, 0);
  r.set(c1, 32);
  return r;
}

/**
 * Convert snarkjs proof to Sui format (128 bytes).
 * Layout: pi_a(G1, 32B) + pi_b(G2, 64B) + pi_c(G1, 32B)
 */
export function convertProof(proof) {
  const r = new Uint8Array(128);
  r.set(serializeG1Compressed(proof.pi_a), 0);
  r.set(serializeG2Compressed(proof.pi_b), 32);
  r.set(serializeG1Compressed(proof.pi_c), 96);
  return r;
}

/**
 * Convert public signals to Sui format (N * 32 bytes LE).
 */
export function convertPublicInputs(signals) {
  const r = new Uint8Array(signals.length * 32);
  for (let i = 0; i < signals.length; i++) {
    r.set(bigintToBytes32LE(BigInt(signals[i])), i * 32);
  }
  return r;
}

export { bigintToBytes32LE };
