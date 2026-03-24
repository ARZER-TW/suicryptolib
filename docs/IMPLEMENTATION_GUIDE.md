# 加密价格预测市场 — 实作指南 v2

本文档是 PREDICTION_MARKET_SPEC v4.2 的自包含实作参考。设计目的是让一个没有项目上下文的 AI 或开发者能够独立完成实作。

---

## 零、项目上下文

### 项目是什么

SuiCryptoLib 是 Sui 链上的密码学原语库。已有 9 个 Move 模块、3 个 ZK 电路、3 个 Demo（密封拍卖、保密账户、匿名群组）。本次任务是新增第 4 个 Demo：加密价格预测市场。

### 代码库根目录

```
/home/james/projects/suicryptolib/
```

### 已部署的 Testnet 地址

| 资产 | 值 |
|------|---|
| suicryptolib Package (v2) | `0xd8ad089847187cbaa15da503e8892d5e3f0a2acd6cad1aff7be05bf0c127cf02` |
| UpgradeCap | `0x485a3ab5db303c62d19b35ea2e2c52f95ff4bb1c518bd9981ef4005f55e9aad8` |
| Sealed Auction Package | `0x0e500f771f6453e3943ae40167329880b9ae495ceba7d713220f41d6af5edeee` |
| Confidential Account Package | `0x001dc8ff0bd006ebd7fd50d00f1e1772c76c033c2af323cf0a43d76e5df80738` |
| 部署钱包地址 | `0xae79a6345c691f7b9c7a20f104c62d4e71c8928e03f421284b7d8d265a567edd` |
| 剩余 Gas | ~0.8 SUI（可能需要领水） |
| Sui Config Dir | `/tmp/sui_testnet` |

### 现有文件参考

| 需要什么 | 从哪里复制/参考 |
|---------|----------------|
| 格式转换 (snarkjs → Sui) | `examples/confidential_account/frontend/src/lib/format-sui.js` |
| sender_hash 计算 | `examples/confidential_account/frontend/src/lib/sender-hash.js` |
| 浏览器 ZK proof 生成 | `examples/confidential_account/frontend/src/lib/prover.js` |
| 操作详情组件 | `examples/confidential_account/frontend/src/components/OperationDetail.jsx` |
| 隐私切换组件 | `examples/confidential_account/frontend/src/components/PrivacyToggle.jsx` |
| 链上数据注释组件 | `examples/confidential_account/frontend/src/components/ChainDataView.jsx` |
| 模块标签组件 | `examples/confidential_account/frontend/src/components/ModuleTag.jsx` |
| PTB 构建模式 (hash_commitment) | `examples/sealed_auction/frontend/src/use-auction.js` (place_bid) |
| Vite + snarkjs + circomlibjs 配置 | `examples/confidential_account/frontend/vite.config.js` |
| Circom 电路模板 (Pedersen + sender) | `circuits/pedersen/pedersen_commitment.circom` |
| 测试向量生成脚本模板 | `circuits/range_proof/test_prove.mjs` |
| Generator G 和 H 的具体值 | `circuits/pedersen/pedersen_commitment.circom` 第 25-36 行 |
| Generator H 推导方法 | `scripts/compute_generator_h.mjs` |

### 当前测试状态

```
Move (library):  93 tests — ALL PASS
Move (auction):   4 tests — ALL PASS
Move (account):   5 tests — ALL PASS
SDK:             34 tests — ALL PASS
```

### 过往踩坑记录（极重要）

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| `clock::timestamp_ms` 在 testnet 编译失败 | `use sui::clock::Clock` 只导入类型，不导入模块函数 | 改为 `use sui::clock::{Self, Clock}` |
| circomlibjs 在浏览器中 Buffer 报错 | circomlibjs 依赖 Node.js 的 Buffer/events/util | 安装 `vite-plugin-node-polyfills`，在 vite.config 中配置 |
| snarkjs 在 Vite 中 import 问题 | snarkjs 是 CommonJS | 在 vite.config 中加 `optimizeDeps.include: ["snarkjs"]` |
| Demo 2 存款后页面跳转太快看不到详情 | `onSuccess` 在 `setDetail` 后立即触发导航 | 改为先显示详情 + 手动跳转按钮 |
| 链上 phase 不会自动更新 | Move 合约只在 `reveal_bid`/`settle` 时懒更新 phase | 前端用本地时间计算 effectivePhase |
| SHA-256 前端/链上不匹配 | 旧版用自写 JS SHA-256 有 padding bug | 改用 `crypto.subtle.digest("SHA-256")` |
| Balance\<SUI\> 的 JSON 格式 | 以为是 `{ fields: { value: "..." } }` 实际是直接字符串 | `parseInt(typeof f.vault === "string" ? f.vault : f.vault?.fields?.value)` |
| Sui Table 不可迭代 | Table 只能按 key 查询，不能遍历 | 用 Table + vector\<address\> 双结构 |
| suicryptolib 升级后 package ID 变化 | upgrade 产生新 package ID | 更新 Move.toml 的 published-at 和前端 config |

