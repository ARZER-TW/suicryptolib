import { useState } from "react";
import { ConnectButton, useCurrentAccount } from "@mysten/dapp-kit";
import { generateRangeProof, generateBlinding } from "./lib/prover";
import { addressToSenderHash } from "./lib/sender-hash";
import { saveAccountSecret, updateAccountSecret, getAccountSecret } from "./lib/local-store";
import { useDeposit, useWithdraw, useAccountState, useMyAccounts } from "./hooks/use-account";
import { OperationDetail } from "./components/OperationDetail";
import { PrivacyToggle } from "./components/PrivacyToggle";
import { SuiscanLink, AnnotatedChainData } from "./components/ChainDataView";
import { ModuleTag } from "./components/ModuleTag";
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
            <span className="text-[15px] font-medium tracking-tight text-zinc-300">保密账户</span>
          </div>
          <ConnectButton />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        {!account ? (
          <div className="py-20 text-center">
            <h1 className="text-2xl font-semibold mb-3 text-zinc-100">Sui 链上隐私余额</h1>
            <p className="text-zinc-500 mb-8 max-w-md mx-auto text-[15px] leading-relaxed">
              将 SUI 存入保密账户，余额隐藏在 Pedersen 承诺中，
              由 Groth16 零知识证明验证。没有人能看到你的实际余额。
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
          SuiCryptoLib -- pedersen + range_proof -- Groth16 on BN254
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
        <h1 className="text-xl font-semibold text-zinc-100 mb-1">我的账户</h1>
        <p className="text-sm text-zinc-500">基于零知识证明的保密余额账户</p>
      </div>

      <DepositForm
        onSuccess={(id) => {
          refresh();
          onSelect(id);
        }}
      />

      {accounts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-zinc-400">已有账户</h2>
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
                    {secret ? `${(parseInt(secret.value, 10) / MIST_PER_SUI).toFixed(2)} SUI (保密)` : `${(acc.vaultBalance / MIST_PER_SUI).toFixed(2)} SUI 已锁定`}
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
  const [depositDetail, setDepositDetail] = useState(null);

  const handleDeposit = async () => {
    if (!amount || !account?.address) return;
    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum <= 0) return;
    setError("");
    setDepositDetail(null);

    try {
      const blinding = generateBlinding();

      const t0Hash = performance.now();
      const senderHash = await addressToSenderHash(account.address);
      const senderHashTime = ((performance.now() - t0Hash) / 1000).toFixed(1);

      const depositMist = amountNum * MIST_PER_SUI;

      setProofStage("proving");
      const t0Proof = performance.now();
      const result = await generateRangeProof(
        depositMist.toString(),
        blinding,
        senderHash,
        setProofStage
      );
      const proofTime = ((performance.now() - t0Proof) / 1000).toFixed(1);

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
        setDepositDetail({ senderHashTime, proofTime, amount: amountNum });
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
      <h2 className="text-sm font-medium text-zinc-300 mb-3">新建保密存款</h2>
      <div className="flex gap-3">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="金额 (SUI)"
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
          {isWorking ? "处理中..." : "存款"}
        </button>
      </div>

      {depositDetail && (
        <>
          <OperationDetail
            browserSteps={[
              { label: "生成随机 blinding factor", detail: "248-bit" },
              { label: "Poseidon(address) 计算 sender_hash", detail: `${depositDetail.senderHashTime}s` },
              { label: "加载 ZK 电路 + 证明密钥", detail: "4.8 MB" },
              { label: "生成 Groth16 证明 (7,949 约束)", detail: `${depositDetail.proofTime}s` },
              { label: "输出: proof + commitment", detail: "128B + 64B" },
            ]}
            privacyNote="余额和 blinding 永远不跨越此线"
            chainSteps={[
              { label: `收到: proof + commitment + ${depositDetail.amount} SUI`, detail: "" },
              { label: "执行: range_proof::verify_range_64()", detail: "BN254 配对验证" },
              { label: "存储: 承诺坐标 (无法反算余额) + SUI 锁入金库", detail: "" },
            ]}
          />
          <ModuleTag module="pedersen + range_proof" detail="7,949 约束 | Groth16 on BN254" />
        </>
      )}

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
    </div>
  );
}

// --- Account View ---

function AccountView({ accountId, onBack }) {
  const { account, loading, refresh } = useAccountState(accountId);
  const [secret, setSecret] = useState(() => getAccountSecret(accountId));

  const refreshAll = () => {
    refresh();
    setSecret(getAccountSecret(accountId));
  };

  if (!account && loading) {
    return <p className="text-zinc-500 text-center py-16 text-sm">加载账户数据...</p>;
  }

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
        &larr; 返回仪表盘
      </button>

      {/* Balance Card with Privacy Toggle */}
      <PrivacyToggle>
        {(isObserver) => (
          <>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <p className="text-xs text-zinc-600 mb-1 uppercase tracking-wider">保密余额</p>
                  <p className="text-3xl font-semibold text-zinc-100 tabular-nums">
                    {isObserver
                      ? "***"
                      : secret
                        ? (parseInt(secret.value, 10) / MIST_PER_SUI).toFixed(2)
                        : "***"}
                    <span className="text-lg text-zinc-500 ml-1">SUI</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-zinc-700 uppercase tracking-wider mb-1">链上金库</p>
                  <p className="text-sm text-zinc-400 tabular-nums">
                    {account ? (account.vaultBalance / MIST_PER_SUI).toFixed(2) : "..."} SUI
                  </p>
                </div>
              </div>

              {!isObserver && (
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="px-3 py-2 rounded bg-zinc-800/60">
                    <p className="text-zinc-600 mb-0.5">累计存入</p>
                    <p className="text-zinc-400 tabular-nums">{account ? (account.totalDeposited / MIST_PER_SUI).toFixed(2) : "..."} SUI</p>
                  </div>
                  <div className="px-3 py-2 rounded bg-zinc-800/60">
                    <p className="text-zinc-600 mb-0.5">累计提取</p>
                    <p className="text-zinc-400 tabular-nums">{account ? (account.totalWithdrawn / MIST_PER_SUI).toFixed(2) : "..."} SUI</p>
                  </div>
                </div>
              )}

              {isObserver && (
                <>
                  <p className="text-[10px] text-amber-500/70 mt-1">
                    观察者无法看到余额明文，只能看到链上承诺坐标
                  </p>
                  <AnnotatedChainData
                    label="链上原始账户数据"
                    fields={[
                      { key: "commitment_x", value: formatBytes(account?.commitmentX), note: "Pedersen 承诺 x 坐标 -- 无法从坐标反算余额 (离散对数问题)" },
                      { key: "commitment_y", value: formatBytes(account?.commitmentY), note: "Pedersen 承诺 y 坐标 -- 与 x 配对构成椭圆曲线上的点" },
                      { key: "vault_balance", value: `${(account?.vaultBalance / 1e9).toFixed(2)} SUI`, note: "观察者知道金库锁了多少 SUI，但不知道用户声称的保密余额" },
                    ]}
                  />
                  <div className="mt-2">
                    <SuiscanLink objectId={accountId} label="在 Suiscan 查看账户对象" />
                  </div>
                </>
              )}
              {!isObserver && (
                <p className="text-[10px] text-emerald-500/70 mt-3">
                  你持有本地密钥 (blinding factor)，可以解读真实余额
                </p>
              )}
            </div>

            {/* On-chain Commitment */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5 mt-6">
              <p className="text-xs text-zinc-600 uppercase tracking-wider mb-2">
                链上承诺 {isObserver ? "(这是你能看到的全部)" : "(公开可见)"}
              </p>
              <p className="text-[11px] font-mono text-zinc-600 break-all leading-relaxed">
                x: {account?.commitmentX ? formatBytes(account.commitmentX) : "..."}
              </p>
              <p className="text-[11px] font-mono text-zinc-600 break-all leading-relaxed mt-1">
                y: {account?.commitmentY ? formatBytes(account.commitmentY) : "..."}
              </p>
              <p className="text-[10px] text-zinc-700 mt-2">
                {isObserver
                  ? "你无法从这些坐标推算出实际余额。Pedersen 承诺具有完美隐藏性。"
                  : "这是观察者能看到的全部内容。无法从这些坐标推算出实际余额。"}
              </p>
            </div>
          </>
        )}
      </PrivacyToggle>

      {/* Withdraw */}
      {secret && account && (
        <WithdrawForm accountId={accountId} secret={secret} account={account} onSuccess={refreshAll} />
      )}

      {/* Object ID */}
      <p className="text-[10px] text-zinc-800 font-mono break-all">账户: {accountId}</p>
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
  const [withdrawDetail, setWithdrawDetail] = useState(null);

  const maxWithdraw = account.totalDeposited - account.totalWithdrawn;

  const handleWithdraw = async () => {
    if (!amount || !currentAccount?.address) return;
    const withdrawNum = parseInt(amount, 10);
    if (isNaN(withdrawNum) || withdrawNum <= 0) return;

    const withdrawMist = withdrawNum * MIST_PER_SUI;
    if (withdrawMist > maxWithdraw) {
      setError("超出可用余额");
      return;
    }

    setError("");
    setWithdrawDetail(null);

    try {
      const currentMist = parseInt(secret.value, 10);
      const newValue = currentMist - withdrawMist;
      if (newValue < 0) {
        setError("保密余额不足");
        return;
      }

      const newBlinding = generateBlinding();

      const t0Hash = performance.now();
      const senderHash = await addressToSenderHash(currentAccount.address);
      const senderHashTime = ((performance.now() - t0Hash) / 1000).toFixed(1);

      setProofStage("proving");
      const t0Proof = performance.now();
      const result = await generateRangeProof(
        newValue.toString(),
        newBlinding,
        senderHash,
        setProofStage
      );
      const proofTime = ((performance.now() - t0Proof) / 1000).toFixed(1);

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
      setWithdrawDetail({ senderHashTime, proofTime, amount: withdrawNum, newValue });
      onSuccess();
    } catch (err) {
      setError(err.message);
      setProofStage("");
    }
  };

  const isWorking = proofStage || txLoading;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-medium text-zinc-300 mb-3">提取</h2>
      <div className="flex gap-3">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={`最大: ${(maxWithdraw / MIST_PER_SUI).toFixed(0)} SUI`}
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
          {isWorking ? "处理中..." : "提取"}
        </button>
      </div>

      {withdrawDetail && (
        <>
          <OperationDetail
            browserSteps={[
              { label: "计算新余额 & 新 blinding factor", detail: `${(withdrawDetail.newValue / MIST_PER_SUI).toFixed(2)} SUI` },
              { label: "Poseidon(address) 计算 sender_hash", detail: `${withdrawDetail.senderHashTime}s` },
              { label: "加载 ZK 电路 + 证明密钥", detail: "4.8 MB" },
              { label: "生成 Groth16 证明 (7,949 约束)", detail: `${withdrawDetail.proofTime}s` },
              { label: "输出: proof + new_commitment", detail: "128B + 64B" },
            ]}
            privacyNote="余额和 blinding 永远不跨越此线"
            chainSteps={[
              { label: `收到: proof + new_commitment, 释放 ${withdrawDetail.amount} SUI`, detail: "" },
              { label: "执行: range_proof::verify_range_64()", detail: "BN254 配对验证" },
              { label: "更新: 承诺坐标 + 从金库释放 SUI 至用户", detail: "" },
            ]}
          />
          <ModuleTag module="range_proof" detail="余额合法性验证" />
        </>
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
