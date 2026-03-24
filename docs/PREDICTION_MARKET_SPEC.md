# SuiCryptoLib — AI 预测市场 项目规格书

## 项目概述

基于 SuiCryptoLib 的 Groth16 管线，构建一个链上预测市场。用户提交的预测值隐藏在 Pedersen 承诺中，用 ZK 证明验证预测合法性，结算时可选择揭示制或 ZK 比较制。与 Sui Stack（Walrus 存储电路文件、Seal 加密预测详情）整合。

---

## 一、产品定义

### 核心流程

```
创建市场 → 提交预测（保密）→ 事件发生 → 结算 → 领奖
```

### 用户角色

| 角色 | 操作 |
|------|------|
| 市场创建者 | 创建市场（事件描述、预测范围、截止时间、结算方式） |
| 预测者 | 提交保密预测 + 押注 SUI |
| 结算者 | 事件结束后输入实际结果，触发结算 |

### 结算方式（两种，递进实现）

**V1: 揭示制（先做）**
- 事件结束后，所有预测者揭示自己的预测值
- 链上比较所有揭示值与实际结果的偏差
- 最接近的预测者获胜
- 不揭示者没收押注

**V2: ZK 比较制（后做，需 Comparison Proof 电路）**
- 事件结束后，链上直接用 ZK 证明比较两个承诺的偏差
- 预测值全程不揭示
- 赢家领奖，输家退还押注（无惩罚）

---

## 二、技术架构

### 系统分层

```
┌──────────────────────────────────────────────┐
│  前端 (React + Vite + Tailwind)               │
│  ├── 创建市场 / 提交预测 / 结算 UI            │
│  ├── snarkjs 浏览器 proof 生成                │
│  └── @suicryptolib/sdk (统一 SDK)            │
├──────────────────────────────────────────────┤
│  Sui Stack 整合                               │
│  ├── Walrus: 存储 .wasm / .zkey 电路文件     │
│  └── Seal: 加密预测详情（可选）               │
├──────────────────────────────────────────────┤
│  Move 合约 (链上)                             │
│  ├── prediction_market.move (市场逻辑)        │
│  └── suicryptolib (pedersen, range_proof,     │
│       threshold_range, comparison)            │
├──────────────────────────────────────────────┤
│  ZK 电路 (链下)                               │
│  ├── threshold_range.circom (新)             │
│  ├── comparison.circom (新, V2)              │
│  ├── range_proof_64.circom (现有)            │
│  └── pedersen_commitment.circom (现有)        │
└──────────────────────────────────────────────┘
```

---

## 三、新增 ZK 电路规格

### 3.1 Threshold Range Proof

**目的：** 证明 value >= threshold 且 value < 2^64，同时生成 Pedersen 承诺。

**电路输入/输出：**
```
Private inputs:
  - value: 预测值
  - blinding: 随机 blinding factor

Public inputs:
  - threshold: 预测范围下限
  - sender_hash: 地址绑定（防重放）

Public outputs:
  - commitment_x, commitment_y: Pedersen 承诺坐标
```

**电路逻辑：**
```
1. diff = value - threshold
2. Num2Bits(64) on diff  → 证明 diff >= 0 (即 value >= threshold)
3. Num2Bits(64) on value → 证明 value < 2^64
4. commitment = value * G + blinding * H (EscalarMulFix + BabyAdd)
5. sender_sq = sender_hash * sender_hash (地址绑定)
```

**约束估算：**
- Num2Bits(64) x 2 = 128
- Pedersen (EscalarMulFix x 2 + BabyAdd) ≈ 7,885
- 总计 ≈ 8,100 约束

**Move 模块接口：**
```move
module suicryptolib::threshold_range {
    public fun verify_threshold_range(
        commitment: &PedersenCommitment,
        threshold: u64,
        sender_hash: vector<u8>,
        proof_bytes: vector<u8>,
    ): bool;
}
```

### 3.2 Comparison Proof（V2 阶段）

