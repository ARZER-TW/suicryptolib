/// Poseidon-based Merkle Proof Verification
///
/// Uses sui::poseidon::poseidon_bn254 (mainnet available) for
/// ZK-compatible Merkle trees. Produces identical results to
/// circomlib's Poseidon(2) circuit -- verified by cross-validation tests.
///
/// Convention (consistent with circomlib / Semaphore):
///   leaf = value (already a BN254 field element, e.g. identity commitment)
///   internal node = Poseidon(left, right)
///   No domain separation prefix needed (Poseidon input count disambiguates)
///
/// All values are u256, must be < BN254 scalar field order.
///
/// This module is the on-chain counterpart to Semaphore's in-circuit
/// Poseidon Merkle proof. Both use the same hash function and parameters,
/// so roots computed on-chain match roots verified inside Groth16 circuits.
module suicryptolib::merkle_poseidon {
    use sui::poseidon;

    // --- Error codes ---

    /// Proof and positions vectors must have the same length
    const ELengthMismatch: u64 = 0;
    /// Position value must be 0 (left) or 1 (right)
    const EInvalidPosition: u64 = 1;

    // --- Public functions ---

    /// Verify a Poseidon Merkle inclusion proof.
    ///
    /// Arguments:
    /// - root: the known Merkle root (u256)
    /// - leaf: the leaf value (u256, e.g. an identity commitment)
    /// - proof: sibling hashes from leaf to root
    /// - positions: for each level, 0 = current is left child, 1 = current is right child
    ///
    /// Returns true if the proof is valid.
    public fun verify_proof(
        root: u256,
        leaf: u256,
        proof: vector<u256>,
        positions: vector<u8>,
    ): bool {
        let proof_len = vector::length(&proof);
        assert!(proof_len == vector::length(&positions), ELengthMismatch);

        let mut current = leaf;
        let mut i = 0;
        while (i < proof_len) {
            let sibling = *vector::borrow(&proof, i);
            let pos = *vector::borrow(&positions, i);
            assert!(pos <= 1, EInvalidPosition);

            current = if (pos == 0) {
                // Current is left child: Poseidon(current, sibling)
                hash_pair(current, sibling)
            } else {
                // Current is right child: Poseidon(sibling, current)
                hash_pair(sibling, current)
            };
            i = i + 1;
        };

        current == root
    }

    /// Hash a single value with Poseidon.
    /// Useful for computing leaf commitments: e.g. Poseidon(value)
    public fun hash_leaf(value: u256): u256 {
        poseidon::poseidon_bn254(&vector[value])
    }

    /// Hash two values with Poseidon to produce a parent node.
    /// node = Poseidon(left, right)
    public fun hash_pair(left: u256, right: u256): u256 {
        poseidon::poseidon_bn254(&vector[left, right])
    }

    /// Compute an identity commitment (Semaphore-style).
    /// commitment = Poseidon(secret, nullifier_key)
    public fun compute_identity_commitment(
        secret: u256,
        nullifier_key: u256,
    ): u256 {
        poseidon::poseidon_bn254(&vector[secret, nullifier_key])
    }

    /// Compute a nullifier hash (Semaphore-style).
    /// nullifier_hash = Poseidon(nullifier_key, external_nullifier)
    public fun compute_nullifier_hash(
        nullifier_key: u256,
        external_nullifier: u256,
    ): u256 {
        poseidon::poseidon_bn254(&vector[nullifier_key, external_nullifier])
    }

    // ========== Tests ==========

    // All reference values cross-validated with circomlibjs (see sdk/test/merkle_poseidon_reference.mjs)

    // --- hash_leaf / hash_pair consistency with circomlib ---

    #[test]
    fun test_hash_pair_matches_circomlib() {
        // Poseidon(1, 2) -- already verified in poseidon_poc
        let result = hash_pair(1, 2);
        assert!(result == 7853200120776062878684798364095072458815029376092732009249414926327459813530, 0);
    }

    #[test]
    fun test_hash_leaf_matches_circomlib() {
        // Poseidon(42) -- already verified in poseidon_poc
        let result = hash_leaf(42);
        assert!(result == 12326503012965816391338144612242952408728683609716147019497703475006801258307, 0);
    }

    // --- 2-leaf tree (depth 1) ---

    #[test]
    fun test_2_leaf_tree() {
        let leaf0: u256 = 100;
        let leaf1: u256 = 200;
        let root: u256 = 3699275827636970843851136077830925792907611923069205979397427147713774628412;

        // Verify root computation
        assert!(hash_pair(leaf0, leaf1) == root, 0);

        // Proof for leaf0 (left): sibling = leaf1, position = 0
        assert!(verify_proof(root, leaf0, vector[leaf1], vector[0]), 1);

        // Proof for leaf1 (right): sibling = leaf0, position = 1
        assert!(verify_proof(root, leaf1, vector[leaf0], vector[1]), 2);
    }

    // --- 4-leaf tree (depth 2) ---

    #[test]
    fun test_4_leaf_tree_leaf0() {
        let leaf0: u256 = 111;
        let leaf1: u256 = 222;
        let _node01: u256 = 20595346326572914964186581639484694308224330290454662633399973481953444150659;
        let node23: u256 = 20403006909364192806930024120627684483381303094884559877071101381067530732246;
        let root: u256 = 2627613426887678919670906595223549159912332087418882198813349531614684120136;

        // Proof for leaf0: siblings=[leaf1, node23], positions=[0, 0]
        assert!(verify_proof(root, leaf0, vector[leaf1, node23], vector[0, 0]), 0);
    }

