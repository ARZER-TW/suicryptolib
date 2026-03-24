# SuiCryptoLib — 加密价格预测市场 项目规格书 v3

## 变更记录

| 版本 | 变更 |
|------|------|
| v1 | 初始规格 |
| v2 | 移除 V2 comparison proof；Oracle 改用 Pyth；V1 揭示改用 hash_commitment；电路加上限；修复 sender_hash；Table 替代 vector |
| v3 | 修复 Table 不可迭代问题（加 predictor_addresses vector）；Pyth 时间戳窗口验证；create_market 参数验证；明确价格截断规则；记录已知设计取舍；emergency_refund 改为可配置超时；明确资金分配规则；ASCII 序列化标准化 |

---

## 一、项目概述

基于 SuiCryptoLib 的 Groth16 管线，构建一个链上加密货币价格预测市场。

- 用户提交保密预测（SHA-256 哈希承诺 + ZK 范围证明）
- 预测截止后进入揭示阶段（链上验证哈希匹配）
- 结算时合约从 **Pyth Oracle** 读取指定时间窗口内的实际价格
- 最接近实际价格的预测者获胜

**展示的 SuiCryptoLib 能力：**
- hash_commitment — 承诺-揭示机制
- threshold_range — ZK 证明预测值在合法范围内（新电路）
- Groth16 管线 — 浏览器生成证明 → 链上 BN254 验证

**Sui 生态整合：**
- Pyth Oracle — 可信价格数据
- Walrus — 去中心化存储 ZK 电路文件

---

## 二、产品定义

### 场景

> 「预测 BTC/USD 在 2026 年 4 月 15 日 00:00 UTC 的价格。
> 预测范围：$50,000 - $150,000（整数美元）。
> 最低押注：1 SUI。
> 最接近实际价格的预测者获胜。」

### 生命周期

```
[创建] ── [预测阶段] ── [揭示阶段] ── [结算窗口] ── [超时退款]
             │               │             │              │
        提交哈希承诺      揭示预测值    Pyth 读价格    无人结算时
        + ZK 范围证明     链上验证哈希   最近者获胜     全额退款
        + 押注 SUI       不揭示→没收
```

### 资金分配规则

| 角色 | 结算后 |
|------|--------|
| 赢家（最接近的揭示者） | 拿回自己的押注 + 获得所有未揭示者被没收的押注 |
| 揭示但未获胜的人 | 拿回自己的押注（无损失） |
| 未揭示者 | 押注被没收，分配给赢家 |

押注的主要作用是**惩罚不揭示行为**，而非对赌注。预测本身几乎无风险（揭示就退还），但不揭示会受罚。

---

## 三、设计决策与已知取舍

### 3.1 为什么用 hash_commitment 揭示而非 Pedersen

Hash commitment 用于揭示验证（简单、已有模块），threshold_range ZK proof 用于范围验证（证明预测在 [min, max] 内）。两者各司其职。V1 的揭示阶段本来就要公开预测值，不需要 Pedersen 的 ZK 属性。

### 3.2 为什么移除 V2 ZK 比较制

两个根本矛盾无法解决：
1. Comparison proof 需要双方的私有输入，但没有任何一方同时拥有两组秘密
2. N 人场景没有可行的电路设计

### 3.3 已知取舍：Hash 和 ZK proof 未绑定同一 value

用户提交时有两个独立承诺：
- `SHA-256(value_string || salt)` — 用于揭示验证
- `Pedersen(value', blinding)` — ZK 范围证明的副产物

这两个 value 和 value' 理论上可以是不同的数字。但攻击者无法从中获利：
- 如果 hash 承诺的值超出范围 → 揭示时被拒绝或选择不揭示 → 损失押注
- 如果 hash 承诺的值在范围内 → 正常参与，无需作弊

真正绑定两者需要在电路内用 Poseidon 替代 SHA-256 做 hash（SHA-256 在 Circom 中约束数极高），这对 hackathon 是过度工程。

### 3.4 已知取舍：emergency_refund 消除不揭示惩罚

当市场进入超时退款状态时，未揭示者也能拿回押注。这意味着如果用户预期市场可能无法正常结算（如 Pyth feed 故障），有动机故意不揭示。这是可接受的设计取舍：超时退款的首要目的是防止资金永久锁定。

---

## 四、ZK 电路规格：Threshold Range Proof

**目的：** 证明 min_value <= value <= max_value 且生成 Pedersen 承诺。

### 输入输出

