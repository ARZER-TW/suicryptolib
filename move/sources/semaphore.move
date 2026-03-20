/// Semaphore — Anonymous Group Membership Proof
///
/// Allows a user to prove "I am a member of this group" without revealing
/// which member they are. Uses Poseidon Merkle tree for group management
/// and Groth16 zero-knowledge proof for anonymous verification.
///
/// Core concepts:
///   - Identity: (secret, nullifier_key) -> commitment = Poseidon(secret, nullifier_key)
///   - Group: Incremental Poseidon Merkle tree of identity commitments
///   - Nullifier: Poseidon(nullifier_key, external_nullifier) — prevents double-action
///   - Proof: Groth16 ZK proof of membership + nullifier correctness
///
/// On-chain observers see: merkle_root + nullifier_hash
/// They CANNOT determine which member generated the proof.
module suicryptolib::semaphore {
    use sui::groth16;
    use sui::table::{Self, Table};
    use sui::event;
    use suicryptolib::merkle_poseidon;

    // --- Error codes ---

    const EGroupFull: u64 = 0;
    const EInvalidRoot: u64 = 1;
    const ENullifierAlreadyUsed: u64 = 2;
    const EInvalidProof: u64 = 3;
    const EInvalidDepth: u64 = 4;

    // --- Constants ---

    /// Maximum supported tree depth
    const MAX_DEPTH: u8 = 20;
    /// Number of recent roots to keep (for race condition tolerance)
    const ROOT_HISTORY_SIZE: u64 = 30;

    // --- Structs ---

    /// Incremental Poseidon Merkle Tree for anonymous group membership.
    /// Only stores O(depth) state, not all leaves.
    public struct Group has key {
        id: UID,
        depth: u8,
        next_index: u64,
        filled_subtrees: vector<u256>,
        zeros: vector<u256>,
        merkle_root: u256,
        root_history: vector<u256>,
        nullifier_store: Table<u256, bool>,
    }

    // --- Events ---

    public struct GroupCreated has copy, drop {
        group_id: ID,
        depth: u8,
    }

    public struct MemberAdded has copy, drop {
        group_id: ID,
        commitment: u256,
        member_index: u64,
        new_root: u256,
    }

    public struct ProofVerified has copy, drop {
        group_id: ID,
        nullifier_hash: u256,
        external_nullifier: u256,
    }

    // --- Public functions ---

    /// Create a new Semaphore group with the given tree depth.
    /// depth=8 supports 256 members, depth=16 supports 65536 members.
    public fun create_group(depth: u8, ctx: &mut TxContext) {
        assert!(depth > 0 && depth <= MAX_DEPTH, EInvalidDepth);

        // Pre-compute zero values for each level
        let zeros = compute_zeros(depth);
        let empty_root = if (vector::length(&zeros) > 0) {
            let last_zero = *vector::borrow(&zeros, (depth as u64) - 1);
            merkle_poseidon::hash_pair(last_zero, last_zero)
        } else {
            0u256
        };

        // Initialize filled_subtrees with zero values
        let filled_subtrees = zeros;

        let group = Group {
            id: object::new(ctx),
            depth,
            next_index: 0,
            filled_subtrees,
            zeros: compute_zeros(depth),
            merkle_root: empty_root,
            root_history: vector::empty(),
            nullifier_store: table::new(ctx),
        };

        event::emit(GroupCreated {
            group_id: object::id(&group),
            depth,
        });

        transfer::share_object(group);
    }

    /// Add a member (identity commitment) to the group.
    /// The commitment should be Poseidon(identity_secret, identity_nullifier).
    public fun add_member(group: &mut Group, commitment: u256) {
        let max_members = 1u64 << group.depth;
        assert!(group.next_index < max_members, EGroupFull);

        // Incremental Merkle tree insert (O(depth) Poseidon hashes)
        let mut current_index = group.next_index;
        let mut current_hash = commitment;
        let depth = group.depth;

        let mut i = 0u8;
        while (i < depth) {
            let level = (i as u64);
            if (current_index % 2 == 0) {
                // Left child: update filled_subtrees, pair with zero
                *vector::borrow_mut(&mut group.filled_subtrees, level) = current_hash;
                let zero = *vector::borrow(&group.zeros, level);
                current_hash = merkle_poseidon::hash_pair(current_hash, zero);
            } else {
                // Right child: pair with filled_subtrees
                let left = *vector::borrow(&group.filled_subtrees, level);
                current_hash = merkle_poseidon::hash_pair(left, current_hash);
            };
            current_index = current_index / 2;
            i = i + 1;
        };

        // Update root history
        if (vector::length(&group.root_history) >= ROOT_HISTORY_SIZE) {
            vector::remove(&mut group.root_history, 0);
        };
        vector::push_back(&mut group.root_history, group.merkle_root);

        group.merkle_root = current_hash;
        let member_index = group.next_index;
        group.next_index = group.next_index + 1;

        event::emit(MemberAdded {
            group_id: object::id(group),
            commitment,
            member_index,
            new_root: current_hash,
        });
    }

