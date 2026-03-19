/// Hash-based Commitment Scheme
///
/// Provides commit-reveal functionality using standard hash functions.
/// C = H(value || salt), where H is SHA256, Blake2b-256, or Keccak256.
///
/// Properties:
/// - Binding: cannot find (value', salt') != (value, salt) with same commitment (collision resistance)
/// - Hiding: cannot derive value from commitment without knowing salt (preimage resistance)
///
/// Usage:
/// 1. Committer computes commitment off-chain: C = compute(value, salt, scheme)
/// 2. Committer publishes C on-chain
/// 3. Later, committer reveals value + salt
/// 4. Anyone verifies: verify_opening(&C, value, salt) == true
module suicryptolib::hash_commitment {
    use std::hash;
    use sui::hash::{blake2b256, keccak256};

    // --- Error codes ---

    /// Hash scheme must be 0 (SHA256), 1 (Blake2b), or 2 (Keccak256)
    const EInvalidScheme: u64 = 0;
    /// Salt must be at least 16 bytes to prevent brute-force attacks
    const ESaltTooShort: u64 = 1;
    /// Hash length does not match expected 32 bytes
    const EInvalidHashLength: u64 = 2;

    // --- Constants ---

    const SCHEME_SHA256: u8 = 0;
    const SCHEME_BLAKE2B: u8 = 1;
    const SCHEME_KECCAK256: u8 = 2;

    const MIN_SALT_LENGTH: u64 = 16;
    const HASH_LENGTH: u64 = 32;

    // --- Structs ---

    /// An opaque commitment to a value.
    /// The hash is H(value || salt) where H is determined by scheme.
    public struct Commitment has store, copy, drop {
        hash: vector<u8>,
        scheme: u8,
    }

    // --- Public functions ---

    /// Reconstruct a Commitment from a known hash and scheme.
    /// Used when receiving a commitment from another party or loading from storage.
    public fun from_hash(hash: vector<u8>, scheme: u8): Commitment {
        assert!(scheme <= SCHEME_KECCAK256, EInvalidScheme);
        assert!(vector::length(&hash) == HASH_LENGTH, EInvalidHashLength);
        Commitment { hash, scheme }
    }

    /// Compute a commitment on-chain.
    /// Typically done off-chain for privacy, but available on-chain for
    /// scenarios where the committer's value is already known to the contract.
    public fun compute(value: vector<u8>, salt: vector<u8>, scheme: u8): Commitment {
        assert!(scheme <= SCHEME_KECCAK256, EInvalidScheme);
        assert!(vector::length(&salt) >= MIN_SALT_LENGTH, ESaltTooShort);

        let data = concat_bytes(value, salt);
        let hash = hash_with_scheme(data, scheme);
        Commitment { hash, scheme }
    }

    /// Verify that a (value, salt) pair opens the given commitment.
    /// Returns true if H(value || salt) matches the stored hash.
    public fun verify_opening(
        commitment: &Commitment,
        value: vector<u8>,
        salt: vector<u8>,
    ): bool {
        assert!(vector::length(&salt) >= MIN_SALT_LENGTH, ESaltTooShort);

        let data = concat_bytes(value, salt);
        let computed = hash_with_scheme(data, commitment.scheme);
        computed == commitment.hash
    }

    /// Get the raw hash bytes of a commitment.
    public fun hash(commitment: &Commitment): vector<u8> {
        commitment.hash
    }

    /// Get the hash scheme of a commitment.
    public fun scheme(commitment: &Commitment): u8 {
        commitment.scheme
    }

    /// Check if two commitments are equal.
    public fun equal(a: &Commitment, b: &Commitment): bool {
        a.hash == b.hash && a.scheme == b.scheme
    }

    // --- Public constants accessors ---

    public fun scheme_sha256(): u8 { SCHEME_SHA256 }
    public fun scheme_blake2b(): u8 { SCHEME_BLAKE2B }
    public fun scheme_keccak256(): u8 { SCHEME_KECCAK256 }
    public fun min_salt_length(): u64 { MIN_SALT_LENGTH }

    // --- Internal functions ---

    /// Hash data using the specified scheme.
    fun hash_with_scheme(data: vector<u8>, scheme: u8): vector<u8> {
        if (scheme == SCHEME_SHA256) {
            hash::sha2_256(data)
        } else if (scheme == SCHEME_BLAKE2B) {
            blake2b256(&data)
        } else {
            // scheme == SCHEME_KECCAK256 (validated by caller)
            keccak256(&data)
        }
    }

    /// Concatenate two byte vectors: result = a || b
    /// Creates a new vector without mutating inputs.
    fun concat_bytes(a: vector<u8>, b: vector<u8>): vector<u8> {
        let mut result = a;
        vector::append(&mut result, b);
        result
    }

    // ========== Tests ==========

    #[test]
    fun test_compute_and_verify_sha256() {
        let value = b"hello world";
        let salt = b"0123456789abcdef"; // 16 bytes exactly

        let commitment = compute(value, salt, SCHEME_SHA256);
        assert!(verify_opening(&commitment, value, salt), 0);
    }

    #[test]
    fun test_compute_and_verify_blake2b() {
        let value = b"hello world";
        let salt = b"0123456789abcdef0123"; // 20 bytes

        let commitment = compute(value, salt, SCHEME_BLAKE2B);
        assert!(verify_opening(&commitment, value, salt), 0);
    }

    #[test]
    fun test_compute_and_verify_keccak256() {
        let value = b"hello world";
        let salt = b"0123456789abcdef0123456789abcdef"; // 32 bytes

        let commitment = compute(value, salt, SCHEME_KECCAK256);
        assert!(verify_opening(&commitment, value, salt), 0);
    }

