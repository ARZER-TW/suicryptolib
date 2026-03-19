/// PoC: Verify sui::poseidon::poseidon_bn254 works
module suicryptolib::poseidon_poc {
    use sui::poseidon;

    /// Compute Poseidon hash of two BN254 field elements
    public fun hash_pair(a: u256, b: u256): u256 {
        poseidon::poseidon_bn254(&vector[a, b])
    }

    /// Compute Poseidon hash of a single value
    public fun hash_single(a: u256): u256 {
        poseidon::poseidon_bn254(&vector[a])
    }

    #[test]
    fun test_poseidon_basic() {
        // Just test that it doesn't abort
        let result = hash_pair(1, 2);
        assert!(result != 0, 0);
    }

    #[test]
    fun test_poseidon_deterministic() {
        let a = hash_pair(1, 2);
        let b = hash_pair(1, 2);
        assert!(a == b, 1);
    }

    #[test]
    fun test_poseidon_different_inputs() {
        let a = hash_pair(1, 2);
        let b = hash_pair(2, 1);
        assert!(a != b, 2);
    }

    #[test]
    fun test_poseidon_single() {
        let result = hash_single(42);
        assert!(result != 0, 3);
    }

    /// Cross-validate with circomlibjs reference values
    /// If these pass, sui::poseidon and circomlib produce identical results
    #[test]
    fun test_poseidon_circomlib_consistency() {
        // hash_pair(1, 2)
        assert!(poseidon::poseidon_bn254(&vector[1, 2]) == 7853200120776062878684798364095072458815029376092732009249414926327459813530u256, 10);

        // hash_pair(2, 1)
        assert!(poseidon::poseidon_bn254(&vector[2, 1]) == 9708419728795563670286566418307042748092204899363634976546883453490873071450u256, 11);

        // hash_single(42)
        assert!(poseidon::poseidon_bn254(&vector[42]) == 12326503012965816391338144612242952408728683609716147019497703475006801258307u256, 12);

        // hash_pair(0, 0)
        assert!(poseidon::poseidon_bn254(&vector[0, 0]) == 14744269619966411208579211824598458697587494354926760081771325075741142829156u256, 13);

        // hash_pair(123456789, 987654321)
        assert!(poseidon::poseidon_bn254(&vector[123456789, 987654321]) == 16832421271961222550979173996485995711342823810308835997146707681980704453417u256, 14);
    }
}
