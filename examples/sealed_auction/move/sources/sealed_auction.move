/// Sealed-Bid Auction using SuiCryptoLib
///
/// Demonstrates hash commitment for sealed bidding:
/// 1. COMMIT phase: bidders submit H(amount || salt) + deposit
/// 2. REVEAL phase: bidders reveal amount + salt, contract verifies
/// 3. SETTLE: highest bidder wins, others get deposits back
///
/// Privacy: during COMMIT phase, nobody knows any bid amounts.
/// Fairness: deposit mechanism prevents commit-without-reveal griefing.
#[allow(lint(self_transfer), unused_variable, unused_const)]
module sealed_auction::auction {
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use suicryptolib::hash_commitment::{Self, Commitment};

    // --- Error codes ---

    const EWrongPhase: u64 = 0;
    const ECommitPhaseNotOver: u64 = 1;
    const ERevealPhaseNotOver: u64 = 2;
    const EInsufficientDeposit: u64 = 3;
    const EAlreadyBid: u64 = 4;
    const ENotBidder: u64 = 5;
    const EAlreadyRevealed: u64 = 6;
    const EInvalidOpening: u64 = 7;
    const EAuctionNotSettled: u64 = 8;
    #[allow(unused_const)]
    const ENotWinner: u64 = 9;
    #[allow(unused_const)]
    const EAlreadyClaimed: u64 = 10;

    // --- Constants ---

    const PHASE_COMMIT: u8 = 0;
    const PHASE_REVEAL: u8 = 1;
    const PHASE_SETTLED: u8 = 2;

    // --- Structs ---

    /// A sealed bid entry
    public struct Bid has store, drop {
        bidder: address,
        commitment: Commitment,
        deposit_amount: u64,
        revealed_amount: u64,
        revealed: bool,
    }

    /// The auction object
    public struct Auction has key {
        id: UID,
        item_name: vector<u8>,
        creator: address,
        bids: vector<Bid>,
        commit_deadline: u64,
        reveal_deadline: u64,
        min_deposit: u64,
        phase: u8,
        treasury: Balance<SUI>,
        winner: address,
        winning_amount: u64,
        settled: bool,
    }

    // --- Events ---

    public struct AuctionCreated has copy, drop {
        auction_id: ID,
        item_name: vector<u8>,
        commit_deadline: u64,
        reveal_deadline: u64,
    }

    public struct BidPlaced has copy, drop {
        auction_id: ID,
        bidder: address,
        commitment_hash: vector<u8>,
    }

    public struct BidRevealed has copy, drop {
        auction_id: ID,
        bidder: address,
        amount: u64,
    }

    public struct AuctionSettled has copy, drop {
        auction_id: ID,
        winner: address,
        winning_amount: u64,
        total_bids: u64,
    }

    // --- Public functions ---

    /// Create a new sealed-bid auction.
    public fun create_auction(
        item_name: vector<u8>,
        commit_deadline: u64,
        reveal_deadline: u64,
        min_deposit: u64,
        ctx: &mut TxContext,
    ) {
        let auction = Auction {
            id: object::new(ctx),
            item_name,
            creator: tx_context::sender(ctx),
            bids: vector::empty(),
            commit_deadline,
            reveal_deadline,
            min_deposit,
            phase: PHASE_COMMIT,
            treasury: balance::zero(),
            winner: @0x0,
            winning_amount: 0,
            settled: false,
        };

        event::emit(AuctionCreated {
            auction_id: object::id(&auction),
            item_name: auction.item_name,
            commit_deadline,
            reveal_deadline,
        });

        transfer::share_object(auction);
    }