---

## Phase 1: ZK 电路 — threshold_range

### 1.1 创建文件

```bash
mkdir -p circuits/threshold_range
```

### 1.2 电路源码

文件：`circuits/threshold_range/threshold_range.circom`

完整源码见 SPEC 的 Section IV。关键点：
- 复用 `circuits/pedersen/pedersen_commitment.circom` 的 Generator G 和 H（同一份常量）
- 下限验证：`Num2Bits(64)(value - minValue)` — 如果 value < minValue，差值是负数（域元素极大），Num2Bits 会失败
- 上限验证：`Num2Bits(64)(maxValue - value)` — 同理
- **不加** `sender_sq <== senderHash * senderHash`（spec v4.2 决定移除）
- Public inputs 声明：`component main {public [minValue, maxValue, senderHash]} = ThresholdRange();`

### 1.3 编译 + Trusted Setup

```bash
cd circuits/threshold_range

# 编译（注意 -l 指向 node_modules）
circom threshold_range.circom --r1cs --wasm --sym --output . -l ../node_modules

# 检查约束数（预期 ~8,013）
# 输出会显示 "non-linear constraints: XXXX"

# Trusted setup
snarkjs groth16 setup threshold_range.r1cs ../pot15.ptau threshold_0000.zkey
snarkjs zkey contribute threshold_0000.zkey threshold_range_final.zkey \
  --name="SuiCryptoLib ThresholdRange v1" -e="threshold range setup entropy 2026"
snarkjs zkey export verificationkey threshold_range_final.zkey verification_key.json
```

### 1.4 测试向量脚本

文件：`circuits/threshold_range/test_prove.mjs`

**参考模板：** 复制 `circuits/range_proof/test_prove.mjs` 的结构，修改：
- 电路路径改为 `threshold_range_js/threshold_range.wasm` 和 `threshold_range_final.zkey`
- 输入改为 `{ value, blinding, minValue, maxValue, sender_hash }`
- 测试 5 组向量（正常值、下界、上界、低于下限、高于上限）
- 输出 Sui 格式的 VK hex + proof bytes + public inputs（用于 Move 测试）

### 1.5 验证标准

- [ ] circom 编译无错误
- [ ] 约束数 ≈ 8,013
- [ ] 正常值 proof 本地 verify PASS
- [ ] value == min PASS
- [ ] value == max PASS
- [ ] value == min-1 FAIL（无法生成 witness）
- [ ] value == max+1 FAIL（无法生成 witness）
- [ ] 输出了 VK hex 和测试向量的 proof bytes

### 1.6 关键验证：public inputs 顺序

运行 test_prove.mjs 后，检查 `publicSignals` 的顺序：
```javascript
console.log("Public signals:", publicSignals);
// 预期顺序: [commitmentX, commitmentY, minValue, maxValue, senderHash]
// 但可能不同！必须实测确认
```

**这个顺序决定了 Phase 2 中 Move 合约拼接 public inputs 的字节顺序。** 顺序错误 = 链上验证永远失败，且报错只有 "proof invalid"，没有任何提示。

---

## Phase 2: Move 合约

### 2.1 threshold_range.move

文件：`move/sources/threshold_range.move`

**参考模板：** 复制 `move/sources/range_proof.move` 的结构：
- 修改 VK bytes 为 Phase 1 产生的 VK hex
- 修改 public inputs 拼接逻辑（加入 minValue 和 maxValue）
- 函数签名：`verify_threshold_range(commitment, min_value, max_value, sender_hash, proof_bytes) -> bool`

