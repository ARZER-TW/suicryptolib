/**
 * Generate Poseidon Merkle tree test vectors for Move tests.
 *
 * Convention (consistent with circomlib/Semaphore):
 *   leaf = identity_commitment (already a field element)
 *   internal node = Poseidon(left, right)
 *   No domain separation prefix (Poseidon differentiates by input count)
 *
 * Zero value for empty leaves = 0 (the additive identity in the field)
 */
import { buildPoseidon } from "circomlibjs";

async function main() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  function hashPair(left, right) {
    return F.toObject(poseidon([left, right]));
  }

  function hashSingle(val) {
    return F.toObject(poseidon([val]));
  }

  // --- Test Case 1: 2-leaf tree ---
  console.log("=== Test Case 1: 2 leaves (depth 1) ===\n");
  {
    // Use simple values as leaves (like identity commitments)
    const leaf0 = 100n;
    const leaf1 = 200n;
    const root = hashPair(leaf0, leaf1);

    console.log(`leaf0 = ${leaf0}`);
    console.log(`leaf1 = ${leaf1}`);
    console.log(`root  = Poseidon(${leaf0}, ${leaf1}) = ${root}`);
    console.log();
  }

  // --- Test Case 2: 4-leaf tree ---
  console.log("=== Test Case 2: 4 leaves (depth 2) ===\n");
  {
    const leaves = [111n, 222n, 333n, 444n];
    const node01 = hashPair(leaves[0], leaves[1]);
    const node23 = hashPair(leaves[2], leaves[3]);
    const root = hashPair(node01, node23);

    console.log("leaves:", leaves.map(String).join(", "));
    console.log(`node01 = Poseidon(${leaves[0]}, ${leaves[1]}) = ${node01}`);
    console.log(`node23 = Poseidon(${leaves[2]}, ${leaves[3]}) = ${node23}`);
    console.log(`root   = Poseidon(node01, node23) = ${root}`);
    console.log();
  }

  // --- Test Case 3: Identity commitment style (like Semaphore) ---
  console.log("=== Test Case 3: Semaphore-style identity commitments ===\n");
  {
    // identity_commitment = Poseidon(secret, nullifier)
    const secret1 = 12345n;
    const nullifier1 = 67890n;
    const id1 = hashPair(secret1, nullifier1);

    const secret2 = 11111n;
    const nullifier2 = 22222n;
    const id2 = hashPair(secret2, nullifier2);

    const root = hashPair(id1, id2);

    console.log(`id1 = Poseidon(${secret1}, ${nullifier1}) = ${id1}`);
    console.log(`id2 = Poseidon(${secret2}, ${nullifier2}) = ${id2}`);
    console.log(`root = Poseidon(id1, id2) = ${root}`);
    console.log();
  }

  // --- Move test assertions ---
  console.log("=== Move Test Assertions ===\n");
  {
    const leaves = [111n, 222n, 333n, 444n];
    const node01 = hashPair(leaves[0], leaves[1]);
    const node23 = hashPair(leaves[2], leaves[3]);
    const root = hashPair(node01, node23);

    console.log("// 4-leaf Poseidon Merkle tree");
    console.log(`let leaf0: u256 = ${leaves[0]};`);
    console.log(`let leaf1: u256 = ${leaves[1]};`);
    console.log(`let leaf2: u256 = ${leaves[2]};`);
    console.log(`let leaf3: u256 = ${leaves[3]};`);
    console.log(`let node01: u256 = ${node01};`);
    console.log(`let node23: u256 = ${node23};`);
    console.log(`let root: u256 = ${root};`);
    console.log();

    // 2-leaf simple
    const l0 = 100n;
    const l1 = 200n;
    const r2 = hashPair(l0, l1);
    console.log("// 2-leaf tree");
    console.log(`let simple_root: u256 = ${r2};`);
    console.log();

    // Hash pair reference
    console.log(`// hash_pair(1, 2) = ${hashPair(1n, 2n)}`);
    console.log(`// hash_leaf(42) = Poseidon(42) = ${hashSingle(42n)}`);
  }
}

main().catch(console.error);
