/// Commit-Reveal Round Manager
///
/// Facilitates multi-party commit-reveal protocols with:
/// - Phase management: COMMIT -> REVEAL -> FINALIZED
/// - Deposit-based DoS prevention (commit-not-reveal penalty)
/// - Deadline enforcement via sui::clock
///
/// Typical flow:
/// 1. Creator calls create_round() with deadlines and minimum deposit
/// 2. Participants call commit() during COMMIT phase with commitment + deposit
/// 3. After commit_deadline, participants call reveal() with value + salt
/// 4. After reveal_deadline, anyone calls finalize() to settle deposits
///
/// Participants who commit but don't reveal forfeit their deposit.
#[allow(lint(self_transfer), unused_variable)]
module suicryptolib::commit_reveal {
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use suicryptolib::hash_commitment::{Self, Commitment};

    // --- Error codes ---

    /// Current phase does not allow this operation
    const EWrongPhase: u64 = 0;
    /// Commit deadline has not passed yet (cannot start reveal)
    const ECommitPhaseNotOver: u64 = 1;
    /// Reveal deadline has not passed yet (cannot finalize)
    const ERevealPhaseNotOver: u64 = 2;
    /// Deposit is less than the minimum required
    const EInsufficientDeposit: u64 = 3;
    /// Caller has already committed
    const EAlreadyCommitted: u64 = 4;
    /// Caller has not committed (cannot reveal)
    const ENotCommitted: u64 = 5;
    /// Caller has already revealed
    const EAlreadyRevealed: u64 = 6;
    /// Revealed value does not match commitment
    const EInvalidOpening: u64 = 7;
    /// Commit deadline must be before reveal deadline
    const EInvalidDeadlines: u64 = 8;
    /// Reveal deadline must be at least 10 minutes after commit deadline
    const EDeadlineTooClose: u64 = 9;

    // --- Constants ---

    const PHASE_COMMIT: u8 = 0;
    const PHASE_REVEAL: u8 = 1;
    const PHASE_FINALIZED: u8 = 2;

    /// Minimum gap between commit and reveal deadlines (10 minutes in ms)
    const MIN_DEADLINE_GAP_MS: u64 = 600_000;

    // --- Structs ---

    /// A single participant's commitment entry
    public struct CommitEntry has store, drop {
        player: address,
        commitment: Commitment,
        deposit: u64,
        revealed: bool,
    }

    /// A revealed value from a participant
    public struct RevealEntry has store, drop {
        player: address,
        value: vector<u8>,
    }

    /// A complete commit-reveal round
    public struct Round has key {
        id: UID,
        commits: vector<CommitEntry>,
        reveals: vector<RevealEntry>,
        commit_deadline: u64,
        reveal_deadline: u64,
        phase: u8,
        min_deposit: u64,
        treasury: Balance<SUI>,
        forfeited: u64,
    }

    // --- Public functions ---

    /// Create a new commit-reveal round.
    /// commit_deadline and reveal_deadline are Unix timestamps in milliseconds.
    /// reveal_deadline must be at least 10 minutes after commit_deadline.
    public fun create_round(
        commit_deadline: u64,
        reveal_deadline: u64,
        min_deposit: u64,
        ctx: &mut TxContext,
    ): Round {
        assert!(commit_deadline < reveal_deadline, EInvalidDeadlines);
        assert!(reveal_deadline - commit_deadline >= MIN_DEADLINE_GAP_MS, EDeadlineTooClose);

        Round {
            id: object::new(ctx),
            commits: vector::empty(),
            reveals: vector::empty(),
            commit_deadline,
            reveal_deadline,
            phase: PHASE_COMMIT,
            min_deposit,
            treasury: balance::zero(),
            forfeited: 0,
        }
    }

    /// Submit a commitment with deposit during the COMMIT phase.
    /// The commitment hash should be computed off-chain: H(value || salt).
    public fun commit(
        round: &mut Round,
        commitment: Commitment,
        deposit: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(round.phase == PHASE_COMMIT, EWrongPhase);
        assert!(clock::timestamp_ms(clock) <= round.commit_deadline, EWrongPhase);

        let sender = tx_context::sender(ctx);
        let deposit_value = coin::value(&deposit);
        assert!(deposit_value >= round.min_deposit, EInsufficientDeposit);

        // Check not already committed
        let mut i = 0;
        let len = vector::length(&round.commits);
        while (i < len) {
            assert!(vector::borrow(&round.commits, i).player != sender, EAlreadyCommitted);
            i = i + 1;
        };

        // Store commitment and deposit
        let entry = CommitEntry {
            player: sender,
            commitment,
            deposit: deposit_value,
            revealed: false,
        };
        vector::push_back(&mut round.commits, entry);
        balance::join(&mut round.treasury, coin::into_balance(deposit));
    }

