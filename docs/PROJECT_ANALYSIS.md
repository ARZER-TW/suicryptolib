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

> 本节面向熟悉 Sui、会写 Move 的工程师，说明 SuiCryptoLib 到底做了什么、怎么做的、为什么这样做。

### 10.1 Sui 原生提供了什么 vs SuiCryptoLib 补了什么

Sui Framework 提供的是原始密码学函数：SHA-256、Blake2b、Keccak256 的哈希运算，Groth16 证明的 pairing 验证，以及 Poseidon 哈希。但这些只是最底层的「零件」— 就像有了螺丝和钢板，但没有预制好的桥梁构件。

开发者想做一个密封拍卖，他需要的不是「一个 SHA-256 函数」，而是「一个完整的承诺-揭示方案」：包含承诺的数据结构、盐值长度的安全检查、多种哈希方案的切换、揭示时的验证逻辑。如果每个项目都自己从哈希函数开始搭，重复工作量大，而且很容易犯安全错误（比如忘记检查盐值长度、没做 domain separation）。

SuiCryptoLib 把这些常见的密码学模式封装成了现成的 Move 模块。开发者只需要引入依赖，一行调用就能完成承诺的生成和验证，不需要关心底层的字节拼接、哈希选择、安全检查。

### 10.2 Groth16 桥接架构

Sui Move 虚拟机没有 BabyJubJub 椭圆曲线的原生运算。但 Pedersen 承诺和范围证明都需要在这条曲线上做标量乘法和点加法。如果用纯 Move 实现椭圆曲线运算，gas 成本会非常高，代码也极其复杂。

我们的解决方案是利用 Sui 内置的 Groth16 验证器作为桥梁。具体流程是：在 Circom（一种零知识证明电路语言）中编写椭圆曲线运算逻辑，用 snarkjs 在链下生成零知识证明，然后把证明提交到 Sui 链上，由 Sui 原生的 Groth16 验证函数来验证。这样链上只需要做一次 pairing check（固定的、低成本的运算），所有复杂的椭圆曲线运算都在链下完成。

这个方案中最大的工程难点是格式转换。snarkjs 输出的证明格式是非压缩的仿射坐标（以 JSON 大整数表示），而 Sui 的 Groth16 验证器期望的是 Arkworks 库的压缩格式（little-endian 字节序，Y 坐标的符号位编码在最高位）。我们实现了完整的格式转换工具，先在一个简单的乘法电路上验证通过，再应用到 Pedersen 和 Range Proof 的生产电路上。

### 10.3 Poseidon 一致性验证

Poseidon 是一种专门为零知识证明优化的哈希函数，它在 ZK 电路中的约束数远低于 SHA-256。但 Poseidon 有大量参数变体 — 不同的 round 数、不同的 MDS 矩阵、不同的 S-box 指数。如果链上用的 Poseidon 参数和 ZK 电路用的不一致，那么链下生成的 Merkle root 和链上计算的就会对不上，整个系统就无法工作。

我们的验证方法很直接：用 circomlib（ZK 电路生态中最主流的库）的 Poseidon 实现计算了 5 组参考值（分别是 1 到 5 个输入元素的哈希结果），然后在 Move 测试中用 Sui 内置的 Poseidon 函数计算同样的输入，断言两边结果完全相等。5 组全部匹配，确认了 Sui 和 circomlib 使用的是同一组 Poseidon 参数。这个一致性是 merkle_poseidon 模块能够工作的基础。

### 10.4 Demo 中的链上调用流程

密封拍卖 Demo 展示了 SuiCryptoLib 在真实应用中的使用方式。每个用户操作背后都是真实的 Sui 链上交易。

**出价过程：** 前端在用户的浏览器中用 Web Crypto API 计算出价金额和随机盐值的 SHA-256 哈希。然后构建一个 Programmable Transaction Block（Sui 的批量交易机制），在一笔交易中完成三件事：调用 SuiCryptoLib 的 from_hash 函数把哈希包装成 Commitment 数据结构，从 gas coin 中分出押金，最后调用拍卖合约的 place_bid 函数把 Commitment 和押金一起存入链上的 Auction 对象。整个过程只需要用户签名一次。

**揭示过程：** 前端从浏览器的本地存储中取出之前保存的金额和盐值，发送到链上。拍卖合约内部调用 SuiCryptoLib 的 verify_opening 函数，重新计算 SHA-256(金额 || 盐值)，然后和链上存储的哈希进行比对。如果匹配，揭示成功，记录出价金额；如果不匹配，交易回滚。

**安全保证：** 出价时，金额和盐值只存在于用户的浏览器本地存储中，完全不出现在链上交易数据里。链上只有 32 字节的 SHA-256 哈希值，任何人都无法从哈希反推出原始金额。直到揭示阶段，金额才上链 — 但此时承诺阶段已经结束，所有人的承诺都已锁定，看到别人的金额也无法修改自己的出价。

### 10.5 Commitment 的数据类型设计

SuiCryptoLib 中的 Commitment 是一个带有 store、copy、drop 能力的 struct，而不是一个 Sui object（没有 key 能力）。这个设计是刻意的。

作为非 object 的纯值类型，Commitment 可以被嵌入到其他 Sui object 中（比如拍卖合约的 Bid 结构），也可以在 Programmable Transaction Block 中作为中间值在多条指令之间传递。如果把它设计成 Sui object，每次创建都需要一个独立的链上对象，增加存储成本，也让 PTB 的组合变得更复杂。

### 10.6 为什么需要 from_hash 函数

SuiCryptoLib 同时提供了 compute 和 from_hash 两个函数来创建 Commitment。compute 接受原始值和盐值，在链上计算哈希；from_hash 接受一个已经算好的哈希值。

在隐私场景中，必须使用 from_hash 而不是 compute。原因是 Sui 上的所有交易数据都是公开的。如果调用 compute 把金额和盐值作为交易参数传入，任何人查看这笔交易的输入数据就能直接看到明文金额，承诺方案的隐藏性就完全失效了。

from_hash 的设计就是为了解决这个问题：让客户端在本地计算好哈希，只把 32 字节的哈希结果发到链上。链上存储的只有哈希，无法反推原始值。之后揭示时，verify_opening 函数会用同样的算法重新计算哈希，验证是否匹配。

这两个函数的存在反映了一个重要的架构原则：链上计算用于透明场景（比如合约间调用），链下预计算用于隐私场景（比如密封出价）。SuiCryptoLib 同时支持这两种模式。

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
