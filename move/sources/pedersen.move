/// Pedersen Commitment via Groth16 Bridge
///
/// Proves knowledge of (value, blinding) such that
/// commitment = value * G + blinding * H on BabyJubJub curve,
/// without revealing value or blinding.
///
/// Properties:
///   - Perfect hiding: commitment reveals nothing about value
///   - Computational binding: cannot open to different value
///   - Homomorphic: C(v1,r1) + C(v2,r2) = C(v1+v2, r1+r2)
///
/// On-chain verification uses sui::groth16 (BN254).
/// Off-chain proof generation uses Circom + snarkjs.
module suicryptolib::pedersen {
    use sui::groth16;

    // --- Error codes ---

    /// Commitment point coordinates must be 32 bytes each
    const EInvalidCommitmentLength: u64 = 0;

    // --- Structs ---

    /// A Pedersen Commitment point on BabyJubJub.
    /// Represents C = value * G + blinding * H.
    public struct PedersenCommitment has store, copy, drop {
        point_x: vector<u8>,  // 32 bytes, BN254 scalar field element (LE)
        point_y: vector<u8>,  // 32 bytes, BN254 scalar field element (LE)
    }

    // --- Public functions ---

    /// Create a PedersenCommitment from point coordinates.
    /// Coordinates must be 32-byte little-endian BN254 scalar field elements.
    public fun from_point(point_x: vector<u8>, point_y: vector<u8>): PedersenCommitment {
        assert!(vector::length(&point_x) == 32, EInvalidCommitmentLength);
        assert!(vector::length(&point_y) == 32, EInvalidCommitmentLength);
        PedersenCommitment { point_x, point_y }
    }

    /// Verify a Pedersen Commitment proof.
    ///
    /// Proves that the prover knows (value, blinding) such that
    /// commitment = value * G + blinding * H, without revealing either.
    ///
    /// sender_hash binds the proof to a specific sender (prevents replay).
    /// The caller should compute sender_hash = poseidon(sender_address).
    public fun verify_commitment_proof(
        commitment: &PedersenCommitment,
        sender_hash: vector<u8>,
        proof_bytes: vector<u8>,
    ): bool {
        let pvk = get_pedersen_pvk();
        let curve = groth16::bn254();

        // Public inputs order (from Circom): commitment_x, commitment_y, sender_hash
        let mut public_inputs = vector::empty<u8>();
        vector::append(&mut public_inputs, commitment.point_x);
        vector::append(&mut public_inputs, commitment.point_y);
        vector::append(&mut public_inputs, sender_hash);

        let inputs = groth16::public_proof_inputs_from_bytes(public_inputs);
        let proof = groth16::proof_points_from_bytes(proof_bytes);

        groth16::verify_groth16_proof(&curve, &pvk, &inputs, &proof)
    }

    /// Get the x-coordinate of a commitment
    public fun point_x(c: &PedersenCommitment): vector<u8> { c.point_x }

    /// Get the y-coordinate of a commitment
    public fun point_y(c: &PedersenCommitment): vector<u8> { c.point_y }

    /// Check if two commitments are equal
    public fun equal(a: &PedersenCommitment, b: &PedersenCommitment): bool {
        a.point_x == b.point_x && a.point_y == b.point_y
    }

    // --- Verifying Key ---

    /// Hardcoded Prepared Verifying Key for the Pedersen Commitment circuit.
    /// Generated from trusted setup (see circuits/pedersen/verification_key.json).
    /// NOT upgradeable -- this is a security requirement.
    fun get_pedersen_pvk(): groth16::PreparedVerifyingKey {
        let vk_bytes = x"e2f26dbea299f5223b646cb1fb33eadb059d9407559d7441dfd902e3a79a4d2dabb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036789edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e192d40aa09808ee3bf8244048361285f756d32a225482c0f38dd541c758cd5e1098af98d32954bd8c5aa9991daa87a122067e74312658cb8dd4aea73046ed2be9b0400000000000000335091ee333966e665a9c2c689b39623060201d19875ebeb2a69907fc680d026fb673bd8e3f12ffbbbd5b3f26095f5212440d610cba93a809272b20a063f5c828ca6f63693a320fffc4fbb9b06e289202176eed706d89e872297acf73473ec07d9d0b218268d1881ae9b71e6f85675036035749dcc96d4c6f0414eb5c6c1628c";

        let curve = groth16::bn254();
        groth16::prepare_verifying_key(&curve, &vk_bytes)
    }

