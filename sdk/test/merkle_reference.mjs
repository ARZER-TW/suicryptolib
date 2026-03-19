/**
 * Generate Merkle tree test vectors for Move tests.
 *
 * Tree structure uses domain separation prefixes:
 *   leaf hash   = H(0x00 || data)
 *   internal    = H(0x01 || left || right)
 *
 * This prevents second preimage attacks where an attacker crafts
 * a leaf that is interpreted as an internal node.
 */
import { createHash } from "crypto";

function sha256(data) {
  return createHash("sha256").update(data).digest();
}

function hashLeaf(data) {
  // 0x00 prefix for leaf
  const prefixed = Buffer.concat([Buffer.from([0x00]), Buffer.from(data)]);
  return sha256(prefixed);
}

function hashPair(left, right) {
  // 0x01 prefix for internal node
  const prefixed = Buffer.concat([Buffer.from([0x01]), left, right]);
  return sha256(prefixed);
}

function bytesToMoveHex(buf) {
  return 'x"' + buf.toString("hex") + '"';
}

// --- Test Case 1: 2 leaves, depth 1 ---
console.log("=== Test Case 1: 2 leaves (depth 1) ===\n");
{
  const leaf0 = hashLeaf(Buffer.from("alice"));
  const leaf1 = hashLeaf(Buffer.from("bob"));
  const root = hashPair(leaf0, leaf1);

  console.log(`leaf0 = hashLeaf("alice") = ${bytesToMoveHex(leaf0)}`);
  console.log(`leaf1 = hashLeaf("bob")   = ${bytesToMoveHex(leaf1)}`);
  console.log(`root  = hashPair(l0, l1)  = ${bytesToMoveHex(root)}`);
  console.log();

  // Proof for leaf0 (position left=0): sibling is leaf1
  console.log("Proof for leaf0: sibling=[leaf1], positions=[0]");
  // Proof for leaf1 (position right=1): sibling is leaf0
  console.log("Proof for leaf1: sibling=[leaf0], positions=[1]");
  console.log();
}

// --- Test Case 2: 4 leaves, depth 2 ---
console.log("=== Test Case 2: 4 leaves (depth 2) ===\n");
{
  const leaves = ["alice", "bob", "charlie", "dave"].map((s) =>
    hashLeaf(Buffer.from(s))
  );
  const node01 = hashPair(leaves[0], leaves[1]);
  const node23 = hashPair(leaves[2], leaves[3]);
  const root = hashPair(node01, node23);

  for (let i = 0; i < 4; i++) {
    console.log(
      `leaf${i} = hashLeaf("${["alice", "bob", "charlie", "dave"][i]}") = ${bytesToMoveHex(leaves[i])}`
    );
  }
  console.log(`node01 = hashPair(l0, l1)       = ${bytesToMoveHex(node01)}`);
  console.log(`node23 = hashPair(l2, l3)       = ${bytesToMoveHex(node23)}`);
  console.log(`root   = hashPair(n01, n23)     = ${bytesToMoveHex(root)}`);
  console.log();

  // Proof for leaf0: path = [leaf1, node23], positions = [0, 0]
  // Level 0: leaf0 is on left (pos=0), sibling = leaf1
  // Level 1: node01 is on left (pos=0), sibling = node23
  console.log("Proof for leaf0: siblings=[leaf1, node23], positions=[0, 0]");

  // Proof for leaf2: path = [leaf3, node01], positions = [0, 1]
  // Level 0: leaf2 is on left (pos=0), sibling = leaf3
  // Level 1: node23 is on right (pos=1), sibling = node01
  console.log("Proof for leaf2: siblings=[leaf3, node01], positions=[0, 1]");

  // Proof for leaf3: path = [leaf2, node01], positions = [1, 1]
  // Level 0: leaf3 is on right (pos=1), sibling = leaf2
  // Level 1: node23 is on right (pos=1), sibling = node01
  console.log("Proof for leaf3: siblings=[leaf2, node01], positions=[1, 1]");
  console.log();
}

// --- Output Move test code ---
console.log("=== Move Test Vector Code ===\n");
{
  const leaves = ["alice", "bob", "charlie", "dave"].map((s) =>
    hashLeaf(Buffer.from(s))
  );
  const node01 = hashPair(leaves[0], leaves[1]);
  const node23 = hashPair(leaves[2], leaves[3]);
  const root = hashPair(node01, node23);

  console.log("// 4-leaf tree test vectors (SHA256)");
  console.log(`let leaf0 = ${bytesToMoveHex(leaves[0])};`);
  console.log(`let leaf1 = ${bytesToMoveHex(leaves[1])};`);
  console.log(`let leaf2 = ${bytesToMoveHex(leaves[2])};`);
  console.log(`let leaf3 = ${bytesToMoveHex(leaves[3])};`);
  console.log(`let node01 = ${bytesToMoveHex(node01)};`);
  console.log(`let node23 = ${bytesToMoveHex(node23)};`);
  console.log(`let root = ${bytesToMoveHex(root)};`);
  console.log();
  console.log(
    "// Proof for leaf0: siblings=[leaf1, node23], positions=[0, 0]"
  );
  console.log("// verify_proof(root, leaf0, [leaf1, node23], [0, 0], 0)");
  console.log();
  console.log(
    "// Proof for leaf3: siblings=[leaf2, node01], positions=[1, 1]"
  );
  console.log("// verify_proof(root, leaf3, [leaf2, node01], [1, 1], 0)");
}