```
Private inputs:
  - value: 预测值（整数美元，如 85000）
  - blinding: 随机 blinding factor

Public inputs:
  - min_value: 预测范围下限
  - max_value: 预测范围上限
  - sender_hash: Poseidon(sender_address)

Public outputs:
  - commitment_x, commitment_y: Pedersen 承诺坐标
```

### 电路逻辑（Circom 伪代码，注意 <== 生成 R1CS 约束）

```circom
// 1. 下限验证：value >= min_value
signal diff_min;
diff_min <== value - min_value;
component lb = Num2Bits(64);
lb.in <== diff_min;                  // diff_min 在 [0, 2^64) → value >= min_value

// 2. 上限验证：value <= max_value
signal diff_max;
diff_max <== max_value - value;
component ub = Num2Bits(64);
ub.in <== diff_max;                  // diff_max 在 [0, 2^64) → value <= max_value

// 3. Pedersen 承诺（内嵌，防绑定脱钩）
component vG = EscalarMulFix(253, G);
// ... value bits → vG
component rH = EscalarMulFix(253, H);
// ... blinding bits → rH
component add = BabyAdd();
// ... commitment = vG + rH

// 4. sender 信号绑定（<== 生成真实约束，不会被优化掉）
signal sender_sq;
sender_sq <== sender_hash * sender_hash;
```

### 约束估算

| 组件 | 约束数 |
|------|--------|
| Num2Bits(64) x 2 | ~128 |
| EscalarMulFix(253) x 2 + BabyAdd | ~7,885 |
| sender_hash 约束 | 1 |
| **总计** | **~8,014** |

---

## 五、Move 合约规格

### 5.1 数据结构

```move
module prediction_market::market {
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::balance::{Self, Balance};
    use sui::table::{Self, Table};
    use suicryptolib::hash_commitment::{Self, Commitment};
    use suicryptolib::threshold_range;
    use suicryptolib::pedersen::{Self, PedersenCommitment};

    // --- Error codes ---
    const EInvalidRange: u64 = 0;
    const EInvalidTimeline: u64 = 1;
    const EInvalidStake: u64 = 2;
    const EInvalidFeedId: u64 = 3;
    const EWrongPhase: u64 = 4;
    const EDuplicatePrediction: u64 = 5;
    const EInsufficientStake: u64 = 6;
    const ESenderHashMismatch: u64 = 7;
    const EInvalidRangeProof: u64 = 8;
    const ENotPredictor: u64 = 9;
    const EAlreadyRevealed: u64 = 10;
    const EInvalidOpening: u64 = 11;
    const ERevealedValueOutOfRange: u64 = 12;
    const EAlreadySettled: u64 = 13;
    const EPriceTooEarly: u64 = 14;
    const EPriceTooStale: u64 = 15;
    const EFeedIdMismatch: u64 = 16;
    const ENoRevealedPredictions: u64 = 17;
    const EEmergencyTooEarly: u64 = 18;

    /// 预测市场实例
    public struct Market has key {
        id: UID,
        creator: address,
        description: vector<u8>,

        // Pyth Oracle 配置
        pyth_price_feed_id: vector<u8>,         // 32 bytes, 如 BTC/USD feed ID
        settle_price_window_secs: u64,          // 结算价格时间窗口 (秒, 如 3600)

        // 预测范围 (整数美元)
        min_prediction: u64,
        max_prediction: u64,

        // 时间线 (毫秒时间戳)
        prediction_deadline: u64,               // 提交截止
        reveal_deadline: u64,                   // 揭示截止
        settle_after: u64,                      // 最早结算时间 (预测的目标时间点)
        emergency_timeout: u64,                 // 超时退款等待时间 (毫秒)

        // 押注
        min_stake: u64,                         // 最低押注 (MIST)

        // 预测存储 (Table + vector 双结构)
        predictions: Table<address, Prediction>,    // O(1) 查询和防重复
        predictor_addresses: vector<address>,       // 维护提交顺序，用于迭代和平局判定

        // 结算
        actual_price: u64,                      // Pyth 结算价格 (整数美元, 结算后填入)
        settled: bool,
        winner: Option<address>,

        // 资金池
        prize_pool: Balance<SUI>,
    }

    /// 单个预测
    public struct Prediction has store {
        hash_commitment: Commitment,            // SHA-256(value_string || salt)
        zk_commitment: PedersenCommitment,      // 范围证明的 Pedersen 承诺 (副产物)
        stake_amount: u64,
        revealed_value: u64,                    // 揭示后填入
        revealed: bool,
    }
}
```

### 5.2 函数接口

#### create_market