**public inputs 拼接伪代码：**
```
拼接顺序 = Phase 1.6 实测确认的顺序

对于每个 public input:
- 如果是 commitment 坐标 (vector<u8>): 直接 append（已是 32B LE）
- 如果是 u64 (min/max): 转为 u256 再转为 32 bytes LE
  方法: append_u256_le(buf, (value as u256))
- 如果是 sender_hash (vector<u8>): 直接 append（已是 32B LE）
```

**注意：** `append_u256_le` 函数已在 `semaphore.move` 中实现，可直接复用。

### 2.2 prediction_market.move

文件：`examples/prediction_market/move/sources/market.move`

**Move.toml 依赖：**
```toml
[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }
suicryptolib = { local = "../../../move" }
```

**Pyth 依赖（需要实测确认 rev）：**
```toml
# 需要查询 Pyth Sui SDK 的最新 Move 依赖方式
# 参考: https://docs.pyth.network/price-feeds/use-real-data/sui
# 可能是 git 依赖或已发布的 package
```

**sender_hash 验证的 Move 实现：**

现有 SDK 实现（`examples/confidential_account/frontend/src/lib/sender-hash.js`）：
```javascript
const addr = BigInt(address);
const lo = addr & ((1n << 128n) - 1n);
const hi = addr >> 128n;
const hash = poseidon.F.toString(poseidon([hi, lo]));
```

Move 中等价实现需要：
1. `tx_context::sender(ctx)` 获取 address（32 bytes）
2. BCS 序列化为 bytes
3. 拆分为 hi 和 lo（**字节序必须与 JS 一致**）
4. 转为 u256
5. `sui::poseidon::poseidon_bn254(vector[hi, lo])`

**字节序确认方法：** 写一个 #[test] 打印 BCS 序列化的 address bytes，与 JS 的 BigInt(address) 的字节比对。Sui address 的 hex 表示是大端序，BCS 序列化也是大端序。JS 的 `BigInt("0xabcd...")` 是大端数值。所以 `addr >> 128n` 取的是高位 = bytes[0..16]，`addr & mask` 取的是低位 = bytes[16..32]。

**settle 中 abs_diff 实现：**
```move
fun abs_diff(a: u64, b: u64): u64 {
    if (a >= b) { a - b } else { b - a }
}
```

### 2.3 测试

**test_only settle 函数：**
```move
#[test_only]
public fun settle_for_testing(
    market: &mut Market,
    actual_price: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

逻辑与真实 settle 相同，但不读 Pyth，直接接受 actual_price 参数。

**需要从 Phase 1 获取的测试向量：**
- 一组有效的 proof bytes + commitment_x/y + min + max + sender_hash（用于 test_submit_prediction）
- 一组无效的 proof bytes（用于 test_submit_invalid_proof_fails）

### 2.4 部署

**升级 suicryptolib（添加 threshold_range 模块）：**
```bash
cd move
SUI_CONFIG_DIR=/tmp/sui_testnet sui client upgrade \
  --gas-budget 200000000 \
  --upgrade-capability 0x485a3ab5db303c62d19b35ea2e2c52f95ff4bb1c518bd9981ef4005f55e9aad8 \
  --skip-dependency-verification
```

升级后会得到新的 package ID。更新 `move/Move.toml` 的 `published-at`。

**部署 prediction_market：**
```bash
cd examples/prediction_market/move
SUI_CONFIG_DIR=/tmp/sui_testnet sui client publish \
  --gas-budget 200000000 \
  --skip-dependency-verification