**目的：** 给定实际结果 actual，证明 |prediction_A - actual| < |prediction_B - actual|，不揭示 A 或 B。

**电路输入/输出：**
```
Private inputs:
  - prediction_A, blinding_A
  - prediction_B, blinding_B

Public inputs:
  - commitment_A_x, commitment_A_y
  - commitment_B_x, commitment_B_y
  - actual_value: 实际结果

Public outputs:
  - winner: 0 表示 A 更接近, 1 表示 B 更接近
```

**电路逻辑（核心挑战 — 域元素绝对值）：**
```
1. 验证 commitment_A = prediction_A * G + blinding_A * H
2. 验证 commitment_B = prediction_B * G + blinding_B * H
3. diff_A = prediction_A - actual_value
4. diff_B = prediction_B - actual_value
5. 计算 |diff_A| 和 |diff_B|（需要符号判断）
6. 比较 |diff_A| < |diff_B|
7. 输出 winner
```

**符号判断方法：** 在 BN254 域中，如果 diff < p/2 则视为正数，否则视为负数。用 Num2Bits(254) 取最高位判断。绝对值 = 正数时取 diff，负数时取 p - diff。

**约束估算：** ≈ 16,000-20,000（两组 Pedersen + 绝对值 + 比较）

**注意：** 此电路设计复杂度较高，建议在 V1 完成后再实现。

---

## 四、Move 合约规格

### 4.1 数据结构

```move
module prediction_market::market {
    use sui::balance::{Self, Balance};
    use sui::sui::SUI;
    use sui::table::{Self, Table};
    use suicryptolib::pedersen::{Self, PedersenCommitment};

    /// 一个预测市场实例
    public struct Market has key {
        id: UID,
        creator: address,
        description: vector<u8>,          // 事件描述
        min_prediction: u64,              // 预测范围下限
        max_prediction: u64,              // 预测范围上限
        prediction_deadline: u64,         // 提交截止时间 (ms)
        settle_deadline: u64,             // 结算截止时间 (ms)
        min_stake: u64,                   // 最低押注 (MIST)
        predictions: vector<Prediction>,  // 所有预测
        actual_value: u64,                // 实际结果（结算时填入）
        settled: bool,
        winner: address,
        prize_pool: Balance<SUI>,
    }

    /// 单个预测条目
    public struct Prediction has store, drop {
        predictor: address,
        commitment: PedersenCommitment,   // 隐藏预测值
        stake_amount: u64,
        revealed_value: u64,              // V1: 揭示后填入
        revealed: bool,                   // V1: 是否已揭示
    }
}
```

### 4.2 函数接口

```
create_market(
    description, min_prediction, max_prediction,
    prediction_deadline, settle_deadline, min_stake,
    ctx
) → 创建共享 Market 对象

submit_prediction(
    market, commitment_x, commitment_y,
    sender_hash, range_proof_bytes,
    stake: Coin<SUI>, clock, ctx
) → 验证 range proof + 存储承诺 + 锁入押注

--- V1 揭示制 ---

reveal_prediction(
    market, value_bytes, salt_bytes, clock, ctx
) → 验证 hash commitment 匹配 + 记录揭示值

settle_v1(
    market, actual_value, clock, ctx
) → 比较所有揭示值 + 最接近者获胜 + 分配奖金

--- V2 ZK 比较制 ---

settle_v2(
    market, actual_value,
    comparison_proof_bytes,
    winner_index,
    clock, ctx
) → 验证 comparison proof + winner 领奖
```

### 4.3 安全考量

| 风险 | 缓解 |
|------|------|
| 预测值超出范围 | threshold_range proof 验证 min <= value <= max |
| 重复提交 | 每个地址只能提交一次 |
| 不揭示（V1） | 不揭示者没收押注，分配给揭示者 |
| 时间操纵 | 使用 sui::clock 链上时间 |
| sender_hash 重放 | Poseidon(address) 绑定 |

---

## 五、链下 SDK 规格

