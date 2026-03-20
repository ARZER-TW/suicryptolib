/**
 * Compute sender_hash from Sui wallet address.
 *
 * sender_hash is used to bind the ZK proof to a specific sender,
 * preventing proof replay attacks.
 *
 * Strategy: take the Sui address as a BigInt, reduce mod BN254 scalar
 * field order to ensure it fits in the field, then use it directly
 * as the sender_hash. Simple and deterministic.
 */

const BN254_R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Convert a Sui address (0x...) to a BN254 field element for use as sender_hash.
 * @param {string} address - Sui address (0x + 64 hex chars)
 * @returns {string} decimal string suitable for Circom input
 */
export function addressToSenderHash(address) {
  const addr = BigInt(address);
  const inField = addr % BN254_R;
  return inField.toString();
}
