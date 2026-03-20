#[test_only]
module confidential_account::account_tests {
    use sui::test_scenario;
    use sui::coin;
    use sui::sui::SUI;
    use confidential_account::account::{Self, ConfidentialAccount};

    const ALICE: address = @0xA;

    // Test vector from circuits/range_proof/test_prove.mjs
    // value=1000, blinding=98765432109876543210, sender_hash=42
    const COMMITMENT_X: vector<u8> = x"582c93b820dbb7887890400f924b40fb78d30873ad8d69687e29b229cf4c681d";
    const COMMITMENT_Y: vector<u8> = x"b74e06f1f3bb53dac6ca7b57a5a16d81eac77edc0ed29b8ee24ca464672a4b05";
    const SENDER_HASH: vector<u8> = x"2a00000000000000000000000000000000000000000000000000000000000000";
    const RANGE_PROOF: vector<u8> = x"dc3ed6c0639395901162aebb9083befe92f8ee36a9dc93d6288521d2380a282f0ed5d411ad89771a717668e94bd02d5df524ca3c01ebddcfe079856842b55a040db26b365b4a428c7422cbfe853281a5725c2301c1e4eda0950973d7deba0f8eeeb3e5461dc3ccdb2ecf72aad5221f9f319384621d223362bb0539cb3f3c6410";

    // Second test vector: value=0 (for withdraw to zero balance)
    const ZERO_COMMITMENT_X: vector<u8> = x"db42c01a9842d69e041dac7a5134946672a01af6012d36474697ab48a80f052a";
    const ZERO_COMMITMENT_Y: vector<u8> = x"3d0ecb6e021637c8c220a5d736111be4bfc41832b201d35edd244da0ad06fe27";
    const ZERO_RANGE_PROOF: vector<u8> = x"ed9e5c74b69d7ebf5ab287254a51d86c3361d7ef4399b6b8487707706ea78aa00612f21ec131fd956d73cbf48c74ff14602915fb724f5eccb4e235c2ec54602e8c4406f9d7d7bfdfd8493d9dea891cc5aa2dada87843922773e2b1bfdf38672f33f26aa85268178a6b993d4b163a2269dbf6b5dc3a5abee11b66f23c652c6580";

    #[test]
    fun test_deposit_creates_account() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);

        let deposit_coin = coin::mint_for_testing<SUI>(1000, ctx);

        account::deposit(
            COMMITMENT_X,
            COMMITMENT_Y,
            SENDER_HASH,
            RANGE_PROOF,
            deposit_coin,
            ctx,
        );

        // Account should be transferred to ALICE
        test_scenario::next_tx(&mut scenario, ALICE);
        let acc = test_scenario::take_from_sender<ConfidentialAccount>(&scenario);

        assert!(account::owner(&acc) == ALICE, 0);
        assert!(account::total_deposited(&acc) == 1000, 1);
        assert!(account::total_withdrawn(&acc) == 0, 2);
        assert!(account::vault_balance(&acc) == 1000, 3);

        test_scenario::return_to_sender(&scenario, acc);
        test_scenario::end(scenario);
    }

    #[test]
    fun test_withdraw_updates_balance() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);

        // Deposit 1000
        let deposit_coin = coin::mint_for_testing<SUI>(1000, ctx);
        account::deposit(
            COMMITMENT_X,
            COMMITMENT_Y,
            SENDER_HASH,
            RANGE_PROOF,
            deposit_coin,
            ctx,
        );

        // Withdraw 1000 (new balance = 0)
        test_scenario::next_tx(&mut scenario, ALICE);
        let mut acc = test_scenario::take_from_sender<ConfidentialAccount>(&scenario);

        account::withdraw(
            &mut acc,
            ZERO_COMMITMENT_X,
            ZERO_COMMITMENT_Y,
            SENDER_HASH,
            ZERO_RANGE_PROOF,
            1000,
            test_scenario::ctx(&mut scenario),
        );

        assert!(account::total_withdrawn(&acc) == 1000, 0);
        assert!(account::vault_balance(&acc) == 0, 1);

        test_scenario::return_to_sender(&scenario, acc);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = account::EInvalidRangeProof)]
    fun test_deposit_invalid_proof_fails() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);

        let deposit_coin = coin::mint_for_testing<SUI>(1000, ctx);

        // Tampered proof (changed first byte)
        let bad_proof = x"ff3ed6c0639395901162aebb9083befe92f8ee36a9dc93d6288521d2380a282f0ed5d411ad89771a717668e94bd02d5df524ca3c01ebddcfe079856842b55a040db26b365b4a428c7422cbfe853281a5725c2301c1e4eda0950973d7deba0f8eeeb3e5461dc3ccdb2ecf72aad5221f9f319384621d223362bb0539cb3f3c6410";

        account::deposit(
            COMMITMENT_X,
            COMMITMENT_Y,
            SENDER_HASH,
            bad_proof,
            deposit_coin,
            ctx,
        );

        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = account::ENotOwner)]
    fun test_withdraw_wrong_owner_fails() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);

        let deposit_coin = coin::mint_for_testing<SUI>(1000, ctx);
        account::deposit(
            COMMITMENT_X, COMMITMENT_Y, SENDER_HASH, RANGE_PROOF,
            deposit_coin, ctx,
        );

        // BOB tries to withdraw
        test_scenario::next_tx(&mut scenario, @0xB);
        let mut acc = test_scenario::take_from_address<ConfidentialAccount>(&scenario, ALICE);

        account::withdraw(
            &mut acc,
            ZERO_COMMITMENT_X, ZERO_COMMITMENT_Y, SENDER_HASH, ZERO_RANGE_PROOF,
            500,
            test_scenario::ctx(&mut scenario),
        );

        test_scenario::return_to_address(ALICE, acc);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = account::EInsufficientBalance)]
    fun test_withdraw_exceeds_deposit_fails() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);

        let deposit_coin = coin::mint_for_testing<SUI>(1000, ctx);
        account::deposit(
            COMMITMENT_X, COMMITMENT_Y, SENDER_HASH, RANGE_PROOF,
            deposit_coin, ctx,
        );

        test_scenario::next_tx(&mut scenario, ALICE);
        let mut acc = test_scenario::take_from_sender<ConfidentialAccount>(&scenario);

        // Try to withdraw more than deposited
        account::withdraw(
            &mut acc,
            ZERO_COMMITMENT_X, ZERO_COMMITMENT_Y, SENDER_HASH, ZERO_RANGE_PROOF,
            1001,  // exceeds 1000 deposited
            test_scenario::ctx(&mut scenario),
        );

        test_scenario::return_to_sender(&scenario, acc);
        test_scenario::end(scenario);
    }
}
