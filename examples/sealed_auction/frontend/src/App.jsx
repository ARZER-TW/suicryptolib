import { useState, useEffect } from "react";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import { createHash, randomBytes, hexToBytes, bytesToHex } from "./crypto-utils";
import {
  useCreateAuction,
  usePlaceBid,
  useRevealBid,
  useSettleAuction,
  useAuctionState,
} from "./use-auction";
import { DEFAULT_MIN_DEPOSIT_MIST, PHASE_COMMIT, PHASE_REVEAL, PHASE_SETTLED } from "./config";
import "./index.css";

const PHASE_LABELS = ["承诺阶段", "揭示阶段", "已结算"];
const DEPOSIT_SUI = DEFAULT_MIN_DEPOSIT_MIST / 1_000_000_000;

// --- Bid storage (localStorage) ---
// We store {amount, salt} locally so the user can reveal later.
// These secrets NEVER go on-chain during commit phase.

function saveBidSecret(auctionId, amount, saltHex) {
  const key = `bid_${auctionId}`;
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  existing.push({ amount, saltHex, revealed: false });
  localStorage.setItem(key, JSON.stringify(existing));
}

function getBidSecrets(auctionId) {
  return JSON.parse(localStorage.getItem(`bid_${auctionId}`) || "[]");
}

function markRevealed(auctionId, index) {
  const key = `bid_${auctionId}`;
  const secrets = JSON.parse(localStorage.getItem(key) || "[]");
  if (secrets[index]) {
    secrets[index].revealed = true;
    localStorage.setItem(key, JSON.stringify(secrets));
  }
}

// --- App ---

function App() {
  const account = useCurrentAccount();
  const [auctionId, setAuctionId] = useState(
    localStorage.getItem("current_auction_id") || ""
  );
  const [view, setView] = useState(auctionId ? "auction" : "home");

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-zinc-200">
      <Header />
      <main className="max-w-4xl mx-auto px-6 py-8">
        {!account ? (
          <WalletPrompt />
        ) : view === "home" ? (
          <HomeView
            onCreated={(id) => {
              setAuctionId(id);
              localStorage.setItem("current_auction_id", id);
              setView("auction");
            }}
            onJoin={(id) => {
              setAuctionId(id);
              localStorage.setItem("current_auction_id", id);
              setView("auction");
            }}
          />
        ) : (
          <AuctionView
            auctionId={auctionId}
            onBack={() => {
              setView("home");
              setAuctionId("");
              localStorage.removeItem("current_auction_id");
            }}
          />
        )}
        <Footer />
      </main>
    </div>
  );
}

// --- Header ---

function Header() {
  return (
    <header className="border-b border-zinc-800 px-6 py-4">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-xs font-bold text-white">
            V
          </div>
          <span className="text-lg font-semibold tracking-tight">Veil Protocol</span>
        </div>
        <ConnectButton />
      </div>
    </header>
  );
}

// --- Wallet Prompt ---

function WalletPrompt() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <h1 className="text-3xl font-bold mb-4 bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
        密封竞价拍卖
      </h1>
      <p className="text-zinc-400 mb-8 text-center max-w-md">
        链上零知识密封拍卖协议。请先连接 Sui 钱包开始使用。
      </p>
      <ConnectButton />
    </div>
  );
}

// --- Home View ---

