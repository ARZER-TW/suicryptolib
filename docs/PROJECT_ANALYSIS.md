# SuiCryptoLib - 项目完整分析文档

## 一、项目定位

**SuiCryptoLib** 是一个为 Sui 区块链提供的密码学原语库。

它解决的核心问题是：Sui 原生只提供了底层的密码学函数（SHA-256、Groth16 验证等），但缺少**可直接使用的高级密码学模块**。开发者想在 Sui 上做隐私应用（密封拍卖、匿名投票、保密转账），需要自己从零搭建 commit-reveal、Merkle 证明、Pedersen 承诺等基础设施。

SuiCryptoLib 把这些常用模式封装成即插即用的 Move 模块，让 Sui 开发者可以像用工具箱一样直接调用。

**类比：** 就像以太坊世界的 OpenZeppelin 提供了标准合约模板，SuiCryptoLib 提供的是 Sui 上的标准密码学模板。

---

## 二、项目架构

项目分为四层：

```
                    ┌─────────────────────┐
                    │   Demo Application  │ ← 第四层：示范如何使用
                    │   (密封拍卖)         │
                    └─────────┬───────────┘
                              │ 调用
                    ┌─────────┴───────────┐
                    │   TypeScript SDK    │ ← 第三层：前端集成工具
                    │   (hash, merkle)    │
                    └─────────┬───────────┘
                              │ 配合
┌───────────────────────────────────────────────────┐
│              Move 合约 (链上)                       │ ← 第二层：核心库
│  hash_commitment │ commit_reveal │ merkle          │
│  merkle_poseidon │ pedersen      │ range_proof     │
└─────────────────────────┬─────────────────────────┘
                          │ 依赖
┌─────────────────────────┴─────────────────────────┐
│              ZK 电路 (链下)                         │ ← 第一层：零知识证明
│  pedersen_commitment.circom │ range_proof_64.circom │
└───────────────────────────────────────────────────┘
```

---

## 三、完成的模块详解

### 第一层：Move 合约模块（链上执行）

#### 模块 1: hash_commitment

**做什么：** 最基础的承诺方案。把一个值加上随机盐，算出哈希，公开哈希但隐藏原值。之后可以揭示原值和盐，任何人都能验证。

**支持三种哈希算法：** SHA-256、Blake2b-256、Keccak256

**核心函数：**
- `compute(value, salt, scheme)` → 生成承诺
- `verify_opening(commitment, value, salt)` → 验证揭示是否正确
- `from_hash(hash, scheme)` → 从已有哈希重建承诺（用于跨链或前端预计算）

**安全特性：** 强制盐值至少 16 字节，防止暴力破解。

**测试覆盖：** 20 个测试，覆盖所有哈希方案、边界情况、错误输入。

---

#### 模块 2: commit_reveal

**做什么：** 在 hash_commitment 之上，提供完整的承诺-揭示游戏流程管理。

**核心概念：** 一个「回合」（Round）有三个阶段：
1. 承诺阶段 — 参与者提交哈希 + 押金
2. 揭示阶段 — 参与者公开原值和盐
3. 结束 — 未揭示者没收押金

**为什么需要押金？** 防止「承诺但不揭示」的恶意行为。如果你承诺了但不揭示，你的押金会被没收，分配给其他参与者。

**测试覆盖：** 9 个测试，覆盖完整生命周期、错误阶段操作、揭示验证失败等。

---

#### 模块 3: merkle

**做什么：** Merkle 树验证。给定一个叶子节点和一条证明路径，验证该叶子是否属于某棵 Merkle 树。

**用途举例：**
- 白名单验证（你在不在这个名单里？）
- 空投资格验证
- 投票资格验证

**支持三种哈希方案：** 与 hash_commitment 保持一致。

**安全特性：** Domain Separation — 叶子节点和内部节点使用不同的前缀哈希，防止「第二前像攻击」（伪造叶子为内部节点）。

**测试覆盖：** 23 个测试，包含 2/4/8 叶子树、不同位置、跨方案攻击防护。

---

#### 模块 4: merkle_poseidon

**做什么：** 用 Poseidon 哈希函数的 Merkle 树。Poseidon 是专门为零知识证明优化的哈希函数，在 ZK 电路中的约束数远低于 SHA-256。