    // ========== Tests ==========

    #[test]
    fun test_pedersen_proof_valid() {
        // Test vector from circuits/pedersen/test_prove.mjs
        // Input: value=1000, blinding=12345678901234567890, sender_hash=9999

        let commitment = from_point(
            // commitment_x (32 bytes LE)
            x"f7f866912c298cfe0fa36030f56537e25dcb5e924adf0ae9fe831eb9f236fb01",
            // commitment_y (32 bytes LE)
            x"f90159d69a6c3cabdabbf1f6d8e85b88c997f648e8af2baaca37ff4d7457b22c",
        );

        let sender_hash = x"0f27000000000000000000000000000000000000000000000000000000000000";

        let proof = x"360617e1baf7520ab952c207d19e004b2ee6c91ada5bf21118a410fb5974329a5e77c6bfe34dc2a173526cd529390cb29448174c79e731f1d7c5ad870cdcf7240514196f206fbc38744a118f7df78784b869ab75877667c156d0a2a99a94c2ac25c13db9fda2ae70cc13b3751f18ae8b024b85a5ec504d3db0fe4dd01e84f5ab";

        assert!(verify_commitment_proof(&commitment, sender_hash, proof), 0);
    }

    #[test]
    fun test_pedersen_proof_wrong_sender_fails() {
        let commitment = from_point(
            x"f7f866912c298cfe0fa36030f56537e25dcb5e924adf0ae9fe831eb9f236fb01",
            x"f90159d69a6c3cabdabbf1f6d8e85b88c997f648e8af2baaca37ff4d7457b22c",
        );

        // Wrong sender hash (different from the one used in proof generation)
        let wrong_sender = x"ff27000000000000000000000000000000000000000000000000000000000000";

        let proof = x"360617e1baf7520ab952c207d19e004b2ee6c91ada5bf21118a410fb5974329a5e77c6bfe34dc2a173526cd529390cb29448174c79e731f1d7c5ad870cdcf7240514196f206fbc38744a118f7df78784b869ab75877667c156d0a2a99a94c2ac25c13db9fda2ae70cc13b3751f18ae8b024b85a5ec504d3db0fe4dd01e84f5ab";

        assert!(!verify_commitment_proof(&commitment, wrong_sender, proof), 0);
    }

    #[test]
    fun test_pedersen_proof_wrong_commitment_fails() {
        // Tampered commitment (changed one byte in x)
        let commitment = from_point(
            x"f8f866912c298cfe0fa36030f56537e25dcb5e924adf0ae9fe831eb9f236fb01",
            x"f90159d69a6c3cabdabbf1f6d8e85b88c997f648e8af2baaca37ff4d7457b22c",
        );

        let sender_hash = x"0f27000000000000000000000000000000000000000000000000000000000000";

        let proof = x"360617e1baf7520ab952c207d19e004b2ee6c91ada5bf21118a410fb5974329a5e77c6bfe34dc2a173526cd529390cb29448174c79e731f1d7c5ad870cdcf7240514196f206fbc38744a118f7df78784b869ab75877667c156d0a2a99a94c2ac25c13db9fda2ae70cc13b3751f18ae8b024b85a5ec504d3db0fe4dd01e84f5ab";

        assert!(!verify_commitment_proof(&commitment, sender_hash, proof), 0);
    }

    #[test]
    fun test_from_point() {
        let c = from_point(
            x"0100000000000000000000000000000000000000000000000000000000000000",
            x"0200000000000000000000000000000000000000000000000000000000000000",
        );
        assert!(vector::length(&point_x(&c)) == 32, 0);
        assert!(vector::length(&point_y(&c)) == 32, 1);
    }

    #[test]
    fun test_equal() {
        let a = from_point(
            x"0100000000000000000000000000000000000000000000000000000000000000",
            x"0200000000000000000000000000000000000000000000000000000000000000",
        );
        let b = from_point(
            x"0100000000000000000000000000000000000000000000000000000000000000",
            x"0200000000000000000000000000000000000000000000000000000000000000",
        );
        let c = from_point(
            x"0300000000000000000000000000000000000000000000000000000000000000",
            x"0200000000000000000000000000000000000000000000000000000000000000",
        );
        assert!(equal(&a, &b), 0);
        assert!(!equal(&a, &c), 1);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidCommitmentLength)]
    fun test_invalid_commitment_length() {
        from_point(x"0102", x"0304");
    }
}
