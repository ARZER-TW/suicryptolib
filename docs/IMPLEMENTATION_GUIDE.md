# 加密价格预测市场 — 实作指南

本文档是 PREDICTION_MARKET_SPEC v4.2 的**具体实作参考**。按 Phase 顺序编排，每个步骤包含文件路径、输入输出、关键细节。

---

## Phase 1: ZK 电路 — threshold_range

### 1.1 文件结构

```
circuits/threshold_range/
├── threshold_range.circom        ← 新电路
├── test_prove.mjs                ← 测试脚本
├── threshold_range_js/
│   └── threshold_range.wasm      ← 编译产物
├── threshold_range_final.zkey    ← trusted setup 产物
└── verification_key.json         ← VK（用于 Move 模块）
```

### 1.2 电路设计

```circom
pragma circom 2.1.5;

include "../node_modules/circomlib/circuits/babyjub.circom";
include "../node_modules/circomlib/circuits/escalarmulfix.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

template ThresholdRange() {
    // Private
    signal input value;
    signal input blinding;

    // Public
    signal input minValue;
    signal input maxValue;
    signal input senderHash;

    // Outputs
    signal output commitmentX;
    signal output commitmentY;

    // 1. 下限: value >= minValue
    component lowerBound = Num2Bits(64);
    lowerBound.in <== value - minValue;

    // 2. 上限: value <= maxValue
    component upperBound = Num2Bits(64);
    upperBound.in <== maxValue - value;

    // 3. Pedersen 承诺: value*G + blinding*H
    //    G = BabyJubJub base point (同 pedersen_commitment.circom)
    //    H = nothing-up-my-sleeve point (同 pedersen_commitment.circom)
    var G[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];
    var H[2] = [
        18267622314187687572088998826809831308727694590966921888299154889300475970589,
        8059698257908533886155608288179897806584863540535702356995467530609830876645
    ];

    component valueBits = Num2Bits(253);
    valueBits.in <== value;
    component blindingBits = Num2Bits(253);
    blindingBits.in <== blinding;

    component vG = EscalarMulFix(253, G);
    for (var i = 0; i < 253; i++) { vG.e[i] <== valueBits.out[i]; }

    component rH = EscalarMulFix(253, H);
    for (var i = 0; i < 253; i++) { rH.e[i] <== blindingBits.out[i]; }

    component add = BabyAdd();
    add.x1 <== vG.out[0];
    add.y1 <== vG.out[1];
    add.x2 <== rH.out[0];
    add.y2 <== rH.out[1];

    commitmentX <== add.xout;
    commitmentY <== add.yout;

    // senderHash: 无需额外约束
    // Groth16 public input 天然绑定在验证方程中
    // Move 合约验证 senderHash == Poseidon(ctx.sender())
}

component main {public [minValue, maxValue, senderHash]} = ThresholdRange();
```

### 1.3 编译和设置命令

```bash
cd circuits/threshold_range

# 编译
circom threshold_range.circom --r1cs --wasm --sym --output . -l ../node_modules

# Trusted setup
snarkjs groth16 setup threshold_range.r1cs ../pot15.ptau threshold_0000.zkey
snarkjs zkey contribute threshold_0000.zkey threshold_range_final.zkey \
  --name="SuiCryptoLib ThresholdRange v1" -e="threshold range setup entropy"
snarkjs zkey export verificationkey threshold_range_final.zkey verification_key.json
```

### 1.4 测试向量

test_prove.mjs 需要测试以下场景：

| 场景 | value | min | max | 预期结果 |
|------|-------|-----|-----|---------|
| 正常值 | 85000 | 50000 | 150000 | PASS |
| 下界 | 50000 | 50000 | 150000 | PASS (value == min) |
| 上界 | 150000 | 50000 | 150000 | PASS (value == max) |
| 低于下限 | 49999 | 50000 | 150000 | FAIL (Num2Bits 负数) |
| 高于上限 | 150001 | 50000 | 150000 | FAIL (Num2Bits 负数) |