**为什么需要单独的模块？** Poseidon 的接口与标准哈希不同（输入是域元素而非字节），所以不能简单复用 merkle 模块。

**关键验证：** 与 circomlib（最主流的 ZK 电路库）的 Poseidon 实现做了一致性验证，确保链上和链下计算结果完全相同。验证了 5 个参考向量。

**测试覆盖：** 19 个测试，包含 circomlib 参考值交叉验证。

---

#### 模块 5: pedersen

**做什么：** Pedersen 承诺的链上验证。Pedersen 承诺比哈希承诺更强大 — 它具有「同态性」，可以在不揭示原值的情况下对承诺做加法运算。

**工作原理：**
- 承诺 = value x G + blinding x H（椭圆曲线上的两点乘法再相加）
- G 是标准生成元，H 是 nothing-up-my-sleeve 生成元（用 SHA-256 推导，可审计）
- 证明用 Groth16 零知识证明，链上只需验证证明

**Groth16 桥接：** 因为 Sui Move 没有原生的椭圆曲线运算（BabyJubJub），我们用 Circom 在链下生成证明，然后用 Sui 的内置 `groth16::verify` 在链上验证。这是一个重要的架构决策。

**测试覆盖：** 6 个测试，包含有效证明、错误发送者、篡改承诺。

---

#### 模块 6: range_proof

**做什么：** 证明 Pedersen 承诺中的值在 [0, 2^64) 范围内，不揭示具体数值。

**为什么需要？** 在保密转账场景中，你需要证明「我转的金额不是负数」。如果没有范围证明，攻击者可以承诺一个负数金额来凭空造币。

**关键设计：** 范围证明电路**内嵌**了 Pedersen 承诺计算，两者共用同一个 `value` 信号。这防止了「绑定脱钩攻击」 — 攻击者不能用一个值生成 Pedersen 证明、用另一个值生成范围证明。

**测试覆盖：** 6 个测试，包含值=0、值=2^64-1 的边界测试，以及 Pedersen 证明与 Range Proof 的 VK 隔离测试。

---

#### 辅助模块: groth16_poc、poseidon_poc

**做什么：** 验证概念（Proof of Concept），证明 Sui 链上的 Groth16 验证和 Poseidon 哈希可以正确工作，并建立了 snarkjs → Sui 的格式转换管线。

---

### 第二层：ZK 电路（链下证明生成）

#### pedersen_commitment.circom

- **约束数：** 8,249
- **功能：** 证明知道 (value, blinding) 使得 commitment = value x G + blinding x H
- **生成元 H：** 用 SHA-256("SuiCryptoLib_Pedersen_H_v1") 的 try-and-increment 方法推导，完全可审计

#### range_proof_64.circom

- **约束数：** 7,949
- **功能：** 内嵌 Pedersen 承诺 + Num2Bits(64) 位分解
- **安全性：** value >= 2^64 时 Num2Bits 会拒绝（无法生成有效 witness）

两个电路都经过了完整的 Trusted Setup（Powers of Tau 15 + Phase 2 贡献）。

---

### 第三层：TypeScript SDK（前端集成）

#### hash-commitment.js

- `computeCommitment(value, salt, scheme)` — 与 Move 合约完全一致的承诺计算
- `verifyOpening(commitment, value, salt)` — 本地验证
- `generateSalt(length)` — 密码学安全的随机盐生成
- 13 个测试，与 Move 合约的输出做了交叉验证

#### merkle.js

- `StandardMerkleTree` — SHA-256/Blake2b/Keccak 的 Merkle 树
- `PoseidonMerkleTree` — Poseidon Merkle 树（需要 circomlibjs）
- 生成 proof、验证 proof、与链上完全兼容
- 21 个测试

---

### 第四层：Demo 应用（密封拍卖）

#### 链上合约 (sealed_auction.move)

**完整的拍卖生命周期：**

1. **创建拍卖** — 任何人可以创建，设定承诺截止时间、揭示截止时间、最低押金
2. **密封出价** — 竞标者在浏览器中计算 SHA-256(金额 || 随机盐值)，只把哈希和押金发送到链上。金额和盐值保存在本地浏览器
3. **揭示出价** — 竞标者发送金额和盐值到链上，合约调用 `hash_commitment::verify_opening()` 验证哈希匹配
4. **结算** — 最高揭示出价者获胜，失败者退还押金，未揭示者没收押金

