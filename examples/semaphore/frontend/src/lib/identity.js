/**
 * Semaphore Identity management.
 *
 * An identity consists of:
 *   - secret: random BN254 field element
 *   - nullifierKey: random BN254 field element
 *   - commitment: Poseidon(secret, nullifierKey)
 *
 * The commitment is public (goes on-chain in the Merkle tree).
 * The secret and nullifierKey are private (stored locally).
 */
import { buildPoseidon } from "circomlibjs";

let poseidonInstance = null;

export async function getPoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

function randomFieldElement() {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let result = 0n;
  for (let i = 0; i < bytes.length; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

export async function createIdentity() {
  const poseidon = await getPoseidon();
  const secret = randomFieldElement();
  const nullifierKey = randomFieldElement();
  const commitment = BigInt(poseidon.F.toString(poseidon([secret, nullifierKey])));
  return { secret, nullifierKey, commitment };
}

export function identityToJSON(identity) {
  return JSON.stringify({
    secret: identity.secret.toString(),
    nullifierKey: identity.nullifierKey.toString(),
    commitment: identity.commitment.toString(),
  });
}

export function identityFromJSON(json) {
  const obj = typeof json === "string" ? JSON.parse(json) : json;
  return {
    secret: BigInt(obj.secret),
    nullifierKey: BigInt(obj.nullifierKey),
    commitment: BigInt(obj.commitment),
  };
}

// --- localStorage ---

const STORE_KEY = "semaphore_identities";

export function saveIdentity(groupId, identity) {
  const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  all[groupId] = identityToJSON(identity);
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}

export function getIdentity(groupId) {
  const all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  if (!all[groupId]) return null;
  return identityFromJSON(all[groupId]);
}
