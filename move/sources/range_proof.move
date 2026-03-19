/// Range Proof via Groth16 Bridge (64-bit)
///
/// Proves that a Pedersen Commitment contains a value in [0, 2^64),
/// without revealing the value.
///
/// This circuit EMBEDS the Pedersen Commitment computation, so a single
/// proof simultaneously proves:
///   1. The commitment is correctly formed (value * G + blinding * H)
///   2. The value is in [0, 2^64)
///
/// This prevents "binding detachment" attacks where different proofs
/// are generated for different values and mixed together.
///
/// Use case: proving non-negative balances in confidential transfers,
/// proving bid amounts are valid in sealed auctions.
module suicryptolib::range_proof {
    use sui::groth16;
    use suicryptolib::pedersen::{Self, PedersenCommitment};

    // --- Error codes ---

    /// Sender hash must be 32 bytes
    const EInvalidSenderHash: u64 = 0;

    // --- Public functions ---

    /// Verify that a Pedersen Commitment contains a value in [0, 2^64).
    ///
    /// This simultaneously verifies:
    /// 1. The commitment is a valid Pedersen commitment (value*G + blinding*H)
    /// 2. The committed value is in [0, 2^64 - 1]
    ///
    /// The proof is bound to sender_hash to prevent replay attacks.
    public fun verify_range_64(
        commitment: &PedersenCommitment,
        sender_hash: vector<u8>,
        proof_bytes: vector<u8>,
    ): bool {
        assert!(vector::length(&sender_hash) == 32, EInvalidSenderHash);

        let pvk = get_range64_pvk();
        let curve = groth16::bn254();

        // Public inputs order (from Circom): commitment_x, commitment_y, sender_hash
        let mut public_inputs = vector::empty<u8>();
        vector::append(&mut public_inputs, pedersen::point_x(commitment));
        vector::append(&mut public_inputs, pedersen::point_y(commitment));
        vector::append(&mut public_inputs, sender_hash);

        let inputs = groth16::public_proof_inputs_from_bytes(public_inputs);
        let proof = groth16::proof_points_from_bytes(proof_bytes);

        groth16::verify_groth16_proof(&curve, &pvk, &inputs, &proof)
    }

    // --- Verifying Key ---

    /// Hardcoded VK for the 64-bit Range Proof circuit.
    /// NOT upgradeable.
    fun get_range64_pvk(): groth16::PreparedVerifyingKey {
        let vk_bytes = x"e2f26dbea299f5223b646cb1fb33eadb059d9407559d7441dfd902e3a79a4d2dabb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036789edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e197f5401e0e2e1cb8dab01f7971003bbc17394124f2edd6f17758e1243a955a62c1f15f3d06de46a80b43ac3d9707e21fbb289392c5a6d31133b1aead2e30fdb1904000000000000004c44aa99876915a095c21b23dd496adef2d68e477c99d0a9f2b88b1c094cf92f76b4cddbbe4ea4a200dedb21092c9ea16f38ea770f94736d2b6647e440508c02c325677484b698757b7bcd839bcbfe00b8cc15b9df8528ebe288222ec396ef9c98e2d2b756843cff1bcf325acabed2b1417adb6ca04803c084fe442dfed52512";

        let curve = groth16::bn254();
        groth16::prepare_verifying_key(&curve, &vk_bytes)
    }

    // ========== Tests ==========

    #[test]
    fun test_range_proof_valid_normal() {
        // value=1000, in range [0, 2^64)
        let commitment = pedersen::from_point(
            x"582c93b820dbb7887890400f924b40fb78d30873ad8d69687e29b229cf4c681d",
            x"b74e06f1f3bb53dac6ca7b57a5a16d81eac77edc0ed29b8ee24ca464672a4b05",
        );
        let sender_hash = x"2a00000000000000000000000000000000000000000000000000000000000000";
        let proof = x"dc3ed6c0639395901162aebb9083befe92f8ee36a9dc93d6288521d2380a282f0ed5d411ad89771a717668e94bd02d5df524ca3c01ebddcfe079856842b55a040db26b365b4a428c7422cbfe853281a5725c2301c1e4eda0950973d7deba0f8eeeb3e5461dc3ccdb2ecf72aad5221f9f319384621d223362bb0539cb3f3c6410";

        assert!(verify_range_64(&commitment, sender_hash, proof), 0);
    }