### 5.1 目录结构

```
sdk/
├── src/
│   ├── index.js                  // 统一入口
│   ├── format-sui.js             // snarkjs → Sui 格式转换
│   ├── prover.js                 // 通用 snarkjs 封装
│   ├── hash-commitment.js        // 已有
│   ├── merkle.js                 // 已有
│   ├── pedersen.js               // 新增
│   ├── range-proof.js            // 新增
│   ├── threshold-range.js        // 新增
│   ├── comparison.js             // 新增 (V2)
│   └── semaphore.js              // 新增
├── bin/
│   └── suicryptolib-cli.js       // CLI 工具
├── package.json
└── test/
```

### 5.2 核心 API

```javascript
// 格式转换
import { convertProof, convertPublicInputs, convertVK } from '@suicryptolib/sdk/format-sui'

// Pedersen 承诺
import { generatePedersenProof, generateBlinding } from '@suicryptolib/sdk/pedersen'
const { proofBytes, commitmentX, commitmentY } = await generatePedersenProof({
  value: "1000",
  blinding: generateBlinding(),
  senderHash: "...",
  wasmPath: "...",
  zkeyPath: "...",
})

// Threshold Range Proof
import { generateThresholdRangeProof } from '@suicryptolib/sdk/threshold-range'
const result = await generateThresholdRangeProof({
  value: "500",
  threshold: "100",     // 证明 value >= 100
  blinding: generateBlinding(),
  senderHash: "...",
})

// Semaphore
import { createIdentity, generateSemaphoreProof } from '@suicryptolib/sdk/semaphore'
```

### 5.3 CLI 工具

```bash
# 格式转换
npx suicryptolib convert-vk verification_key.json
# 输出: Sui 格式的 VK hex 字符串

# 生成 Move 验证器模块
npx suicryptolib generate-verifier --vk verification_key.json --module my_verifier
# 输出: my_verifier.move（hardcoded VK + verify 函数）
```

---

## 六、前端规格

### 6.1 页面结构

```
/                     → 首页（市场列表 + 创建市场）
/market/:id           → 市场详情（提交预测 / 揭示 / 结算）
```

### 6.2 组件列表

| 组件 | 功能 |
|------|------|
| CreateMarketForm | 创建市场（事件描述、范围、时间、最低押注） |
| MarketCard | 市场列表中的卡片（状态、参与人数、奖池） |
| SubmitPrediction | 输入预测值 → 生成 ZK proof → 提交 |
| RevealPrediction | V1: 揭示预测值 |
| SettleMarket | 输入实际结果 → 结算 |
| MarketResult | 显示赢家和奖金分配 |
| OperationDetail | 数据流向面板（隐私边界线） |
| PrivacyToggle | 你的视角 / 观察者视角 |
| AnnotatedChainData | 带注释的链上原始数据 |

### 6.3 操作详情面板内容

**提交预测时：**
```
浏览器 (离线计算)
│ 生成随机 blinding factor                        248-bit
│ 加载 ZK 电路 + 证明密钥                          从 Walrus
│ 生成 Threshold Range Proof                       X.Xs
│ 证明: 预测值 >= 下限 且 < 2^64
│ 输出: proof (128B) + commitment (64B)
│
├── 隐私边界 ── 预测值永远不跨越此线 ──
│
Sui 链上
│ 收到: proof + commitment + 押注 SUI
│ 执行: threshold_range::verify() — BN254 配对验证
│ 存储: 承诺坐标 + 押注锁入奖池
```

### 6.4 观察者视角注释

```
commitment_x: 582c93b8...
  ← 预测值的 Pedersen 承诺 x 坐标 — 无法反推预测值

commitment_y: b74e06f1...
  ← 承诺 y 坐标 — 与 x 配对构成椭圆曲线上的点

stake_amount: 1000000000
  ← 观察者知道押注金额 (1 SUI)

revealed: false
  ← 预测尚未揭示，值保密
```

---