    #[test]
    fun test_4_leaf_tree_leaf1() {
        let leaf0: u256 = 111;
        let leaf1: u256 = 222;
        let node23: u256 = 20403006909364192806930024120627684483381303094884559877071101381067530732246;
        let root: u256 = 2627613426887678919670906595223549159912332087418882198813349531614684120136;

        // Proof for leaf1: siblings=[leaf0, node23], positions=[1, 0]
        assert!(verify_proof(root, leaf1, vector[leaf0, node23], vector[1, 0]), 0);
    }

    #[test]
    fun test_4_leaf_tree_leaf3() {
        let leaf2: u256 = 333;
        let leaf3: u256 = 444;
        let node01: u256 = 20595346326572914964186581639484694308224330290454662633399973481953444150659;
        let root: u256 = 2627613426887678919670906595223549159912332087418882198813349531614684120136;

        // Proof for leaf3: siblings=[leaf2, node01], positions=[1, 1]
        assert!(verify_proof(root, leaf3, vector[leaf2, node01], vector[1, 1]), 0);
    }

    #[test]
    fun test_4_leaf_tree_root_computation() {
        // Verify tree is built correctly from leaves
        let leaf0: u256 = 111;
        let leaf1: u256 = 222;
        let leaf2: u256 = 333;
        let leaf3: u256 = 444;

        let node01 = hash_pair(leaf0, leaf1);
        let node23 = hash_pair(leaf2, leaf3);
        let root = hash_pair(node01, node23);

        assert!(node01 == 20595346326572914964186581639484694308224330290454662633399973481953444150659, 0);
        assert!(node23 == 20403006909364192806930024120627684483381303094884559877071101381067530732246, 1);
        assert!(root == 2627613426887678919670906595223549159912332087418882198813349531614684120136, 2);
    }

    // --- Semaphore-style identity commitments ---

    #[test]
    fun test_identity_commitment() {
        let secret: u256 = 12345;
        let nullifier_key: u256 = 67890;
        let commitment = compute_identity_commitment(secret, nullifier_key);
        assert!(commitment == 11344094074881186137859743404234365978119253787583526441303892667757095072923, 0);
    }

    #[test]
    fun test_nullifier_hash() {
        // This is different from identity commitment because inputs are different
        let nullifier_key: u256 = 67890;
        let external_nullifier: u256 = 42;
        let nh = compute_nullifier_hash(nullifier_key, external_nullifier);
        assert!(nh != 0, 0);
        // Deterministic
        let nh2 = compute_nullifier_hash(nullifier_key, external_nullifier);
        assert!(nh == nh2, 1);
    }

    #[test]
    fun test_semaphore_style_tree() {
        // Two identity commitments as leaves
        let id1 = compute_identity_commitment(12345, 67890);
        let id2 = compute_identity_commitment(11111, 22222);
        let root = hash_pair(id1, id2);

        assert!(root == 4795017070673638622195357555868476850739718765983730710143355006520760102244, 0);

        // Verify proof for id1
        assert!(verify_proof(root, id1, vector[id2], vector[0]), 1);
        // Verify proof for id2
        assert!(verify_proof(root, id2, vector[id1], vector[1]), 2);
    }

    // --- Invalid proof tests ---

    #[test]
    fun test_wrong_root_fails() {
        let leaf0: u256 = 100;
        let leaf1: u256 = 200;
        let wrong_root: u256 = 999;
        assert!(!verify_proof(wrong_root, leaf0, vector[leaf1], vector[0]), 0);
    }

    #[test]
    fun test_wrong_leaf_fails() {
        let leaf1: u256 = 200;
        let root: u256 = 3699275827636970843851136077830925792907611923069205979397427147713774628412;
        let fake_leaf: u256 = 999;
        assert!(!verify_proof(root, fake_leaf, vector[leaf1], vector[0]), 0);
    }

    #[test]
    fun test_wrong_sibling_fails() {
        let leaf0: u256 = 100;
        let root: u256 = 3699275827636970843851136077830925792907611923069205979397427147713774628412;
        let wrong_sibling: u256 = 999;
        assert!(!verify_proof(root, leaf0, vector[wrong_sibling], vector[0]), 0);
    }

    #[test]
    fun test_wrong_position_fails() {
        let leaf0: u256 = 100;
        let leaf1: u256 = 200;
        let root: u256 = 3699275827636970843851136077830925792907611923069205979397427147713774628412;
        // leaf0 is at position 0, but we claim position 1
        assert!(!verify_proof(root, leaf0, vector[leaf1], vector[1]), 0);
    }

    // --- Single leaf (empty proof) ---

    #[test]
    fun test_single_leaf() {
        let leaf: u256 = 42;
        assert!(verify_proof(leaf, leaf, vector[], vector[]), 0);
    }

    // --- Error handling ---

    #[test]
    #[expected_failure(abort_code = ELengthMismatch)]
    fun test_length_mismatch() {
        verify_proof(0, 0, vector[1], vector[0, 1]);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidPosition)]
    fun test_invalid_position() {
        verify_proof(0, 0, vector[1], vector[2]);
    }

    // --- Hash pair is not commutative ---

    #[test]
    fun test_hash_pair_order_matters() {
        let a: u256 = 100;
        let b: u256 = 200;
        assert!(hash_pair(a, b) != hash_pair(b, a), 0);
    }

    // --- Determinism ---

    #[test]
    fun test_deterministic() {
        let a = hash_pair(100, 200);
        let b = hash_pair(100, 200);
        assert!(a == b, 0);
    }
}