```

**如果 gas 不够：** 去 https://faucet.sui.io/?address=0xae79a6345c691f7b9c7a20f104c62d4e71c8928e03f421284b7d8d265a567edd 领水。注意 faucet 有 rate limit，多次请求需要等待。

### 2.5 验证标准

- [ ] threshold_range.move 测试通过（有效 proof、无效 proof、边界值）
- [ ] prediction_market.move 全部 20 个测试通过
- [ ] 现有 93 个 library 测试无 regression
- [ ] 两个包都成功部署到 testnet

---

## Phase 3: Pyth 集成

### 3.1 首先实测验证（不写合约代码，先确认 API）

**安装：**
```bash
npm install @pythnetwork/pyth-sui-js @pythnetwork/hermes-client
```

**验证脚本：** `scripts/test_pyth.mjs`

需要确认的 6 件事（每件事写一小段代码验证）：

1. **Hermes API 数据格式**
```javascript
const hermes = new HermesClient("https://hermes.pyth.network");
const updates = await hermes.getLatestPriceUpdates(["0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43"]);
console.log("binary data format:", typeof updates.binary.data, updates.binary.data.length);
console.log("parsed price:", updates.parsed[0].price);
```

2. **SuiPythClient 构造**
```javascript
// 需要确认 testnet 的 PYTH_STATE_ID 和 WORMHOLE_STATE_ID
// 查询: https://docs.pyth.network/price-feeds/contract-addresses/sui
```

3. **updatePriceFeeds PTB 构建**
```javascript
const pythClient = new SuiPythClient(suiClient, PYTH_STATE_ID, WORMHOLE_STATE_ID);
const tx = new Transaction();
const priceInfoObjectIds = await pythClient.updatePriceFeeds(tx, updates.binary.data, [BTC_USD_FEED_ID]);
console.log("priceInfoObjectIds:", priceInfoObjectIds);
```

4. **Pyth Move API 路径**
在 Move 合约中测试 `pyth::get_price` 的导入和调用。

5. **I64 类型处理**
```move
let price_i64 = price::get_price(&price_struct);
// 如何从 I64 提取 u64 值？查 pyth::i64 模块
```

6. **BTC/USD 的 expo 值**
预期 expo = -8，但需确认。

### 3.2 合约集成

确认所有 API 后，修改 `prediction_market.move`：
- 添加真实 `settle` 函数（读 Pyth）
- 保留 `settle_for_testing`（用于 Move 测试）

### 3.3 验证标准

- [ ] 从 Hermes 获取 BTC/USD 价格成功
- [ ] SuiPythClient.updatePriceFeeds PTB 构建成功
- [ ] 链上读取 Pyth 价格成功
- [ ] I64 → u64 转换正确
- [ ] 价格截断（向下到整数美元）正确

---

## Phase 4: SDK 统一 + Walrus

### 4.1 去重

当前重复的文件和要合并到的位置：

| 源文件 | 合并到 |
|--------|--------|
| `examples/confidential_account/frontend/src/lib/format-sui.js` | `sdk/src/format-sui.js` |
| `examples/confidential_account/frontend/src/lib/sender-hash.js` | `sdk/src/sender-hash.js` |
| `examples/confidential_account/frontend/src/lib/prover.js` | `sdk/src/prover.js` |
| `examples/semaphore/frontend/src/lib/prover.js`（格式转换部分） | 合并到上面 |

**注意：** 去重后不要删除 Demo 中的原文件（它们仍在使用）。先创建 SDK 的新文件，验证 SDK 可用后，再决定是否将 Demo 改为引用 SDK。

### 4.2 新增 threshold-range.js

文件：`sdk/src/threshold-range.js`

参考 `examples/confidential_account/frontend/src/lib/prover.js` 的 `generateRangeProof` 函数结构。修改：
- 电路输入加 `minValue` 和 `maxValue`
- 路径改为 Walrus URL（参数传入）

### 4.3 Walrus 上传

```bash
# 安装 Walrus CLI (如果没有)
# 参考: https://docs.walrus.site/usage/setup.html

# 上传
walrus store circuits/threshold_range/threshold_range_js/threshold_range.wasm --epochs 100
walrus store circuits/threshold_range/threshold_range_final.zkey --epochs 100
```

记下返回的 blob IDs。

**Walrus aggregator URL 格式（已确认）：**
```
Testnet: https://aggregator.walrus-testnet.walrus.space/v1/<blobId>
```

### 4.4 验证标准

- [ ] `sdk/src/format-sui.js` 包含所有格式转换函数
- [ ] `sdk/src/threshold-range.js` 能从 Walrus URL 加载电路并生成 proof
- [ ] 生成的 proof 能通过 testnet 上的 threshold_range.move 验证
- [ ] 现有 SDK 测试（34 个）无 regression

---

## Phase 5: 前端

### 5.1 脚手架

```bash
mkdir -p examples/prediction_market/frontend
cd examples/prediction_market/frontend

