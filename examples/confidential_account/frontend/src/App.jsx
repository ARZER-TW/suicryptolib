import { useState, useEffect } from "react";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import { generateRangeProof, generateBlinding } from "./lib/prover";
import { addressToSenderHash } from "./lib/sender-hash";
import { saveAccountSecret, updateAccountSecret, getAccountSecret } from "./lib/local-store";
import { useDeposit, useWithdraw, useAccountState, useMyAccounts } from "./hooks/use-account";
import "./index.css";

const MIST_PER_SUI = 1_000_000_000;

function App() {
  const account = useCurrentAccount();
  const [selectedAccountId, setSelectedAccountId] = useState(
    localStorage.getItem("zk_selected_account") || ""
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <header className="border-b border-zinc-800/60 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-emerald-600 flex items-center justify-center text-[11px] font-bold text-white tracking-tight">ZK</div>
            <span className="text-[15px] font-medium tracking-tight text-zinc-300">Confidential Account</span>
          </div>
          <ConnectButton />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {!account ? (
          <div className="py-20 text-center">
            <h1 className="text-2xl font-semibold mb-3 text-zinc-100">Private Balance on Sui</h1>
            <p className="text-zinc-500 mb-8 max-w-md mx-auto text-[15px] leading-relaxed">
              Deposit SUI into a confidential account. Your balance is hidden inside a Pedersen Commitment
              and verified by a Groth16 zero-knowledge proof. No one can see your actual balance.
            </p>
            <ConnectButton />
          </div>
        ) : !selectedAccountId ? (
          <DashboardView
            onSelect={(id) => {
              setSelectedAccountId(id);
              localStorage.setItem("zk_selected_account", id);
            }}
          />
        ) : (
          <AccountView
            accountId={selectedAccountId}
            onBack={() => {
              setSelectedAccountId("");
              localStorage.removeItem("zk_selected_account");
            }}
          />
        )}
      </main>

      <footer className="border-t border-zinc-800/40 py-6 text-center">
        <p className="text-[11px] text-zinc-700">
          SuiCryptoLib -- pedersen + range_proof modules -- Groth16 on BN254
        </p>
      </footer>
    </div>
  );
}

// --- Dashboard ---