    #[test]
    fun test_range_proof_valid_zero() {
        // value=0, minimum valid value
        let commitment = pedersen::from_point(
            x"db42c01a9842d69e041dac7a5134946672a01af6012d36474697ab48a80f052a",
            x"3d0ecb6e021637c8c220a5d736111be4bfc41832b201d35edd244da0ad06fe27",
        );
        let sender_hash = x"2a00000000000000000000000000000000000000000000000000000000000000";
        let proof = x"ed9e5c74b69d7ebf5ab287254a51d86c3361d7ef4399b6b8487707706ea78aa00612f21ec131fd956d73cbf48c74ff14602915fb724f5eccb4e235c2ec54602e8c4406f9d7d7bfdfd8493d9dea891cc5aa2dada87843922773e2b1bfdf38672f33f26aa85268178a6b993d4b163a2269dbf6b5dc3a5abee11b66f23c652c6580";

        assert!(verify_range_64(&commitment, sender_hash, proof), 0);
    }

    #[test]
    fun test_range_proof_valid_max() {
        // value=2^64-1, maximum valid value
        let commitment = pedersen::from_point(
            x"88b4b3b59745824233c824d31d7c487d264589bef97b2afeb5ed44047fac880d",
            x"cdc1d386be5b07194aa0a4974f736c23d85508f2f63013a0aee7429b6e6d1808",
        );
        let sender_hash = x"2a00000000000000000000000000000000000000000000000000000000000000";
        let proof = x"34951fbf74c3c2667962f5929672193298f270d71a6e534b72e37716e3fbc0856c62372942e6ac17fab00c4ff39e39279a7eaef75c25b0c8f9510311f0b2d21ad11de967926dd7ce92a83c63a6e883c8ea6a6b252f70b12aee6b12ae22e68625b1796950ff44147395b562e459731339be19397675b2df622dd8e3df1444990a";

        assert!(verify_range_64(&commitment, sender_hash, proof), 0);
    }

    #[test]
    fun test_range_proof_wrong_sender_fails() {
        let commitment = pedersen::from_point(
            x"582c93b820dbb7887890400f924b40fb78d30873ad8d69687e29b229cf4c681d",
            x"b74e06f1f3bb53dac6ca7b57a5a16d81eac77edc0ed29b8ee24ca464672a4b05",
        );
        // Wrong sender hash
        let wrong_sender = x"ff00000000000000000000000000000000000000000000000000000000000000";
        let proof = x"dc3ed6c0639395901162aebb9083befe92f8ee36a9dc93d6288521d2380a282f0ed5d411ad89771a717668e94bd02d5df524ca3c01ebddcfe079856842b55a040db26b365b4a428c7422cbfe853281a5725c2301c1e4eda0950973d7deba0f8eeeb3e5461dc3ccdb2ecf72aad5221f9f319384621d223362bb0539cb3f3c6410";

        assert!(!verify_range_64(&commitment, wrong_sender, proof), 0);
    }

    #[test]
    fun test_range_proof_tampered_commitment_fails() {
        // Changed one byte in commitment_x
        let commitment = pedersen::from_point(
            x"592c93b820dbb7887890400f924b40fb78d30873ad8d69687e29b229cf4c681d",
            x"b74e06f1f3bb53dac6ca7b57a5a16d81eac77edc0ed29b8ee24ca464672a4b05",
        );
        let sender_hash = x"2a00000000000000000000000000000000000000000000000000000000000000";
        let proof = x"dc3ed6c0639395901162aebb9083befe92f8ee36a9dc93d6288521d2380a282f0ed5d411ad89771a717668e94bd02d5df524ca3c01ebddcfe079856842b55a040db26b365b4a428c7422cbfe853281a5725c2301c1e4eda0950973d7deba0f8eeeb3e5461dc3ccdb2ecf72aad5221f9f319384621d223362bb0539cb3f3c6410";

        assert!(!verify_range_64(&commitment, sender_hash, proof), 0);
    }

    #[test]
    fun test_pedersen_proof_not_interchangeable_with_range_proof() {
        // A Pedersen proof from Module 3 should NOT work as a Range Proof
        // because they use different VKs (different circuits)
        let commitment = pedersen::from_point(
            x"f7f866912c298cfe0fa36030f56537e25dcb5e924adf0ae9fe831eb9f236fb01",
            x"f90159d69a6c3cabdabbf1f6d8e85b88c997f648e8af2baaca37ff4d7457b22c",
        );
        let sender_hash = x"0f27000000000000000000000000000000000000000000000000000000000000";
        // This is the Pedersen proof from Module 3 tests (NOT a range proof)
        let pedersen_proof = x"360617e1baf7520ab952c207d19e004b2ee6c91ada5bf21118a410fb5974329a5e77c6bfe34dc2a173526cd529390cb29448174c79e731f1d7c5ad870cdcf7240514196f206fbc38744a118f7df78784b869ab75877667c156d0a2a99a94c2ac25c13db9fda2ae70cc13b3751f18ae8b024b85a5ec504d3db0fe4dd01e84f5ab";

        // Should fail: wrong VK (Pedersen circuit != Range Proof circuit)
        assert!(!verify_range_64(&commitment, sender_hash, pedersen_proof), 0);
    }
}
