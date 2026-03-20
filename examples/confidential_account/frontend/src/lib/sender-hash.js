/**
 * Compute sender_hash from Sui wallet address using Poseidon hash.
 *
 * Uses Poseidon (BN254-compatible) to map a 256-bit Sui address
 * into a BN254 scalar field element, avoiding the collision risk
 * of simple modular reduction.
 *
 * The address is split into two 128-bit limbs and fed into Poseidon(hi, lo).
 */
import { buildPoseidon } from "circomlibjs";

let poseidonInstance = null;

async function getPoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

/**
 * Convert a Sui address (0x...) to a BN254 field element via Poseidon hash.
 * @param {string} address - Sui address (0x + 64 hex chars)
 * @returns {Promise<string>} decimal string suitable for Circom input
 */
export async function addressToSenderHash(address) {
  const poseidon = await getPoseidon();
  const addr = BigInt(address);
  const lo = addr & ((1n << 128n) - 1n);
  const hi = addr >> 128n;
  const hash = poseidon.F.toString(poseidon([hi, lo]));
  return hash;
}
