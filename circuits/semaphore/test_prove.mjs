/**
 * Generate Semaphore test proof and convert to Sui format.
 * Also verifies Poseidon consistency with circomlibjs.
 */
import { readFileSync } from "fs";
import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";

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
  const yNeg = yC1 !== 0n ? yC1 > BN254_P / 2n : yC0 > BN254_P / 2n;
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

async function main() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // --- Identity ---
  const identitySecret = 42n;
  const identityNullifier = 123n;
  const commitment = F.toString(poseidon([identitySecret, identityNullifier]));
  console.log("Identity commitment:", commitment);

  // --- Build Merkle tree (depth=8, 256 leaves) ---
  const depth = 8;
  const leaves = new Array(1 << depth).fill(0n);
  leaves[0] = BigInt(commitment); // Alice is at index 0

  // Build tree layers
  let layer = leaves.map(l => l);
  const layers = [layer.slice()];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (let j = 0; j < layer.length; j += 2) {
      const hash = F.toString(poseidon([layer[j], layer[j + 1]]));
      next.push(BigInt(hash));
    }
    layer = next;
    layers.push(layer.slice());
  }
  const merkleRoot = layer[0];
  console.log("Merkle root:", merkleRoot.toString());

  // --- Generate Merkle proof for index 0 ---
  const pathElements = [];
  const pathIndices = [];
  let idx = 0;
  for (let d = 0; d < depth; d++) {
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    pathElements.push(layers[d][siblingIdx].toString());
    pathIndices.push(idx % 2); // 0 = left, 1 = right
    idx = Math.floor(idx / 2);
  }

  // --- External nullifier (e.g., vote proposal ID) ---
  const externalNullifier = 999n;
  const nullifierHash = F.toString(poseidon([identityNullifier, externalNullifier]));
  console.log("Nullifier hash:", nullifierHash);

  // --- Generate proof ---
  const input = {
    merkleRoot: merkleRoot.toString(),
    nullifierHash: nullifierHash.toString(),
    externalNullifier: externalNullifier.toString(),
    identitySecret: identitySecret.toString(),
    identityNullifier: identityNullifier.toString(),
    pathElements,
    pathIndices,
  };

  console.log("\nGenerating proof...");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    "semaphore_lite_js/semaphore_lite.wasm",
    "semaphore_final.zkey"
  );

  console.log("Public signals:", publicSignals);

  // Verify locally
  const vk = JSON.parse(readFileSync("verification_key.json", "utf8"));
  const valid = await snarkjs.groth16.verify(vk, publicSignals, proof);
  console.log(`Local verification: ${valid ? "PASS" : "FAIL"}`);

  // Convert to Sui format
  const proofBytes = convertProof(proof);
  const publicInputsBytes = convertPublicInputs(publicSignals);
  const vkBytes = convertVK(vk);

  console.log(`\n=== Sui Format ===`);
  console.log(`Proof (${proofBytes.length}b): x"${bytesToHex(proofBytes)}"`);
  console.log(`Public inputs (${publicInputsBytes.length}b): x"${bytesToHex(publicInputsBytes)}"`);
  console.log(`VK (${vkBytes.length}b): x"${bytesToHex(vkBytes)}"`);

  // Output test values for Move tests
  console.log(`\n=== Move Test Values ===`);
  console.log(`commitment (u256): ${commitment}`);
  console.log(`merkle_root (u256): ${merkleRoot}`);
  console.log(`nullifier_hash (u256): ${nullifierHash}`);
  console.log(`external_nullifier (u256): ${externalNullifier}`);

  // Verify zero-value hashes (for incremental tree initialization)
  console.log(`\n=== Zero Value Hashes (for incremental tree) ===`);
  let zeroHash = 0n;
  for (let d = 0; d < depth; d++) {
    const nextZero = BigInt(F.toString(poseidon([zeroHash, zeroHash])));
    console.log(`  zeros[${d}] = ${zeroHash}`);
    console.log(`  hash(zeros[${d}], zeros[${d}]) = ${nextZero}`);
    zeroHash = nextZero;
  }
  console.log(`  empty tree root = ${zeroHash}`);
}

main().catch(console.error);