```
public fun create_market(
    description: vector<u8>,
    pyth_price_feed_id: vector<u8>,
    min_prediction: u64,
    max_prediction: u64,
    prediction_deadline: u64,
    reveal_deadline: u64,
    settle_after: u64,
    emergency_timeout: u64,             // 可配置的超时时间 (毫秒)
    settle_price_window_secs: u64,      // Pyth 价格窗口 (秒)
    min_stake: u64,
    ctx: &mut TxContext,
)
```

**参数验证（全部 assert）：**
```
assert!(min_prediction < max_prediction)
assert!(prediction_deadline < reveal_deadline)
assert!(reveal_deadline <= settle_after)
assert!(min_stake > 0)
assert!(vector::length(&pyth_price_feed_id) == 32)
assert!(emergency_timeout >= 86400000)         // 至少 1 天
assert!(settle_price_window_secs > 0 && settle_price_window_secs <= 86400)  // 1秒-1天
```

#### submit_prediction

```
public fun submit_prediction(
    market: &mut Market,
    hash_commitment: Commitment,
    zk_commitment_x: vector<u8>,
    zk_commitment_y: vector<u8>,
    sender_hash: vector<u8>,
    range_proof_bytes: vector<u8>,
    stake: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

**内部逻辑（按顺序）：**
1. `assert!(clock::timestamp_ms(clock) <= market.prediction_deadline)` — 时间检查
2. `assert!(!table::contains(&market.predictions, sender))` — O(1) 防重复
3. 计算 `expected_sender_hash = poseidon::poseidon_bn254(sender_address_as_u256)`
4. `assert!(sender_hash == expected_sender_hash)` — 防重放
5. 构建 PedersenCommitment，调用 `threshold_range::verify(commitment, min_prediction, max_prediction, sender_hash, range_proof_bytes)` — ZK 验证
6. `assert!(coin::value(&stake) >= market.min_stake)` — 押注检查
7. `table::add(&mut market.predictions, sender, prediction)` — 存储
8. `vector::push_back(&mut market.predictor_addresses, sender)` — 维护顺序
9. 锁入押注到 prize_pool

#### reveal_prediction

```
public fun reveal_prediction(
    market: &mut Market,
    value: vector<u8>,          // ASCII bytes, 如 b"85000"
    salt: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

**内部逻辑：**
1. `assert!(timestamp > prediction_deadline && timestamp <= reveal_deadline)` — 揭示窗口
2. 从 Table 读取 sender 的 Prediction
3. `assert!(!prediction.revealed)` — 未揭示过
4. `hash_commitment::verify_opening(&prediction.hash_commitment, value, salt)` — 哈希验证
5. `parse_u64(value)` → revealed_value
6. `assert!(revealed_value >= min_prediction && revealed_value <= max_prediction)` — 二次范围检查
7. 标记 revealed = true, revealed_value = parsed

#### settle

```
public fun settle(
    market: &mut Market,
    price_info: &PriceInfoObject,       // Pyth 价格对象
    clock: &Clock,
    ctx: &mut TxContext,
)
```

**内部逻辑：**
1. `assert!(timestamp >= market.settle_after)` — 可以结算了
2. `assert!(!market.settled)` — 未结算过
3. 从 Pyth PriceInfoObject 读取价格和时间戳
4. 验证 feed ID 匹配 `market.pyth_price_feed_id`
5. **验证价格时间戳在窗口内：**
   ```
   price_ts >= settle_after_secs
   price_ts <= settle_after_secs + settle_price_window_secs
   ```
6. 价格转换为整数美元（**向下截断**，如 84999.73 → 84999）
7. **迭代 predictor_addresses 找赢家：**
   ```
   遍历 predictor_addresses (vector)
   对每个地址，从 predictions (Table) 读取 Prediction
   如果 revealed == true:
     计算 abs_diff = |revealed_value - actual_price|
     如果 abs_diff < current_min_diff:    // 严格小于 → 先提交者自动优先
       更新赢家
   ```
8. 如果有赢家：
   - 退还所有已揭示非赢家的押注
   - 赢家获得自己的押注 + 所有未揭示者被没收的押注
9. 如果没有任何揭示者：`assert!(false, ENoRevealedPredictions)`
10. 标记 settled, 记录 winner + actual_price

#### emergency_refund

```
public fun emergency_refund(
    market: &mut Market,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

**内部逻辑：**
1. `assert!(timestamp > market.settle_after + market.emergency_timeout)` — 超时
2. `assert!(!market.settled)` — 未正常结算
3. 退还**所有人**的押注（包括未揭示者）
4. 标记 settled = true, winner = None

---

## 六、Pyth 整合规格

### 结算时间语义

预测的是 **settle_after 时间点**的价格，不是「有人调用 settle 时」的价格。

合约通过验证 Pyth 价格时间戳在 `[settle_after, settle_after + window]` 内来确保时间语义一致。窗口由 `settle_price_window_secs` 参数控制（建议 1 小时 = 3600 秒）。

### 价格精度规则

Pyth 返回的价格带指数位（如 `price=8499973000, expo=-5` 表示 $84,999.73）。

**规则：向下截断到整数美元。**

```
actual_price_usd = pyth_price / 10^(-expo)   // 取整数部分
```

前端 UI 必须明确显示：「以整数美元为单位预测」。用户输入小数时前端应自动截断。

### Pyth Sui 整合流程

```
前端:
  1. 调用 Pyth Hermes API: GET /v2/updates/price/latest?ids[]=BTC_USD_FEED_ID
  2. 获取 VAA (Verified Action Approval) 数据
  3. PTB:
     a. pyth::update_single_price_feed(state, vaa, clock)
     b. market::settle(market, price_info_object, clock)
  4. 钱包签名

链上:
  1. Pyth 合约验证 VAA (Wormhole guardian 签名)
  2. PriceInfoObject 更新为最新价格
  3. market::settle 读取验证后的价格
```

**开发前必须确认：** Pyth Sui SDK 的实际 package ID、函数签名、PriceInfoObject 结构。参考 https://docs.pyth.network/price-feeds/use-real-data/sui

### 测试中的 Mock 策略

`sui move test` 环境无法连接真实 Pyth。两种方案：
- **方案 A：** 合约额外提供 `settle_for_testing(market, price, clock)` 函数（仅限 #[test_only]）
- **方案 B：** 使用 Pyth SDK 提供的测试工具（如果有）

建议使用方案 A，简单可控。

---

## 七、链下规格

### 7.1 SDK 数值序列化标准

预测值在 hash commitment 中以 ASCII 字符串表示（如 b"85000"）。

**标准化规则：**
- 必须是纯数字（0-9），不允许小数点、逗号、空格
- **不允许前导零**（如 "085000" 不合法，必须是 "85000"）
- SDK 层面强制 trim：`value.replace(/^0+/, '') || '0'`
- 零值表示为 "0" 而非 ""

前端输入验证必须在提交前执行此标准化，否则揭示时字节不匹配会导致押注被没收。

### 7.2 SDK 函数

```javascript
import { computeCommitment, generateSalt } from '@suicryptolib/sdk/hash-commitment'
import { generateThresholdRangeProof, generateBlinding } from '@suicryptolib/sdk/threshold-range'
import { addressToSenderHash } from '@suicryptolib/sdk/sender-hash'

// 标准化预测值
function normalizeValue(input) {
  const num = parseInt(input, 10);
  if (isNaN(num) || num < 0) throw new Error('Invalid prediction');
  return num.toString();  // 自动去除前导零
}

// 提交预测
const valueStr = normalizeValue(userInput);
const salt = generateSalt(32);
const commitment = computeCommitment(valueStr, salt, 0);  // SHA256

const blinding = generateBlinding();
const senderHash = await addressToSenderHash(walletAddress);
const rangeResult = await generateThresholdRangeProof({
  value: valueStr,
  minValue: market.minPrediction.toString(),
  maxValue: market.maxPrediction.toString(),
  blinding,
  senderHash,
});
```

### 7.3 Walrus 整合

| 文件 | 大小 |
|------|------|
| threshold_range.wasm | ~100 KB |
| threshold_range_final.zkey | ~5 MB |

上传到 Walrus，前端从 Walrus aggregator URL 加载。具体 URL 格式开发时确认。

---

## 八、前端规格

### 页面结构

```
/                     → 市场列表 + 创建市场
/market/:id           → 市场详情
```

### 市场详情页的阶段展示

| 阶段 | 显示内容 |
|------|---------|
| 预测阶段 | 提交预测表单（输入整数美元 + 押注金额）+ 已提交预测数 |
| 揭示阶段 | 揭示按钮 + 已揭示/未揭示计数 |
| 等待结算 | 结算按钮（任何人可点）+ 倒计时 |
| 已结算 | 赢家 + 实际价格 + 偏差 + 奖金分配 |
| 超时 | 退款按钮 |

### 操作详情面板

**提交预测时：**
```
浏览器 (离线计算)
│ 标准化预测值 (去前导零, 纯数字)
│ 生成 32 字节随机盐值 (CSPRNG)
│ 计算 SHA-256(预测值 || 盐值) = 32 字节哈希
│ 生成随机 blinding factor (248-bit)
│ 加载 ZK 电路 + 证明密钥                     从 Walrus
│ 生成 Threshold Range Proof                   X.Xs
│   证明: 预测值在 [$min, $max] 范围内
│ 输出: hash (32B) + proof (128B) + commitment (64B)
│
├── 隐私边界 ── 预测值和盐值不跨越此线 ──
│
Sui 链上
│ 验证 1: sender_hash == Poseidon(tx.sender)
│ 验证 2: threshold_range proof (BN254 配对)
│ 存储: hash commitment + 押注锁入奖池
```

**结算时：**
```
浏览器
│ 调用 Pyth Hermes API 获取价格更新 (VAA)
│
├── 无隐私边界 (结算是公开操作)
│
Sui 链上
│ Pyth 验证 VAA 签名 (Wormhole guardian)
│ 读取 BTC/USD 价格: $XX,XXX
│ 验证价格时间戳在结算窗口内
│ 遍历所有揭示值，计算与实际价格的偏差
│ 偏差最小者获胜 (平局: 先提交者优先)
│ 退还揭示失败者押注 + 赢家获得没收押注
```

### 观察者视角注释

```
hash_commitment: a1b2c3d4...
  ← SHA-256 哈希 — 无法反推预测值 (单向函数)

zk_commitment_x: 582c93b8...
  ← Pedersen 承诺坐标 — range proof 副产物
  ← 注: 与 hash commitment 独立，不保证对应同一个值
  ← 攻击者若两者不一致，最多损失押注

stake_amount: 1000000000
  ← 押注 1 SUI — 揭示后退还，不揭示被没收

revealed: false
  ← 尚未揭示

actual_price: 84999 (结算后)
  ← 来自 Pyth Oracle — 125+ 机构数据源，非人为输入
  ← 向下截断到整数美元
```

---

## 九、测试计划

### Move 合约测试

| # | 测试 | 验证什么 |
|---|------|---------|
| 1 | test_create_market | 参数正确存储 |
| 2 | test_create_invalid_range_fails | min >= max 被拒绝 |
| 3 | test_create_invalid_timeline_fails | deadline 顺序错误被拒绝 |
| 4 | test_submit_prediction | 提交 + range proof 通过 |
| 5 | test_submit_invalid_proof_fails | 无效 proof 被拒绝 |
| 6 | test_submit_duplicate_fails | 同地址重复提交被拒绝 (Table O(1)) |
| 7 | test_submit_after_deadline_fails | 截止后提交被拒绝 |
| 8 | test_submit_insufficient_stake_fails | 押注不足被拒绝 |
| 9 | test_sender_hash_mismatch_fails | sender_hash 不匹配被拒绝 |
| 10 | test_reveal_correct | 正确揭示通过 |
| 11 | test_reveal_wrong_value_fails | 错误值揭示被拒绝 |
| 12 | test_reveal_after_deadline_fails | 揭示截止后被拒绝 |
| 13 | test_settle_closest_wins | Pyth 价格结算，最接近者获胜 |
| 14 | test_settle_tie_first_wins | 平局时先提交者获胜 |
| 15 | test_settle_non_revealer_forfeits | 不揭示者押注给赢家 |
| 16 | test_settle_price_out_of_window_fails | 价格时间戳超出窗口被拒绝 |
| 17 | test_emergency_refund | 超时后全额退款 |
| 18 | test_emergency_too_early_fails | 未超时不能退款 |

注：test_settle 相关测试使用 #[test_only] 的 settle_for_testing 函数（mock Pyth 价格）。

### E2E 测试

| # | 测试 | 描述 |
|---|------|------|
| 1 | 完整流程 | 创建 → 2 人预测 → 揭示 → 结算 → 赢家领奖 |
| 2 | ZK proof 浏览器生成 | 前端 snarkjs 生成 threshold range proof → 链上验证 |
| 3 | Walrus 加载 | 从 Walrus 加载 zkey 后生成 proof |

---

## 十、交付物清单

- [ ] 统一链下 SDK（合并 format-sui.js + 新增 threshold-range.js）
- [ ] threshold_range.circom 电路（min + max 双边验证）
- [ ] threshold_range.move 验证器
- [ ] prediction_market.move 合约（Table + vector 双结构、Pyth 时间窗口、参数验证、emergency_refund）
- [ ] settle_for_testing 测试辅助函数
- [ ] zkey 文件存 Walrus
- [ ] 前端（创建/预测/揭示/结算 + 操作详情 + 观察者视角）
- [ ] Move 测试 18 个 + E2E 测试 3 个
- [ ] 更新 README + PROJECT_ANALYSIS.md
- [ ] 更新 PPT

**预估时间：4-5 周**
