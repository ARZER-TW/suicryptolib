/**
 * Auction hooks - real Sui on-chain interactions.
 *
 * Each user action becomes a signed transaction:
 *   create  → moveCall auction::create_auction
 *   bid     → PTB: hash_commitment::from_hash + auction::place_bid
 *   reveal  → moveCall auction::reveal_bid
 *   settle  → moveCall auction::settle
 *   read    → suiClient.getObject (parse Auction fields)
 */
import { useCallback, useState, useEffect, useRef } from "react";
import { useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import {
  LIB_PACKAGE_ID,
  AUCTION_PACKAGE_ID,
  CLOCK_OBJECT_ID,
  SCHEME_SHA256,
} from "./config";

// --- Create Auction ---

export function useCreateAuction() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const client = useSuiClient();
  const [loading, setLoading] = useState(false);

  const create = useCallback(
    async ({ itemName, commitDeadline, revealDeadline, minDeposit }) => {
      setLoading(true);
      try {
        const tx = new Transaction();

        tx.moveCall({
          target: `${AUCTION_PACKAGE_ID}::auction::create_auction`,
          arguments: [
            tx.pure(bcs.vector(bcs.u8()).serialize(new TextEncoder().encode(itemName))),
            tx.pure(bcs.u64().serialize(commitDeadline)),
            tx.pure(bcs.u64().serialize(revealDeadline)),
            tx.pure(bcs.u64().serialize(minDeposit)),
          ],
        });

        const result = await signAndExecute({ transaction: tx });

        // Extract auction object ID from created objects
        const txResponse = await client.waitForTransaction({
          digest: result.digest,
          options: { showEvents: true, showObjectChanges: true },
        });

        const created = txResponse.objectChanges?.find(
          (c) => c.type === "created" && c.objectType?.includes("::auction::Auction")
        );

        return {
          digest: result.digest,
          auctionId: created?.objectId || null,
        };
      } finally {
        setLoading(false);
      }
    },
    [signAndExecute, client]
  );

  return { create, loading };
}

// --- Place Bid ---

export function usePlaceBid() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [loading, setLoading] = useState(false);

  const placeBid = useCallback(
    async ({ auctionId, commitmentHash, depositMist }) => {
      setLoading(true);
      try {
        const tx = new Transaction();

        // Step 1: Create Commitment from pre-computed hash
        // hash_commitment::from_hash(hash: vector<u8>, scheme: u8) -> Commitment
        const [commitment] = tx.moveCall({
          target: `${LIB_PACKAGE_ID}::hash_commitment::from_hash`,
          arguments: [
            tx.pure(bcs.vector(bcs.u8()).serialize(commitmentHash)),
            tx.pure(bcs.u8().serialize(SCHEME_SHA256)),
          ],
        });

        // Step 2: Split deposit from gas coin
        const [deposit] = tx.splitCoins(tx.gas, [
          tx.pure(bcs.u64().serialize(depositMist)),
        ]);

        // Step 3: Call place_bid with commitment + deposit
        tx.moveCall({
          target: `${AUCTION_PACKAGE_ID}::auction::place_bid`,
          arguments: [
            tx.object(auctionId),
            commitment,
            deposit,
            tx.object(CLOCK_OBJECT_ID),
          ],
        });

        const result = await signAndExecute({ transaction: tx });
        return { digest: result.digest };
      } finally {
        setLoading(false);
      }
    },
    [signAndExecute]
  );

  return { placeBid, loading };
}

// --- Reveal Bid ---

export function useRevealBid() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [loading, setLoading] = useState(false);

  const revealBid = useCallback(
    async ({ auctionId, valueBytes, saltBytes }) => {
      setLoading(true);
      try {
        const tx = new Transaction();

        tx.moveCall({
          target: `${AUCTION_PACKAGE_ID}::auction::reveal_bid`,
          arguments: [
            tx.object(auctionId),
            tx.pure(bcs.vector(bcs.u8()).serialize(valueBytes)),
            tx.pure(bcs.vector(bcs.u8()).serialize(saltBytes)),
            tx.object(CLOCK_OBJECT_ID),
          ],
        });

        const result = await signAndExecute({ transaction: tx });
        return { digest: result.digest };
      } finally {
        setLoading(false);
      }
    },
    [signAndExecute]
  );

  return { revealBid, loading };
}

// --- Settle Auction ---

export function useSettleAuction() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [loading, setLoading] = useState(false);

  const settle = useCallback(
    async ({ auctionId }) => {
      setLoading(true);
      try {
        const tx = new Transaction();

        tx.moveCall({
          target: `${AUCTION_PACKAGE_ID}::auction::settle`,
          arguments: [
            tx.object(auctionId),
            tx.object(CLOCK_OBJECT_ID),
          ],
        });

        const result = await signAndExecute({ transaction: tx });
        return { digest: result.digest };
      } finally {
        setLoading(false);
      }
    },
    [signAndExecute]
  );

  return { settle, loading };
}

// --- Read Auction State ---

export function useAuctionState(auctionId) {
  const client = useSuiClient();
  const [auction, setAuction] = useState(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!auctionId) return;
    setLoading(true);
    try {
      const obj = await client.getObject({
        id: auctionId,
        options: { showContent: true },
      });

      if (obj.data?.content?.fields) {
        const f = obj.data.content.fields;
        const chainPhase = Number(f.phase);
          const commitDeadline = parseInt(f.commit_deadline, 10);
          const revealDeadline = parseInt(f.reveal_deadline, 10);
          const settled = f.settled;

          // Compute effective phase from local time, because the chain
          // only updates phase lazily (on the next reveal_bid/settle call).
          let effectivePhase = chainPhase;
          if (!settled) {
            const now = Date.now();
            if (now <= commitDeadline) {
              effectivePhase = 0; // COMMIT
            } else if (now <= revealDeadline) {
              effectivePhase = 1; // REVEAL
            } else {
              effectivePhase = 2; // ready to settle (or settled)
            }
          } else {
            effectivePhase = 2;
          }

          setAuction({
          itemName: decodeBytes(f.item_name),
          creator: f.creator,
          phase: effectivePhase,
          chainPhase,
          commitDeadline,
          revealDeadline,
          minDeposit: parseInt(f.min_deposit, 10),
          bidCount: f.bids?.length || 0,
          bids: (f.bids || []).map((b) => ({
            bidder: b.fields.bidder,
            commitmentHash: b.fields.commitment?.fields?.hash,
            depositAmount: parseInt(b.fields.deposit_amount, 10),
            revealedAmount: parseInt(b.fields.revealed_amount, 10),
            revealed: b.fields.revealed,
          })),
          winner: f.winner,
          winningAmount: parseInt(f.winning_amount, 10),
          settled,
        });
      }
    } catch (err) {
      // Silently retry on next poll cycle
    } finally {
      setLoading(false);
    }
  }, [client, auctionId]);

  // Auto-poll every 3 seconds
  useEffect(() => {
    if (!auctionId) return;
    refresh();
    intervalRef.current = setInterval(refresh, 3000);
    return () => clearInterval(intervalRef.current);
  }, [auctionId, refresh]);

  return { auction, loading, refresh };
}

// --- Helpers ---

function decodeBytes(arr) {
  if (!arr) return "";
  // Sui returns vector<u8> as array of numbers
  if (Array.isArray(arr)) {
    return new TextDecoder().decode(new Uint8Array(arr));
  }
  return String(arr);
}