    /// Advance to REVEAL phase once commit deadline has passed.
    /// Anyone can call this.
    public fun advance_to_reveal(round: &mut Round, clock: &Clock) {
        assert!(round.phase == PHASE_COMMIT, EWrongPhase);
        assert!(clock::timestamp_ms(clock) > round.commit_deadline, ECommitPhaseNotOver);
        round.phase = PHASE_REVEAL;
    }

    /// Reveal value + salt during the REVEAL phase.
    /// The contract verifies that H(value || salt) matches the stored commitment.
    public fun reveal(
        round: &mut Round,
        value: vector<u8>,
        salt: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Auto-advance to REVEAL if needed
        if (round.phase == PHASE_COMMIT && clock::timestamp_ms(clock) > round.commit_deadline) {
            round.phase = PHASE_REVEAL;
        };

        assert!(round.phase == PHASE_REVEAL, EWrongPhase);
        assert!(clock::timestamp_ms(clock) <= round.reveal_deadline, EWrongPhase);

        let sender = tx_context::sender(ctx);

        // Find the commit entry for this sender
        let mut i = 0;
        let len = vector::length(&round.commits);
        let mut found = false;
        while (i < len) {
            let entry = vector::borrow_mut(&mut round.commits, i);
            if (entry.player == sender) {
                assert!(!entry.revealed, EAlreadyRevealed);
                assert!(
                    hash_commitment::verify_opening(&entry.commitment, value, salt),
                    EInvalidOpening,
                );
                entry.revealed = true;
                found = true;

                let reveal_entry = RevealEntry {
                    player: sender,
                    value,
                };
                vector::push_back(&mut round.reveals, reveal_entry);
                break
            };
            i = i + 1;
        };

        assert!(found, ENotCommitted);
    }

    /// Finalize the round after the reveal deadline.
    /// Returns deposits to revealed players, forfeits deposits of non-revealers.
    /// Anyone can call this.
    public fun finalize(
        round: &mut Round,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Auto-advance phases if needed
        if (round.phase == PHASE_COMMIT && clock::timestamp_ms(clock) > round.commit_deadline) {
            round.phase = PHASE_REVEAL;
        };
        if (round.phase == PHASE_REVEAL && clock::timestamp_ms(clock) > round.reveal_deadline) {
            round.phase = PHASE_FINALIZED;
        };

        assert!(round.phase == PHASE_FINALIZED, ERevealPhaseNotOver);

        // Return deposits to players who revealed
        let mut i = 0;
        let len = vector::length(&round.commits);
        while (i < len) {
            let entry = vector::borrow(&round.commits, i);
            if (entry.revealed) {
                // Return deposit
                let refund = coin::from_balance(
                    balance::split(&mut round.treasury, entry.deposit),
                    ctx,
                );
                transfer::public_transfer(refund, entry.player);
            } else {
                // Forfeit deposit
                round.forfeited = round.forfeited + entry.deposit;
            };
            i = i + 1;
        };
    }

    /// Withdraw forfeited deposits. Only callable after finalization.
    /// Sends all forfeited deposits to the caller.
    public fun withdraw_forfeited(
        round: &mut Round,
        ctx: &mut TxContext,
    ) {
        assert!(round.phase == PHASE_FINALIZED, EWrongPhase);

        let forfeited_amount = round.forfeited;
        if (forfeited_amount > 0) {
            round.forfeited = 0;
            let forfeited_coin = coin::from_balance(
                balance::split(&mut round.treasury, forfeited_amount),
                ctx,
            );
            transfer::public_transfer(forfeited_coin, tx_context::sender(ctx));
        };
    }

    // --- View functions ---

    public fun phase(round: &Round): u8 { round.phase }
    public fun commit_count(round: &Round): u64 { vector::length(&round.commits) }
    public fun reveal_count(round: &Round): u64 { vector::length(&round.reveals) }
    public fun forfeited_amount(round: &Round): u64 { round.forfeited }
    public fun commit_deadline(round: &Round): u64 { round.commit_deadline }
    public fun reveal_deadline(round: &Round): u64 { round.reveal_deadline }