    /// Place a sealed bid during COMMIT phase.
    /// commitment = H(amount_as_string || salt)
    /// Bidder must include a deposit >= min_deposit.
    public fun place_bid(
        auction: &mut Auction,
        commitment: Commitment,
        deposit: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert!(auction.phase == PHASE_COMMIT, EWrongPhase);
        assert!(clock::timestamp_ms(clock) <= auction.commit_deadline, EWrongPhase);

        let sender = tx_context::sender(ctx);
        let deposit_value = coin::value(&deposit);
        assert!(deposit_value >= auction.min_deposit, EInsufficientDeposit);

        // Check not already bid
        let mut i = 0;
        while (i < vector::length(&auction.bids)) {
            assert!(vector::borrow(&auction.bids, i).bidder != sender, EAlreadyBid);
            i = i + 1;
        };

        event::emit(BidPlaced {
            auction_id: object::id(auction),
            bidder: sender,
            commitment_hash: hash_commitment::hash(&commitment),
        });

        vector::push_back(&mut auction.bids, Bid {
            bidder: sender,
            commitment,
            deposit_amount: deposit_value,
            revealed_amount: 0,
            revealed: false,
        });

        balance::join(&mut auction.treasury, coin::into_balance(deposit));
    }

    /// Reveal bid during REVEAL phase.
    /// value should be the bid amount encoded as bytes (e.g., b"1000").
    /// salt is the random salt used during commitment.
    public fun reveal_bid(
        auction: &mut Auction,
        value: vector<u8>,
        salt: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Auto-advance to REVEAL if needed
        if (auction.phase == PHASE_COMMIT && clock::timestamp_ms(clock) > auction.commit_deadline) {
            auction.phase = PHASE_REVEAL;
        };

        assert!(auction.phase == PHASE_REVEAL, EWrongPhase);
        assert!(clock::timestamp_ms(clock) <= auction.reveal_deadline, EWrongPhase);

        let sender = tx_context::sender(ctx);

        let mut i = 0;
        let mut found = false;
        let mut revealed_amount = 0u64;
        let parsed_amount = parse_u64_from_bytes(&value);

        while (i < vector::length(&auction.bids)) {
            let bid = vector::borrow_mut(&mut auction.bids, i);
            if (bid.bidder == sender) {
                assert!(!bid.revealed, EAlreadyRevealed);
                assert!(
                    hash_commitment::verify_opening(&bid.commitment, value, salt),
                    EInvalidOpening,
                );

                bid.revealed_amount = parsed_amount;
                bid.revealed = true;
                found = true;
                revealed_amount = parsed_amount;
                break
            };
            i = i + 1;
        };

        assert!(found, ENotBidder);

        event::emit(BidRevealed {
            auction_id: object::id(auction),
            bidder: sender,
            amount: revealed_amount,
        });
    }

    /// Settle the auction after REVEAL phase.
    /// Determines winner (highest revealed bid).
    /// Returns deposits to all revealed bidders except winner.
    /// Forfeits deposits of non-revealers.
    public fun settle(
        auction: &mut Auction,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        // Auto-advance phases
        if (auction.phase == PHASE_COMMIT && clock::timestamp_ms(clock) > auction.commit_deadline) {
            auction.phase = PHASE_REVEAL;
        };
        if (auction.phase == PHASE_REVEAL && clock::timestamp_ms(clock) > auction.reveal_deadline) {
            // Find winner
            let mut highest_amount = 0u64;
            let mut winner_addr = @0x0;
            let mut i = 0;
            while (i < vector::length(&auction.bids)) {
                let bid = vector::borrow(&auction.bids, i);
                if (bid.revealed && bid.revealed_amount > highest_amount) {
                    highest_amount = bid.revealed_amount;
                    winner_addr = bid.bidder;
                };
                i = i + 1;
            };

            auction.winner = winner_addr;
            auction.winning_amount = highest_amount;
            auction.phase = PHASE_SETTLED;
            auction.settled = true;

            // Return deposits to revealed losers
            i = 0;
            while (i < vector::length(&auction.bids)) {
                let bid = vector::borrow(&auction.bids, i);
                if (bid.revealed && bid.bidder != winner_addr) {
                    let refund = coin::from_balance(
                        balance::split(&mut auction.treasury, bid.deposit_amount),
                        ctx,
                    );
                    transfer::public_transfer(refund, bid.bidder);
                };
                i = i + 1;
            };

            event::emit(AuctionSettled {
                auction_id: object::id(auction),
                winner: winner_addr,
                winning_amount: highest_amount,
                total_bids: vector::length(&auction.bids),
            });
        };

        assert!(auction.phase == PHASE_SETTLED, ERevealPhaseNotOver);
    }