test_prove.mjs 还需要输出 Sui 格式的 VK hex（用于 Move 模块）和测试向量的 proof bytes + public inputs（用于 Move 测试）。

### 1.5 注意事项

- Generator G 和 H 必须与现有 pedersen_commitment.circom 完全一致
- senderHash 不加 `sender_sq <== senderHash * senderHash`（与现有电路不同，spec v4.2 决定移除）
- Public inputs 顺序（从 Circom 输出）: commitmentX, commitmentY, minValue, maxValue, senderHash — **这个顺序决定了 Move 合约中 public inputs 的拼接顺序，必须实测确认**

---

## Phase 2: Move 合约

### 2.1 文件结构

```
examples/prediction_market/move/
├── Move.toml
├── sources/
│   ├── market.move                ← 主合约
│   └── market_tests.move          ← 测试
```

Move.toml 依赖 suicryptolib（已部署）和 Pyth。

### 2.2 threshold_range.move

放在 suicryptolib 主库中（需要升级 package）：

```
move/sources/threshold_range.move
```

**关键：** public inputs 拼接顺序必须与 Circom 电路输出顺序一致。Phase 1.5 确认顺序后才能写这个模块。

拼接逻辑（伪代码）：
```
public_inputs = commitmentX(32B LE) || commitmentY(32B LE)
             || minValue(32B LE) || maxValue(32B LE)
             || senderHash(32B LE)
```

其中 minValue 和 maxValue 是 u64 转为 u256 再转为 32 bytes LE。

### 2.3 prediction_market.move 关键实作细节

**sender_hash 验证：**
```move
// address → hi/lo 128-bit → Poseidon
let addr_bytes = bcs::to_bytes(&tx_context::sender(ctx));
// 取前 16 bytes 为 hi, 后 16 bytes 为 lo
// 转为 u256
let expected = sui::poseidon::poseidon_bn254(vector[hi_u256, lo_u256]);
// 与传入的 sender_hash 比对
```

注意：address 在 Move 中是 32 bytes。拆分方式必须与 SDK 的 `addressToSenderHash` 完全一致。现有 SDK 在 `examples/confidential_account/frontend/src/lib/sender-hash.js` 中的实现是：
```javascript
const addr = BigInt(address);
const lo = addr & ((1n << 128n) - 1n);
const hi = addr >> 128n;
```

Move 中需要做等价的拆分。`addr_bytes[0..16]` 是高位还是低位取决于 BCS 序列化的字节序 — **必须实测确认**。

**settle 中的价格截断：**
```move
// Pyth 返回 I64 类型
let raw_price = price::get_price(&price_struct);      // I64
let expo = price::get_expo(&price_struct);              // I64 (负数如 -8)

// BTC/USD: price=8499973000, expo=-8
// actual_usd = 8499973000 / 10^8 = 84999 (向下截断)
// 需要用 pyth::i64 模块提取 magnitude 和符号
```

**settle 资金分配（两次遍历）：**
```move
// 第一次遍历: 找赢家
let i = 0;
let min_diff = 0xFFFFFFFFFFFFFFFF; // u64::MAX
let winner = option::none<address>();
while (i < vector::length(&market.predictor_addresses)) {
    let addr = *vector::borrow(&market.predictor_addresses, i);
    let pred = table::borrow(&market.predictions, addr);
    if (pred.revealed) {
        let diff = abs_diff(pred.revealed_value, market.actual_price);
        if (diff < min_diff) {  // 严格小于 → 先提交者优先
            min_diff = diff;
            winner = option::some(addr);
        };
    };
    i = i + 1;
};

// 第二次遍历: 退还非赢家揭示者的押注
let i = 0;
while (i < vector::length(&market.predictor_addresses)) {
    let addr = *vector::borrow(&market.predictor_addresses, i);
    let pred = table::borrow(&market.predictions, addr);
    if (pred.revealed && option::some(addr) != winner) {
        // 退还 pred.stake_amount 给 addr
        let refund = coin::from_balance(
            balance::split(&mut market.prize_pool, pred.stake_amount), ctx
        );
        transfer::public_transfer(refund, addr);
    };
    i = i + 1;
};

// 赢家获得剩余 prize_pool（自己的押注 + 所有未揭示者的押注）
let winner_addr = option::extract(&mut winner);
let prize = coin::from_balance(
    balance::withdraw_all(&mut market.prize_pool), ctx
);
transfer::public_transfer(prize, winner_addr);
```

