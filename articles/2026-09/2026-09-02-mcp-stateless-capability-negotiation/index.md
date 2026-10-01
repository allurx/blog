---
title: "MCP 为什么从初始化握手改为每请求协商"
date: "2026-09-02"
updated: "2026-10-01"
id: "2026-09-02-mcp-stateless-capability-negotiation"
domain: "MCP"
tags: ["MCP", "协议设计", "Agent"]
---

接入 MCP Server 时，有些示例要求先发送 `initialize`，另一些示例却直接请求 `tools/list`。这不是可以随意省略的初始化步骤，而是协议版本边界：`2025-11-25` 使用连接开始时的握手，`2026-07-28` 将版本与 Client 能力放到每个请求中。

本文以 **MCP 2026-07-28** 正式规范为基线，解释这次状态归属变化，以及同时连接新旧 Server 时应把兼容逻辑放在哪里。无状态化可以减少服务端对连接协商状态的依赖，但仍需处理认证、授权、缓存和长任务各自的生命周期。[MCP 2026-07-28 规范](https://modelcontextprotocol.io/specification/2026-07-28)

## 协商上下文从连接移到请求

MCP 中的 Host、Client、Server 是架构角色，不是协议本身：

* Host：运行模型和用户界面的应用，例如 IDE 或 Agent 应用。
* Client：Host 内负责连接某个 MCP Server 的协议组件。
* Server：提供 Tools、Resources、Prompts 等能力的服务。

协议定义这些角色之间如何交换 JSON-RPC 消息。

旧版协议将协商结果绑定到“连接或会话”：

```text
连接建立
  └─ initialize
      ├─ 确定协议版本
      ├─ 交换能力
      └─ 保存会话状态
```

后续请求依赖这次握手留下的隐式上下文。Server 收到 `tools/list` 时，需要知道该连接此前协商了哪个版本、Client 支持什么能力。

新版则把隐式状态显式化：

```text
请求
  ├─ 协议版本
  ├─ Client 能力
  ├─ Client 信息
  └─ 实际方法与参数
```

任意 Server 实例只看当前请求，就可以决定如何处理，不必访问此前的握手状态。这就是该版本所说的自包含请求与每请求能力协商。[MCP 基础协议](https://modelcontextprotocol.io/specification/2026-07-28/basic)

## 请求元数据、版本错误与能力发现

现代请求通过 `_meta` 携带以下标准元数据：

* `io.modelcontextprotocol/protocolVersion`
* `io.modelcontextprotocol/clientCapabilities`
* `io.modelcontextprotocol/clientInfo`（建议提供）

概念上，一个请求类似：

```json
{
  "jsonrpc": "2.0",
  "id": "tools-1",
  "method": "tools/list",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {
        "elicitation": {}
      },
      "io.modelcontextprotocol/clientInfo": {
        "name": "example-agent",
        "version": "1.0.0"
      }
    }
  }
}
```

在 Streamable HTTP 中，部分元数据还会镜像到 HTTP Header，便于网关路由和检查；但消息体仍是事实来源。[MCP Transport 规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)

如果 Server 不支持请求声明的版本，应返回 `UnsupportedProtocolVersionError`，并列出支持的版本：

```json
{
  "jsonrpc": "2.0",
  "id": "tools-1",
  "error": {
    "code": -32022,
    "message": "Unsupported protocol version",
    "data": {
      "requested": "2099-01-01",
      "supported": ["2026-07-28"]
    }
  }
}
```

`2099-01-01` 只是表示不受支持版本的示意值。对于仍采用每请求元数据的兼容版本，Client 可以：

1. 从 `supported` 中选择双方都支持的版本。
2. 使用该版本重新发送请求。
3. 如果没有交集，则向用户报告不兼容。

`-32022` 表示对端识别了现代协议，版本不匹配应先在双方支持的现代版本中选择交集重试。对旧 Server 的探测与 `initialize` 回退另按传输约定处理，不能把普通业务错误直接解释成需要切换协议时代。

Server 必须实现 `server/discover`；Client 可以但不必须预先调用它。Discovery 结果可一次返回：

* `supportedVersions`
* Server capabilities
* Server identity
* 使用指导
* 缓存期限与作用域

这避免了分别调用 `tools/list`、`resources/list`、`prompts/list` 来猜测 Server 能力。[MCP Server Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)

## 在 Client 边界统一构造请求

下面的 TypeScript 片段只展示请求形状，能力必须按 Client 实际实现配置；它不是完整 SDK，也没有覆盖传输、响应校验、扩展或重试。示例将请求的标准 `_meta` 交给协议层管理，不接受调用方同名字段覆盖：

```typescript
type JsonRpcId = string | number;

interface ClientInfo {
  readonly name: string;
  readonly version: string;
}

interface ClientCapabilities {
  readonly elicitation?: Record<string, never>;
  readonly sampling?: Record<string, never>;
  readonly roots?: Record<string, never>;
}

interface RequestMetadata {
  readonly "io.modelcontextprotocol/protocolVersion": "2026-07-28";
  readonly "io.modelcontextprotocol/clientCapabilities": ClientCapabilities;
  readonly "io.modelcontextprotocol/clientInfo": ClientInfo;
}

interface McpRequest<P extends object> {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params: P & {
    readonly _meta: RequestMetadata;
  };
}

function createRequest<P extends object>(
  id: JsonRpcId,
  method: string,
  params: P & { readonly _meta?: never },
): McpRequest<P> {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {
          elicitation: {},
        },
        "io.modelcontextprotocol/clientInfo": {
          name: "example-agent",
          version: "1.0.0",
        },
      },
    },
  };
}

const request = createRequest("tools-1", "tools/list", {});
```

工程中不应让每个业务调用手写这些元数据。应在 Transport 或协议 Client 层统一注入，以保持版本切换和能力配置的一致性。

## 新旧协议共存时的实现边界

### 明确协议版本边界

不要使用模糊的“支持 MCP”作为兼容性声明，应记录：

```text
Supported MCP versions:
- 2026-07-28
- 2025-11-25 compatibility mode
```

协议版本是日期标识，不应当作普通语义化版本号比较。例如，不能通过字符串大小推断两个实现一定兼容。

### 将能力视为契约，而不是功能猜测

只有双方声明支持的能力才应被使用。Client 声明 `sampling`，表示它能够处理相关协议流程；这并不意味着 Server 可以绕过用户授权随意调用模型。

能力协商回答的是“协议上能否处理”，授权回答的是“本次是否允许执行”，两者必须分层。

### 隔离 Legacy 兼容逻辑

只有确实需要同时支持两代协议时，才在协议 Client 中维护两套入口：现代请求的元数据处理，以及旧版初始化后的会话状态。工具调用方应使用同一语义接口，避免在每次调用中重复判断协议版本。具体是否需要独立适配类，取决于现有 SDK 和实现规模。

在 `stdio` 场景，dual-era Client 可先用 `server/discover` 探测；如果收到非现代协议错误或超时，再回退到 `initialize`。在 HTTP 场景，则根据现代请求的 HTTP 状态与 JSON-RPC 错误体判断是否回退。

### 缓存 Discovery，但允许失效

`server/discover` 可以返回 `ttlMs` 和 `cacheScope` 等缓存提示。Client 可以按提示缓存能力结果，但服务器升级或明确的版本、能力不兼容错误出现时应按需要重新探测，不能永久相信第一次结果。

`serverInfo` 和 `clientInfo` 都是对端自报的信息，适合展示和诊断，不构成可信身份。能力声明也只说明协议上能处理什么，不代表某次数据访问或工具调用已经获得授权。版本、能力和授权应分别校验。

`stdio` 与 HTTP 是传输选择，不能据此推断协议时代。长任务同样不要求恢复旧式握手；它们可以由相应扩展和持久句柄表达。兼容性决策应以实际请求、响应和所选协议规范为准。[版本与兼容性](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
