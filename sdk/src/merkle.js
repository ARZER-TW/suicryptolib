/**
 * Merkle Tree Builder + Proof Generator (off-chain)
 *
 * Two variants:
 * 1. StandardMerkleTree - SHA256 with domain separation (mirrors suicryptolib::merkle)
 * 2. PoseidonMerkleTree - Poseidon hash (mirrors suicryptolib::merkle_poseidon)
 *
 * The Poseidon variant produces roots identical to circomlib's Poseidon(2)
 * and sui::poseidon::poseidon_bn254, verified by cross-validation tests.
 */
import { createHash } from "crypto";
import { buildPoseidon } from "circomlibjs";

// ==================== Standard Merkle Tree (SHA256) ====================

const LEAF_PREFIX = Buffer.from([0x00]);
const INTERNAL_PREFIX = Buffer.from([0x01]);

function sha256(data) {
  return createHash("sha256").update(data).digest();
}

function hashLeafStandard(data) {
  return sha256(Buffer.concat([LEAF_PREFIX, Buffer.from(data)]));
}

function hashPairStandard(left, right) {
  return sha256(Buffer.concat([INTERNAL_PREFIX, left, right]));
}

/**
 * Standard Merkle Tree using SHA256 with domain separation.
 * Compatible with suicryptolib::merkle Move module.
 */
export class StandardMerkleTree {
  /**
   * @param {(string|Buffer|Uint8Array)[]} leaves - Raw leaf data (will be hashed)
   */
  constructor(leaves) {
    if (leaves.length === 0) {
      throw new Error("Cannot create tree with zero leaves");
    }

    this.leafData = leaves;
    this.leafHashes = leaves.map((l) =>
      hashLeafStandard(typeof l === "string" ? Buffer.from(l) : l)
    );
    this.layers = this._buildLayers();
  }

  _buildLayers() {
    const layers = [this.leafHashes];
    let currentLayer = this.leafHashes;

    while (currentLayer.length > 1) {
      const nextLayer = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right =
          i + 1 < currentLayer.length ? currentLayer[i + 1] : currentLayer[i]; // duplicate last if odd
        nextLayer.push(hashPairStandard(left, right));
      }
      layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    return layers;
  }

  /** Get the Merkle root as hex string */
  getRoot() {
    return this.layers[this.layers.length - 1][0].toString("hex");
  }

  /** Get the Merkle root as byte array (for Move) */
  getRootBytes() {
    return Array.from(this.layers[this.layers.length - 1][0]);
  }

  /**
   * Get proof for a leaf by index.
   * @param {number} index - Leaf index
   * @returns {{ proof: string[], positions: number[], leafHash: string }}
   */
  getProof(index) {
    if (index < 0 || index >= this.leafHashes.length) {
      throw new Error(`Index ${index} out of range [0, ${this.leafHashes.length})`);
    }

    const proof = [];
    const positions = [];
    let currentIndex = index;

    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      const currentLayer = this.layers[layer];
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < currentLayer.length) {
        proof.push(currentLayer[siblingIndex].toString("hex"));
        positions.push(isRight ? 1 : 0);
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      proof,
      positions,
      leafHash: this.leafHashes[index].toString("hex"),
    };
  }

  /**
   * Get proof as Move-compatible format.
   * @param {number} index
   * @returns {{ root: number[], leaf: number[], proof: number[][], positions: number[] }}
   */
  getProofForMove(index) {
    const { proof, positions, leafHash } = this.getProof(index);
    return {
      root: this.getRootBytes(),
      leaf: Array.from(Buffer.from(leafHash, "hex")),
      proof: proof.map((h) => Array.from(Buffer.from(h, "hex"))),
      positions,
      scheme: 0, // SHA256
    };
  }

  /** Number of leaves */
  get size() {
    return this.leafHashes.length;
  }
}

// ==================== Poseidon Merkle Tree ====================

let _poseidon = null;

/**
 * Get or initialize the Poseidon hash instance.
 * Cached after first call.
 */
async function getPoseidon() {
  if (!_poseidon) {
    _poseidon = await buildPoseidon();
  }
  return _poseidon;
}

/**
 * Poseidon Merkle Tree using BN254 field elements.
 * Compatible with suicryptolib::merkle_poseidon Move module
 * and circomlib's Poseidon(2) circuit.
 *
 * All values are BigInt (BN254 scalar field elements).
 */
export class PoseidonMerkleTree {
  /**
   * @param {bigint[]} leaves - Leaf values as BigInt (already field elements)
   */
  static async create(leaves) {
    if (leaves.length === 0) {
      throw new Error("Cannot create tree with zero leaves");
    }
    const poseidon = await getPoseidon();
    const tree = new PoseidonMerkleTree();
    tree.poseidon = poseidon;
    tree.F = poseidon.F;
    tree.leafValues = [...leaves];
    tree.layers = tree._buildLayers();
    return tree;
  }

  _hashPair(left, right) {
    return this.F.toObject(this.poseidon([left, right]));
  }

  _buildLayers() {
    const layers = [this.leafValues];
    let currentLayer = this.leafValues;

    while (currentLayer.length > 1) {
      const nextLayer = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right =
          i + 1 < currentLayer.length ? currentLayer[i + 1] : 0n; // zero for padding
        nextLayer.push(this._hashPair(left, right));
      }
      layers.push(nextLayer);
      currentLayer = nextLayer;
    }

    return layers;
  }

  /** Get Merkle root as BigInt */
  getRoot() {
    return this.layers[this.layers.length - 1][0];
  }

  /**
   * Get proof for a leaf by index.
   * @param {number} index
   * @returns {{ proof: bigint[], positions: number[], leaf: bigint }}
   */
  getProof(index) {
    if (index < 0 || index >= this.leafValues.length) {
      throw new Error(`Index ${index} out of range [0, ${this.leafValues.length})`);
    }

    const proof = [];
    const positions = [];
    let currentIndex = index;

    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      const currentLayer = this.layers[layer];
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      const sibling =
        siblingIndex < currentLayer.length ? currentLayer[siblingIndex] : 0n;
      proof.push(sibling);
      positions.push(isRight ? 1 : 0);

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      proof,
      positions,
      leaf: this.leafValues[index],
    };
  }

  /**
   * Compute an identity commitment (Semaphore-style).
   * commitment = Poseidon(secret, nullifierKey)
   */
  static async computeIdentityCommitment(secret, nullifierKey) {
    const poseidon = await getPoseidon();
    return poseidon.F.toObject(poseidon([secret, nullifierKey]));
  }

  /** Number of leaves */
  get size() {
    return this.leafValues.length;
  }
}
