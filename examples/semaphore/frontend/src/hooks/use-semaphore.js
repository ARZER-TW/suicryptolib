/**
 * Hooks for Semaphore on-chain interactions.
 */
import { useCallback, useState, useEffect, useRef } from "react";
import { useSignAndExecuteTransaction, useSuiClient, useCurrentAccount } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { bcs } from "@mysten/sui/bcs";
import { LIB_PACKAGE_ID, TREE_DEPTH } from "../lib/config";
import { bigintToBytes32LE } from "../lib/prover";

// --- Create Group ---

export function useCreateGroup() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const client = useSuiClient();
  const [loading, setLoading] = useState(false);

  const createGroup = useCallback(async () => {
    setLoading(true);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${LIB_PACKAGE_ID}::semaphore::create_group`,
        arguments: [tx.pure(bcs.u8().serialize(TREE_DEPTH))],
      });

      const result = await signAndExecute({ transaction: tx });
      const txResponse = await client.waitForTransaction({
        digest: result.digest,
        options: { showObjectChanges: true },
      });

      const created = txResponse.objectChanges?.find(
        (c) => c.type === "created" && c.objectType?.includes("::semaphore::Group")
      );

      return { digest: result.digest, groupId: created?.objectId || null };
    } finally {
      setLoading(false);
    }
  }, [signAndExecute, client]);

  return { createGroup, loading };
}

// --- Add Member ---

export function useAddMember() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [loading, setLoading] = useState(false);

  const addMember = useCallback(async ({ groupId, commitment }) => {
    setLoading(true);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${LIB_PACKAGE_ID}::semaphore::add_member`,
        arguments: [
          tx.object(groupId),
          tx.pure(bcs.u256().serialize(commitment)),
        ],
      });

      const result = await signAndExecute({ transaction: tx });
      return { digest: result.digest };
    } finally {
      setLoading(false);
    }
  }, [signAndExecute]);

  return { addMember, loading };
}

// --- Verify Proof ---

export function useVerifyProof() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [loading, setLoading] = useState(false);

  const verifyProof = useCallback(async ({
    groupId,
    merkleRoot,
    nullifierHash,
    externalNullifier,
    proofBytes,
  }) => {
    setLoading(true);
    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${LIB_PACKAGE_ID}::semaphore::verify_proof`,
        arguments: [
          tx.object(groupId),
          tx.pure(bcs.u256().serialize(merkleRoot)),
          tx.pure(bcs.u256().serialize(nullifierHash)),
          tx.pure(bcs.u256().serialize(externalNullifier)),
          tx.pure(bcs.vector(bcs.u8()).serialize(proofBytes)),
        ],
      });

      const result = await signAndExecute({ transaction: tx });
      return { digest: result.digest };
    } finally {
      setLoading(false);
    }
  }, [signAndExecute]);

  return { verifyProof, loading };
}

// --- Read Group State ---

export function useGroupState(groupId) {
  const client = useSuiClient();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const obj = await client.getObject({
        id: groupId,
        options: { showContent: true },
      });
      if (obj.data?.content?.fields) {
        const f = obj.data.content.fields;
        setGroup({
          depth: parseInt(f.depth, 10),
          nextIndex: parseInt(f.next_index, 10),
          merkleRoot: f.merkle_root,
        });
      }
    } catch (_) {
      // retry
    } finally {
      setLoading(false);
    }
  }, [client, groupId]);

  useEffect(() => {
    if (!groupId) return;
    refresh();
    intervalRef.current = setInterval(refresh, 5000);
    return () => clearInterval(intervalRef.current);
  }, [groupId, refresh]);

  return { group, loading, refresh };
}

// --- Query MemberAdded events ---

export function useGroupMembers(groupId) {
  const client = useSuiClient();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    try {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${LIB_PACKAGE_ID}::semaphore::MemberAdded`,
        },
        limit: 100,
      });
      const groupMembers = (events.data || [])
        .filter((e) => {
          const parsed = e.parsedJson;
          return parsed?.group_id === groupId;
        })
        .map((e) => ({
          commitment: e.parsedJson.commitment,
          memberIndex: parseInt(e.parsedJson.member_index, 10),
        }))
        .sort((a, b) => a.memberIndex - b.memberIndex);
      setMembers(groupMembers);
    } catch (_) {
      // retry
    } finally {
      setLoading(false);
    }
  }, [client, groupId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { members, loading, refresh };
}