    // --- View functions ---

    public fun phase(auction: &Auction): u8 { auction.phase }
    public fun item_name(auction: &Auction): vector<u8> { auction.item_name }
    public fun bid_count(auction: &Auction): u64 { vector::length(&auction.bids) }
    public fun winner(auction: &Auction): address { auction.winner }
    public fun winning_amount(auction: &Auction): u64 { auction.winning_amount }
    public fun is_settled(auction: &Auction): bool { auction.settled }

    // --- Internal helpers ---

    /// Parse a u64 from ASCII byte string (e.g., b"1000" -> 1000)
    fun parse_u64_from_bytes(bytes: &vector<u8>): u64 {
        let mut result = 0u64;
        let len = vector::length(bytes);
        let mut i = 0;
        while (i < len) {
            let byte = *vector::borrow(bytes, i);
            // ASCII '0' = 48, '9' = 57
            assert!(byte >= 48 && byte <= 57, 100);
            result = result * 10 + ((byte - 48) as u64);
            i = i + 1;
        };
        result
    }

    // ========== Tests ==========

    #[test_only]
    use sui::test_scenario;
    #[test_only]
    use sui::clock;

    #[test_only]
    const ALICE: address = @0xA;
    #[test_only]
    const BOB: address = @0xB;
    #[test_only]
    const CREATOR: address = @0xC;

    #[test]
    fun test_full_auction_flow() {
        let mut scenario = test_scenario::begin(CREATOR);
        let ctx = test_scenario::ctx(&mut scenario);
        let mut test_clock = clock::create_for_testing(ctx);

        // Create auction
        create_auction(
            b"Rare NFT",
            1000000,  // commit deadline
            2000000,  // reveal deadline
            100,      // min deposit
            ctx,
        );

        // Get shared auction
        test_scenario::next_tx(&mut scenario, ALICE);
        let mut auction = test_scenario::take_shared<Auction>(&scenario);

        // Alice bids 500
        let alice_salt = b"alice_random_salt";
        let alice_commitment = hash_commitment::compute(b"500", alice_salt, 0);
        let alice_deposit = coin::mint_for_testing<SUI>(200, test_scenario::ctx(&mut scenario));
        clock::set_for_testing(&mut test_clock, 500000);
        place_bid(&mut auction, alice_commitment, alice_deposit, &test_clock, test_scenario::ctx(&mut scenario));
        assert!(bid_count(&auction) == 1, 0);

        // Bob bids 800
        test_scenario::next_tx(&mut scenario, BOB);
        let bob_salt = b"bob_secret_salt!";
        let bob_commitment = hash_commitment::compute(b"800", bob_salt, 0);
        let bob_deposit = coin::mint_for_testing<SUI>(200, test_scenario::ctx(&mut scenario));
        place_bid(&mut auction, bob_commitment, bob_deposit, &test_clock, test_scenario::ctx(&mut scenario));
        assert!(bid_count(&auction) == 2, 1);

        // Advance to reveal phase
        clock::set_for_testing(&mut test_clock, 1500000);

        // Alice reveals
        test_scenario::next_tx(&mut scenario, ALICE);
        reveal_bid(&mut auction, b"500", alice_salt, &test_clock, test_scenario::ctx(&mut scenario));

        // Bob reveals
        test_scenario::next_tx(&mut scenario, BOB);
        reveal_bid(&mut auction, b"800", bob_salt, &test_clock, test_scenario::ctx(&mut scenario));

        // Settle
        clock::set_for_testing(&mut test_clock, 2500000);
        test_scenario::next_tx(&mut scenario, CREATOR);
        settle(&mut auction, &test_clock, test_scenario::ctx(&mut scenario));

        assert!(is_settled(&auction), 2);
        assert!(winner(&auction) == BOB, 3);
        assert!(winning_amount(&auction) == 800, 4);

        // Cleanup
        clock::destroy_for_testing(test_clock);
        test_scenario::return_shared(auction);
        test_scenario::end(scenario);
    }

