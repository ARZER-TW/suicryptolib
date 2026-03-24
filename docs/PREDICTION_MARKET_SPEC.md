# SuiCryptoLib — 加密价格预测市场 项目规格书 v2

## 变更记录

| 版本 | 变更 |
|------|------|
| v1 | 初始规格 |
| v2 | 根据深度审查修正：移除 V2 comparison proof（设计根本矛盾）；Oracle 改用 Pyth；V1 揭示改用 hash_commitment；电路加上限验证；修复 sender_hash 绑定；Table 替代 vector；处理平局/死锁边界情况 |

---

## 一、项目概述

基于 SuiCryptoLib 的 Groth16 管线，构建一个链上加密货币价格预测市场。

- 用户提交保密预测（SHA-256 哈希承诺 + ZK 范围证明）
- 预测截止后揭示阶段（链上验证哈希匹配）
- 结算时合约从 **Pyth Oracle** 读取实际价格（无人为输入）
- 最接近实际价格的预测者获胜

**展示的 SuiCryptoLib 能力：**
- hash_commitment — 承诺-揭示机制
- threshold_range — ZK 证明预测值在合法范围内（新电路）
- Groth16 管线 — 浏览器生成证明 → 链上 BN254 验证

**Sui 生态整合：**
- Pyth Oracle — 可信价格数据（无需人为输入结算值）
- Walrus — 存储 ZK 电路文件（去中心化加载）

---

## 二、产品定义

### 核心流程

```
创建市场 → 提交保密预测 → 揭示预测 → Pyth 结算 → 领奖
```

### 用户角色

| 角色 | 操作 |
|------|------|
| 市场创建者 | 创建市场（标的、范围、截止时间） |
| 预测者 | 提交保密预测 + 押注 SUI |
| 任何人 | 触发结算（合约从 Pyth 读价格，无信任假设） |

### 具体场景

> 「预测 BTC/USD 在 2026 年 4 月 15 日 00:00 UTC 的价格。
> 预测范围：$50,000 - $150,000。
> 最低押注：1 SUI。
> 最接近实际价格的预测者获胜，赢得奖池。」

### 生命周期

```
[创建] ─── [预测阶段] ─── [揭示阶段] ─── [结算]
              │                │              │
         提交哈希承诺       揭示预测值     Pyth 读价格
         + ZK 范围证明      链上验证哈希    比较偏差
         + 押注 SUI         不揭示→没收     最近者获胜
```

---

## 三、设计决策

### 为什么用 hash_commitment 揭示，不用 Pedersen？

| | Hash Commitment (选用) | Pedersen Commitment |
|---|---|---|
| 揭示方式 | 提交 value + salt，链上重算哈希比对 | 需要链上做椭圆曲线乘法验证 |
| 复杂度 | 低 — SuiCryptoLib 已有 hash_commitment 模块 | 高 — 需要额外的链上 EC 运算 |
| V1 足够？ | 是 — 揭示阶段本来就要公开值 | 过度设计 |

Hash commitment 用于揭示验证，threshold_range ZK proof 用于范围验证。两者各司其职，互不冲突。

### 为什么移除 V2 ZK 比较制？

审查发现两个根本矛盾：

1. **谁生成 comparison proof？** 比较电路需要双方的私有输入（prediction_A, blinding_A, prediction_B, blinding_B），但没有任何一方同时拥有两组秘密。
2. **N 人场景？** 比较电路只处理 A vs B 两人，N 人需要 N-1 次比较或全新的电路设计。

这两个问题没有简单的解法。V1 的揭示制已经足够展示 SuiCryptoLib 的技术能力。

### 为什么用 Pyth 而不是人工输入？

| | Pyth Oracle (选用) | 人工输入 |
|---|---|---|
| 信任模型 | 125+ 机构数据源（Jane Street、Jump Trading 等） | 信任结算者不作弊 |
| 操纵风险 | 无 — 合约直接读 Pyth feed | 结算者可伪造 actual_value |
| 数据范围 | 加密货币、外汇、商品价格 | 任意事件 |
| 适合场景 | 加密价格预测（hackathon 最佳选择） | 通用预测市场（需乐观 Oracle，Sui 上没有） |

---

## 四、ZK 电路规格

### Threshold Range Proof（新电路）

**目的：** 证明 min <= value <= max 且生成 Pedersen 承诺。

```
Private inputs:
  - value: 预测值（如 85000，代表 $85,000）
  - blinding: 随机 blinding factor

Public inputs:
  - min_value: 预测范围下限
  - max_value: 预测范围上限
  - sender_hash: Poseidon(sender_address)，防重放

Public outputs:
  - commitment_x, commitment_y: Pedersen 承诺坐标
```

