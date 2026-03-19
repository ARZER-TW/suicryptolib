import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StandardMerkleTree, PoseidonMerkleTree } from "../src/merkle.js";

describe("StandardMerkleTree", () => {
  describe("basic tree operations", () => {
    it("should build a 2-leaf tree", () => {
      const tree = new StandardMerkleTree(["alice", "bob"]);
      assert.equal(tree.size, 2);
      assert.equal(tree.getRoot().length, 64); // 32 bytes hex
    });

    it("should build a 4-leaf tree with correct root", () => {
      const tree = new StandardMerkleTree(["alice", "bob", "charlie", "dave"]);
      assert.equal(tree.size, 4);
      // Cross-validated with Move test vectors
      assert.equal(
        tree.getRoot(),
        "ebba995839ee5ec0a720998bfefba84675244b9684b9203aade54754bb602ed5"
      );
    });

    it("should produce deterministic root", () => {
      const a = new StandardMerkleTree(["alice", "bob"]);
      const b = new StandardMerkleTree(["alice", "bob"]);
      assert.equal(a.getRoot(), b.getRoot());
    });

    it("should produce different root for different leaves", () => {
      const a = new StandardMerkleTree(["alice", "bob"]);
      const b = new StandardMerkleTree(["alice", "eve"]);
      assert.notEqual(a.getRoot(), b.getRoot());
    });
  });

  describe("proof generation + verification", () => {
    it("should generate valid proof for leaf 0 in 2-leaf tree", () => {
      const tree = new StandardMerkleTree(["alice", "bob"]);
      const { proof, positions, leafHash } = tree.getProof(0);

      assert.equal(proof.length, 1);
      assert.equal(positions.length, 1);
      assert.equal(positions[0], 0); // alice is left child
      assert.equal(leafHash.length, 64);
    });

    it("should generate valid proof for leaf 1 in 2-leaf tree", () => {
      const tree = new StandardMerkleTree(["alice", "bob"]);
      const { positions } = tree.getProof(1);
      assert.equal(positions[0], 1); // bob is right child
    });

    it("should generate correct proof for 4-leaf tree", () => {
      const tree = new StandardMerkleTree(["alice", "bob", "charlie", "dave"]);

      // Leaf 0 (alice): siblings=[bob_hash, node23], positions=[0, 0]
      const p0 = tree.getProof(0);
      assert.equal(p0.proof.length, 2);
      assert.deepEqual(p0.positions, [0, 0]);

      // Leaf 3 (dave): siblings=[charlie_hash, node01], positions=[1, 1]
      const p3 = tree.getProof(3);
      assert.equal(p3.proof.length, 2);
      assert.deepEqual(p3.positions, [1, 1]);
    });

    it("should produce Move-compatible proof format", () => {
      const tree = new StandardMerkleTree(["alice", "bob"]);
      const moveProof = tree.getProofForMove(0);

      assert.equal(moveProof.root.length, 32); // 32 bytes
      assert.equal(moveProof.leaf.length, 32);
      assert.equal(moveProof.proof.length, 1);
      assert.equal(moveProof.proof[0].length, 32);
      assert.equal(moveProof.scheme, 0);
    });
  });

  describe("edge cases", () => {
    it("should handle single leaf", () => {
      const tree = new StandardMerkleTree(["only"]);
      const { proof, positions } = tree.getProof(0);
      assert.equal(proof.length, 0); // no siblings needed
      assert.equal(positions.length, 0);
    });

    it("should handle odd number of leaves", () => {
      const tree = new StandardMerkleTree(["a", "b", "c"]);
      assert.equal(tree.size, 3);
      // Should not throw
      const p = tree.getProof(2);
      assert.ok(p.proof.length > 0);
    });

    it("should reject empty leaves", () => {
      assert.throws(() => new StandardMerkleTree([]), /zero leaves/);
    });

    it("should reject out of range index", () => {
      const tree = new StandardMerkleTree(["a"]);
      assert.throws(() => tree.getProof(1), /out of range/);
      assert.throws(() => tree.getProof(-1), /out of range/);
    });
  });
});

describe("PoseidonMerkleTree", () => {
  describe("basic operations", () => {
    it("should build a 2-leaf tree with correct root", async () => {
      const tree = await PoseidonMerkleTree.create([100n, 200n]);
      assert.equal(tree.size, 2);
      // Cross-validated with circomlibjs and Move test
      assert.equal(
        tree.getRoot(),
        3699275827636970843851136077830925792907611923069205979397427147713774628412n
      );
    });

    it("should build a 4-leaf tree with correct root", async () => {
      const tree = await PoseidonMerkleTree.create([111n, 222n, 333n, 444n]);
      // Cross-validated with circomlibjs and Move test
      assert.equal(
        tree.getRoot(),
        2627613426887678919670906595223549159912332087418882198813349531614684120136n
      );
    });

    it("should be deterministic", async () => {
      const a = await PoseidonMerkleTree.create([100n, 200n]);
      const b = await PoseidonMerkleTree.create([100n, 200n]);
      assert.equal(a.getRoot(), b.getRoot());
    });
  });

  describe("proof generation", () => {
    it("should generate proof for leaf 0 in 4-leaf tree", async () => {
      const tree = await PoseidonMerkleTree.create([111n, 222n, 333n, 444n]);
      const { proof, positions, leaf } = tree.getProof(0);

      assert.equal(leaf, 111n);
      assert.equal(proof.length, 2);
      assert.deepEqual(positions, [0, 0]);
      // Sibling of leaf0 is leaf1 = 222
      assert.equal(proof[0], 222n);
    });

    it("should generate proof for leaf 3 in 4-leaf tree", async () => {
      const tree = await PoseidonMerkleTree.create([111n, 222n, 333n, 444n]);
      const { proof, positions, leaf } = tree.getProof(3);

      assert.equal(leaf, 444n);
      assert.deepEqual(positions, [1, 1]);
      // Sibling of leaf3 is leaf2 = 333
      assert.equal(proof[0], 333n);
    });
  });

  describe("Semaphore-style identity commitments", () => {
    it("should compute identity commitment matching Move", async () => {
      const commitment = await PoseidonMerkleTree.computeIdentityCommitment(
        12345n,
        67890n
      );
      // Cross-validated with Move test
      assert.equal(
        commitment,
        11344094074881186137859743404234365978119253787583526441303892667757095072923n
      );
    });

    it("should build tree from identity commitments", async () => {
      const id1 = await PoseidonMerkleTree.computeIdentityCommitment(12345n, 67890n);
      const id2 = await PoseidonMerkleTree.computeIdentityCommitment(11111n, 22222n);

      const tree = await PoseidonMerkleTree.create([id1, id2]);
      // Cross-validated with Move test
      assert.equal(
        tree.getRoot(),
        4795017070673638622195357555868476850739718765983730710143355006520760102244n
      );
    });
  });

  describe("edge cases", () => {
    it("should handle single leaf", async () => {
      const tree = await PoseidonMerkleTree.create([42n]);
      assert.equal(tree.getRoot(), 42n); // single leaf = root
      const { proof } = tree.getProof(0);
      assert.equal(proof.length, 0);
    });

    it("should reject empty leaves", async () => {
      await assert.rejects(
        () => PoseidonMerkleTree.create([]),
        /zero leaves/
      );
    });
  });
});
