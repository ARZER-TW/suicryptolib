/**
 * Poseidon Merkle Tree (client-side).
 *
 * Builds a full Merkle tree from identity commitments using circomlibjs
 * Poseidon hash. The tree structure matches the on-chain incremental
 * Merkle tree in semaphore.move.
 */
import { getPoseidon } from "./identity";

export async function buildMerkleTree(commitments, depth) {
  const poseidon = await getPoseidon();
  const F = poseidon.F;

  const maxLeaves = 1 << depth;
  const leaves = new Array(maxLeaves).fill(0n);
  for (let i = 0; i < commitments.length; i++) {
    leaves[i] = BigInt(commitments[i]);
  }

  const layers = [leaves.slice()];
  let layer = leaves;

  for (let d = 0; d < depth; d++) {
    const next = [];
    for (let j = 0; j < layer.length; j += 2) {
      const hash = BigInt(F.toString(poseidon([layer[j], layer[j + 1]])));
      next.push(hash);
    }
    layer = next;
    layers.push(layer.slice());
  }

  return {
    root: layer[0],
    layers,
    depth,
  };
}

export function generateMerkleProof(tree, leafIndex) {
  const pathElements = [];
  const pathIndices = [];
  let idx = leafIndex;

  for (let d = 0; d < tree.depth; d++) {
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    pathElements.push(tree.layers[d][siblingIdx]);
    pathIndices.push(idx % 2);
    idx = Math.floor(idx / 2);
  }

  return { pathElements, pathIndices };
}