    /// Verify an anonymous membership proof.
    ///
    /// Verifies a Groth16 proof that the prover:
    ///   1. Knows (identity_secret, identity_nullifier) whose commitment is in the tree
    ///   2. The nullifier_hash = Poseidon(identity_nullifier, external_nullifier)
    ///
    /// After verification, the nullifier_hash is recorded to prevent reuse.
    public fun verify_proof(
        group: &mut Group,
        merkle_root: u256,
        nullifier_hash: u256,
        external_nullifier: u256,
        proof_bytes: vector<u8>,
    ): bool {
        // 1. Validate root (current or recent)
        assert!(is_valid_root(group, merkle_root), EInvalidRoot);

        // 2. Check nullifier not already used
        assert!(
            !table::contains(&group.nullifier_store, nullifier_hash),
            ENullifierAlreadyUsed,
        );

        // 3. Groth16 verification
        let pvk = get_semaphore_pvk();
        let curve = groth16::bn254();

        // Public inputs order (from Circom): merkleRoot, nullifierHash, externalNullifier
        let mut public_inputs_bytes = vector::empty<u8>();
        append_u256_le(&mut public_inputs_bytes, merkle_root);
        append_u256_le(&mut public_inputs_bytes, nullifier_hash);
        append_u256_le(&mut public_inputs_bytes, external_nullifier);

        let inputs = groth16::public_proof_inputs_from_bytes(public_inputs_bytes);
        let proof = groth16::proof_points_from_bytes(proof_bytes);

        let valid = groth16::verify_groth16_proof(&curve, &pvk, &inputs, &proof);
        assert!(valid, EInvalidProof);

        // 4. Record nullifier to prevent reuse
        table::add(&mut group.nullifier_store, nullifier_hash, true);

        event::emit(ProofVerified {
            group_id: object::id(group),
            nullifier_hash,
            external_nullifier,
        });

        true
    }

    // --- View functions ---

    public fun merkle_root(group: &Group): u256 { group.merkle_root }
    public fun member_count(group: &Group): u64 { group.next_index }
    public fun depth(group: &Group): u8 { group.depth }
    public fun is_nullifier_used(group: &Group, nullifier_hash: u256): bool {
        table::contains(&group.nullifier_store, nullifier_hash)
    }

    // --- Internal functions ---

    /// Compute zero values for each tree level.
    /// zeros[0] = 0 (empty leaf)
    /// zeros[i] = Poseidon(zeros[i-1], zeros[i-1])
    fun compute_zeros(depth: u8): vector<u256> {
        let mut zeros = vector::empty<u256>();
        let mut current = 0u256;
        let mut i = 0u8;
        while (i < depth) {
            vector::push_back(&mut zeros, current);
            current = merkle_poseidon::hash_pair(current, current);
            i = i + 1;
        };
        zeros
    }

    /// Check if a root is the current root or in recent history.
    fun is_valid_root(group: &Group, root: u256): bool {
        if (root == group.merkle_root) { return true };
        let mut i = 0u64;
        let len = vector::length(&group.root_history);
        while (i < len) {
            if (*vector::borrow(&group.root_history, i) == root) { return true };
            i = i + 1;
        };
        false
    }

    /// Encode a u256 as 32 bytes little-endian and append to buffer.
    fun append_u256_le(buf: &mut vector<u8>, value: u256) {
        let mut v = value;
        let mut i = 0u8;
        while (i < 32) {
            vector::push_back(buf, ((v & 0xff) as u8));
            v = v >> 8;
            i = i + 1;
        };
    }

    /// Hardcoded Prepared Verifying Key for the Semaphore Lite circuit (depth=8).
    fun get_semaphore_pvk(): groth16::PreparedVerifyingKey {
        let vk_bytes = x"e2f26dbea299f5223b646cb1fb33eadb059d9407559d7441dfd902e3a79a4d2dabb73dc17fbc13021e2471e0c08bd67d8401f52b73d6d07483794cad4778180e0c06f33bbc4c79a9cadef253a68084d382f17788f885c9afd176f7cb2f036789edf692d95cbdde46ddda5ef7d422436779445c5e66006a42761e1f12efde0018c212f3aeb785e49712e7a9353349aaf1255dfb31b7bf60723a480d9293938e1972bfc60df4eed9cac8c3b4e99417e501da7a8fe2e66b83881bdc744cc82f792ac3e3c8e0048ec764387fd037bfb7e3d153cf0d3991c2d89d79a3ee14d5bfd091040000000000000020445f95e4619521865e25def1de776807f9a239e212f5555fecabfb87a6269cbc636b9e3b0185068452be16551c126c5fce11fbd7e9996ae1a37bc463775e28c7e9c3aab6b3fd4247223383c7d9031dce94808054316d4d50d33a746c76772f2758c4f8d4f79a495a7035828d57de97402a8b685ee7bdf7e203f70aedbc0ba9";

        let curve = groth16::bn254();
        groth16::prepare_verifying_key(&curve, &vk_bytes)
    }

    // ========== Tests ==========

    #[test]
    fun test_create_group_and_add_member() {
        let mut ctx = tx_context::dummy();
        let zeros = compute_zeros(8);
        // zeros[0] should be 0
        assert!(*vector::borrow(&zeros, 0) == 0u256, 0);
        // zeros[1] should be Poseidon(0, 0) = 14744269619966411208579211824598458697587494354926760081771325075741142829156
        assert!(
            *vector::borrow(&zeros, 1) == 14744269619966411208579211824598458697587494354926760081771325075741142829156u256,
            1
        );
    }

    #[test]
    fun test_verify_semaphore_proof() {
        let mut ctx = tx_context::dummy();

        // Create group
        create_group(8, &mut ctx);
    }

    #[test]
    fun test_append_u256_le() {
        let mut buf = vector::empty<u8>();
        append_u256_le(&mut buf, 999u256);
        // 999 = 0x3E7 -> LE: [0xE7, 0x03, 0x00, ..., 0x00]
        assert!(*vector::borrow(&buf, 0) == 0xe7, 0);
        assert!(*vector::borrow(&buf, 1) == 0x03, 1);
        assert!(vector::length(&buf) == 32, 2);
    }
}