    /// Get the revealed value for a player (empty if not revealed)
    public fun get_revealed_value(round: &Round, player: address): vector<u8> {
        let mut i = 0;
        let len = vector::length(&round.reveals);
        while (i < len) {
            let entry = vector::borrow(&round.reveals, i);
            if (entry.player == player) {
                return entry.value
            };
            i = i + 1;
        };
        vector::empty()
    }

    /// Check if a player has committed
    public fun has_committed(round: &Round, player: address): bool {
        let mut i = 0;
        let len = vector::length(&round.commits);
        while (i < len) {
            if (vector::borrow(&round.commits, i).player == player) {
                return true
            };
            i = i + 1;
        };
        false
    }

    /// Check if a player has revealed
    public fun has_revealed(round: &Round, player: address): bool {
        let mut i = 0;
        let len = vector::length(&round.commits);
        while (i < len) {
            let entry = vector::borrow(&round.commits, i);
            if (entry.player == player) {
                return entry.revealed
            };
            i = i + 1;
        };
        false
    }

    // --- Phase constants accessors ---

    public fun phase_commit(): u8 { PHASE_COMMIT }
    public fun phase_reveal(): u8 { PHASE_REVEAL }
    public fun phase_finalized(): u8 { PHASE_FINALIZED }

    // --- Cleanup ---

    /// Destroy a finalized round. Must have zero treasury balance.
    public fun destroy(round: Round) {
        let Round {
            id,
            commits: _,
            reveals: _,
            commit_deadline: _,
            reveal_deadline: _,
            phase: _,
            min_deposit: _,
            treasury,
            forfeited: _,
        } = round;
        object::delete(id);
        balance::destroy_zero(treasury);
    }

    // ========== Tests ==========

    #[test_only]
    use sui::test_scenario;
    #[test_only]
    const ALICE: address = @0xA;
    #[test_only]
    fun make_test_clock(timestamp_ms: u64, ctx: &mut TxContext): Clock {
        let mut c = clock::create_for_testing(ctx);
        clock::set_for_testing(&mut c, timestamp_ms);
        c
    }