npm create vite@latest . -- --template react
npm install
npm install @mysten/dapp-kit @mysten/sui @tanstack/react-query \
  tailwindcss @tailwindcss/vite snarkjs circomlibjs \
  vite-plugin-node-polyfills \
  @pythnetwork/pyth-sui-js @pythnetwork/hermes-client \
  --legacy-peer-deps
```

**vite.config.js（从 Demo 2 复制并修改）：**
```javascript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    nodePolyfills({
      include: ["buffer", "events", "util", "stream", "crypto"],
      globals: { Buffer: true },
    }),
  ],
  optimizeDeps: {
    include: ["snarkjs", "circomlibjs"],
  },
});
```

### 5.2 关键组件

**CreateMarket：** 表单输入 → PTB `market::create_market()` → 签名

**SubmitPrediction：** 核心流程（参考 SPEC Section VII SDK 函数）：
1. `normalizeValue(input)` — 去前导零
2. `generateSalt(32)` + `computeCommitment(value, salt, 0)` — hash commitment
3. `generateBlinding()` + `addressToSenderHash(address)` — ZK 准备
4. `generateThresholdRangeProof({...})` — 浏览器生成 ZK proof（3-5 秒）
5. PTB: `hash_commitment::from_hash(hash, 0)` → `market::submit_prediction(market, commitment, zk_x, zk_y, sender_hash, proof, coin, clock)`
6. 保存 `{ value, saltHex }` 到 localStorage

**PTB 模式参考：** `examples/sealed_auction/frontend/src/use-auction.js` 的 `usePlaceBid` 函数展示了如何在 PTB 中链式调用 `from_hash()` 和业务函数。

**RevealPrediction：** 从 localStorage 读 value + salt → PTB `market::reveal_prediction(value_bytes, salt_bytes)`

**SettleMarket：** 调用 `pythClient.updatePriceFeeds(tx, ...)` → `market::settle(market, price_info, clock)`

### 5.3 UI 复用

从 `examples/confidential_account/frontend/src/components/` 复制以下文件：
- `OperationDetail.jsx`
- `PrivacyToggle.jsx`
- `ChainDataView.jsx`（含 AnnotatedChainData + SuiscanLink）
- `ModuleTag.jsx`

### 5.4 验证标准

- [ ] build 通过（`npx vite build`）
- [ ] 创建市场 → 链上成功
- [ ] 提交预测 → ZK proof 浏览器生成 → 链上验证通过
- [ ] 揭示 → 链上 hash 验证通过
- [ ] Pyth 结算 → 链上读价格 → 赢家确定
- [ ] 操作详情面板正确显示隐私边界
- [ ] 观察者视角显示注释链上数据 + Suiscan 链接
- [ ] 所有文字简体中文

---

## Phase 6: 收尾

### 6.1 更新清单

| 文件 | 操作 |
|------|------|
| `README.md` | 加入预测市场 Demo 说明 |
| `docs/PROJECT_ANALYSIS.md` | 加入第四个 Demo + threshold_range + Pyth 整合 |
| `docs/NEXT_STEPS.md` | 标记 threshold_range 和 prediction_market 为已完成 |

### 6.2 代码审查重点

- [ ] threshold_range 电路边界（value == min, value == max 都通过）
- [ ] public inputs 拼接顺序 = Circom 输出顺序（Phase 1.6 确认的）
- [ ] sender_hash hi/lo 拆分：电路 input、Move Poseidon、SDK addressToSenderHash 三方一致
- [ ] Pyth I64 → u64 转换正确
- [ ] 价格截断为向下截断
- [ ] `prediction_market.move` 的 settle 用 Table + vector 双结构迭代
- [ ] emergency_refund 也用 predictor_addresses 迭代
- [ ] 现有 3 个 Demo 前端无 regression
- [ ] 现有 93 个 library Move 测试无 regression

### 6.3 部署后验证

- [ ] E2E 完整流程：创建 → 预测(2人) → 揭示 → Pyth 结算 → 赢家领奖
- [ ] Walrus 加载：从 Walrus URL 加载 zkey 后 proof 正常生成
- [ ] 边界测试：超时 settle → emergency_refund 退款