**调用了哪些 Library 函数：**
- `hash_commitment::from_hash()` — 从前端预计算的哈希创建链上承诺对象
- `hash_commitment::verify_opening()` — 揭示时验证哈希匹配

#### 前端 (React + Vite + Tailwind)

- 真实钱包连接（Sui Wallet / Slush）
- 每个操作都是签名交易，链上执行
- 实时链上状态轮询（每 3 秒）
- 倒计时显示
- 出价秘密保存在 localStorage（不上链）
- 预检验证：揭示前本地重算哈希，防止不匹配导致押金损失

---

## 四、已部署的链上地址

| 合约 | Testnet Package ID |
|------|-------------------|
| SuiCryptoLib | `0x738433a8c905c57314cd2a9f8f4a2eb254cf45958d1694e9f0d9a7dc35a09490` |
| Sealed Auction | `0x0e500f771f6453e3943ae40167329880b9ae495ceba7d713220f41d6af5edeee` |

---

## 五、测试统计

| 层 | 测试数 | 状态 |
|----|--------|------|
| Move 合约 (Library) | 90 | 全过 |
| Move 合约 (Auction) | 4 | 全过 |
| TypeScript SDK | 34 | 全过 |
| ZK 电路 (本地验证) | 4 vectors | 全过 |
| E2E 链上验证 | 已在 testnet 完成完整流程 | 通过 |

---

## 六、关键技术决策及其原因

### 决策 1: 为什么用 Groth16 桥接而不是原生 Move 实现？

Sui Move 没有 BabyJubJub 椭圆曲线的原生运算。Pedersen 承诺需要椭圆曲线标量乘法，如果用纯 Move 实现，gas 成本会极高且代码复杂。

**解决方案：** 在 Circom 中实现密码学运算，用 snarkjs 生成 Groth16 证明，利用 Sui 内置的 `sui::groth16::verify_groth16_proof()` 在链上验证。这样链上只需要一次 pairing check，gas 成本固定且低。

### 决策 2: 为什么 Generator H 用 nothing-up-my-sleeve 方法？

Pedersen 承诺需要两个生成元 G 和 H。如果 H 的离散对数（相对于 G）已知，承诺的绑定性就被打破。

**解决方案：** H 通过 SHA-256("SuiCryptoLib_Pedersen_H_v1") + try-and-increment 推导，整个过程可复现、可审计，没有人知道 H 相对于 G 的离散对数。

### 决策 3: 为什么 Range Proof 内嵌 Pedersen 而不是独立？

如果范围证明和 Pedersen 承诺是两个独立电路，攻击者可以用值 A 生成 Pedersen 证明，用值 B 生成范围证明，然后把两个证明组合。链上无法发现值不同。

**解决方案：** 范围证明电路内嵌了 Pedersen 承诺计算，共用同一个 `value` 信号线。一个证明同时证明两件事，不可能拆分。

### 决策 4: 为什么前端的 hash 不在链上计算？

如果调用 `hash_commitment::compute(value, salt, scheme)` 在链上计算承诺，`value` 和 `salt` 会出现在交易数据中 — 任何人都能在链上看到你的出价金额。

**解决方案：** 前端用 Web Crypto API 计算 SHA-256，只把 32 字节的哈希发送到链上（通过 `from_hash()`）。金额和盐值永远不出现在链上数据中。

### 决策 5: 为什么 Poseidon 需要单独的 Merkle 模块？

Poseidon 哈希的输入是 BN254 域元素（大整数），不是任意字节。它的接口是 `poseidon::poseidon_bn254(vector<u256>)`，与标准哈希函数 `sha2_256(vector<u8>)` 完全不同。

**解决方案：** 创建 `merkle_poseidon` 模块，专门处理 Poseidon 的输入/输出格式，并提供 Semaphore 协议所需的辅助函数。

---

## 七、项目结构