    #[test]
    fun test_create_round() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);

        let round = create_round(
            1000000, // commit deadline
            1700000, // reveal deadline (700s gap > 600s min)
            100,     // min deposit
            ctx,
        );

        assert!(phase(&round) == PHASE_COMMIT, 0);
        assert!(commit_count(&round) == 0, 1);
        assert!(reveal_count(&round) == 0, 2);

        destroy(round);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidDeadlines)]
    fun test_create_round_invalid_deadlines() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);
        // commit_deadline > reveal_deadline
        let round = create_round(2000000, 1000000, 100, ctx);
        destroy(round);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EDeadlineTooClose)]
    fun test_create_round_deadline_too_close() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);
        // 5 min gap < 10 min minimum
        let round = create_round(1000000, 1300000, 100, ctx);
        destroy(round);
        test_scenario::end(scenario);
    }

    #[test]
    fun test_full_commit_reveal_flow() {
        let mut scenario = test_scenario::begin(ALICE);

        // Setup
        let ctx = test_scenario::ctx(&mut scenario);
        let mut test_clock = make_test_clock(0, ctx);

        let mut round = create_round(
            1000000,  // commit deadline: t=1000s
            2000000,  // reveal deadline: t=2000s
            100,      // min deposit: 100 MIST
            ctx,
        );

        // Alice commits at t=500s
        let value_a = b"alice_bid_100";
        let salt_a = b"alice_salt_random";
        let commitment_a = hash_commitment::compute(value_a, salt_a, 0);
        let deposit_a = coin::mint_for_testing<SUI>(200, ctx);

        clock::set_for_testing(&mut test_clock, 500000);
        commit(&mut round, commitment_a, deposit_a, &test_clock, ctx);
        assert!(commit_count(&round) == 1, 0);
        assert!(has_committed(&round, ALICE), 1);

        // Advance to reveal phase at t=1001s
        clock::set_for_testing(&mut test_clock, 1001000);
        advance_to_reveal(&mut round, &test_clock);
        assert!(phase(&round) == PHASE_REVEAL, 2);

        // Alice reveals
        reveal(&mut round, value_a, salt_a, &test_clock, ctx);
        assert!(reveal_count(&round) == 1, 3);
        assert!(has_revealed(&round, ALICE), 4);
        assert!(get_revealed_value(&round, ALICE) == value_a, 5);

        // Finalize at t=2001s
        clock::set_for_testing(&mut test_clock, 2001000);
        finalize(&mut round, &test_clock, ctx);
        assert!(phase(&round) == PHASE_FINALIZED, 6);
        assert!(forfeited_amount(&round) == 0, 7);

        // Cleanup
        clock::destroy_for_testing(test_clock);
        destroy(round);
        test_scenario::end(scenario);
    }

    #[test]
    fun test_non_revealer_forfeits_deposit() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);
        let mut test_clock = make_test_clock(0, ctx);

        let mut round = create_round(1000000, 2000000, 100, ctx);

        // Alice commits but won't reveal
        let commitment = hash_commitment::compute(b"secret", b"0123456789abcdef", 0);
        let deposit = coin::mint_for_testing<SUI>(150, ctx);

        clock::set_for_testing(&mut test_clock, 500000);
        commit(&mut round, commitment, deposit, &test_clock, ctx);

        // Skip to finalization without revealing
        clock::set_for_testing(&mut test_clock, 2001000);
        finalize(&mut round, &test_clock, ctx);

        assert!(phase(&round) == PHASE_FINALIZED, 0);
        assert!(forfeited_amount(&round) == 150, 1);

        clock::destroy_for_testing(test_clock);
        // Withdraw forfeited to drain treasury before destroy
        withdraw_forfeited(&mut round, ctx);
        destroy(round);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidOpening)]
    fun test_reveal_wrong_value_fails() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);
        let mut test_clock = make_test_clock(0, ctx);

        let mut round = create_round(1000000, 2000000, 100, ctx);

        let commitment = hash_commitment::compute(b"real_value", b"0123456789abcdef", 0);
        let deposit = coin::mint_for_testing<SUI>(100, ctx);

        clock::set_for_testing(&mut test_clock, 500000);
        commit(&mut round, commitment, deposit, &test_clock, ctx);

        // Try to reveal with wrong value
        clock::set_for_testing(&mut test_clock, 1001000);
        reveal(&mut round, b"fake_value", b"0123456789abcdef", &test_clock, ctx);

        clock::destroy_for_testing(test_clock);
        destroy(round);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInsufficientDeposit)]
    fun test_insufficient_deposit() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);
        let mut test_clock = make_test_clock(0, ctx);

        let mut round = create_round(1000000, 2000000, 100, ctx);
        let commitment = hash_commitment::compute(b"test", b"0123456789abcdef", 0);
        let deposit = coin::mint_for_testing<SUI>(50, ctx); // below minimum

        clock::set_for_testing(&mut test_clock, 500000);
        commit(&mut round, commitment, deposit, &test_clock, ctx);

        clock::destroy_for_testing(test_clock);
        destroy(round);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EWrongPhase)]
    fun test_commit_after_deadline() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);
        let mut test_clock = make_test_clock(0, ctx);

        let mut round = create_round(1000000, 2000000, 100, ctx);
        let commitment = hash_commitment::compute(b"late", b"0123456789abcdef", 0);
        let deposit = coin::mint_for_testing<SUI>(100, ctx);

        // Try to commit after deadline
        clock::set_for_testing(&mut test_clock, 1001000);
        commit(&mut round, commitment, deposit, &test_clock, ctx);

        clock::destroy_for_testing(test_clock);
        destroy(round);
        test_scenario::end(scenario);
    }

    #[test]
    fun test_auto_advance_on_reveal() {
        let mut scenario = test_scenario::begin(ALICE);
        let ctx = test_scenario::ctx(&mut scenario);
        let mut test_clock = make_test_clock(0, ctx);

        let mut round = create_round(1000000, 2000000, 100, ctx);

        let value = b"auto_advance";
        let salt = b"0123456789abcdef";
        let commitment = hash_commitment::compute(value, salt, 0);
        let deposit = coin::mint_for_testing<SUI>(100, ctx);

        clock::set_for_testing(&mut test_clock, 500000);
        commit(&mut round, commitment, deposit, &test_clock, ctx);

        // Reveal after commit deadline without explicit advance_to_reveal
        clock::set_for_testing(&mut test_clock, 1001000);
        assert!(phase(&round) == PHASE_COMMIT, 0); // still COMMIT before reveal call
        reveal(&mut round, value, salt, &test_clock, ctx);
        assert!(phase(&round) == PHASE_REVEAL, 1); // auto-advanced

        clock::set_for_testing(&mut test_clock, 2001000);
        finalize(&mut round, &test_clock, ctx);

        clock::destroy_for_testing(test_clock);
        destroy(round);
        test_scenario::end(scenario);
    }
}