### 2.4 20 个测试用例

每个测试需要的测试向量来自 Phase 1。对于涉及 ZK proof 的测试（#4, #5, #9），需要从 test_prove.mjs 获取具体的 proof bytes 和 public inputs。

对于不涉及 ZK 的测试（如 create_market 参数验证），直接在 Move 中构造。

settle 相关测试使用 `#[test_only]` 的 settle_for_testing 函数 mock Pyth 价格。

### 2.5 部署

suicryptolib 需要升级（添加 threshold_range 模块）：
```bash
cd move
sui client upgrade --gas-budget 200000000 --upgrade-capability 0x485a3ab5...
```

prediction_market 作为独立包部署：
```bash
cd examples/prediction_market/move
sui client publish --gas-budget 200000000
```

---

## Phase 3: Pyth 集成

### 3.1 依赖安装

```bash
npm install @pythnetwork/pyth-sui-js @pythnetwork/hermes-client
```

### 3.2 Pyth Testnet 配置

```javascript
// Pyth Sui Testnet State ID (需确认最新值)
// 查询: https://docs.pyth.network/price-feeds/contract-addresses/sui
const PYTH_STATE_ID = "0x...";  // testnet
const WORMHOLE_STATE_ID = "0x...";  // testnet

// BTC/USD Price Feed ID (所有链通用)
const BTC_USD_FEED_ID = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
```

### 3.3 验证脚本 (scripts/test_pyth.mjs)

```javascript
import { SuiPythClient } from "@pythnetwork/pyth-sui-js";
import { HermesClient } from "@pythnetwork/hermes-client";

// 1. 从 Hermes 获取价格
const hermes = new HermesClient("https://hermes.pyth.network");
const priceUpdates = await hermes.getLatestPriceUpdates([BTC_USD_FEED_ID]);

// 2. 构建 PTB
const pythClient = new SuiPythClient(suiClient, PYTH_STATE_ID, WORMHOLE_STATE_ID);
const tx = new Transaction();
await pythClient.updatePriceFeeds(tx, priceUpdates.binary.data, [BTC_USD_FEED_ID]);

// 3. 在同一 PTB 中调用 settle
tx.moveCall({
  target: `${MARKET_PKG}::market::settle`,
  arguments: [tx.object(marketId), tx.object(priceInfoObjectId), tx.object("0x6")],
});
```

### 3.4 Move 合约中的 Pyth 读取

```move
use pyth::pyth;
use pyth::price;
use pyth::price_info::PriceInfoObject;

// settle 函数内:
let price_struct = pyth::get_price(price_info_object, clock);
let price_timestamp = price::get_timestamp(&price_struct);
let price_i64 = price::get_price(&price_struct);
let expo_i64 = price::get_expo(&price_struct);
```

**I64 → u64 转换需要实测。** Pyth 的 I64 是自定义类型，查看 `pyth::i64` 模块确认 API。

### 3.5 实测检查清单

- [ ] Hermes API 返回数据格式
- [ ] SuiPythClient.updatePriceFeeds 的参数格式
- [ ] PriceInfoObject 的 Sui object ID 如何获取
- [ ] price::get_timestamp 返回值是 seconds 还是 ms
- [ ] price::get_price 返回值的 magnitude 和符号处理
- [ ] price::get_expo 的典型值（BTC/USD 预期 -8）
- [ ] Pyth testnet 的 package ID

---

## Phase 4: SDK 统一 + Walrus

