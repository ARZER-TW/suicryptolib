/**
 * Deployment configuration.
 *
 * After publishing to testnet, update these values:
 *   sui client publish --gas-budget 200000000
 *
 * The publish transaction will output the package IDs.
 */

// suicryptolib package ID on testnet (set after publish)
export const LIB_PACKAGE_ID = import.meta.env.VITE_LIB_PACKAGE_ID || "";

// sealed_auction package ID on testnet (set after publish)
export const AUCTION_PACKAGE_ID = import.meta.env.VITE_AUCTION_PACKAGE_ID || "";

// Runtime check
export function assertConfigured() {
  if (!LIB_PACKAGE_ID || !AUCTION_PACKAGE_ID) {
    throw new Error(
      "Package IDs not configured. Create .env file with:\n" +
      "VITE_LIB_PACKAGE_ID=0x...\n" +
      "VITE_AUCTION_PACKAGE_ID=0x..."
    );
  }
}

// Sui testnet RPC
export const SUI_NETWORK = "testnet";
export const SUI_RPC_URL = "https://fullnode.testnet.sui.io:443";

// hash_commitment scheme constants (match Move module)
export const SCHEME_SHA256 = 0;

// Auction phase constants
export const PHASE_COMMIT = 0;
export const PHASE_REVEAL = 1;
export const PHASE_SETTLED = 2;

// Clock object ID (shared, always 0x6)
export const CLOCK_OBJECT_ID = "0x6";

// Minimum deposit in MIST (1 SUI = 1_000_000_000 MIST)
export const DEFAULT_MIN_DEPOSIT_MIST = 100_000_000; // 0.1 SUI