**电路逻辑：**
```
1. diff_min = value - min_value
   Num2Bits(64)(diff_min)           → 证明 value >= min_value

2. diff_max = max_value - value
   Num2Bits(64)(diff_max)           → 证明 value <= max_value

3. commitment = value * G + blinding * H
   EscalarMulFix(253, G) + EscalarMulFix(253, H) + BabyAdd

4. sender_sq = sender_hash * sender_hash   (信号绑定)
```

**约束估算：**
- Num2Bits(64) x 2 = 128 约束
- Pedersen (EscalarMulFix x 2 + BabyAdd) ≈ 7,885 约束
- 总计 ≈ 8,100 约束

**与现有 range_proof_64 的差异：**
- range_proof_64 只验证 [0, 2^64)，没有自定义上下限
- threshold_range 支持任意 [min, max] 范围，min 和 max 作为 public inputs

---

## 五、Move 合约规格

### 5.1 数据结构

```
module prediction_market::market {
    use sui::clock::Clock;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::table::{Self, Table};
    use suicryptolib::hash_commitment::{Self, Commitment};
    use suicryptolib::threshold_range;
    use suicryptolib::pedersen::PedersenCommitment;
    // Pyth price feed integration
    use pyth::price_info::PriceInfoObject;

    public struct Market has key {
        id: UID,
        creator: address,
        description: vector<u8>,
        pyth_price_feed_id: vector<u8>,     // Pyth price feed identifier (BTC/USD etc.)
        min_prediction: u64,                 // 预测范围下限
        max_prediction: u64,                 // 预测范围上限
        prediction_deadline: u64,            // 提交截止 (ms timestamp)
        reveal_deadline: u64,                // 揭示截止 (ms timestamp)
        settle_after: u64,                   // 最早结算时间 (ms timestamp)
        min_stake: u64,                      // 最低押注 (MIST)
        predictions: Table<address, Prediction>,  // address → Prediction (高效防重复)
        prediction_count: u64,
        actual_price: u64,                   // Pyth 结算价格 (结算后填入)
        settled: bool,
        winner: Option<address>,             // None = 未结算
        prize_pool: Balance<SUI>,
    }

    public struct Prediction has store {
        commitment: Commitment,              // hash_commitment: SHA-256(value_string || salt)
        zk_commitment: PedersenCommitment,   // 范围证明产生的 Pedersen 承诺
        stake_amount: u64,
        revealed_value: u64,
        revealed: bool,
    }
}
```

### 5.2 函数接口

**创建市场：**
```
public fun create_market(
    description: vector<u8>,
    pyth_price_feed_id: vector<u8>,    // 如 BTC/USD 的 feed ID
    min_prediction: u64,
    max_prediction: u64,
    prediction_deadline: u64,
    reveal_deadline: u64,
    settle_after: u64,
    min_stake: u64,
    ctx: &mut TxContext,
)
```