### 4.1 SDK 文件结构

```
sdk/src/
├── index.js                  ← 统一入口
├── format-sui.js             ← 从三个 Demo 合并（去重）
├── prover.js                 ← 通用 snarkjs 封装
├── sender-hash.js            ← Poseidon(hi, lo) — 从 Demo 2 提取
├── hash-commitment.js        ← 已有
├── merkle.js                 ← 已有
├── pedersen.js               ← 封装 pedersen proof 生成
├── range-proof.js            ← 封装 range proof 生成
├── threshold-range.js        ← 新增
└── semaphore.js              ← 封装 semaphore proof 生成
```

### 4.2 去重清单

当前三份副本：
- `examples/sealed_auction/frontend/src/lib/format-sui.js` — 没有 convertVK
- `examples/confidential_account/frontend/src/lib/format-sui.js` — 有 convertPublicInputs
- `examples/semaphore/frontend/src/lib/prover.js` — 包含格式转换

合并为 `sdk/src/format-sui.js`：包含 bigintToBytes32LE, serializeG1Compressed, serializeG2Compressed, convertProof, convertPublicInputs, convertVK。

### 4.3 threshold-range.js API

```javascript
export async function generateThresholdRangeProof({
  value,          // 预测值 (decimal string)
  minValue,       // 范围下限 (decimal string)
  maxValue,       // 范围上限 (decimal string)
  blinding,       // 随机 blinding factor (decimal string)
  senderHash,     // Poseidon(addr_hi, addr_lo) (decimal string)
  wasmUrl,        // .wasm 文件 URL (Walrus)
  zkeyUrl,        // .zkey 文件 URL (Walrus)
  onProgress,     // 进度回调
}) {
  // 1. snarkjs.groth16.fullProve
  // 2. convertProof → 128 bytes
  // 3. 提取 public signals: commitmentX, commitmentY, minValue, maxValue, senderHash
  // 4. 返回 { proofBytes, commitmentX, commitmentY, senderHashBytes }
}
```

### 4.4 Walrus 上传

```bash
# 使用 Walrus CLI 或 HTTP API 上传
walrus store threshold_range.wasm --epochs 100
# 输出 blob ID

walrus store threshold_range_final.zkey --epochs 100
# 输出 blob ID
```

记录 blob ID，配置到前端 config 中。

### 4.5 验证

上传后测试：
```javascript
const wasmUrl = `https://aggregator.walrus-testnet.walrus.space/v1/${WASM_BLOB_ID}`;
const zkeyUrl = `https://aggregator.walrus-testnet.walrus.space/v1/${ZKEY_BLOB_ID}`;
const result = await generateThresholdRangeProof({ ..., wasmUrl, zkeyUrl });
// 验证 result.proofBytes 能通过链上验证
```

---

## Phase 5: 前端

### 5.1 文件结构

```
examples/prediction_market/frontend/
├── public/
│   └── (无本地电路文件 — 全部从 Walrus 加载)
├── src/
│   ├── App.jsx
│   ├── main.jsx
│   ├── index.css
│   ├── config.js                    ← package IDs, Pyth config, Walrus URLs
│   ├── lib/
│   │   ├── prediction.js           ← hash commitment + ZK proof 生成
│   │   └── pyth.js                 ← Pyth 价格获取 + PTB 构建
│   ├── hooks/
│   │   ├── use-market.js           ← create/submit/reveal/settle hooks
│   │   └── use-market-state.js     ← 读取市场状态
│   └── components/
│       ├── CreateMarket.jsx
│       ├── SubmitPrediction.jsx
│       ├── RevealPrediction.jsx
│       ├── SettleMarket.jsx
│       ├── MarketStatus.jsx        ← 阶段 + 倒计时
│       ├── OperationDetail.jsx     ← 复用
│       ├── PrivacyToggle.jsx       ← 复用
│       ├── ChainDataView.jsx       ← 复用 (AnnotatedChainData + SuiscanLink)
│       └── ModuleTag.jsx           ← 复用
├── vite.config.js
├── package.json
└── index.html
```

### 5.2 config.js

```javascript
export const LIB_PACKAGE_ID = "0x...";  // 升级后的 suicryptolib
export const MARKET_PACKAGE_ID = "0x...";  // prediction_market

