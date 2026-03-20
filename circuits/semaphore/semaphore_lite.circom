pragma circom 2.1.5;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/mux1.circom";

/**
 * Simplified Semaphore: Anonymous Group Membership Proof + Nullifier
 *
 * Proves:
 *   1. I know (identity_secret, identity_nullifier) such that
 *      Poseidon(identity_secret, identity_nullifier) is a leaf in the Merkle tree
 *   2. The Merkle tree root matches the public input merkleRoot
 *   3. nullifier_hash = Poseidon(identity_nullifier, external_nullifier)
 *
 * Privacy:
 *   - On-chain observers see merkle_root + nullifier_hash
 *   - They CANNOT determine which member generated the proof
 *   - nullifier_hash prevents the same member from acting twice
 *     for the same external_nullifier (e.g., same vote proposal)
 *
 * Public inputs (3): merkleRoot, nullifierHash, externalNullifier
 * Private inputs: identitySecret, identityNullifier, pathElements[], pathIndices[]
 */
template SemaphoreLite(levels) {
    // Public inputs
    signal input merkleRoot;
    signal input nullifierHash;
    signal input externalNullifier;

    // Private inputs
    signal input identitySecret;
    signal input identityNullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // 1. Compute identity commitment = Poseidon(secret, nullifier_key)
    component identityHasher = Poseidon(2);
    identityHasher.inputs[0] <== identitySecret;
    identityHasher.inputs[1] <== identityNullifier;

    // 2. Verify Merkle proof (Poseidon tree)
    component hashers[levels];
    component mux[levels];

    signal hashes[levels + 1];
    hashes[0] <== identityHasher.out;

    for (var i = 0; i < levels; i++) {
        // Constrain pathIndices to be binary
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // Select ordering based on path index
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== hashes[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== hashes[i];
        mux[i].s <== pathIndices[i];

        // Hash the pair
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        hashes[i + 1] <== hashers[i].out;
    }

    // Check computed root matches public input
    merkleRoot === hashes[levels];

    // 3. Compute and verify nullifier hash
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== identityNullifier;
    nullifierHasher.inputs[1] <== externalNullifier;
    nullifierHash === nullifierHasher.out;
}

// depth=8 for demo (256 members max, smaller zkey, faster proof)
component main {public [merkleRoot, nullifierHash, externalNullifier]} = SemaphoreLite(8);