**提交预测（两个承诺 + ZK 证明）：**
```
public fun submit_prediction(
    market: &mut Market,
    // Hash commitment (用于揭示验证)
    hash_commitment: Commitment,           // SHA-256(value_string || salt)
    // ZK 范围证明 (用于证明 min <= value <= max)
    zk_commitment_x: vector<u8>,           // Pedersen 承诺坐标
    zk_commitment_y: vector<u8>,
    sender_hash: vector<u8>,               // 必须 == Poseidon(ctx.sender())
    range_proof_bytes: vector<u8>,          // threshold_range Groth16 proof
    // 押注
    stake: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

**内部逻辑：**
1. 检查时间 <= prediction_deadline
2. 检查 sender 未重复提交（Table::contains）
3. **在合约内计算 expected_sender_hash = Poseidon(ctx.sender())，与传入的 sender_hash 比对**
4. 验证 threshold_range proof（min_prediction, max_prediction 作为 public inputs）
5. 检查 stake >= min_stake
6. 存储 Prediction + 锁入押注

**揭示预测：**
```
public fun reveal_prediction(
    market: &mut Market,
    value: vector<u8>,                     // 预测值的 ASCII 字节 (如 b"85000")
    salt: vector<u8>,                      // 随机盐值
    clock: &Clock,
    ctx: &mut TxContext,
)
```

**内部逻辑：**
1. 检查时间 > prediction_deadline 且 <= reveal_deadline
2. 读取 sender 的 Prediction（Table::borrow_mut）
3. **hash_commitment::verify_opening(commitment, value, salt)** — 验证哈希匹配
4. parse_u64(value) → revealed_value
5. 检查 revealed_value 在 [min_prediction, max_prediction] 范围内（双重保险）
6. 标记 revealed = true

**Pyth 结算：**
```
public fun settle(
    market: &mut Market,
    price_info: &PriceInfoObject,          // Pyth 价格对象
    clock: &Clock,
    ctx: &mut TxContext,
)
```

**内部逻辑：**
1. 检查时间 >= settle_after
2. 检查 market.settled == false
3. **从 Pyth PriceInfoObject 读取价格**（合约内部读取，非外部传入）
4. 验证价格 feed ID 匹配 market.pyth_price_feed_id
5. 验证价格时间戳在合理范围内（不是过期数据）
6. 遍历所有已揭示的预测，计算 |revealed_value - actual_price|
7. **平局处理：多人偏差相同时，先提交者优先**（按 Table 插入顺序）
8. 赢家获得奖池
9. 退还所有已揭示失败者的押注
10. 未揭示者的押注留在奖池（被赢家获得）

**超时退款（处理死锁）：**
```
public fun emergency_refund(
    market: &mut Market,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

**内部逻辑：**
1. 检查时间 > settle_after + 7 天（宽限期）
2. 检查 market.settled == false（没人结算）
3. 退还所有人的押注（包括未揭示者）
4. 标记 market.settled = true, winner = None

### 5.3 安全设计

| 风险 | 缓解方式 |
|------|---------|
| 预测值超出范围 | threshold_range ZK proof 验证 min <= value <= max（链下）+ reveal 时链上二次检查 |
| 重复提交 | Table<address, Prediction> + contains 检查，O(1) |
| Oracle 操纵 | Pyth 125+ 机构数据源，合约不接受外部输入 |
| Proof 重放 | sender_hash = Poseidon(ctx.sender())，合约内强制验证 |
| 没人揭示 | emergency_refund 7 天后退款 |
| 没人结算 | settle 是 permissionless，任何人可调用 |
| 平局 | 先提交者优先 |
| 只有一人揭示 | 该人自动获胜（设计意图：不揭示是惩罚行为） |
| 过期 Pyth 数据 | 合约验证价格时间戳在 settle_after ± 合理窗口内 |

---

## 六、Pyth 整合规格

### Sui 上的 Pyth

Pyth 已部署在 Sui mainnet 和 testnet。使用 pull 模型：

1. 前端从 Pyth Hermes API 获取最新价格更新数据（VAA）
2. 将 VAA 作为交易参数传入 Move 合约
3. 合约内部通过 Pyth SDK 解析并验证价格

### 结算流程

```
前端:
  1. 调用 Pyth Hermes API 获取 BTC/USD 最新价格 VAA
  2. 构建 PTB: pyth::update_price_feed(VAA) → market::settle(price_info)
  3. 钱包签名

链上:
  1. Pyth 合约验证 VAA 签名（Wormhole guardian 签名）
  2. market::settle 从 PriceInfoObject 读取验证后的价格
  3. 比较所有揭示值与实际价格
  4. 最接近者获胜
```

### 价格精度处理

Pyth 价格带有指数位（如 price=8500000, expo=-2 表示 $85,000.00）。合约中需要做精度对齐：

- 用户预测值以**整数美元**为单位（如 85000 = $85,000）
- Pyth 价格转换为整数美元后再比较

---

## 七、链下 SDK 规格

### 预测市场相关的 SDK 函数

```javascript
// 提交预测时，浏览器端需要做的事：
import { computeCommitment, generateSalt } from '@suicryptolib/sdk/hash-commitment'
import { generateThresholdRangeProof, generateBlinding } from '@suicryptolib/sdk/threshold-range'
import { addressToSenderHash } from '@suicryptolib/sdk/sender-hash'

// 1. 生成 hash commitment (用于揭示)
const salt = generateSalt(32);
const hashCommitment = computeCommitment(valueString, salt, 0); // 0=SHA256

// 2. 生成 ZK 范围证明 (证明 min <= value <= max)
const blinding = generateBlinding();
const senderHash = await addressToSenderHash(walletAddress);
const rangeResult = await generateThresholdRangeProof({
  value: valueString,
  minValue: market.minPrediction.toString(),
  maxValue: market.maxPrediction.toString(),
  blinding,
  senderHash,
  wasmUrl: WALRUS_THRESHOLD_WASM_URL,
  zkeyUrl: WALRUS_THRESHOLD_ZKEY_URL,
});

// 3. 提交到链上
// PTB: hash_commitment::from_hash(hash) + market::submit_prediction(...)
```

### 统一 SDK 包结构（更新）

```
sdk/src/
├── hash-commitment.js       ← 已有
├── merkle.js                ← 已有
├── format-sui.js            ← 从 Demo 合并（去重）
├── prover.js                ← 通用 snarkjs 封装
├── sender-hash.js           ← Poseidon(address)
├── pedersen.js              ← 新增封装
├── range-proof.js           ← 新增封装
├── threshold-range.js       ← 新增（本电路）
└── semaphore.js             ← 新增封装
```

---

## 八、前端规格

### 页面结构

```
/                     → 市场列表 + 创建市场
/market/:id           → 市场详情（提交/揭示/结算）
```

### 提交预测时的操作详情面板

```
浏览器 (离线计算)
│ 生成 32 字节随机盐值 (CSPRNG)
│ 计算 SHA-256(预测值 || 盐值) = 32 字节哈希
│ 生成随机 blinding factor (248-bit)
│ 加载 ZK 电路 + 证明密钥                    从 Walrus
│ 生成 Threshold Range Proof                  X.Xs
│   证明: 预测值在 [min, max] 范围内
│ 输出: hash (32B) + proof (128B) + commitment (64B)
│
├── 隐私边界 ── 预测值和盐值不跨越此线 ──
│
Sui 链上
│ 收到: hash + proof + commitment + 押注 SUI
│ 验证 1: threshold_range proof (BN254 配对)
│ 验证 2: sender_hash == Poseidon(tx.sender)
│ 存储: hash commitment + 押注锁入奖池
```

### 结算时的操作详情面板

```
浏览器
│ 调用 Pyth Hermes API 获取价格更新数据 (VAA)
│ 构建 PTB: pyth::update_price + market::settle
│
├── 无隐私边界（结算是公开操作）
│
Sui 链上
│ Pyth 验证 VAA 签名 (Wormhole guardian)
│ 读取 BTC/USD 价格: $XX,XXX
│ 比较所有揭示值与实际价格
│ 最接近者获胜，获得奖池
│ 退还失败者押注
```

### 观察者视角注释

```
hash_commitment: a1b2c3d4...
  ← 预测值的 SHA-256 哈希 — 无法反推预测值（单向函数）

zk_commitment_x: 582c93b8...
  ← Pedersen 承诺坐标 — range proof 的副产物，证明预测在合法范围内

stake_amount: 1000000000
  ← 观察者知道押注金额 (1 SUI)

revealed: false
  ← 预测尚未揭示，值保密

actual_price: (结算后可见)
  ← 来自 Pyth Oracle (125+ 机构数据源)，非人为输入
```

---

## 九、Walrus 整合

| 文件 | 大小 | 来源 |
|------|------|------|
| threshold_range.wasm | ~100 KB | 新电路编译产物 |
| threshold_range_final.zkey | ~5 MB | 新电路 trusted setup |
| 现有电路 wasm/zkey | ~10 MB | pedersen + range + semaphore |

前端从 Walrus aggregator URL 加载，不依赖中心化服务器。

---

## 十、测试计划

### Move 合约测试

| 测试 | 描述 |
|------|------|
| test_create_market | 创建市场，验证参数 |
| test_submit_prediction | 提交预测 + range proof 通过 |
| test_submit_invalid_proof_fails | 无效 proof 被拒绝 |
| test_submit_out_of_range_fails | 范围外预测被拒绝 |
| test_submit_after_deadline_fails | 截止后提交被拒绝 |
| test_submit_duplicate_fails | 同地址重复提交被拒绝 (Table) |
| test_reveal_correct | 正确揭示通过 |
| test_reveal_wrong_value_fails | 错误值揭示被拒绝 |
| test_reveal_after_deadline_fails | 揭示截止后被拒绝 |
| test_settle_with_pyth | Pyth 价格结算，最接近者获胜 |
| test_settle_tie_first_submitter_wins | 平局时先提交者获胜 |
| test_non_revealer_forfeits | 不揭示者没收押注 |
| test_emergency_refund | 7 天后无人结算，全额退款 |
| test_sender_hash_mismatch_fails | sender_hash 不匹配被拒绝 |

### E2E 测试

| 测试 | 描述 |
|------|------|
| 完整流程 | 创建 → 2 人预测 → 揭示 → Pyth 结算 → 赢家领奖 |
| ZK proof 浏览器生成 | 前端 snarkjs 生成 threshold range proof → 链上验证 |
| Walrus 加载 | 从 Walrus 加载 zkey 后生成 proof |

---

## 十一、交付物清单

- [ ] 统一链下 SDK（npm 包，合并 format-sui.js 去重）
- [ ] threshold_range.circom 电路（含 min + max 双边验证）
- [ ] threshold_range.move 验证器（hardcode VK）
- [ ] prediction_market.move 合约（Pyth 整合 + hash_commitment 揭示）
- [ ] Pyth 价格 feed 整合（pull 模型）
- [ ] zkey 文件存 Walrus
- [ ] 前端（创建/预测/揭示/结算 + 操作详情 + 观察者视角）
- [ ] Move 测试（14 个）+ E2E 测试（3 个）
- [ ] 更新 README + PROJECT_ANALYSIS.md
- [ ] 更新 PPT

**预估时间：4-5 周**
