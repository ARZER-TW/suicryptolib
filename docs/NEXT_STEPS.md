# SuiCryptoLib — 下一步完整分析文档

## 一、项目现状总结

### 已完成的内容

| 类别 | 内容 |
|------|------|
| Move 模块 | 9 个（hash_commitment, commit_reveal, merkle, merkle_poseidon, pedersen, range_proof, semaphore, groth16_poc, poseidon_poc） |
| ZK 电路 | 3 个（pedersen 8,249 约束、range_proof 7,949、semaphore 2,454） |
| SDK | hash-commitment.js + merkle.js |
| Demo | 3 个（密封拍卖、保密账户、匿名群组），全部链上真实交易 |
| 部署 | Sui Testnet |
| 测试 | 136+，0 失败 |
| 投影片 | 13 页 Pitch Deck |

### 项目的真实定位

SuiCryptoLib 不是一个隐私产品，而是 **Sui 上 ZK 开发的基础设施**。

核心价值不在于 9 个 Move 模块本身，而在于：

1. **Groth16 管线已打通** — 从 Circom 电路到 Sui 链上验证的完整路径，包括 snarkjs 格式到 Sui Arkworks 格式的转换
2. **Poseidon 一致性已验证** — circomlibjs 和 sui::poseidon 输出完全一致（5 个参考向量）
3. **管线是可扩展的** — 写任意新 Circom 电路，用同一套管线即可在 Sui 上验证，链上验证成本固定

换句话说，SuiCryptoLib 打通的是一个 **可以无限扩展的 ZK 验证平台**，不是三个固定的功能模块。

---

## 二、Sui 生态 2026 年现状（基于最新调研）

### Sui Stack

Sui 官方在 2026 年 1 月 1 日宣布「2026 is the year of the stack」，明确将三个组件作为核心战略：

| 组件 | 状态 | 做什么 |
|------|------|--------|
| **Seal** | 主网已上线（2025.9），MPC Key Server 测试网（2026.3） | 可编程加密 — 控制谁能解密数据 |
| **Walrus** | 主网已上线（2025.3），Allium 存入 65TB 数据 | 去中心化存储 |
| **Nautilus** | 主网已上线（2025.6），Bluefin 已在使用 | TEE 可信执行 — 链下保密计算 |

### Sui 隐私路线图

Sui 官方计划在 2026 年推出协议层隐私功能，明确会使用 Groth16（和 SuiCryptoLib 用的同一个验证器）。采用「分层隐私」模型 — 从基本保密到完全匿名，用户可切换。

### Sui Overflow

Sui 官方全球 hackathon。2025 届有 599 个项目提交，Infrastructure & Tooling 赛道的 ZK 方向是空白（没有 ZK 密码学工具获奖）。2026 届大概率在 Q2 举办。

### 竞争格局

**Sui 上目前没有任何与 SuiCryptoLib 直接竞争的第三方密码学工具库。** ZK 生态由官方工具（zkLogin、Groth16 verifier、Seal）主导，缺少社区层面的开发者工具。

---

## 三、SuiCryptoLib 在 Sui Stack 中的角色

Seal 管「谁能看」，Walrus 管「数据存哪」，Nautilus 管「在哪算」。三者合一的隐私基础设施中，缺少一块：**「怎么证明某件事为真，但不暴露细节」**。

SuiCryptoLib 补的就是这一块。

```
Seal   问: 「这个用户有权解密吗？」
       → SuiCryptoLib 答: 「他提供了有效的 ZK 证明，是群组成员」

Walrus 问: 「这个电路文件是正确的吗？」
       → SuiCryptoLib 答: 「可以用它生成的 proof 在链上通过 Groth16 验证」

Nautilus 问: 「TEE 算完了怎么证明结果正确？」
         → SuiCryptoLib 答: 「生成 Groth16 proof，链上验证」

Sui 链  问: 「这个 proof 有效吗？」
        → SuiCryptoLib 答: 「BN254 配对验证通过」
```

SuiCryptoLib 不是 Stack 的某一层，而是横切各层的密码学连接器。

---

## 四、具体整合方案

### 4.1 Walrus 整合（最低成本，最确定的收益）

**做什么：** 将 .zkey 文件（电路证明密钥）存储在 Walrus 去中心化存储上，前端从 Walrus 加载而非中心化服务器。

