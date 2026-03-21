/**
 * Hooks for Confidential Account on-chain interactions.
 */
import { useCallback, useState, useEffect, useRef } from "react";
import { useSignAndExecuteTransaction, useSuiClient, useCurrentAccount } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { ACCOUNT_PACKAGE_ID } from "../config";

// --- Deposit ---

export function useDeposit() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const client = useSuiClient();
  const [loading, setLoading] = useState(false);

  const deposit = useCallback(
    async ({ commitmentX, commitmentY, senderHashBytes, proofBytes, depositMist }) => {
      setLoading(true);
      try {
        const tx = new Transaction();

        const [depositCoin] = tx.splitCoins(tx.gas, [
          tx.pure(bcs.u64().serialize(depositMist)),
        ]);

        tx.moveCall({
          target: `${ACCOUNT_PACKAGE_ID}::account::deposit`,
          arguments: [
            tx.pure(bcs.vector(bcs.u8()).serialize(commitmentX)),
            tx.pure(bcs.vector(bcs.u8()).serialize(commitmentY)),
            tx.pure(bcs.vector(bcs.u8()).serialize(senderHashBytes)),
            tx.pure(bcs.vector(bcs.u8()).serialize(proofBytes)),
            depositCoin,
          ],
        });

        const result = await signAndExecute({ transaction: tx });

        const txResponse = await client.waitForTransaction({
          digest: result.digest,
          options: { showObjectChanges: true },
        });

        const created = txResponse.objectChanges?.find(
          (c) => c.type === "created" && c.objectType?.includes("::account::ConfidentialAccount")
        );

        return { digest: result.digest, accountId: created?.objectId || null };
      } finally {
        setLoading(false);
      }
    },
    [signAndExecute, client]
  );

  return { deposit, loading };
}

// --- Withdraw ---

export function useWithdraw() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [loading, setLoading] = useState(false);

  const withdraw = useCallback(
    async ({ accountId, newCommitmentX, newCommitmentY, senderHashBytes, proofBytes, withdrawMist }) => {
      setLoading(true);
      try {
        const tx = new Transaction();

        tx.moveCall({
          target: `${ACCOUNT_PACKAGE_ID}::account::withdraw`,
          arguments: [
            tx.object(accountId),
            tx.pure(bcs.vector(bcs.u8()).serialize(newCommitmentX)),
            tx.pure(bcs.vector(bcs.u8()).serialize(newCommitmentY)),
            tx.pure(bcs.vector(bcs.u8()).serialize(senderHashBytes)),
            tx.pure(bcs.vector(bcs.u8()).serialize(proofBytes)),
            tx.pure(bcs.u64().serialize(withdrawMist)),
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

  return { withdraw, loading };
}

// --- Read Account State ---

export function useAccountState(accountId) {
  const client = useSuiClient();
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const obj = await client.getObject({
        id: accountId,
        options: { showContent: true },
      });
      if (obj.data?.content?.fields) {
        const f = obj.data.content.fields;
        setAccount({
          owner: f.owner,
          commitmentX: f.commitment?.fields?.point_x,
          commitmentY: f.commitment?.fields?.point_y,
          totalDeposited: parseInt(f.total_deposited, 10),
          totalWithdrawn: parseInt(f.total_withdrawn, 10),
          vaultBalance: parseInt(typeof f.vault === "string" ? f.vault : (f.vault?.fields?.value || "0"), 10),
        });
      }
    } catch (_) {
      // retry on next poll
    } finally {
      setLoading(false);
    }
  }, [client, accountId]);

  useEffect(() => {
    if (!accountId) return;
    refresh();
    intervalRef.current = setInterval(refresh, 5000);
    return () => clearInterval(intervalRef.current);
  }, [accountId, refresh]);

  return { account, loading, refresh };
}

// --- Find User's Accounts ---

export function useMyAccounts() {
  const client = useSuiClient();
  const currentAccount = useCurrentAccount();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!currentAccount?.address) return;
    setLoading(true);
    try {
      const objects = await client.getOwnedObjects({
        owner: currentAccount.address,
        filter: {
          StructType: `${ACCOUNT_PACKAGE_ID}::account::ConfidentialAccount`,
        },
        options: { showContent: true },
      });
      setAccounts(
        (objects.data || []).map((o) => ({
          id: o.data?.objectId,
          ...parseAccountFields(o.data?.content?.fields),
        }))
      );
    } catch (_) {
      // retry
    } finally {
      setLoading(false);
    }
  }, [client, currentAccount?.address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { accounts, loading, refresh };
}

function parseAccountFields(f) {
  if (!f) return {};
  return {
    owner: f.owner,
    totalDeposited: parseInt(f.total_deposited, 10),
    totalWithdrawn: parseInt(f.total_withdrawn, 10),
    vaultBalance: parseInt(typeof f.vault === "string" ? f.vault : (f.vault?.fields?.value || "0"), 10),
  };
}