    #[test]
    fun test_non_revealer_loses_deposit() {
        let mut scenario = test_scenario::begin(CREATOR);
        let ctx = test_scenario::ctx(&mut scenario);
        let mut test_clock = clock::create_for_testing(ctx);

        create_auction(b"Item", 1000000, 2000000, 100, ctx);

        test_scenario::next_tx(&mut scenario, ALICE);
        let mut auction = test_scenario::take_shared<Auction>(&scenario);

        // Alice bids and will reveal
        let alice_commitment = hash_commitment::compute(b"100", b"alice_salt_random", 0);
        let alice_deposit = coin::mint_for_testing<SUI>(150, test_scenario::ctx(&mut scenario));
        clock::set_for_testing(&mut test_clock, 500000);
        place_bid(&mut auction, alice_commitment, alice_deposit, &test_clock, test_scenario::ctx(&mut scenario));

        // Bob bids but won't reveal
        test_scenario::next_tx(&mut scenario, BOB);
        let bob_commitment = hash_commitment::compute(b"999", b"bob_secret_salt!", 0);
        let bob_deposit = coin::mint_for_testing<SUI>(150, test_scenario::ctx(&mut scenario));
        place_bid(&mut auction, bob_commitment, bob_deposit, &test_clock, test_scenario::ctx(&mut scenario));

        // Only Alice reveals
        clock::set_for_testing(&mut test_clock, 1500000);
        test_scenario::next_tx(&mut scenario, ALICE);
        reveal_bid(&mut auction, b"100", b"alice_salt_random", &test_clock, test_scenario::ctx(&mut scenario));

        // Settle - Alice wins by default (only revealer)
        clock::set_for_testing(&mut test_clock, 2500000);
        test_scenario::next_tx(&mut scenario, CREATOR);
        settle(&mut auction, &test_clock, test_scenario::ctx(&mut scenario));

        assert!(winner(&auction) == ALICE, 0);
        assert!(winning_amount(&auction) == 100, 1);

        clock::destroy_for_testing(test_clock);
        test_scenario::return_shared(auction);
        test_scenario::end(scenario);
    }

    #[test]
    #[expected_failure(abort_code = EInvalidOpening)]
    fun test_reveal_wrong_amount_fails() {
        let mut scenario = test_scenario::begin(CREATOR);
        let ctx = test_scenario::ctx(&mut scenario);
        let mut test_clock = clock::create_for_testing(ctx);

        create_auction(b"Item", 1000000, 2000000, 100, ctx);

        test_scenario::next_tx(&mut scenario, ALICE);
        let mut auction = test_scenario::take_shared<Auction>(&scenario);

        let commitment = hash_commitment::compute(b"500", b"alice_salt_random", 0);
        let deposit = coin::mint_for_testing<SUI>(100, test_scenario::ctx(&mut scenario));
        clock::set_for_testing(&mut test_clock, 500000);
        place_bid(&mut auction, commitment, deposit, &test_clock, test_scenario::ctx(&mut scenario));

        // Try to reveal with different amount
        clock::set_for_testing(&mut test_clock, 1500000);
        reveal_bid(&mut auction, b"999", b"alice_salt_random", &test_clock, test_scenario::ctx(&mut scenario));

        clock::destroy_for_testing(test_clock);
        test_scenario::return_shared(auction);
        test_scenario::end(scenario);
    }

    #[test]
    fun test_parse_u64() {
        assert!(parse_u64_from_bytes(&b"0") == 0, 0);
        assert!(parse_u64_from_bytes(&b"1") == 1, 1);
        assert!(parse_u64_from_bytes(&b"42") == 42, 2);
        assert!(parse_u64_from_bytes(&b"1000") == 1000, 3);
        assert!(parse_u64_from_bytes(&b"18446744073709551615") == 18446744073709551615, 4);
    }
}