**为什么有意义：**
- Tusky（Walrus 上的文件管理器）在 2026 年 1 月关闭，但用户数据因为存在 Walrus 上仍可访问 — 证明去中心化存储的真实价值
- 电路文件放 Walrus 后，不依赖任何服务器，永远可用
- Walrus 提供 Proof-of-Availability（可用性证明），链上可验证文件完整性

**工作量：** 1-2 天

### 4.2 Seal 整合（战略价值最高）

**做什么：** 构建一个 Seal + SuiCryptoLib 的整合 Demo，展示「加密 + 证明」双层隐私。

**最佳场景 — 加密匿名投票：**
1. 投票人用 SuiCryptoLib semaphore 生成匿名 ZK 证明（证明是群组成员但不暴露身份）
2. 投票内容用 Seal 加密（投票期间没人能看到）
3. 加密后的投票数据存到 Walrus
4. 链上同时验证：ZK 证明有效 + 记录加密投票
5. 投票截止后 Seal 的时间锁策略自动允许解密

**Seal 目前的一个缺口：** Seal 能控制谁能解密，但不能验证「加密的内容是否合法」。加入 SuiCryptoLib 的 ZK 证明后，可以证明加密的内容满足某个条件（比如投票选项只能是 A/B/C），补上了 Seal 的最后一块拼图。

**工作量：** 5-7 天（需要 semaphore SDK 先封装好）

### 4.3 Nautilus 整合（高级场景）

**做什么：** 在 Nautilus TEE 中运行 snarkjs 生成 ZK 证明，替代浏览器端计算。

**适用场景：**
- AI 代理自动化操作（没有浏览器）
- 高频操作（浏览器性能不够）
- 服务端批量证明生成

**工作量：** 2-3 周

**建议：** 不急于实现，优先做 Walrus 和 Seal 整合。Nautilus 整合是长期方向。

---

## 五、电路扩展计划

SuiCryptoLib 的 Groth16 管线是一个可扩展平台。每增加一个 Circom 电路，就多一种链上可验证的能力。链上验证成本永远是固定的（一次 BN254 pairing check）。

### 新电路优先级

| 优先级 | 电路 | 证明什么 | 解锁什么场景 |
|--------|------|---------|-------------|
| **P0** | Threshold Range Proof | value >= X 或 X <= value <= Y | 信用评分、年龄验证、合规检查 |
| **P1** | Comparison Proof | 承诺 A 的值 > 承诺 B 的值 | 密封拍卖不揭示就比大小、预测市场保密结算 |
| **P1** | Encryption Correctness | 数据确实用某公钥正确加密 | Seal 深度整合 — 证明加密内容合法 |
| **P2** | Sum/Conservation Proof | 输入总和 = 输出总和 | 保密转账（证明没有凭空造币） |
| **P2** | Equality Proof | 两个承诺包含相同的值 | 跨协议余额验证 |
| **P3** | Set Non-Membership | 我不在某个黑名单中 | 合规隐私（证明不在制裁名单） |
| **P3** | Hash Preimage Proof | 知道某个哈希的原像 | 跨链原子交换 |

### 新电路如何增强现有方向

**AI 预测市场：**
- 现有能力：只能承诺预测值、证明在范围内
- 加上 Comparison Proof：不揭示预测就能判定谁更准 — 全程保密结算
- 加上 Threshold：证明预测偏差在容许范围内

**隐私游戏：**
- 现有能力：承诺-揭示（commit-reveal）
- 加上 Comparison Proof：暗牌直接比大小，不揭示手牌
- 加上 Sum Proof：证明资源守恒但不公开具体数量

**合规隐私 / AI 评分：**
- 现有能力：range proof 只能证明 [0, 2^64)
- 加上 Threshold Range Proof：证明 score >= 700、age >= 18 等任意阈值
- 加上 Set Non-Membership：证明不在黑名单上

---

## 六、链下 SDK 完善计划

目前的问题：链上模块已经完整（9 个 Move 模块），但链下工具碎片化。每个 Demo 各自实现了 prover.js 和 format-sui.js，没有统一的 SDK。

如果一个开发者想用 SuiCryptoLib，他需要去 Demo 源码里翻找复制粘贴 — 这不是一个「开发者工具」该有的体验。

### 需要做的事

| 事项 | 具体内容 | 意义 |
|------|---------|------|
| **统一 SDK 包** | 将 format-sui.js、prover 封装、identity 管理、Merkle tree 构建合并为一个 npm 包 | 开发者一行 import 就能用 |
| **格式转换 CLI** | 输入 verification_key.json，输出 Sui 格式的 VK hex | 核心价值（管线打通）的外化，任何人都能用 |
| **Move 验证器生成器** | 输入 VK，自动生成 Move 模块代码 | 开发者写自己的电路后一键生成链上验证器 |

