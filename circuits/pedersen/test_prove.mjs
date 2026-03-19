/**
 * Generate a test Pedersen Commitment proof and convert to Sui format.
 */
import { readFileSync } from "fs";
import * as snarkjs from "snarkjs";

// Import the format converter from our PoC
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

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function serializeG1Compressed(point) {
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);
  if (x === 0n && y === 0n) {
    const buf = new Uint8Array(32); buf[31] = 0x40; return buf;
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
  if (xC0 === 0n && xC1 === 0n && yC0 === 0n && yC1 === 0n) {
    const buf = new Uint8Array(64); buf[63] = 0x40; return buf;
  }
  const c0Bytes = bigintToBytes32LE(xC0);
  const c1Bytes = bigintToBytes32LE(xC1);
  let yNeg;
  if (yC1 !== 0n) { yNeg = yC1 > BN254_P / 2n; }
  else { yNeg = yC0 > BN254_P / 2n; }
  if (yNeg) c1Bytes[31] |= 0x80;
  const result = new Uint8Array(64);
  result.set(c0Bytes, 0); result.set(c1Bytes, 32);
  return result;
}

function convertProof(proof) {
  const result = new Uint8Array(128);
  result.set(serializeG1Compressed(proof.pi_a), 0);
  result.set(serializeG2Compressed(proof.pi_b), 32);
  result.set(serializeG1Compressed(proof.pi_c), 96);
  return result;
}

function convertPublicInputs(signals) {
  const result = new Uint8Array(signals.length * 32);
  for (let i = 0; i < signals.length; i++) {
    result.set(bigintToBytes32LE(BigInt(signals[i])), i * 32);
  }
  return result;
}

function convertVK(vk) {
  const alpha = serializeG1Compressed(vk.vk_alpha_1);
  const beta = serializeG2Compressed(vk.vk_beta_2);
  const gamma = serializeG2Compressed(vk.vk_gamma_2);
  const delta = serializeG2Compressed(vk.vk_delta_2);
  const icLen = vk.IC.length;
  const icLenBytes = new Uint8Array(8);
  let len = BigInt(icLen);
  for (let i = 0; i < 8; i++) { icLenBytes[i] = Number(len & 0xffn); len >>= 8n; }
  const icBytes = new Uint8Array(icLen * 32);
  for (let i = 0; i < icLen; i++) {
    icBytes.set(serializeG1Compressed(vk.IC[i]), i * 32);
  }
  const totalLen = 32 + 64 + 64 + 64 + 8 + icLen * 32;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  result.set(alpha, offset); offset += 32;
  result.set(beta, offset); offset += 64;
  result.set(gamma, offset); offset += 64;
  result.set(delta, offset); offset += 64;
  result.set(icLenBytes, offset); offset += 8;
  result.set(icBytes, offset);
  return result;
}

// --- Main ---
async function main() {
  const input = {
    value: "1000",     // committed value
    blinding: "12345678901234567890",  // random blinding factor
    sender_hash: "9999",  // simulated sender hash
  };

  console.log("=== Generating Pedersen Commitment Proof ===\n");
  console.log("Input:", input);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "pedersen_commitment_js/pedersen_commitment.wasm",
    "pedersen_final.zkey"
  );

  console.log("\nPublic signals (commitment_x, commitment_y, sender_hash):");
  publicSignals.forEach((s, i) => console.log(`  [${i}]: ${s}`));

  // Verify locally
  const vk = JSON.parse(readFileSync("verification_key.json", "utf8"));
  const localValid = await snarkjs.groth16.verify(vk, publicSignals, proof);
  console.log(`\nLocal verification: ${localValid ? "PASS" : "FAIL"}`);

  // Convert to Sui format
  const proofBytes = convertProof(proof);
  const publicInputsBytes = convertPublicInputs(publicSignals);
  const vkBytes = convertVK(vk);

  console.log(`\n=== Sui Format ===`);
  console.log(`\nProof (${proofBytes.length} bytes):`);
  console.log(`  x"${bytesToHex(proofBytes)}"`);
  console.log(`\nPublic inputs (${publicInputsBytes.length} bytes, ${publicSignals.length} signals):`);
  console.log(`  x"${bytesToHex(publicInputsBytes)}"`);
  console.log(`\nVK (${vkBytes.length} bytes):`);
  console.log(`  x"${bytesToHex(vkBytes)}"`);
}

main().catch(console.error);
