/**
 * snarkjs -> Sui (Arkworks) Groth16 proof format converter
 *
 * Sui's groth16 module uses Arkworks canonical compressed serialization:
 * - G1 compressed: 32 bytes (x coordinate LE, sign bit in last byte bit 7)
 * - G2 compressed: 64 bytes (x.c0 LE || x.c1 LE, sign bit in last byte of c1 bit 7)
 * - Scalar: 32 bytes LE
 *
 * snarkjs outputs: decimal string coordinates, big-endian conceptually, uncompressed affine
 */

import { readFileSync, writeFileSync } from "fs";

// BN254 base field prime
const BN254_P =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

// BN254 scalar field prime (for public inputs)
const BN254_R =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Convert BigInt to 32-byte little-endian Uint8Array
 */
function bigintToBytes32LE(value) {
  const buf = new Uint8Array(32);
  let v = BigInt(value);
  for (let i = 0; i < 32; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

/**
 * Convert Uint8Array to hex string (for Move contract constants)
 */
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Serialize a G1 point to Arkworks compressed format (32 bytes)
 *
 * Format: x coordinate in LE, with flags in the highest bits of the last byte:
 * - bit 7 (0x80): y > p/2 (y is "negative" in Arkworks terms)
 * - bit 6 (0x40): point at infinity
 */
function serializeG1Compressed(point) {
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);

  // Check for point at infinity
  if (x === 0n && y === 0n) {
    const buf = new Uint8Array(32);
    buf[31] = 0x40;
    return buf;
  }

  const xBytes = bigintToBytes32LE(x);

  // Determine y sign: if y > p/2, set bit 7
  const yNeg = y > BN254_P / 2n;
  if (yNeg) {
    xBytes[31] |= 0x80;
  }

  return xBytes;
}

/**
 * Serialize a G2 point to Arkworks compressed format (64 bytes)
 *
 * G2 is over Fp2 = Fp[u]/(u^2 + 1)
 * snarkjs format: [[x_c0, x_c1], [y_c0, y_c1], [z_c0, z_c1]]
 *
 * Arkworks serialization: x.c0 LE (32 bytes) || x.c1 LE (32 bytes)
 * Flags in the highest bits of the last byte (of c1):
 * - bit 7 (0x80): y > -y (lexicographic comparison in Fp2)
 * - bit 6 (0x40): point at infinity
 *
 * Lexicographic ordering for Fp2: compare c1 first, if equal compare c0
 */
function serializeG2Compressed(point) {
  const xC0 = BigInt(point[0][0]);
  const xC1 = BigInt(point[0][1]);
  const yC0 = BigInt(point[1][0]);
  const yC1 = BigInt(point[1][1]);

  // Check for point at infinity
  if (xC0 === 0n && xC1 === 0n && yC0 === 0n && yC1 === 0n) {
    const buf = new Uint8Array(64);
    buf[63] = 0x40;
    return buf;
  }

  const c0Bytes = bigintToBytes32LE(xC0);
  const c1Bytes = bigintToBytes32LE(xC1);

  // Determine y sign using Fp2 lexicographic ordering
  // y > -y iff:
  //   yC1 > p/2 (comparing c1 first)
  //   OR yC1 == 0 AND yC0 > p/2 (fall back to c0)
  let yNeg;
  if (yC1 !== 0n) {
    yNeg = yC1 > BN254_P / 2n;
  } else {
    yNeg = yC0 > BN254_P / 2n;
  }

  if (yNeg) {
    c1Bytes[31] |= 0x80;
  }

  // Concatenate: c0 || c1
  const result = new Uint8Array(64);
  result.set(c0Bytes, 0);
  result.set(c1Bytes, 32);
  return result;
}

/**
 * Convert snarkjs proof to Sui proof_points bytes (128 bytes)
 * Format: A(G1, 32) || B(G2, 64) || C(G1, 32)
 */
function convertProof(proof) {
  const a = serializeG1Compressed(proof.pi_a);
  const b = serializeG2Compressed(proof.pi_b);
  const c = serializeG1Compressed(proof.pi_c);

  const result = new Uint8Array(128);
  result.set(a, 0);
  result.set(b, 32);
  result.set(c, 96);
  return result;
}

/**
 * Convert snarkjs public signals to Sui public_proof_inputs bytes
 * Each signal is a 32-byte LE scalar
 */
function convertPublicInputs(publicSignals) {
  const result = new Uint8Array(publicSignals.length * 32);
  for (let i = 0; i < publicSignals.length; i++) {
    const scalar = bigintToBytes32LE(BigInt(publicSignals[i]));
    result.set(scalar, i * 32);
  }
  return result;
}

/**
 * Convert snarkjs verification_key.json to Sui prepare_verifying_key format
 *
 * Arkworks VerifyingKey<Bn254> serialized compressed:
 * alpha_g1 (32) || beta_g2 (64) || gamma_g2 (64) || delta_g2 (64)
 * || len(IC) as u64 LE (8) || IC[0] (32) || IC[1] (32) || ...
 */
function convertVK(vk) {
  const alpha = serializeG1Compressed(vk.vk_alpha_1);
  const beta = serializeG2Compressed(vk.vk_beta_2);
  const gamma = serializeG2Compressed(vk.vk_gamma_2);
  const delta = serializeG2Compressed(vk.vk_delta_2);

  const icLen = vk.IC.length;
  const icLenBytes = new Uint8Array(8);
  let len = BigInt(icLen);
  for (let i = 0; i < 8; i++) {
    icLenBytes[i] = Number(len & 0xffn);
    len >>= 8n;
  }

  const icBytes = new Uint8Array(icLen * 32);
  for (let i = 0; i < icLen; i++) {
    const ic = serializeG1Compressed(vk.IC[i]);
    icBytes.set(ic, i * 32);
  }

  const totalLen = 32 + 64 + 64 + 64 + 8 + icLen * 32;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  result.set(alpha, offset);
  offset += 32;
  result.set(beta, offset);
  offset += 64;
  result.set(gamma, offset);
  offset += 64;
  result.set(delta, offset);
  offset += 64;
  result.set(icLenBytes, offset);
  offset += 8;
  result.set(icBytes, offset);

  return result;
}

// --- Main ---

const proof = JSON.parse(readFileSync("proof.json", "utf8"));
const publicSignals = JSON.parse(readFileSync("public.json", "utf8"));
const vk = JSON.parse(readFileSync("verification_key.json", "utf8"));

const proofBytes = convertProof(proof);
const publicInputsBytes = convertPublicInputs(publicSignals);
const vkBytes = convertVK(vk);

console.log("=== Sui Groth16 Proof Format ===\n");

console.log(`Proof points (${proofBytes.length} bytes):`);
console.log(`  hex: ${bytesToHex(proofBytes)}`);
console.log(`  Move: x"${bytesToHex(proofBytes)}"`);

console.log(`\nPublic inputs (${publicInputsBytes.length} bytes):`);
console.log(`  hex: ${bytesToHex(publicInputsBytes)}`);
console.log(`  Move: x"${bytesToHex(publicInputsBytes)}"`);
console.log(`  value: ${publicSignals.join(", ")}`);

console.log(`\nVerifying key (${vkBytes.length} bytes):`);
console.log(`  hex: ${bytesToHex(vkBytes)}`);
console.log(`  Move: x"${bytesToHex(vkBytes)}"`);

// Also output as JSON for the Move test
const output = {
  proof_hex: bytesToHex(proofBytes),
  public_inputs_hex: bytesToHex(publicInputsBytes),
  vk_hex: bytesToHex(vkBytes),
  proof_length: proofBytes.length,
  public_inputs_length: publicInputsBytes.length,
  vk_length: vkBytes.length,
};

writeFileSync("sui_format.json", JSON.stringify(output, null, 2));
console.log("\nSaved to sui_format.json");