function DashboardView({ onSelect }) {
  const { accounts, loading, refresh } = useMyAccounts();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100 mb-1">Your Accounts</h1>
        <p className="text-sm text-zinc-500">Confidential accounts with zero-knowledge balance proofs</p>
      </div>

      <DepositForm
        onSuccess={(id) => {
          refresh();
          onSelect(id);
        }}
      />

      {accounts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-400">Existing accounts</h2>
          {accounts.map((acc) => {
            const secret = getAccountSecret(acc.id);
            return (
              <button
                key={acc.id}
                onClick={() => onSelect(acc.id)}
                className="w-full text-left px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors"
              >
                <div className="flex justify-between items-center">
                  <span className="text-xs font-mono text-zinc-500">{acc.id?.substring(0, 16)}...</span>
                  <span className="text-sm text-zinc-300">
                    {secret ? `${(parseInt(secret.value, 10) / MIST_PER_SUI).toFixed(2)} SUI (private)` : `${(acc.vaultBalance / MIST_PER_SUI).toFixed(2)} SUI locked`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Deposit Form ---

function DepositForm({ onSuccess }) {
  const { deposit, loading: txLoading } = useDeposit();
  const account = useCurrentAccount();
  const [amount, setAmount] = useState("");
  const [proofStage, setProofStage] = useState("");
  const [error, setError] = useState("");

  const stages = {
    loading: "Loading circuit...",
    proving: "Generating ZK proof...",
    converting: "Converting to Sui format...",
    done: "Proof ready",
    signing: "Sign in wallet...",
  };

  const handleDeposit = async () => {
    if (!amount || !account?.address) return;
    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum <= 0) return;
    setError("");

    try {
      const senderHash = await addressToSenderHash(account.address);
      const blinding = generateBlinding();
      const depositMist = amountNum * MIST_PER_SUI;

      // Commitment value must use MIST (same unit as vault balance)
      const result = await generateRangeProof(
        depositMist.toString(),
        blinding,
        senderHash,
        setProofStage
      );

      setProofStage("signing");

      const txResult = await deposit({
        commitmentX: result.commitmentX,
        commitmentY: result.commitmentY,
        senderHashBytes: result.senderHashBytes,
        proofBytes: result.proofBytes,
        depositMist,
      });

      if (txResult.accountId) {
        saveAccountSecret(txResult.accountId, {
          value: depositMist.toString(),
          blinding,
          senderHash,
        });
        setProofStage("");
        setAmount("");
        onSuccess(txResult.accountId);
      }
    } catch (err) {
      setError(err.message);
      setProofStage("");
    }
  };

  const isWorking = proofStage || txLoading;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-medium text-zinc-300 mb-3">New confidential deposit</h2>
      <div className="flex gap-3">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="Amount (SUI)"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          disabled={isWorking}
          className="flex-1 px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-emerald-600 disabled:opacity-40 transition-colors"
        />
        <button
          onClick={handleDeposit}
          disabled={!amount || isWorking}
          className="px-5 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {isWorking ? "Working..." : "Deposit"}
        </button>
      </div>

      {proofStage && (
        <div className="mt-3 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-emerald-400">{stages[proofStage] || proofStage}</span>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </div>
  );
}

// --- Account View ---

function AccountView({ accountId, onBack }) {
  const { account, loading, refresh } = useAccountState(accountId);
  const secret = getAccountSecret(accountId);

  if (!account && loading) {
    return <p className="text-zinc-500 text-center py-16 text-sm">Loading account...</p>;
  }

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
        &larr; Back to dashboard
      </button>

      {/* Balance Card */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="text-xs text-zinc-600 mb-1 uppercase tracking-wider">Private Balance</p>
            <p className="text-3xl font-semibold text-zinc-100 tabular-nums">
              {secret ? (parseInt(secret.value, 10) / MIST_PER_SUI).toFixed(2) : "***"}
              <span className="text-lg text-zinc-500 ml-1">SUI</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-zinc-700 uppercase tracking-wider mb-1">Vault (on-chain)</p>
            <p className="text-sm text-zinc-400 tabular-nums">
              {account ? (account.vaultBalance / MIST_PER_SUI).toFixed(2) : "..."} SUI
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="px-3 py-2 rounded bg-zinc-800/60">
            <p className="text-zinc-600 mb-0.5">Total deposited</p>
            <p className="text-zinc-400 tabular-nums">{account ? (account.totalDeposited / MIST_PER_SUI).toFixed(2) : "..."} SUI</p>
          </div>
          <div className="px-3 py-2 rounded bg-zinc-800/60">
            <p className="text-zinc-600 mb-0.5">Total withdrawn</p>
            <p className="text-zinc-400 tabular-nums">{account ? (account.totalWithdrawn / MIST_PER_SUI).toFixed(2) : "..."} SUI</p>
          </div>
        </div>
      </div>

      {/* On-chain Commitment */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
        <p className="text-xs text-zinc-600 uppercase tracking-wider mb-2">On-chain commitment (public)</p>
        <p className="text-[11px] font-mono text-zinc-600 break-all leading-relaxed">
          x: {account?.commitmentX ? formatBytes(account.commitmentX) : "..."}
        </p>
        <p className="text-[11px] font-mono text-zinc-600 break-all leading-relaxed mt-1">
          y: {account?.commitmentY ? formatBytes(account.commitmentY) : "..."}
        </p>
        <p className="text-[10px] text-zinc-700 mt-2">
          This is all that observers can see. The actual balance cannot be derived from these coordinates.
        </p>
      </div>

      {/* Withdraw */}
      {secret && account && (
        <WithdrawForm accountId={accountId} secret={secret} account={account} onSuccess={refresh} />
      )}

      {/* Object ID */}
      <p className="text-[10px] text-zinc-800 font-mono break-all">Account: {accountId}</p>
    </div>
  );
}

// --- Withdraw Form ---

function WithdrawForm({ accountId, secret, account, onSuccess }) {
  const { withdraw, loading: txLoading } = useWithdraw();
  const currentAccount = useCurrentAccount();
  const [amount, setAmount] = useState("");
  const [proofStage, setProofStage] = useState("");
  const [error, setError] = useState("");

  const stages = {
    loading: "Loading circuit...",
    proving: "Generating ZK proof for new balance...",
    converting: "Converting to Sui format...",
    done: "Proof ready",
    signing: "Sign in wallet...",
  };

  const maxWithdraw = account.totalDeposited - account.totalWithdrawn;

  const handleWithdraw = async () => {
    if (!amount || !currentAccount?.address) return;
    const withdrawNum = parseInt(amount, 10);
    if (isNaN(withdrawNum) || withdrawNum <= 0) return;

    const withdrawMist = withdrawNum * MIST_PER_SUI;
    if (withdrawMist > maxWithdraw) {
      setError("Exceeds available balance");
      return;
    }

    setError("");

    try {
      // secret.value is in MIST, withdrawMist is also MIST
      const currentMist = parseInt(secret.value, 10);
      const newValue = currentMist - withdrawMist;
      if (newValue < 0) {
        setError("Insufficient private balance");
        return;
      }

      const senderHash = await addressToSenderHash(currentAccount.address);
      const newBlinding = generateBlinding();

      const result = await generateRangeProof(
        newValue.toString(),
        newBlinding,
        senderHash,
        setProofStage
      );

      setProofStage("signing");

      await withdraw({
        accountId,
        newCommitmentX: result.commitmentX,
        newCommitmentY: result.commitmentY,
        senderHashBytes: result.senderHashBytes,
        proofBytes: result.proofBytes,
        withdrawMist,
      });

      updateAccountSecret(accountId, {
        value: newValue.toString(),
        blinding: newBlinding,
      });

      setProofStage("");
      setAmount("");
      onSuccess();
    } catch (err) {
      setError(err.message);
      setProofStage("");
    }
  };

  const isWorking = proofStage || txLoading;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-medium text-zinc-300 mb-3">Withdraw</h2>
      <div className="flex gap-3">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={`Max: ${(maxWithdraw / MIST_PER_SUI).toFixed(0)} SUI`}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          disabled={isWorking}
          className="flex-1 px-3 py-2 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-emerald-600 disabled:opacity-40 transition-colors"
        />
        <button
          onClick={handleWithdraw}
          disabled={!amount || isWorking}
          className="px-5 py-2 rounded-md bg-zinc-700 text-zinc-200 text-sm font-medium hover:bg-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {isWorking ? "Working..." : "Withdraw"}
        </button>
      </div>

      {proofStage && (
        <div className="mt-3 flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-emerald-400">{stages[proofStage] || proofStage}</span>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </div>
  );
}

// --- Helpers ---

function formatBytes(arr) {
  if (!arr) return "";
  if (Array.isArray(arr)) {
    return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return String(arr);
}

export default App;
