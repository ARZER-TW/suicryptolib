pragma circom 2.1.5;

include "../node_modules/circomlib/circuits/babyjub.circom";
include "../node_modules/circomlib/circuits/escalarmulfix.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/**
 * Range Proof with embedded Pedersen Commitment (64-bit)
 *
 * Proves BOTH:
 *   1. commitment = value * G + blinding * H  (Pedersen commitment is valid)
 *   2. value is in [0, 2^64)                  (value is non-negative and bounded)
 *
 * CRITICAL: Both proofs share the same `value` signal. This prevents the
 * "binding detachment" attack where an attacker generates a valid Pedersen
 * proof for one value and a valid range proof for a different value.
 *
 * Public inputs (3, within Sui's 8-input limit):
 *   - commitment_x, commitment_y: the commitment point
 *   - sender_hash: anti-replay binding
 *
 * Private inputs:
 *   - value: the committed value (must be in [0, 2^64))
 *   - blinding: random blinding factor
 */
template RangeProof64() {
    // Private inputs
    signal input value;
    signal input blinding;

    // Public inputs
    signal input sender_hash;

    // Public outputs
    signal output commitment_x;
    signal output commitment_y;

    // === Part 1: Range check via bit decomposition ===
    // Num2Bits(64) decomposes value into 64 bits and constrains each bit to {0,1}.
    // This proves value is in [0, 2^64 - 1].
    // If value >= 2^64, the decomposition will fail (no valid witness exists).
    component rangeBits = Num2Bits(64);
    rangeBits.in <== value;

    // === Part 2: Pedersen Commitment (same value, shared signal) ===

    // Generator G: BabyJubJub standard base point
    var G[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];

    // Generator H: nothing-up-my-sleeve point
    // SHA256("SuiCryptoLib_Pedersen_H_v1") try-and-increment
    var H[2] = [
        18267622314187687572088998826809831308727694590966921888299154889300475970589,
        8059698257908533886155608288179897806584863540535702356995467530609830876645
    ];

    // Decompose value to bits for EC scalar multiplication (253 bits for BabyJubJub)
    component valueBits = Num2Bits(253);
    valueBits.in <== value;

    // Decompose blinding to bits
    component blindingBits = Num2Bits(253);
    blindingBits.in <== blinding;

    // value * G
    component vG = EscalarMulFix(253, G);
    for (var i = 0; i < 253; i++) {
        vG.e[i] <== valueBits.out[i];
    }

    // blinding * H
    component rH = EscalarMulFix(253, H);
    for (var i = 0; i < 253; i++) {
        rH.e[i] <== blindingBits.out[i];
    }

    // commitment = vG + rH
    component add = BabyAdd();
    add.x1 <== vG.out[0];
    add.y1 <== vG.out[1];
    add.x2 <== rH.out[0];
    add.y2 <== rH.out[1];

    commitment_x <== add.xout;
    commitment_y <== add.yout;

    // === Part 3: Sender binding ===
    signal sender_sq;
    sender_sq <== sender_hash * sender_hash;
}

component main {public [sender_hash]} = RangeProof64();
