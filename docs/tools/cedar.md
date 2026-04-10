# Cedar 策略语言入门

> 整理日期：2026-04-10
> 仓库地址：https://github.com/cedar-policy/cedar
> 版本：v4.10.0 | Cedar 语言版本 4.5
> 官方文档：https://docs.cedarpolicy.com

## 项目简介

**Cedar** 是由 AWS 开源的策略语言和授权引擎，专门为应用程序的细粒度权限控制设计。你用 Cedar 写策略（policies），应用调用 Cedar 引擎来判断"这个请求是否被允许"。

为什么值得关注：
- **AWS Verified Permissions** 的底层引擎就是 Cedar——这不是个玩具项目，是 AWS 生产级服务的核心
- 支持 **Automated Reasoning**（自动化推理），可以用形式化方法证明你的安全模型是否符合预期
- **默认拒绝 + 显式拒绝覆盖允许**，安全模型天然保守

Cedar 的定位：**不是通用编程语言，而是一门目的明确的 DSL（Domain-Specific Language）**，只做一件事——描述授权策略。

## 核心概念：PARC 模型

Cedar 的每个授权请求都围绕四个要素：

| 要素 | 含义 | 示例 |
|------|------|------|
| **P**rincipal | 谁在请求 | `User::"alice"` |
| **A**ction | 要执行什么操作 | `Action::"view"` |
| **R**esource | 操作的目标对象 | `Photo::"beach.jpg"` |
| **C**ontext | 请求上下文 | `{ ip: "10.0.0.1", time: "..." }` |

每个实体（Entity）有三个属性：
- **类型 + ID**：如 `User::"alice"`
- **属性（attrs）**：如 `age: 25, banned: false`
- **父级（parents）**：支持层级结构，如 `Photo` 属于 `Album`，`User` 属于 `Group`

## 策略语法

### 基本结构

```cedar
// permit 或 forbid
permit (
  principal == User::"alice",      // 谁
  action == Action::"view",        // 做什么
  resource in Album::"vacation"    // 对什么
)
when {                              // 附加条件（可选）
  principal.age >= 18
}
unless {                            // 排除条件（可选）
  principal.banned == true
};
```

### 核心语法要点

**1. 效果（Effect）**
- `permit` — 允许匹配的请求
- `forbid` — 拒绝匹配的请求
- **关键规则**：forbid 永远覆盖 permit（显式拒绝 > 允许）

**2. 作用域（Scope）**
```cedar
principal                              // 匹配任何主体
principal == User::"alice"             // 精确匹配
principal in Group::"admins"           // 层级匹配（alice 在 admins 组中）
principal is User                      // 类型匹配
principal is User in Group::"admins"   // 类型 + 层级

action == Action::"view"               // 单个动作
action in [Action::"view", Action::"comment"]  // 多个动作

resource in Album::"vacation"          // 资源在 Album 层级下
```

**3. 条件子句**
- `when { ... }` — 条件为 true 时策略生效
- `unless { ... }` — 条件为 true 时策略**不**生效
- 可以引用 `principal`、`resource`、`context` 的属性
- 支持 `&&`、`||`、`!`、`has`、`like`、`in` 等操作符

**4. 注解（Annotations）**
```cedar
@id("admin-policy")
@description("Grant admin full access")
permit ( ... );
```

### 授权决策逻辑

```
1. 收集所有匹配请求的策略
2. 如果任何 forbid 策略匹配 → DENY（显式拒绝，不可覆盖）
3. 如果至少一个 permit 策略匹配且没有 forbid → ALLOW
4. 如果没有任何 permit 匹配 → DENY（隐式拒绝，默认安全）
```

这意味着：
- 空策略集 = 全部拒绝
- 一个 forbid 可以覆盖一千个 permit

## 引擎架构

Cedar 是一个 Rust workspace，包含以下 crate：

```
cedar-policy/               # 公共 API（用户直接依赖这个）
├── Authorizer              # 授权引擎入口
├── PolicySet               # 策略集合
├── Request                 # 授权请求
├── Entities                # 实体数据
└── Schema/Validator        # 模式定义与验证

cedar-policy-core/           # 内部核心实现
├── parser/                  # 解析器
│   ├── text_to_cst.rs      #   Cedar 文本 → CST（具体语法树）
│   ├── cst_to_ast.rs       #   CST → AST（抽象语法树）
│   └── ...
├── ast/                     # AST 定义
│   ├── policy.rs           #   策略 AST 节点
│   ├── expr.rs             #   表达式 AST
│   ├── entity.rs           #   实体模型
│   └── ...
├── evaluator.rs             # 表达式求值器
├── authorizer.rs            # 授权逻辑（核心！）
├── validator/               # 策略验证器
│   ├── schema.rs           #   Schema 解析
│   ├── typecheck.rs        #   类型检查
│   └── rbac.rs             #   RBAC 验证规则
├── est/                     # EST（可交换语法树，JSON 格式）
├── extensions/              # 内置扩展函数
│   ├── ipaddr.rs           #   IP 地址操作
│   ├── decimal.rs          #   小数操作
│   └── datetime.rs         #   日期时间操作
└── entities/                # 实体加载与验证

cedar-policy-cli/            # CLI 工具
cedar-policy-formatter/      # 代码格式化器
cedar-policy-symcc/          # 符号化条件编译（实验性）
cedar-wasm/                  # WebAssembly 绑定
cedar-language-server/       # LSP 语言服务器
```

