import { useState } from "react";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import { createIdentity, saveIdentity, getIdentity, identityToJSON } from "./lib/identity";
import { buildMerkleTree, generateMerkleProof } from "./lib/merkle-tree";
import { generateSemaphoreProof } from "./lib/prover";
import { TREE_DEPTH } from "./lib/config";
import {
  useCreateGroup,
  useAddMember,
  useVerifyProof,
  useGroupState,
  useGroupMembers,
} from "./hooks/use-semaphore";
import "./index.css";

function App() {
  const account = useCurrentAccount();
  const [groupId, setGroupId] = useState(localStorage.getItem("sem_group_id") || "");
  const [view, setView] = useState(groupId ? "group" : "home");

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <header className="border-b border-zinc-800/60 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-indigo-600 flex items-center justify-center text-[10px] font-bold text-white">S</div>
            <span className="text-[15px] font-medium tracking-tight text-zinc-300">Semaphore</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">匿名群组</span>
          </div>
          <ConnectButton />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {!account ? (
          <div className="py-20 text-center">
            <h1 className="text-2xl font-semibold mb-3 text-zinc-100">匿名群组成员证明</h1>
            <p className="text-zinc-500 mb-8 max-w-md mx-auto text-[15px] leading-relaxed">
              证明你是群组成员，但不暴露你是哪个成员。基于 Poseidon Merkle 树和 Groth16 零知识证明。
            </p>
            <ConnectButton />
          </div>
        ) : view === "home" ? (
          <HomeView onEnterGroup={(id) => {
            setGroupId(id);
            localStorage.setItem("sem_group_id", id);
            setView("group");
          }} />
        ) : (
          <GroupView groupId={groupId} onBack={() => {
            setView("home");
            setGroupId("");
            localStorage.removeItem("sem_group_id");
          }} />
        )}
      </main>

      <footer className="border-t border-zinc-800/40 py-6 text-center">
        <p className="text-[11px] text-zinc-700">
          SuiCryptoLib -- semaphore + merkle_poseidon -- Groth16 + Poseidon on BN254
        </p>
      </footer>
    </div>
  );
}

// --- Home ---