```
suicryptolib/
├── move/                          # 核心库（链上）
│   └── sources/
│       ├── hash_commitment.move   # 哈希承诺 (20 tests)
│       ├── commit_reveal.move     # 承诺-揭示管理 (9 tests)
│       ├── merkle.move            # Merkle 树验证 (23 tests)
│       ├── merkle_poseidon.move   # Poseidon Merkle (19 tests)
│       ├── pedersen.move          # Pedersen 承诺 (6 tests)
│       ├── range_proof.move       # 范围证明 (6 tests)
│       ├── groth16_poc.move       # Groth16 PoC (2 tests)
│       └── poseidon_poc.move      # Poseidon PoC (5 tests)
│
├── circuits/                      # ZK 电路（链下）
│   ├── pedersen/
│   │   ├── pedersen_commitment.circom  # 8,249 约束
│   │   └── test_prove.mjs
│   ├── range_proof/
│   │   ├── range_proof_64.circom       # 7,949 约束
│   │   └── test_prove.mjs
│   └── poc/
│       └── multiplier.circom           # PoC 电路
│
├── sdk/                           # TypeScript SDK
│   └── src/
│       ├── hash-commitment.js     # 13 tests
│       └── merkle.js              # 21 tests
│
├── scripts/
│   └── compute_generator_h.mjs   # Generator H 推导（可审计）
│
└── examples/
    └── sealed_auction/            # Demo 应用
        ├── move/                  # 拍卖合约 (4 tests)
        └── frontend/             # React 前端
```

---

## 八、项目的价值主张

### 对 Sui 生态的价值

1. **降低门槛** — 开发者不需要是密码学专家，就能在 Sui 上构建隐私应用
2. **标准化** — 提供经过测试和审计的标准实现，避免每个项目自己造轮子
3. **互操作性** — 所有模块使用一致的接口，与 circomlib 兼容，支持跨平台验证

### 可能的应用场景

| 场景 | 使用的模块 |
|------|-----------|
| 密封拍卖 | hash_commitment + commit_reveal |
| 匿名投票 | merkle_poseidon + commit_reveal |
| 保密转账 | pedersen + range_proof |
| 空投白名单 | merkle |
| 暗池交易 | pedersen + range_proof + merkle |
| 身份证明 | merkle_poseidon (Semaphore 模式) |

---

## 九、与同类项目的差异化

| 特性 | SuiCryptoLib | 以太坊类似方案 |
|------|-------------|---------------|
| 承诺方案 | 3 种哈希 + Pedersen | 通常只有 keccak |
| Merkle 树 | 标准 + Poseidon 双版本 | 通常只有一种 |
| ZK 证明 | Groth16 桥接已完成 | 依赖外部合约 |
| Poseidon 一致性 | 与 circomlib 交叉验证 | 各自实现不保证一致 |
| 范围证明 | 内嵌 Pedersen（防脱钩） | 通常独立证明 |

---

## 十、面向 Sui 工程师的技术说明

> 本节面向熟悉 Sui、会写 Move 的工程师，用技术语言说明 SuiCryptoLib 到底做了什么、怎么做的、为什么这样做。

### 10.1 Sui 原生提供了什么 vs SuiCryptoLib 补了什么

Sui Framework 提供的是**原始工具**：

| Sui 原生 | 能力 | 限制 |
|----------|------|------|
| `std::hash::sha2_256` | 算 SHA-256 | 只是一个哈希函数，不管 commitment 语义 |
| `sui::hash::keccak256` / `blake2b256` | 其他哈希 | 同上 |
| `sui::groth16::verify_groth16_proof` | 验证 Groth16 证明 | 只做 pairing check，不管电路逻辑 |
| `sui::poseidon::poseidon_bn254` | 算 Poseidon 哈希 | 输入是 `vector<u256>` 域元素，不是字节 |

SuiCryptoLib 补的是**组合模式**：

```move
// 没有 SuiCryptoLib：你得自己拼
let mut data = vector::empty<u8>();
vector::append(&mut data, value);
vector::append(&mut data, salt);
assert!(vector::length(&salt) >= 16, ESaltTooShort); // 自己记得检查
let hash = std::hash::sha2_256(data);
// 然后自己定义 Commitment struct、自己管理 scheme 选择...

// 有 SuiCryptoLib：
use suicryptolib::hash_commitment;
let commitment = hash_commitment::compute(value, salt, 0);
let valid = hash_commitment::verify_opening(&commitment, value, salt);
```

