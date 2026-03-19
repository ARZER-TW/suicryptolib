pragma circom 2.1.5;

include "../node_modules/circomlib/circuits/babyjub.circom";
include "../node_modules/circomlib/circuits/escalarmulfix.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * Pedersen Commitment on BabyJubJub (BN254-compatible)
 *
 * Proves: commitment = value * G + blinding * H
 * Without revealing value or blinding.
 *
 * Public inputs (3, within Sui's 8-input limit):
 *   - commitment_x: x-coordinate of the commitment point
 *   - commitment_y: y-coordinate of the commitment point
 *   - sender_hash: hash of sender address (prevents proof replay / front-running)
 *
 * Private inputs:
 *   - value: the committed value
 *   - blinding: random blinding factor
 *
 * Generator G: BabyJubJub standard base point (from circomlib)
 * Generator H: nothing-up-my-sleeve point derived from SHA256("SuiCryptoLib_Pedersen_H_v1")
 *   Derivation: x = SHA256(seed) mod Fr, try-and-increment until on curve
 *   See scripts/compute_generator_h.mjs for full derivation record.
 *
 * Security properties:
 *   - Hiding: commitment reveals nothing about value (perfect hiding)
 *   - Binding: cannot open to different value (computational binding)
 *   - Homomorphic: C(v1,r1) + C(v2,r2) = C(v1+v2, r1+r2)
 *   - Replay-resistant: proof bound to sender via sender_hash
 */
template PedersenCommitment() {
    // Private inputs
    signal input value;
    signal input blinding;

    // Public inputs
    signal input sender_hash;

    // Public outputs (commitment point coordinates)
    signal output commitment_x;
    signal output commitment_y;

    // Generator G: BabyJubJub standard base point
    var G[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];

    // Generator H: nothing-up-my-sleeve point
    // Derived from SHA256("SuiCryptoLib_Pedersen_H_v1"), try-and-increment
    var H[2] = [
        18267622314187687572088998826809831308727694590966921888299154889300475970589,
        8059698257908533886155608288179897806584863540535702356995467530609830876645
    ];

    // Decompose value to bits for scalar multiplication
    // BabyJubJub subgroup order is ~251 bits, use 253 for safety
    component valueBits = Num2Bits(253);
    valueBits.in <== value;

    // Decompose blinding to bits
    component blindingBits = Num2Bits(253);
    blindingBits.in <== blinding;

    // value * G (fixed-base scalar multiplication)
    component vG = EscalarMulFix(253, G);
    for (var i = 0; i < 253; i++) {
        vG.e[i] <== valueBits.out[i];
    }

    // blinding * H (fixed-base scalar multiplication)
    component rH = EscalarMulFix(253, H);
    for (var i = 0; i < 253; i++) {
        rH.e[i] <== blindingBits.out[i];
    }

    // commitment = vG + rH (point addition on BabyJubJub)
    component add = BabyAdd();
    add.x1 <== vG.out[0];
    add.y1 <== vG.out[1];
    add.x2 <== rH.out[0];
    add.y2 <== rH.out[1];

    commitment_x <== add.xout;
    commitment_y <== add.yout;

    // Sender binding: constrain sender_hash to be part of the proof
    // This prevents front-running (someone extracting and resubmitting the proof)
    // The Move contract verifies sender_hash == poseidon(tx_sender_address)
    signal sender_sq;
    sender_sq <== sender_hash * sender_hash;
}

component main {public [sender_hash]} = PedersenCommitment();