    #[test]
    fun test_wrong_value_fails() {
        let value = b"correct value";
        let salt = b"0123456789abcdef";

        let commitment = compute(value, salt, SCHEME_SHA256);
        assert!(!verify_opening(&commitment, b"wrong value", salt), 0);
    }

    #[test]
    fun test_wrong_salt_fails() {
        let value = b"hello";
        let salt = b"0123456789abcdef";

        let commitment = compute(value, salt, SCHEME_SHA256);
        assert!(!verify_opening(&commitment, value, b"different_salt__!"), 0);
    }

    #[test]
    fun test_different_schemes_produce_different_hashes() {
        let value = b"test";
        let salt = b"0123456789abcdef";

        let c_sha = compute(value, salt, SCHEME_SHA256);
        let c_blake = compute(value, salt, SCHEME_BLAKE2B);
        let c_keccak = compute(value, salt, SCHEME_KECCAK256);

        // All three should produce different hashes
        assert!(hash(&c_sha) != hash(&c_blake), 0);
        assert!(hash(&c_sha) != hash(&c_keccak), 1);
        assert!(hash(&c_blake) != hash(&c_keccak), 2);
    }

    #[test]
    fun test_deterministic() {
        let value = b"deterministic";
        let salt = b"0123456789abcdef";

        let c1 = compute(value, salt, SCHEME_SHA256);
        let c2 = compute(value, salt, SCHEME_SHA256);
        assert!(equal(&c1, &c2), 0);
    }

    #[test]
    fun test_from_hash_roundtrip() {
        let value = b"roundtrip";
        let salt = b"0123456789abcdef";

        let original = compute(value, salt, SCHEME_BLAKE2B);
        let reconstructed = from_hash(hash(&original), scheme(&original));
        assert!(equal(&original, &reconstructed), 0);
        assert!(verify_opening(&reconstructed, value, salt), 1);
    }

    #[test]
    fun test_empty_value() {
        let value = b"";
        let salt = b"0123456789abcdef";

        let commitment = compute(value, salt, SCHEME_SHA256);
        assert!(verify_opening(&commitment, value, salt), 0);
        assert!(!verify_opening(&commitment, b"notempty", salt), 1);
    }

    #[test]
    fun test_hash_length() {
        let value = b"test";
        let salt = b"0123456789abcdef";

        let c = compute(value, salt, SCHEME_SHA256);
        assert!(vector::length(&hash(&c)) == 32, 0);

        let c = compute(value, salt, SCHEME_BLAKE2B);
        assert!(vector::length(&hash(&c)) == 32, 1);

        let c = compute(value, salt, SCHEME_KECCAK256);
        assert!(vector::length(&hash(&c)) == 32, 2);
    }

    #[test]
    fun test_long_value_and_salt() {
        // Test with larger inputs to ensure no issues
        let mut value = vector::empty<u8>();
        let mut i = 0u16;
        while (i < 1000) {
            vector::push_back(&mut value, ((i % 256) as u8));
            i = i + 1;
        };

        let mut salt = vector::empty<u8>();
        i = 0;
        while (i < 64) {
            vector::push_back(&mut salt, ((i % 256) as u8));
            i = i + 1;
        };

        let commitment = compute(value, salt, SCHEME_SHA256);
        assert!(verify_opening(&commitment, value, salt), 0);
    }

    #[test]
    fun test_scheme_accessors() {
        assert!(scheme_sha256() == 0, 0);
        assert!(scheme_blake2b() == 1, 1);
        assert!(scheme_keccak256() == 2, 2);
        assert!(min_salt_length() == 16, 3);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidScheme)]
    fun test_invalid_scheme_compute() {
        compute(b"test", b"0123456789abcdef", 3);
    }

    #[test]
    #[expected_failure(abort_code = ESaltTooShort)]
    fun test_salt_too_short_compute() {
        compute(b"test", b"short", 0);
    }

    #[test]
    #[expected_failure(abort_code = ESaltTooShort)]
    fun test_salt_too_short_verify() {
        let value = b"test";
        let salt = b"0123456789abcdef";
        let commitment = compute(value, salt, SCHEME_SHA256);
        // Try to verify with a short salt - should abort
        verify_opening(&commitment, value, b"short");
    }

    #[test]
    #[expected_failure(abort_code = EInvalidScheme)]
    fun test_invalid_scheme_from_hash() {
        from_hash(vector[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                         0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 5);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidHashLength)]
    fun test_invalid_hash_length_from_hash() {
        from_hash(vector[0, 1, 2], 0);
    }

    #[test]
    fun test_salt_exactly_min_length() {
        // 16 bytes = exactly minimum, should succeed
        let salt = b"0123456789abcdef";
        assert!(vector::length(&salt) == 16, 99);
        let commitment = compute(b"test", salt, SCHEME_SHA256);
        assert!(verify_opening(&commitment, b"test", salt), 0);
    }

    #[test]
    #[expected_failure(abort_code = ESaltTooShort)]
    fun test_salt_one_below_min() {
        // 15 bytes = one below minimum, should fail
        compute(b"test", b"0123456789abcde", 0);
    }

    #[test]
    fun test_order_matters() {
        // H("AB" || salt) != H("BA" || salt)
        let salt = b"0123456789abcdef";
        let c1 = compute(b"AB", salt, SCHEME_SHA256);
        let c2 = compute(b"BA", salt, SCHEME_SHA256);
        assert!(!equal(&c1, &c2), 0);
    }
}
