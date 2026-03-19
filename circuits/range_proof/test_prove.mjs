/**
 * Generate Range Proof test vectors and convert to Sui format.
 * Tests both valid (in-range) and boundary values.
 */
import { readFileSync } from "fs";
import * as snarkjs from "snarkjs";

const BN254_P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function bigintToBytes32LE(value) {
  const buf = new Uint8Array(32);
  let v = BigInt(value);
  for (let i = 0; i < 32; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
  return buf;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function serializeG1Compressed(point) {
  const x = BigInt(point[0]), y = BigInt(point[1]);
  if (x === 0n && y === 0n) { const buf = new Uint8Array(32); buf[31] = 0x40; return buf; }
  const xBytes = bigintToBytes32LE(x);
  if (y > BN254_P / 2n) xBytes[31] |= 0x80;
  return xBytes;
}
function serializeG2Compressed(point) {
  const xC0 = BigInt(point[0][0]), xC1 = BigInt(point[0][1]);
  const yC0 = BigInt(point[1][0]), yC1 = BigInt(point[1][1]);
  const c0 = bigintToBytes32LE(xC0), c1 = bigintToBytes32LE(xC1);
  let yNeg = yC1 !== 0n ? yC1 > BN254_P / 2n : yC0 > BN254_P / 2n;
  if (yNeg) c1[31] |= 0x80;
  const r = new Uint8Array(64); r.set(c0, 0); r.set(c1, 32); return r;
}
function convertProof(proof) {
  const r = new Uint8Array(128);
  r.set(serializeG1Compressed(proof.pi_a), 0);
  r.set(serializeG2Compressed(proof.pi_b), 32);
  r.set(serializeG1Compressed(proof.pi_c), 96);
  return r;
}
function convertPublicInputs(signals) {
  const r = new Uint8Array(signals.length * 32);
  for (let i = 0; i < signals.length; i++) r.set(bigintToBytes32LE(BigInt(signals[i])), i * 32);
  return r;
}
function convertVK(vk) {
  const parts = [
    serializeG1Compressed(vk.vk_alpha_1),
    serializeG2Compressed(vk.vk_beta_2),
    serializeG2Compressed(vk.vk_gamma_2),
    serializeG2Compressed(vk.vk_delta_2),
  ];
  const icLen = new Uint8Array(8);
  let len = BigInt(vk.IC.length);
  for (let i = 0; i < 8; i++) { icLen[i] = Number(len & 0xffn); len >>= 8n; }
  const ics = vk.IC.map(ic => serializeG1Compressed(ic));
  const total = 32 + 64 + 64 + 64 + 8 + vk.IC.length * 32;
  const r = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { r.set(p, off); off += p.length; }
  r.set(icLen, off); off += 8;
  for (const ic of ics) { r.set(ic, off); off += 32; }
  return r;
}

async function proveAndVerify(label, input) {
  console.log(`\n--- ${label} ---`);
  console.log("Input:", JSON.stringify(input));

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input,
      "range_proof_64_js/range_proof_64.wasm",
      "range_proof_final.zkey"
    );

    const vk = JSON.parse(readFileSync("verification_key.json", "utf8"));
    const valid = await snarkjs.groth16.verify(vk, publicSignals, proof);
    console.log(`Local verify: ${valid ? "PASS" : "FAIL"}`);

    if (valid) {
      const proofBytes = convertProof(proof);
      const inputsBytes = convertPublicInputs(publicSignals);
      const vkBytes = convertVK(vk);

      console.log(`Proof (${proofBytes.length}b): x"${bytesToHex(proofBytes)}"`);
      console.log(`Public inputs (${inputsBytes.length}b): x"${bytesToHex(inputsBytes)}"`);
      console.log(`VK (${vkBytes.length}b): x"${bytesToHex(vkBytes)}"`);
    }

    return { proof, publicSignals, valid };
  } catch (e) {
    console.log(`Proof generation FAILED (expected for out-of-range): ${e.message.substring(0, 100)}`);
    return { valid: false, error: true };
  }
}

async function main() {
  console.log("=== Range Proof Test Vectors ===");

  // Test 1: Normal value
  await proveAndVerify("value=1000 (normal)", {
    value: "1000",
    blinding: "98765432109876543210",
    sender_hash: "42",
  });

  // Test 2: value=0 (boundary)
  await proveAndVerify("value=0 (boundary min)", {
    value: "0",
    blinding: "11111111111111111111",
    sender_hash: "42",
  });

  // Test 3: value=2^64-1 (boundary max)
  await proveAndVerify("value=2^64-1 (boundary max)", {
    value: (2n**64n - 1n).toString(),
    blinding: "22222222222222222222",
    sender_hash: "42",
  });

  // Test 4: value=2^64 (should FAIL - out of range)
  await proveAndVerify("value=2^64 (out of range, should fail)", {
    value: (2n**64n).toString(),
    blinding: "33333333333333333333",
    sender_hash: "42",
  });
}

main().catch(console.error);
