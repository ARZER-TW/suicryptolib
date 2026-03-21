# SuiCryptoLib

Cryptographic primitives library for Sui blockchain. Provides ready-to-use Move modules for commit-reveal schemes, Merkle proofs, Pedersen commitments, range proofs, and Semaphore anonymous membership.

## Modules

| Module | Type | Description |
|--------|------|-------------|
| `hash_commitment` | Pure Move | SHA-256/Blake2b/Keccak commitment with salt enforcement |
| `commit_reveal` | Pure Move | Phase-managed commit-reveal rounds with deposit/refund |
| `merkle` | Pure Move | Merkle proof verification with domain separation |
| `merkle_poseidon` | Pure Move + Poseidon | Poseidon Merkle tree (circomlib-compatible) |
| `pedersen` | Groth16 Bridge | Pedersen commitment verification via ZK proof |
| `range_proof` | Groth16 Bridge | 64-bit range proof (embeds Pedersen, prevents binding detachment) |
| `semaphore` | Groth16 + Poseidon | Anonymous group membership proof with nullifier |

## Testnet Deployment

```
Package (v2): 0xd8ad089847187cbaa15da503e8892d5e3f0a2acd6cad1aff7be05bf0c127cf02
```

## Demos

Three demo applications showcase different library capabilities:

### Demo 1: Sealed-Bid Auction
Commit-reveal bidding using `hash_commitment`. Bids hidden until reveal phase.
```bash
cd examples/sealed_auction/frontend && npm install && npm run dev
```

### Demo 2: Confidential Account (Groth16 Demo)
Browser-side Groth16 proof generation with on-chain BN254 verification. Demonstrates the complete snarkjs-to-Sui pipeline.
```bash
cd examples/confidential_account/frontend && npm install && npm run dev
```

### Demo 3: Semaphore (Anonymous Group)
Anonymous membership proof using Poseidon Merkle tree + Groth16 ZK proof. Proves group membership without revealing identity.
```bash
cd examples/semaphore/frontend && npm install && npm run dev
```

## ZK Circuits

| Circuit | Constraints | Description |
|---------|-------------|-------------|
| `pedersen_commitment` | 8,249 | Pedersen commitment on BabyJubJub |
| `range_proof_64` | 7,949 | 64-bit range proof (embeds Pedersen) |
| `semaphore_lite` | 2,454 | Anonymous membership + nullifier (depth=8) |

## Tests

```
Move (library):  93 tests
Move (demos):     9 tests
TypeScript SDK:  34 tests
Total:          136 tests, 0 failures
```

## Project Structure

```
move/sources/          -- Core library (9 Move modules)
circuits/              -- Circom ZK circuits + trusted setup
sdk/                   -- TypeScript SDK (hash-commitment, merkle)
examples/
  sealed_auction/      -- Demo 1 (Move + React frontend)
  confidential_account/-- Demo 2 (Move + React frontend)
  semaphore/           -- Demo 3 (React frontend, uses upgraded lib)
docs/                  -- Project analysis document
```

## Tech Stack

- **Chain**: Sui Move (testnet)
- **ZK**: Circom 2.1 + snarkjs (Groth16 on BN254)
- **Frontend**: React + Vite + Tailwind CSS + @mysten/dapp-kit
- **Hashing**: SHA-256, Blake2b, Keccak256, Poseidon (BN254)