### 请求处理流程

```
策略文本 (.cedar)
    ↓ text_to_cst
具体语法树 (CST)
    ↓ cst_to_ast
抽象语法树 (AST)
    ↓ [可选] Validator.validate()
验证通过的 PolicySet
    ↓ Authorizer.is_authorized(request, policies, entities)
    ↓   对每个策略：Evaluator 求值 scope + conditions
    ↓   收集所有 permit/forbid 结果
    ↓   forbid > permit > 默认 deny
Authorization Decision (ALLOW / DENY)
```

### 错误处理策略

Cedar 采用 **Skip 模式**：如果某个策略在评估时遇到错误（比如引用了不存在的属性），该策略被跳过，不影响其他策略的评估。这是一个安全的设计选择——不确定的策略不会意外放行。

## 与 AWS Verified Permissions 的关系

[AWS Verified Permissions](https://aws.amazon.com/verified-permissions/) 是基于 Cedar 的托管授权服务：

| 对比 | Cedar（开源） | AWS Verified Permissions |
|------|--------------|------------------------|
| 运行环境 | 嵌入你的应用 | AWS 托管服务 |
| 策略存储 | 你自己管理 | AWS 管理（Policy Store） |
| 与 IdP 集成 | 自行实现 | 原生支持 Cognito |
| Schema 管理 | 文件/代码 | 控制台 UI + API |
| 策略分析 | 开源工具 | 内置分析能力 |
| 适用场景 | 嵌入式、自托管 | 云原生应用 |

简单说：**Cedar 是引擎，Verified Permissions 是基于这个引擎的 SaaS 产品**。

如果你已经在用 AWS，直接用 Verified Permissions 更方便；如果需要自托管或非 AWS 环境，直接用 Cedar SDK。

## Rust SDK 快速上手

### 安装

```toml
[dependencies]
cedar-policy = "4.10"
```

### 最小示例

```rust
use cedar_policy::*;

fn main() {
    // 1. 定义策略
    let policy_src = r#"
        permit(
            principal == User::"alice",
            action == Action::"view",
            resource == File::"93"
        );
    "#;
    let policies: PolicySet = policy_src.parse().unwrap();

    // 2. 构造请求
    let principal = r#"User::"alice""#.parse().unwrap();
    let action = r#"Action::"view""#.parse().unwrap();
    let resource = r#"File::"93""#.parse().unwrap();
    let request = Request::new(principal, action, resource, Context::empty(), None).unwrap();

    // 3. 评估授权
    let entities = Entities::empty();
    let authorizer = Authorizer::new();
    let response = authorizer.is_authorized(&request, &policies, &entities);

    println!("{:?}", response.decision()); // → Allow
}
```

### 带 Schema 验证

```rust
use cedar_policy::*;

// Cedar schema 定义
let schema_src = r#"
    entity User;
    entity File;
    action "view" appliesTo { principal: [User], resource: [File] };
"#;
let schema = Schema::from_cedarschema_str(schema_src).unwrap();

// 验证策略是否符合 schema
let validator = Validator::new(schema);
let result = validator.validate(&policies, ValidationMode::default());

if result.validation_passed() {
    println!("策略验证通过！");
}
```

### 核心 API 概览

| API | 作用 |
|-----|------|
| `PolicySet::from_str()` | 解析 Cedar 策略文本 |
| `Authorizer::is_authorized()` | 执行授权决策 |
| `Response::decision()` | 获取 Allow/Deny 结果 |
| `Response::diagnostics()` | 获取决策原因（哪些策略匹配） |
| `Validator::validate()` | 验证策略是否符合 Schema |
| `Entities::from_json_str()` | 从 JSON 加载实体数据 |
| `Schema::from_cedarschema_str()` | 从 Cedar schema 格式加载 |

## Demo 示例

以下 demo 展示了 Cedar 的核心能力：RBAC、ABAC、permit/forbid、when/unless 的组合使用。

### 策略文件 (`policies.cedar`)

```cedar
// 策略 1: RBAC - 管理员全权限
@id("admin-full-access")
permit (
  principal in Group::"admins",
  action,
  resource
);

// 策略 2: RBAC - alice 可查看和评论度假相册
@id("alice-vacation-access")
permit (
  principal == User::"alice",
  action in [Action::"view", Action::"comment"],
  resource in Album::"jane_vacation"
);

// 策略 3: ABAC + when - 仅成年用户可上传
@id("adult-upload-only")
permit (
  principal,
  action == Action::"upload",
  resource
)
when {
  principal.age >= 18
};

// 策略 4: forbid + when + unless - 私有资源保护
@id("private-resource-deny")
forbid (
  principal,
  action,
  resource
)
when {
  resource.private == true
}
unless {
  principal == resource.owner
};

// 策略 5: forbid + when - 封禁用户（覆盖所有 permit）
@id("banned-user-deny")
forbid (
  principal,
  action,
  resource
)
when {
  principal.banned == true
};
```

### 运行结果

```
场景1: alice view beach.jpg (RBAC permit)      → ALLOW ✅
  alice 有 jane_vacation 相册的 view 权限

场景2: alice delete beach.jpg (no permission)   → DENY ✅
  alice 只有 view 和 comment 权限，delete 不在列表中

场景3: jane(admin) delete beach.jpg             → ALLOW ✅
  jane 在 admins 组，admin-full-access 策略生效

场景4: alice(age=25) upload                     → ALLOW ✅
  alice.age=25 >= 18，满足 when 条件

场景5: bob(age=16) upload                       → DENY ✅
  bob.age=16 < 18，when 条件不满足

场景6: alice view passport.jpg (private)        → DENY ✅
  passport.jpg.private=true 触发 forbid，alice 不是 owner

场景7: jane view passport.jpg (owner)           → ALLOW ✅
  虽然 private=true 触发 forbid 的 when，但 jane==owner 触发 unless 排除

场景8: charlie(banned admin) view               → DENY ✅
  charlie 虽是 admin（permit），但 banned=true 的 forbid 覆盖一切
```

**场景 8 是最有趣的**：它展示了 Cedar 的核心安全保证——`forbid` 永远胜出。即使 charlie 是管理员（匹配了 admin-full-access 的 `permit`），被封禁的 `forbid` 策略依然让最终结果为 DENY。

## 部署步骤

### 从源码构建

```bash
git clone https://github.com/cedar-policy/cedar
cd cedar
cargo build --release
```

构建产物：
- `target/release/cedar` — CLI 工具

### CLI 使用

```bash
# 授权检查
cedar authorize \
  --policies policy.cedar \
  --entities entities.json \
  --principal 'User::"alice"' \
  --action 'Action::"view"' \
  --resource 'Photo::"beach.jpg"'

# 策略验证
cedar validate \
  --policies policy.cedar \
  --schema schema.cedarschema

# 策略格式化
cedar format --policies policy.cedar
```

## 关键发现

1. **安全模型设计精妙**：默认拒绝 + forbid 覆盖 permit，这是"安全优先"的典范。不需要理解整个策略集就能保证安全——只要有一条 forbid 命中，请求一定被拒。

2. **可分析性是核心卖点**：Cedar 的语法刻意限制了表达能力（比如不支持通用循环），使得 Automated Reasoning 工具可以对策略集进行形式化证明。这在合规要求严格的场景（金融、医疗）非常有价值。

3. **引擎性能有保障**：策略结构设计为可索引（通过 principal/action/resource 快速筛选相关策略），评估有界延迟。不会因为策略数量增多而线性退化。

4. **Schema 验证 = 策略的类型系统**：在部署前用 Validator 检查策略是否合理，类似于编程语言的类型检查。能发现"用户类型没有 age 属性"这类错误。

5. **与 AWS 生态深度绑定**：如果你在 AWS 上做应用授权，Cedar + Verified Permissions 是原生方案。但开源版本完全可以脱离 AWS 独立使用。

## 参考资源

- [Cedar 官方文档](https://docs.cedarpolicy.com) — 最全的语法参考和教程
- [cedar-examples](https://github.com/cedar-policy/cedar-examples) — 官方示例集（TinyTodo 等）
- [cedar-policy crate (docs.rs)](https://docs.rs/cedar-policy) — Rust API 文档
- [AWS Verified Permissions](https://aws.amazon.com/verified-permissions/) — Cedar 的 AWS 托管版
- [Cedar Playground](https://www.cedarpolicy.com/en/playground) — 在线体验 Cedar 策略
- [Cedar RFC](https://github.com/cedar-policy/rfcs) — 语言设计 RFC
