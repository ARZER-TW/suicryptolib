/**
 * Semaphore ZK proof generation.
 *
 * Generates a Groth16 proof that:
 *   1. The prover knows (secret, nullifierKey) whose commitment is in the tree
 *   2. nullifierHash = Poseidon(nullifierKey, externalNullifier) is correct
 *
 * Uses snarkjs in the browser (~2-5 seconds for depth=8).
 */
import * as snarkjs from "snarkjs";
import { getPoseidon } from "./identity";

const WASM_PATH = "/circuits/semaphore_lite.wasm";
const ZKEY_PATH = "/circuits/semaphore_final.zkey";

const BN254_P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function bigintToBytes32LE(value) {
  const buf = new Uint8Array(32);
  let v = BigInt(value);
  for (let i = 0; i < 32; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
  return buf;
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

export async function generateSemaphoreProof({
  identity,
  merkleProof,
  merkleRoot,
  externalNullifier,
  onProgress,
}) {
  const poseidon = await getPoseidon();
  const F = poseidon.F;

  // Compute nullifier hash
  const nullifierHash = BigInt(
    F.toString(poseidon([identity.nullifierKey, BigInt(externalNullifier)]))
  );

  onProgress?.("proving");

  const input = {
    merkleRoot: merkleRoot.toString(),
    nullifierHash: nullifierHash.toString(),
    externalNullifier: externalNullifier.toString(),
    identitySecret: identity.secret.toString(),
    identityNullifier: identity.nullifierKey.toString(),
    pathElements: merkleProof.pathElements.map((e) => e.toString()),
    pathIndices: merkleProof.pathIndices,
  };

  const { proof } = await snarkjs.groth16.fullProve(input, WASM_PATH, ZKEY_PATH);

  onProgress?.("converting");

  const proofBytes = convertProof(proof);

  onProgress?.("done");

  return {
    proofBytes,
    nullifierHash,
    merkleRoot,
    externalNullifier: BigInt(externalNullifier),
  };
}

export { bigintToBytes32LE };