### 为什么 SDK 是 Sui Stack 整合的前提

Sui Stack 整合（Seal + SuiCryptoLib 匿名投票等）不只是我们自己做一个 Demo，而是要让其他开发者也能基于我们的工具做类似的应用。没有封装好的 SDK，只有我们自己能做 Demo，其他人用不了。

---

## 七、应用方向分析

基于 Mysten Labs 密码学工程师 Joy 的建议（Seal + Nautilus 做 AI 相关应用），结合 SuiCryptoLib 的能力：

### 方向 1: AI 预测市场（推荐）

- AI 在 Nautilus TEE 中跑推理
- 预测结果用 Pedersen 承诺锁住（SuiCryptoLib）
- Seal 加密原始预测
- Comparison Proof 保密结算（需新电路）
- 2026 年 prediction market 是行业热点

### 方向 2: 加密匿名投票（推荐，与 Seal 最自然的整合）

- semaphore 匿名身份（SuiCryptoLib）
- Seal 加密投票内容
- Walrus 存储加密数据
- 时间锁自动揭露
- Sui 上缺少通用投票平台（类似以太坊 Snapshot 的工具不存在）

### 方向 3: 隐私游戏

- hash_commitment 做承诺-揭示游戏机制
- Comparison Proof 暗牌比大小（需新电路）
- Sui 生态游戏多（EVE Frontier 等）

### 方向 4: 合规隐私 / 选择性揭露

- Threshold Range Proof 证明属性满足条件（需新电路）
- 符合 2026 年监管趋势（欧盟 MiCA）
- Sui 官方路线图明确在做「分层隐私」

---

## 八、投 Sui Overflow 2026 的策略

### 赛道选择

**Infrastructure & Tooling** — 这是 SuiCryptoLib 的天然赛道。2025 届该赛道的 ZK 方向是空白。

### 获奖要素

根据前两届获奖模式，评审看重：
1. 解决真实问题
2. 可运行的 Demo
3. Sui 生态整合（用到 Sui 独有能力）
4. 开发者可以实际使用（有 SDK、有文档）

SuiCryptoLib 目前满足第 2 和第 3 点。需要加强第 1 和第 4 点。

### 最强叙事

> 「Sui 有原生的 Groth16 验证器，但开发者不知道怎么用。SuiCryptoLib 打通了从 Circom 到 Sui 的完整管线，提供可复用的电路库和 SDK，并与 Sui Stack（Seal + Walrus）整合。任何开发者都可以用我们的工具在 Sui 上构建 ZK 应用。」

### 必须在提交前完成的事

| 事项 | 原因 |
|------|------|
| 链下 SDK npm 包 | 否则「开发者工具」站不住 |
| 格式转换 CLI | 核心价值外化 |
| zkey 存 Walrus | 最小成本的 Sui Stack 整合 |
| 至少一个新电路（threshold range proof） | 展示平台的可扩展性 |

---

## 九、优先级路线图

### 阶段 1：补基础（1-2 周）

- 统一链下 SDK（合并三个 Demo 中重复的代码）
- 格式转换 CLI
- 清理技术债务

### 阶段 2：扩展能力（1-2 周）

- Threshold Range Proof 新电路（value >= X）
- zkey 存 Walrus
- 对应的 Move 验证器 + SDK 封装

### 阶段 3：生态整合（1-2 周）

- Seal + semaphore 整合 Demo（加密匿名投票）
- 或 AI 预测市场 Demo（如果选择这个方向）

### 阶段 4：提交 Sui Overflow + 申请 Grant

- 更新文档和 README
- 录制 Demo 视频
- 申请 Sui Foundation DeFi Moonshots（最高 $500K）

---

## 十、全景视图

```
                    SuiCryptoLib 的价值阶梯

  现在                                              未来
  ─────────────────────────────────────────────────────

  参考实现                开发者工具              生态标准
  「管线跑通了」          「npm install 即用」     「Sui ZK 应用的默认选择」

  3 个固定电路            可扩展电路库             任意新电路 + 自动化工具链
  3 个 Demo              SDK + CLI               与 Seal/Walrus/Nautilus 深度整合
  Testnet 部署           Overflow 参赛            Grant 资助 + Mainnet

       ← 你在这里                                    → 目标
```