function HomeView({ onEnterGroup }) {
  const { createGroup, loading } = useCreateGroup();
  const [joinId, setJoinId] = useState("");
  const [error, setError] = useState("");

  const handleCreate = async () => {
    setError("");
    try {
      const result = await createGroup();
      if (result.groupId) onEnterGroup(result.groupId);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100 mb-1">匿名群组</h1>
        <p className="text-sm text-zinc-500">创建或加入一个 Semaphore 群组，进行匿名操作</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
          <h2 className="text-sm font-medium text-zinc-300">创建群组</h2>
          <p className="text-xs text-zinc-500">创建一个新的匿名群组 (Merkle 树深度 = {TREE_DEPTH}，最多 {1 << TREE_DEPTH} 成员)</p>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-30 transition-colors"
          >
            {loading ? "创建中..." : "创建群组 (签名交易)"}
          </button>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
          <h2 className="text-sm font-medium text-zinc-300">加入群组</h2>
          <input
            type="text"
            placeholder="群组 Object ID (0x...)"
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-600 transition-colors font-mono text-xs"
          />
          <button
            onClick={() => joinId && onEnterGroup(joinId)}
            disabled={!joinId}
            className="w-full py-2 rounded-md bg-zinc-700 text-zinc-200 text-sm font-medium hover:bg-zinc-600 disabled:opacity-30 transition-colors"
          >
            进入群组
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// --- Group View ---

function GroupView({ groupId, onBack }) {
  const { group, refresh: refreshGroup } = useGroupState(groupId);
  const { members, refresh: refreshMembers } = useGroupMembers(groupId);
  const identity = getIdentity(groupId);

  const refreshAll = () => { refreshGroup(); refreshMembers(); };

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
        &larr; 返回
      </button>

      {/* Group Info */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs text-zinc-600 uppercase tracking-wider mb-1">群组状态</p>
            <p className="text-lg font-semibold text-zinc-100">{group?.nextIndex || 0} 名成员</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-zinc-700 mb-1">Merkle Root</p>
            <p className="text-[10px] font-mono text-zinc-600 max-w-[200px] break-all">
              {group?.merkleRoot ? String(group.merkleRoot).substring(0, 24) + "..." : "..."}
            </p>
          </div>
        </div>
        <p className="text-[10px] text-zinc-800 font-mono mt-3 break-all">{groupId}</p>
      </div>

      {/* Join / Identity */}
      {!identity ? (
        <JoinPanel groupId={groupId} onSuccess={refreshAll} />
      ) : (
        <div className="rounded-lg border border-indigo-900/30 bg-indigo-950/20 p-5">
          <p className="text-xs text-indigo-400 mb-1">你已是群组成员</p>
          <p className="text-[10px] font-mono text-zinc-600 break-all">
            承诺: {identity.commitment.toString().substring(0, 24)}...
          </p>
        </div>
      )}

      {/* Anonymous Action */}
      {identity && members.length > 0 && (
        <AnonymousAction
          groupId={groupId}
          identity={identity}
          members={members}
          merkleRoot={group?.merkleRoot}
        />
      )}

      {/* Member List */}
      {members.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
          <p className="text-xs text-zinc-600 uppercase tracking-wider mb-3">链上成员 (身份承诺)</p>
          <div className="space-y-1.5">
            {members.map((m, i) => (
              <div key={i} className="flex justify-between text-[11px] font-mono text-zinc-600">
                <span>#{m.memberIndex}</span>
                <span className="break-all max-w-[80%] text-right">
                  {String(m.commitment).substring(0, 32)}...
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-zinc-700 mt-3">
            观察者只能看到这些数字。无法从承诺推算出成员身份。
          </p>
        </div>
      )}
    </div>
  );
}

// --- Join Panel ---

function JoinPanel({ groupId, onSuccess }) {
  const { addMember, loading } = useAddMember();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const handleJoin = async () => {
    setError("");
    setStatus("生成匿名身份...");

    try {
      const identity = await createIdentity();
      setStatus("提交身份承诺到链上...");

      await addMember({
        groupId,
        commitment: identity.commitment,
      });

      saveIdentity(groupId, identity);
      setStatus("");
      onSuccess();
    } catch (err) {
      setError(err.message);
      setStatus("");
    }
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
      <h2 className="text-sm font-medium text-zinc-300">加入群组</h2>
      <p className="text-xs text-zinc-500">
        生成随机身份密钥，计算 Poseidon(secret, nullifier_key) 作为身份承诺，提交到链上 Merkle 树。
        密钥保存在本地浏览器中。
      </p>
      <button
        onClick={handleJoin}
        disabled={loading}
        className="w-full py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-30 transition-colors"
      >
        {loading ? "处理中..." : "生成身份并加入 (签名交易)"}
      </button>
      {status && (
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-xs text-indigo-400">{status}</span>
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// --- Anonymous Action ---

function AnonymousAction({ groupId, identity, members, merkleRoot }) {
  const { verifyProof, loading: txLoading } = useVerifyProof();
  const [extNullifier, setExtNullifier] = useState("");
  const [proofStage, setProofStage] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const stages = {
    building: "构建 Poseidon Merkle 树...",
    proving: "生成零知识证明中...",
    converting: "转换为 Sui 格式...",
    done: "证明已就绪",
    signing: "请在钱包中签名...",
  };

  const handleAction = async () => {
    if (!extNullifier) return;
    setError("");
    setResult("");

    try {
      setProofStage("building");

      // Build tree from on-chain members
      const commitments = members.map((m) => BigInt(m.commitment));
      const tree = await buildMerkleTree(commitments, TREE_DEPTH);

      // Find my leaf index
      const myIndex = commitments.findIndex((c) => c === identity.commitment);
      if (myIndex < 0) {
        setError("你的身份承诺不在群组中");
        setProofStage("");
        return;
      }

      const merkleProof = generateMerkleProof(tree, myIndex);

      // Generate ZK proof
      const proofResult = await generateSemaphoreProof({
        identity,
        merkleProof,
        merkleRoot: tree.root,
        externalNullifier: BigInt(extNullifier),
        onProgress: setProofStage,
      });

      setProofStage("signing");

      await verifyProof({
        groupId,
        merkleRoot: proofResult.merkleRoot,
        nullifierHash: proofResult.nullifierHash,
        externalNullifier: proofResult.externalNullifier,
        proofBytes: proofResult.proofBytes,
      });

      setResult("验证成功! 你已匿名证明了群组成员身份。");
      setProofStage("");
    } catch (err) {
      if (err.message?.includes("NullifierAlreadyUsed") || err.message?.includes("abort_code: 2")) {
        setError("此 nullifier 已使用过 -- 你不能对同一个场景重复操作");
      } else {
        setError(err.message);
      }
      setProofStage("");
    }
  };

  const isWorking = proofStage || txLoading;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
      <h2 className="text-sm font-medium text-zinc-300">匿名操作</h2>
      <p className="text-xs text-zinc-500">
        输入场景标识 (如投票提案 ID)，生成零知识证明，匿名证明你是群组成员。
        每个场景标识只能使用一次 (nullifier 防双重操作)。
      </p>
      <div className="flex gap-3">
        <input
          type="text"
          inputMode="numeric"
          placeholder="场景标识 (如 42)"
          value={extNullifier}
          onChange={(e) => setExtNullifier(e.target.value.replace(/\D/g, ""))}
          disabled={isWorking}
          className="flex-1 px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-600 disabled:opacity-40 transition-colors"
        />
        <button
          onClick={handleAction}
          disabled={!extNullifier || isWorking}
          className="px-5 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {isWorking ? "处理中..." : "匿名证明"}
        </button>
      </div>
      {proofStage && (
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-xs text-indigo-400">{stages[proofStage] || proofStage}</span>
        </div>
      )}
      {result && <p className="text-xs text-emerald-400">{result}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

export default App;