这只是最简单的例子。往上还有 Merkle proof 验证（含 domain separation 防第二前像攻击）、Poseidon Merkle（与 circomlib 一致的参数）、以及 Pedersen commitment 和 Range proof（走 Groth16 桥接到 Circom 电路）。

### 10.2 Groth16 桥接架构

Sui Move 没有 BabyJubJub 曲线运算。Pedersen 和 Range Proof 需要椭圆曲线标量乘法，纯 Move 实现的 gas 成本不可接受。

解决方案是 **Circom → snarkjs → Sui Groth16** 管线：

```
链下 (用户浏览器/服务端)                    链上 (Sui Move)
┌─────────────────────────┐               ┌────────────────────────────┐
│ Circom 电路              │               │ pedersen.move              │
│  - EscalarMulFix(253, G) │  snarkjs      │                            │
│  - EscalarMulFix(253, H) │ fullProve()   │  verify_commitment_proof() │
│  - BabyAdd               │ ──────────→   │    groth16::verify(        │
│  - Num2Bits(64)          │  proof bytes  │      &pvk, &inputs, &proof │
│                          │               │    )                       │
└─────────────────────────┘               └────────────────────────────┘
```

**格式转换**是最关键的工程难点。snarkjs 输出非压缩 affine 坐标（JSON 大整数），Sui 要的是 Arkworks compressed 格式：

- **G1 点**：32 bytes，x 坐标 little-endian，最高位存 y 的符号位
- **G2 点**：64 bytes，Fp2 的 c0 和 c1 分量各 32 bytes LE
- **VK 布局**：alpha(G1, 32B) + beta(G2, 64B) + gamma(G2, 64B) + delta(G2, 64B) + IC_count(u64 LE, 8B) + IC_points(N x G1)
- **Proof 布局**：pi_a(G1, 32B) + pi_b(G2, 64B) + pi_c(G1, 32B) = 固定 128 bytes
- **Public inputs**：每个信号 32 bytes LE（BN254 标量域元素）

这套转换在 `circuits/poc/format_for_sui.mjs` 中建立，经过 PoC 验证后用于 Pedersen 和 Range Proof 的生产电路。

### 10.3 Poseidon 一致性问题

Poseidon 哈希有很多参数变体（t 值、round 数 RF/RP、MDS 矩阵、S-box 指数）。circomlib 用的参数组和 Sui 内置的 `poseidon_bn254` 必须完全一致，否则链上链下的 Merkle root 对不上。

验证方法：用 circomlib 的 `buildPoseidon()` 计算 5 个参考向量（1 到 5 个输入），然后在 Move 测试中用 `sui::poseidon::poseidon_bn254()` 算同样的输入，`assert!` 结果相等。

```move
// poseidon_poc.move 中的一个测试
#[test]
fun test_poseidon_single_input() {
    let input = vector[1u256];
    let result = poseidon::poseidon_bn254(&input);
    // 这个值来自 circomlib JS: buildPoseidon()([1])
    assert!(result == 18586133768512220936620570745912940619677854269274689475585506675881198879027u256, 0);
}
```

5 个值全部匹配，确认 Sui 和 circomlib 用的是同一组 Poseidon 参数。

### 10.4 Demo 中的链上调用链

密封拍卖的每个用户操作对应的链上调用：

**出价（Programmable Transaction Block）：**

```typescript
const tx = new Transaction();

// Step 1: 前端已在浏览器用 crypto.subtle.digest("SHA-256") 算好 hash
// hash 是 SHA-256(amount_string || salt_32bytes)，共 32 bytes

// Step 2: PTB 第一条指令 — 创建 Commitment 对象（不是 Sui object，是纯值）
const [commitment] = tx.moveCall({
  target: `${LIB}::hash_commitment::from_hash`,
  arguments: [
    tx.pure(bcs.vector(bcs.u8()).serialize(hashBytes)),  // 32 bytes hash
    tx.pure(bcs.u8().serialize(0)),                       // scheme=SHA256
  ],
});

// Step 3: PTB 第二条指令 — 从 gas coin 分出押金
const [deposit] = tx.splitCoins(tx.gas, [
  tx.pure(bcs.u64().serialize(minDepositMist)),
]);

// Step 4: PTB 第三条指令 — 调用 place_bid
// commitment 是 Step 2 的返回值（Commitment struct，非 object）
// deposit 是 Step 3 的返回值（Coin<SUI>）
tx.moveCall({
  target: `${AUCTION}::auction::place_bid`,
  arguments: [
    tx.object(auctionId),     // Auction 共享对象
    commitment,                // 纯值传递，不是 object reference
    deposit,                   // Coin<SUI>
    tx.object("0x6"),          // Clock 共享对象
  ],
});

// 一个 PTB，三条指令，一次签名
await signAndExecute({ transaction: tx });
```