## 七、Sui Stack 整合规格

### 7.1 Walrus 整合

**存储内容：**
| 文件 | 大小 | 用途 |
|------|------|------|
| threshold_range.wasm | ~100 KB | 电路 witness calculator |
| threshold_range_final.zkey | ~5 MB | 证明密钥 |
| comparison.wasm (V2) | ~100 KB | 比较电路 |
| comparison_final.zkey (V2) | ~10 MB | 比较证明密钥 |
| 现有 3 个电路的 wasm/zkey | ~10 MB | pedersen + range + semaphore |

**前端加载方式：**
```javascript
const WALRUS_BASE = "https://walrus.sui.io/blob/";

const THRESHOLD_WASM = `${WALRUS_BASE}${THRESHOLD_WASM_BLOB_ID}`;
const THRESHOLD_ZKEY = `${WALRUS_BASE}${THRESHOLD_ZKEY_BLOB_ID}`;

const { proof } = await snarkjs.groth16.fullProve(input, THRESHOLD_WASM, THRESHOLD_ZKEY);
```

### 7.2 Seal 整合（可选增强）

**加密内容：** 用户的预测值详情（具体数字 + 分析理由）
**解密策略：** 市场结算后（时间锁）或市场创建者手动触发
**价值：** 预测值不仅被 ZK 保护（数学隐藏），还被 Seal 加密（物理隐藏）

```javascript
// 提交预测时
const sealClient = new SealClient();
const encryptedDetails = await sealClient.encrypt({
  data: JSON.stringify({ prediction: 42500, analysis: "基于..." }),
  policy: marketPolicyId,  // Move 合约中的解密策略
});
// 加密数据存 Walrus
const blobId = await walrus.store(encryptedDetails);
```

---

## 八、测试计划

### Move 测试

| 测试 | 描述 |
|------|------|
| test_create_market | 创建市场，验证参数正确 |
| test_submit_prediction | 提交预测 + range proof 验证通过 |
| test_submit_invalid_proof_fails | 无效 proof 被拒绝 |
| test_submit_out_of_range_fails | 超出范围的预测被拒绝 |
| test_submit_after_deadline_fails | 截止后提交被拒绝 |
| test_reveal_correct | V1: 正确揭示 |
| test_reveal_wrong_value_fails | V1: 错误揭示被拒绝 |
| test_settle_v1 | V1: 最接近者获胜 |
| test_non_revealer_forfeits | V1: 不揭示者没收押注 |
| test_settle_v2_comparison | V2: ZK 比较结算 |

### E2E 测试

| 测试 | 描述 |
|------|------|
| 完整 V1 流程 | 创建 → 2 人预测 → 揭示 → 结算 → 领奖 |
| Walrus 加载 | 从 Walrus 加载 zkey 后生成 proof |
| 前端全流程 | 浏览器 proof 生成 → 钱包签名 → 链上验证 |

---

## 九、交付物清单

### V1 交付（揭示制，3-4 周）

- [ ] 统一链下 SDK（npm 包）
- [ ] 格式转换 CLI
- [ ] threshold_range.circom 电路 + trusted setup
- [ ] threshold_range.move 验证器
- [ ] prediction_market.move 合约（V1 揭示制）
- [ ] zkey 文件存 Walrus
- [ ] 前端（创建/预测/揭示/结算）
- [ ] 操作详情 + 观察者视角 + 模块标签
- [ ] Move 测试 + E2E 测试
- [ ] 更新文档

### V2 交付（ZK 比较制，额外 2 周）

- [ ] comparison.circom 电路 + trusted setup
- [ ] comparison.move 验证器
- [ ] prediction_market.move 升级（V2 结算）
- [ ] Seal 整合
- [ ] 前端 V2 结算 UI
- [ ] 更新 PPT + Demo 视频

### 提交 Sui Overflow

- [ ] 更新 README
- [ ] 录制 Demo 视频
- [ ] 提交 Infrastructure & Tooling 赛道
