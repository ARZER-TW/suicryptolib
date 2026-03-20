/**
 * ZK Proof generation for Confidential Account.
 *
 * Generates Range Proof (which embeds Pedersen commitment) using snarkjs
 * in the browser, then converts to Sui's Arkworks format.
 */
import * as snarkjs from "snarkjs";
import { convertProof, convertPublicInputs } from "./format-sui";

const RANGE_WASM = "/circuits/range_proof_64.wasm";
const RANGE_ZKEY = "/circuits/range_proof_final.zkey";

/**
 * Generate a Range Proof for a given value and blinding factor.
 *
 * This single proof simultaneously proves:
 *   1. The Pedersen commitment is correctly formed (value*G + blinding*H)
 *   2. The value is in [0, 2^64)
 *
 * @param {string} value - The secret value (decimal string)
 * @param {string} blinding - The random blinding factor (decimal string)
 * @param {string} senderHash - Sender binding hash (decimal string)
 * @param {function} onProgress - Progress callback
 * @returns {{ proofBytes, commitmentX, commitmentY, senderHashBytes }}
 */
export async function generateRangeProof(value, blinding, senderHash, onProgress) {
  onProgress?.("loading");

  const input = {
    value,
    blinding,
    sender_hash: senderHash,
  };

  onProgress?.("proving");

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    RANGE_WASM,
    RANGE_ZKEY
  );

  onProgress?.("converting");

  // Convert proof to Sui format (128 bytes)
  const proofBytes = convertProof(proof);

  // Public signals order (from Circom): [commitment_x, commitment_y, sender_hash]
  const publicInputsBytes = convertPublicInputs(publicSignals);

  // Extract individual public inputs (each 32 bytes LE)
  const commitmentX = publicInputsBytes.slice(0, 32);
  const commitmentY = publicInputsBytes.slice(32, 64);
  const senderHashBytes = publicInputsBytes.slice(64, 96);

  onProgress?.("done");

  return {
    proofBytes,
    commitmentX,
    commitmentY,
    senderHashBytes,
    // Raw values for debugging
    publicSignals,
  };
}

/**
 * Generate a cryptographically secure random blinding factor.
 * Must be less than the BN254 scalar field order.
 * @returns {string} decimal string
 */
export function generateBlinding() {
  const bytes = new Uint8Array(31); // 31 bytes = 248 bits, safely < 254-bit field
  crypto.getRandomValues(bytes);
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result.toString();
}
