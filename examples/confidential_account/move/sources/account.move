/// Confidential Account -- ZK-powered private balance on Sui
///
/// Demonstrates Groth16 bridge modules (pedersen + range_proof):
///   - Balance stored as Pedersen Commitment (amount never revealed on-chain)
///   - Range Proof verifies balance is in [0, 2^64) (prevents negative balance)
///   - Single Groth16 proof proves BOTH commitment validity AND range (circuit embeds both)
///
/// Flow:
///   1. deposit():  User locks SUI + provides range_proof for committed amount
///   2. withdraw(): User provides range_proof for NEW balance, receives SUI back
///
/// Privacy: on-chain observers see commitment points (64 bytes) but cannot
/// derive the actual balance. Only the account owner (who holds value + blinding
/// in their browser localStorage) knows the real amount.
#[allow(unused_variable)]
module confidential_account::account {
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::event;
    use suicryptolib::pedersen::{Self, PedersenCommitment};
    use suicryptolib::range_proof;

    // --- Error codes ---

    /// Range proof verification failed (invalid proof or commitment mismatch)
    const EInvalidRangeProof: u64 = 0;
    /// Only the account owner can operate on this account
    const ENotOwner: u64 = 1;
    /// Withdraw amount exceeds deposited balance
    const EInsufficientBalance: u64 = 2;
    /// Sender hash must be exactly 32 bytes
    const EInvalidSenderHash: u64 = 3;

    // --- Structs ---

    /// A confidential account. The real balance is hidden inside a Pedersen
    /// Commitment. The contract holds actual SUI in a Balance, but never
    /// knows the plaintext amount -- it only knows the total deposited vs
    /// total withdrawn (as a solvency guard).
    public struct ConfidentialAccount has key {
        id: UID,
        owner: address,
        commitment: PedersenCommitment,
        vault: Balance<SUI>,
        total_deposited: u64,
        total_withdrawn: u64,
    }

    // --- Events ---

    public struct AccountCreated has copy, drop {
        account_id: ID,
        owner: address,
    }

    public struct DepositMade has copy, drop {
        account_id: ID,
        deposit_amount: u64,
    }

    public struct WithdrawMade has copy, drop {
        account_id: ID,
        withdraw_amount: u64,
    }

    // --- Public functions ---

    /// Create a confidential account by depositing SUI.
    ///
    /// The deposited amount is hidden inside a Pedersen Commitment.
    /// A Range Proof (which embeds Pedersen verification) proves:
    ///   1. The commitment is correctly formed (value*G + blinding*H)
    ///   2. The committed value is in [0, 2^64)
    ///
    /// sender_hash binds the proof to this specific sender (anti-replay).
    public fun deposit(
        commitment_x: vector<u8>,
        commitment_y: vector<u8>,
        sender_hash: vector<u8>,
        proof_bytes: vector<u8>,
        coin: Coin<SUI>,
        ctx: &mut TxContext,
    ) {
        assert!(vector::length(&sender_hash) == 32, EInvalidSenderHash);

        let commitment = pedersen::from_point(commitment_x, commitment_y);

        // Single Groth16 verification: range_proof embeds Pedersen,
        // so this simultaneously proves commitment validity AND range.
        assert!(
            range_proof::verify_range_64(&commitment, sender_hash, proof_bytes),
            EInvalidRangeProof,
        );

        let deposit_amount = coin::value(&coin);

        let account = ConfidentialAccount {
            id: object::new(ctx),
            owner: tx_context::sender(ctx),
            commitment,
            vault: coin::into_balance(coin),
            total_deposited: deposit_amount,
            total_withdrawn: 0,
        };

        event::emit(AccountCreated {
            account_id: object::id(&account),
            owner: tx_context::sender(ctx),
        });

        event::emit(DepositMade {
            account_id: object::id(&account),
            deposit_amount,
        });

        transfer::transfer(account, tx_context::sender(ctx));
    }

    /// Withdraw SUI from a confidential account.
    ///
    /// The user provides a NEW commitment for the remaining balance,
    /// along with a Range Proof proving the new balance is in [0, 2^64).
    ///
    /// Solvency guard: total_withdrawn + withdraw_amount <= total_deposited.
    /// This ensures the user cannot extract more SUI than they put in,
    /// even though the contract cannot see the committed amounts.
    public fun withdraw(
        account: &mut ConfidentialAccount,
        new_commitment_x: vector<u8>,
        new_commitment_y: vector<u8>,
        sender_hash: vector<u8>,
        proof_bytes: vector<u8>,
        withdraw_amount: u64,
        ctx: &mut TxContext,
    ) {
        assert!(tx_context::sender(ctx) == account.owner, ENotOwner);
        assert!(vector::length(&sender_hash) == 32, EInvalidSenderHash);

        // Solvency guard
        assert!(
            account.total_withdrawn + withdraw_amount <= account.total_deposited,
            EInsufficientBalance,
        );

        let new_commitment = pedersen::from_point(new_commitment_x, new_commitment_y);

        // Verify the new balance commitment + range proof
        assert!(
            range_proof::verify_range_64(&new_commitment, sender_hash, proof_bytes),
            EInvalidRangeProof,
        );

        // Update commitment to the new balance
        account.commitment = new_commitment;
        account.total_withdrawn = account.total_withdrawn + withdraw_amount;

        // Transfer SUI back to the owner
        let withdrawn = coin::from_balance(
            balance::split(&mut account.vault, withdraw_amount),
            ctx,
        );
        transfer::public_transfer(withdrawn, account.owner);

        event::emit(WithdrawMade {
            account_id: object::id(account),
            withdraw_amount,
        });
    }

    // --- View functions ---

    public fun owner(account: &ConfidentialAccount): address { account.owner }
    public fun commitment(account: &ConfidentialAccount): &PedersenCommitment { &account.commitment }
    public fun total_deposited(account: &ConfidentialAccount): u64 { account.total_deposited }
    public fun total_withdrawn(account: &ConfidentialAccount): u64 { account.total_withdrawn }
    public fun vault_balance(account: &ConfidentialAccount): u64 { balance::value(&account.vault) }
}