**揭示：**

```typescript
const tx = new Transaction();
tx.moveCall({
  target: `${AUCTION}::auction::reveal_bid`,
  arguments: [
    tx.object(auctionId),
    tx.pure(bcs.vector(bcs.u8()).serialize(valueBytes)),  // "500" → [53,48,48]
    tx.pure(bcs.vector(bcs.u8()).serialize(saltBytes)),    // 32 bytes 原始盐
    tx.object("0x6"),
  ],
});
// Move 内部: hash_commitment::verify_opening(&commitment, value, salt)
// 重算 sha2_256(value || salt)，比对链上存的 hash
```

**关键安全属性：** 出价时 `value` 和 `salt` 只存在于浏览器 localStorage，不出现在任何交易数据中。链上只有 32 bytes SHA-256 hash。揭示时 `value` 和 `salt` 才上链，此时承诺阶段已结束，其他人看到也无法修改自己的出价。

### 10.5 Commitment 类型在 PTB 中的传递

`Commitment` struct 的定义：

```move
public struct Commitment has store, copy, drop {
    hash: vector<u8>,
    scheme: u8,
}
```

它有 `store + copy + drop`，**没有 `key`**，所以不是 Sui object。在 PTB 中，`from_hash()` 的返回值是一个纯值（pure value），可以直接作为下一条 `moveCall` 的参数传递。SDK 中用 `const [commitment] = tx.moveCall(...)` 解构取第一个返回值。

### 10.6 为什么不能用 `compute()` 在链上算 hash？

```move
// 如果在 PTB 中调用 compute()：
tx.moveCall({
  target: `${LIB}::hash_commitment::compute`,
  arguments: [
    tx.pure(bcs.vector(bcs.u8()).serialize("500")),  // ← 金额明文！
    tx.pure(bcs.vector(bcs.u8()).serialize(salt)),    // ← 盐值明文！
    tx.pure(bcs.u8().serialize(0)),
  ],
});
```

交易数据是公开的。任何人检查这笔交易的 `input_objects` 就能看到 `"500"` 和 `salt`。承诺的隐藏性完全失效。

所以必须在客户端算好 hash，只传 hash 上链：

```move
// 正确做法：浏览器算 hash，链上只存 hash
from_hash(hash_bytes, 0)  // 链上只看到 32 bytes 的 hash，无法反推
```

`from_hash()` 这个函数就是为这个场景设计的 — 让客户端预计算 hash，链上只做存储和后续验证。

---

## 十一、未完成的工作（Remaining Work）

| 项目 | 状态 | 说明 |
|------|------|------|
| Semaphore | 未开始 | 匿名群组成员证明（stretch goal） |
| SDK pedersen/range_proof | 部分 | 浏览器中的 snarkjs 证明生成 |
| 投影片 | 未开始 | Hackathon 展示用 |
| Demo 前端美化 | 可改进 | 基本功能完成但细节可打磨 |

---

## 十二、Git 历程

| Commit | 里程碑 |
|--------|--------|
| `86af030` | Phase 0: Groth16 PoC + Poseidon 一致性验证 |
| `00a7c28` | Module 1: hash_commitment + commit_reveal |
| `2cf9a98` | Module 2: merkle + merkle_poseidon |
| `d5040bc` | SDK: hash-commitment.js + merkle.js |
| `66bc0cb` | Module 3: Pedersen 承诺 (Circom + Move) |
| `1c2fb73` | Module 4: Range Proof (Circom + Move) |
| `fae59f9` | Demo: 密封拍卖 (合约 + 前端) |
| `2cee807` | 重构: 前端改为真实链上交易 |
| `bc0cd02` | 部署到 Sui testnet |
| `54fdb0f` | 修复: Phase 推进 + 多个 UX bug |

**GitHub:** https://github.com/ARZER-TW/suicryptolib