// Pyth
export const PYTH_STATE_ID = "0x...";
export const WORMHOLE_STATE_ID = "0x...";
export const BTC_USD_FEED_ID = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

// Walrus
export const WALRUS_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space/v1/";
export const THRESHOLD_WASM_BLOB_ID = "...";  // Phase 4 上传后填入
export const THRESHOLD_ZKEY_BLOB_ID = "...";

// 市场默认值
export const DEFAULT_MIN_STAKE_MIST = 1_000_000_000;  // 1 SUI
```

### 5.3 prediction.js（核心逻辑）

```javascript
import { computeCommitment, generateSalt } from '@suicryptolib/sdk/hash-commitment';
import { generateThresholdRangeProof, generateBlinding } from '@suicryptolib/sdk/threshold-range';
import { addressToSenderHash } from '@suicryptolib/sdk/sender-hash';

// 标准化预测值
export function normalizeValue(input) {
  const num = parseInt(input, 10);
  if (isNaN(num) || num < 0) throw new Error('Invalid prediction');
  return num.toString();  // 去前导零
}

export async function preparePrediction({ value, minPrediction, maxPrediction, walletAddress, onProgress }) {
  const valueStr = normalizeValue(value);

  // 1. Hash commitment (用于揭示)
  onProgress?.("hashing");
  const salt = generateSalt(32);
  const hashCommitment = computeCommitment(valueStr, salt, 0);  // SHA256

  // 2. ZK 范围证明
  onProgress?.("proving");
  const blinding = generateBlinding();
  const senderHash = await addressToSenderHash(walletAddress);
  const rangeResult = await generateThresholdRangeProof({
    value: valueStr,
    minValue: minPrediction.toString(),
    maxValue: maxPrediction.toString(),
    blinding,
    senderHash,
    wasmUrl: `${WALRUS_AGGREGATOR}${THRESHOLD_WASM_BLOB_ID}`,
    zkeyUrl: `${WALRUS_AGGREGATOR}${THRESHOLD_ZKEY_BLOB_ID}`,
  });

  onProgress?.("done");

  // 3. 保存秘密到 localStorage
  const secret = { value: valueStr, saltHex: bytesToHex(salt) };

  return {
    hashCommitment,
    rangeResult,
    senderHash,
    secret,
  };
}
```

### 5.4 数值序列化标准

前端必须在以下位置执行 normalizeValue：
- SubmitPrediction 组件的输入框 onChange
- preparePrediction 函数的入口
- RevealPrediction 从 localStorage 读取后

统一规则：纯数字、无前导零、零值为 "0"。

---

## Phase 6: 收尾

### 6.1 更新清单

| 文件 | 更新内容 |
|------|---------|
| README.md | 加入预测市场 Demo 说明 + 新电路 + Pyth/Walrus 整合 |
| docs/PROJECT_ANALYSIS.md | 加入第四个 Demo + threshold_range 模块 + Pyth 整合 |
| docs/SuiCryptoLib_Pitch.pptx | 加入预测市场页 |
| docs/NEXT_STEPS.md | 标记已完成项 |

### 6.2 代码审查重点

- [ ] threshold_range 电路的 min/max 边界是否正确（value == min 和 value == max 都应通过）
- [ ] public inputs 拼接顺序是否与 Circom 输出一致
- [ ] sender_hash 的 hi/lo 拆分在电路、合约、SDK 三方是否一致
- [ ] Pyth I64 类型处理是否正确
- [ ] 价格截断是否为向下截断
- [ ] Walrus 加载是否能在首次使用时正常工作（缓存行为）
- [ ] 所有 Demo 前端是否仍然正常（无 regression）