function HomeView({ onCreated, onJoin }) {
  const { create, loading: creating } = useCreateAuction();
  const [itemName, setItemName] = useState("");
  const [commitMinutes, setCommitMinutes] = useState("5");
  const [revealMinutes, setRevealMinutes] = useState("5");
  const [joinId, setJoinId] = useState("");

  const handleCreate = async () => {
    if (!itemName) return;
    const cm = parseInt(commitMinutes, 10);
    const rm = parseInt(revealMinutes, 10);
    if (!cm || cm <= 0 || !rm || rm <= 0) return;
    const now = Date.now();
    const commitDeadline = now + cm * 60 * 1000;
    const revealDeadline = commitDeadline + rm * 60 * 1000;

    const result = await create({
      itemName,
      commitDeadline,
      revealDeadline,
      minDeposit: DEFAULT_MIN_DEPOSIT_MIST,
    });

    if (result.auctionId) {
      onCreated(result.auctionId);
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
          密封竞价拍卖
        </h1>
        <p className="text-zinc-400">基于 SuiCryptoLib 的链上隐私拍卖协议</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="text-lg font-semibold mb-4">创建拍卖</h2>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="拍品名称"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-500 outline-none focus:border-violet-500 transition-colors"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">承诺阶段 (分钟)</label>
                <input
                  type="number"
                  value={commitMinutes}
                  onChange={(e) => setCommitMinutes(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 outline-none focus:border-violet-500 transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 mb-1 block">揭示阶段 (分钟)</label>
                <input
                  type="number"
                  value={revealMinutes}
                  onChange={(e) => setRevealMinutes(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 outline-none focus:border-violet-500 transition-colors"
                />
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              押金: {DEPOSIT_SUI} SUI (未揭示者没收)
            </p>
            <button
              onClick={handleCreate}
              disabled={!itemName || creating}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-medium hover:from-violet-500 hover:to-cyan-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              {creating ? "创建中..." : "创建拍卖 (签名交易)"}
            </button>
          </div>
        </div>

        {/* Join */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="text-lg font-semibold mb-4">加入拍卖</h2>
          <p className="text-sm text-zinc-400 mb-4">
            输入拍卖对象 ID 加入已有的拍卖。
          </p>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="拍卖 Object ID (0x...)"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-500 outline-none focus:border-violet-500 transition-colors font-mono text-sm"
            />
            <button
              onClick={() => joinId && onJoin(joinId)}
              disabled={!joinId}
              className="w-full py-2.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              加入拍卖
            </button>
          </div>
        </div>
      </div>

      {/* How it works */}
      <HowItWorks />
    </div>
  );
}

// --- Auction View ---

function AuctionView({ auctionId, onBack }) {
  const { auction, loading: fetching, refresh } = useAuctionState(auctionId);
  const account = useCurrentAccount();

  if (!auction && fetching) {
    return <p className="text-zinc-500 text-center py-12">加载拍卖数据...</p>;
  }

  if (!auction) {
    return (
      <div className="text-center py-12">
        <p className="text-zinc-500 mb-4">无法加载拍卖对象</p>
        <button onClick={onBack} className="text-cyan-400 underline">返回</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title + Back */}
      <div className="flex items-center justify-between">
        <div>
          <button onClick={onBack} className="text-xs text-zinc-500 hover:text-zinc-300 mb-1 block">
            &larr; 返回
          </button>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
            {auction.itemName || "拍卖"}
          </h1>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-zinc-600 mb-1">拍卖 Object ID (点击复制)</p>
          <button
            onClick={() => { navigator.clipboard.writeText(auctionId); }}
            className="text-xs text-zinc-400 font-mono break-all max-w-[280px] text-left px-2 py-1 rounded bg-zinc-800 border border-zinc-700 hover:border-cyan-600 transition-colors cursor-pointer"
            title="点击复制 Object ID"
          >
            {auctionId}
          </button>
        </div>
      </div>

      {/* Phase Bar */}
      <PhaseBar phase={auction.phase} />

      {/* Deadlines + Countdown */}
      <DeadlineInfo auction={auction} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Actions */}
        <div className="space-y-6">
          {auction.phase === PHASE_COMMIT && (
            <BidPanel auctionId={auctionId} minDeposit={auction.minDeposit} onSuccess={refresh} />
          )}
          {auction.phase === PHASE_REVEAL && (
            <RevealPanel auctionId={auctionId} bids={auction.bids} onSuccess={refresh} />
          )}
          {auction.phase === PHASE_SETTLED && !auction.settled && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-semibold mb-2 text-zinc-300">揭示阶段已截止</h2>
              <p className="text-sm text-zinc-400 mb-4">
                所有出价揭示时间已结束。点击下方按钮结算拍卖，确定赢家。
              </p>
            </div>
          )}
          {auction.settled && (
            <SettledPanel auction={auction} />
          )}
          {!auction.settled && auction.phase === PHASE_SETTLED && (
            <SettleButton auctionId={auctionId} onSuccess={refresh} />
          )}
        </div>

        {/* Right: On-chain state */}
        <div className="space-y-6">
          <OnChainState auction={auction} />
          <HowItWorks />
        </div>
      </div>
    </div>
  );
}

// --- Bid Panel (Commit Phase) ---

function BidPanel({ auctionId, minDeposit, onSuccess }) {
  const { placeBid, loading } = usePlaceBid();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");

  const depositSui = minDeposit / 1_000_000_000;

  const handleBid = async () => {
    if (!amount) return;

    // Validate: must be a positive integer (Move's parse_u64_from_bytes only handles ASCII digits)
    if (!/^\d+$/.test(amount) || amount === "0") {
      setStatus("错误: 金额必须是正整数 (不支持小数)");
      return;
    }

    setStatus("生成承诺哈希...");

    // Step 1: Generate salt (32 bytes, CSPRNG)
    const salt = randomBytes(32);

    // Step 2: Compute SHA-256(amount_string || salt) CLIENT-SIDE
    // The amount and salt NEVER go on-chain during commit
    const valueBytes = new TextEncoder().encode(amount);
    const data = new Uint8Array([...valueBytes, ...salt]);
    const hashHex = await createHash(data);
    const hashBytes = hexToBytes(hashHex);

    setStatus("请在钱包中签名交易...");

    try {
      // Step 3: Send ONLY the hash + deposit on-chain
      await placeBid({
        auctionId,
        commitmentHash: hashBytes,
        depositMist: minDeposit,
      });

      // Step 4: Save secrets locally for reveal phase
      saveBidSecret(auctionId, amount, bytesToHex(salt));

      setStatus(`出价已提交! 金额 ${amount} 已密封。\n承诺哈希: ${hashHex.substring(0, 20)}...`);
      setAmount("");
      onSuccess();
    } catch (err) {
      setStatus(`错误: ${err.message}`);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <h2 className="text-lg font-semibold mb-2">提交密封出价</h2>
      <p className="text-sm text-zinc-400 mb-4">
        金额将在浏览器中哈希为 SHA-256(金额 || 随机盐值)。<br />
        <strong className="text-zinc-300">只有哈希上链</strong>，金额和盐值保存在本地浏览器中。
      </p>
      <div className="space-y-3">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="出价金额 (正整数)"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          className="w-full px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-500 outline-none focus:border-violet-500 transition-colors"
        />
        <p className="text-xs text-zinc-500">押金: {depositSui} SUI (揭示后退还)</p>
        <button
          onClick={handleBid}
          disabled={!amount || loading}
          className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-medium hover:from-violet-500 hover:to-cyan-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          {loading ? "等待签名..." : "提交密封出价 (签名交易)"}
        </button>
        {status && (
          <p className={`text-xs ${status.startsWith("错误") ? "text-red-400" : "text-cyan-400"}`}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
}

// --- Reveal Panel ---

function RevealPanel({ auctionId, bids, onSuccess }) {
  const { revealBid, loading } = useRevealBid();
  const account = useCurrentAccount();
  const [status, setStatus] = useState("");

  const secrets = getBidSecrets(auctionId);
  const myBid = bids.find((b) => b.bidder === account?.address);
  const myUnrevealed = myBid && !myBid.revealed;

  // Find the matching secret
  const mySecret = secrets.find((s) => !s.revealed);

  const handleReveal = async () => {
    if (!mySecret) return;

    // Pre-flight: recompute hash locally to verify it matches commitment
    const valueBytes = new TextEncoder().encode(mySecret.amount);
    const saltBytes = hexToBytes(mySecret.saltHex);
    const data = new Uint8Array([...valueBytes, ...saltBytes]);
    const recomputedHash = await createHash(data);

    // Debug: show what we're about to send
    const debugInfo = [
      `amount: "${mySecret.amount}"`,
      `value bytes: [${Array.from(valueBytes).join(',')}]`,
      `salt hex: ${mySecret.saltHex.substring(0, 16)}...`,
      `salt length: ${saltBytes.length}`,
      `recomputed hash: ${recomputedHash.substring(0, 16)}...`,
    ].join('\n');

    // Check if commitment on-chain matches
    if (myBid?.commitmentHash) {
      const onChainHex = Array.isArray(myBid.commitmentHash)
        ? myBid.commitmentHash.map(b => b.toString(16).padStart(2, '0')).join('')
        : String(myBid.commitmentHash);
      if (onChainHex !== recomputedHash) {
        setStatus(`错误: 本地重算的哈希与链上承诺不匹配!\n链上: ${onChainHex.substring(0, 20)}...\n本地: ${recomputedHash.substring(0, 20)}...\n\n调试信息:\n${debugInfo}`);
        return;
      }
    }

    setStatus("哈希验证通过，请在钱包中签名揭示交易...");

    try {
      await revealBid({
        auctionId,
        valueBytes,
        saltBytes,
      });

      // Mark as revealed locally
      const idx = secrets.indexOf(mySecret);
      markRevealed(auctionId, idx);

      setStatus(`已揭示! 出价金额: ${mySecret.amount} SUI`);
      onSuccess();
    } catch (err) {
      setStatus(`错误: ${err.message}`);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <h2 className="text-lg font-semibold mb-2">揭示您的出价</h2>
      <p className="text-sm text-zinc-400 mb-4">
        提交金额 + 盐值到链上。合约会调用 <code className="text-cyan-400">hash_commitment::verify_opening()</code> 验证哈希是否匹配。
      </p>
      {myUnrevealed && mySecret ? (
        <div className="space-y-3">
          <div className="px-4 py-3 rounded-lg bg-zinc-800 text-sm">
            <p className="text-zinc-400">您的密封出价:</p>
            <p className="text-xl font-bold text-violet-400 mt-1">{mySecret.amount} SUI</p>
          </div>
          <button
            onClick={handleReveal}
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-medium hover:from-violet-500 hover:to-cyan-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {loading ? "等待签名..." : "揭示出价 (签名交易)"}
          </button>
        </div>
      ) : myBid?.revealed ? (
        <p className="text-sm text-emerald-400">您的出价已揭示: {myBid.revealedAmount} SUI</p>
      ) : (
        <p className="text-sm text-zinc-500">您没有待揭示的出价。</p>
      )}
      {status && (
        <pre className={`text-xs mt-2 whitespace-pre-wrap ${status.startsWith("错误") ? "text-red-400" : "text-cyan-400"}`}>
          {status}
        </pre>
      )}
    </div>
  );
}

// --- Settle Button ---

function SettleButton({ auctionId, onSuccess }) {
  const { settle, loading } = useSettleAuction();
  const [status, setStatus] = useState("");

  const handleSettle = async () => {
    setStatus("请在钱包中签名结算交易...");
    try {
      await settle({ auctionId });
      setStatus("拍卖已结算!");
      onSuccess();
    } catch (err) {
      setStatus(`错误: ${err.message}`);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handleSettle}
        disabled={loading}
        className="w-full py-2.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 transition-colors text-sm"
      >
        {loading ? "等待签名..." : "结算拍卖 (签名交易)"}
      </button>
      <p className="text-xs text-zinc-500 text-center">需在揭示截止后调用</p>
      {status && (
        <p className={`text-xs text-center ${status.startsWith("错误") ? "text-red-400" : "text-cyan-400"}`}>
          {status}
        </p>
      )}
    </div>
  );
}

// --- Settled Panel ---

function SettledPanel({ auction }) {
  const hasWinner = auction.winner && auction.winner !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  return (
    <div className={`rounded-xl border p-6 ${
      hasWinner ? "border-emerald-800/50 bg-emerald-900/20" : "border-zinc-800 bg-zinc-900/50"
    }`}>
      <h2 className={`text-lg font-semibold mb-3 ${hasWinner ? "text-emerald-400" : "text-zinc-400"}`}>
        拍卖已结算
      </h2>
      {hasWinner ? (
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-xl font-bold text-white">
            W
          </div>
          <div>
            <p className="text-xs text-zinc-400 font-mono break-all">{auction.winner}</p>
            <p className="text-emerald-400 text-2xl font-bold">
              {auction.winningAmount} SUI
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">没有有效出价，拍卖流拍。</p>
      )}
    </div>
  );
}

// --- On-Chain State ---

function OnChainState({ auction }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <h2 className="text-lg font-semibold mb-4">链上状态</h2>
      <p className="text-xs text-zinc-500 mb-3">所有人都能在区块链上看到的内容:</p>

      {auction.bidCount === 0 ? (
        <p className="text-sm text-zinc-500 italic">暂无出价</p>
      ) : (
        <div className="space-y-2">
          {auction.bids.map((bid, i) => (
            <div key={i} className="px-4 py-3 rounded-lg bg-zinc-800/70 border border-zinc-700/50">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-mono text-zinc-400">
                  {bid.bidder.substring(0, 8)}...{bid.bidder.substring(bid.bidder.length - 6)}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    bid.revealed
                      ? "bg-emerald-900/50 text-emerald-400"
                      : "bg-amber-900/50 text-amber-400"
                  }`}
                >
                  {bid.revealed ? "已揭示" : "已密封"}
                </span>
              </div>
              <div className="font-mono text-xs text-zinc-500 break-all">
                {bid.revealed ? (
                  <span className="text-emerald-400">{bid.revealedAmount}</span>
                ) : (
                  <>
                    <span className="text-zinc-600">commitment: </span>
                    {Array.isArray(bid.commitmentHash)
                      ? bid.commitmentHash.slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("") + "..."
                      : "..."}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Deadline Info ---

function DeadlineInfo({ auction }) {
  const [now, setNow] = useState(Date.now());

  // Update every second for countdown
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatRemaining = (deadline) => {
    const diff = deadline - now;
    if (diff <= 0) return "已截止";
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const commitTime = new Date(auction.commitDeadline).toLocaleTimeString("zh-CN");
  const revealTime = new Date(auction.revealDeadline).toLocaleTimeString("zh-CN");

  return (
    <div className="flex flex-wrap gap-4 text-xs text-zinc-500">
      <span className={auction.phase === 0 ? "text-cyan-400" : ""}>
        承诺截止: {commitTime} ({formatRemaining(auction.commitDeadline)})
      </span>
      <span className={auction.phase === 1 ? "text-cyan-400" : ""}>
        揭示截止: {revealTime} ({formatRemaining(auction.revealDeadline)})
      </span>
      <span>出价数: {auction.bidCount}</span>
    </div>
  );
}

// --- Phase Bar ---

function PhaseBar({ phase }) {
  return (
    <div className="flex gap-1">
      {PHASE_LABELS.map((label, i) => (
        <div key={label} className="flex-1">
          <div
            className={`h-1.5 rounded-full transition-all ${
              i < phase
                ? "bg-cyan-500"
                : i === phase
                  ? "bg-gradient-to-r from-violet-500 to-cyan-500 animate-pulse"
                  : "bg-zinc-800"
            }`}
          />
          <p className={`text-xs mt-1.5 ${i === phase ? "text-cyan-400 font-medium" : "text-zinc-600"}`}>
            {label}
          </p>
        </div>
      ))}
    </div>
  );
}

// --- How It Works ---

function HowItWorks() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <h2 className="text-sm font-semibold mb-3 text-zinc-400">运作原理</h2>
      <div className="space-y-3 text-xs text-zinc-500">
        <div className="flex gap-2">
          <div className="w-5 h-5 rounded-full bg-violet-900/50 text-violet-400 flex items-center justify-center shrink-0 text-[10px] font-bold">1</div>
          <div>
            <span className="text-zinc-300">承诺 (浏览器):</span> SHA-256(金额 || 随机盐值) -- 只有哈希上链，金额保密。
            <br />
            <span className="text-cyan-400/60">Move: hash_commitment::from_hash()</span>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="w-5 h-5 rounded-full bg-violet-900/50 text-violet-400 flex items-center justify-center shrink-0 text-[10px] font-bold">2</div>
          <div>
            <span className="text-zinc-300">揭示 (链上验证):</span> 提交金额 + 盐值，合约重算哈希并验证匹配。
            <br />
            <span className="text-cyan-400/60">Move: hash_commitment::verify_opening()</span>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="w-5 h-5 rounded-full bg-violet-900/50 text-violet-400 flex items-center justify-center shrink-0 text-[10px] font-bold">3</div>
          <div>
            <span className="text-zinc-300">结算 (链上执行):</span> 最高揭示出价者获胜，押金退还失败者。
            <br />
            <span className="text-cyan-400/60">Move: auction::settle()</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Footer ---

function Footer() {
  return (
    <footer className="mt-12 pt-6 border-t border-zinc-800 text-center">
      <p className="text-xs text-zinc-600">
        基于 SuiCryptoLib 构建 -- Sui 区块链密码学原语库
      </p>
      <p className="text-xs text-zinc-700 mt-1">
        模块: hash_commitment + commit_reveal + pedersen + range_proof
      </p>
    </footer>
  );
}

export default App;
