# 架构改造任务清单

来源：`ARCHITECTURE_ASSESSMENT.md`（2026-07-17 评估 + 复核）。  
用法：按阶段顺序执行，一次做一个任务；完成后把 `[ ]` 改 `[x]` 并在任务下追加一行 `完成于 <日期>，<commit/备注>`。阶段内任务若无依赖标注，可按需调整顺序；跨阶段不建议跳跃。

状态标记：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成 · `[-]` 决定不做（注明原因）

## 全局约束

- 既有约定：**不改 `packages/mcp`（MCP 服务端）**。带 ⚠️MCP 标记的任务会触及该约束，动手前需先明确解除或以"新增工具/字段、不改既有行为"的方式绕开。
- 涉及 `packages/core` 场景 schema 的任务（⚠️SCHEMA 标记）属于 editor 仓库层面改动，需先读 `wiki/architecture/node-schemas.md` 并考虑存量场景兼容。
- 线上 eval 消耗真实模型费用，只在任务完成标准要求时跑；日常回归用 `bun test`。
- `requestId` 由 AI API 创建并作为业务请求主键；浏览器只能创建 `clientRequestId` / `idempotencyKey`，不得决定服务端主键。`traceId` 由可信 BFF 或 AI API 创建，不能信任浏览器自报的身份与追踪字段。
- 验收标准不写死测试数量；统一表述为“当前完整测试集全过且测试数不减少”，避免任务清单随新增测试失效。
- 任何日志、错误响应和 telemetry 都不得包含 API Key、Authorization、Cookie、完整 Prompt/回复、图片 Base64 或供应商原始错误体。

---

## 阶段 0：快速见效（无依赖，可穿插任何时候做）

### [~] T0.1 AI 测试与类型检查进 CI
- 内容：新增 GitHub Actions job（或并入 `ci.yml`），按路径 `pascal-ai-mcp/**` 触发，执行 `bun run --cwd pascal-ai-mcp check-types` 和 `bun test --cwd pascal-ai-mcp`。
- 涉及：`.github/workflows/`（新文件或改 `ci.yml`）。
- 完成标准：改动 `pascal-ai-mcp` 下任意文件的 PR 会自动跑单测；不改时不触发。
- 依据：评估 §7.4、§10、§14-6（成本最低、零依赖，建议第一个做）。
- 进展 2026-07-17：新增 `.github/workflows/ai-ci.yml`（触发路径 `pascal-ai-mcp/**` + `bun.lock` + workflow 自身；bun 1.3.0 对齐 mcp-ci）。本地验证：check-types 干净、494 测试全过（0.5s，无需密钥）。**待提交推送后在 GitHub 首次触发确认，确认即可标 [x]。**

### [ ] T0.2 模板体检脚本化并进 CI
- 内容：`pascal-ai-mcp/package.json` scripts 增加 `templates:check` → `scripts/check-templates.ts`（CI 模式跳过 SVG 产物输出，需给脚本加对应开关）；接入 T0.1 的 workflow。模板文件、模板 schema/loader、体检脚本或相关依赖变化时都要执行，不能只监听 `templates/**`。
- 涉及：`pascal-ai-mcp/package.json`、`scripts/check-templates.ts`、workflow。
- 完成标准：坏模板 JSON / good 模板带 fatal 会让 CI 变红。
- 依赖：T0.1（共用 workflow）。
- 依据：§6.6、§7.4。
- 进展 2026-07-17：`check-templates.ts` 增加 `--no-artifacts` CI 模式（跳过 SVG）+ 失败收集与非零退出（坏 JSON/缺 meta.quality/plan.rooms、good 参照带 validator fatal 均判失败；分区器对照失败是已知差距不判失败）；`package.json` 加 `templates:check`；ai-ci.yml 增加体检步骤（触发路径 `pascal-ai-mcp/**` 已覆盖模板/loader/脚本/依赖）。本地验证：15 份模板通过 exit 0；注入坏 JSON 与 good 带 fatal 两种场景均 exit 1；完整 SVG 模式输出与既有预览零 diff。**同 T0.1，待推送后首次触发确认。**

### [x] T0.3 部署边界收口（local-only 加固）
- 完成于 2026-07-17。实现：`AI_MCP_HOST` 默认改 `127.0.0.1`；`/health` 只返回 `{ok}`（配置摘要移到启动日志，正式 readiness 留给 T2.5）；新增 `AI_MCP_MAX_BODY_MB`（默认 28，与前端 20MB 原图 Base64 后 26.7MB 联动），Bun `maxRequestBodySize` + content-length 预检双保险；`/chat` 畸形 JSON 返回 400 `invalid_json`、非 png/jpeg data URL 返回 400 `invalid_image`（对齐前端上传过滤）；README 新增 Deployment boundary 节。验证：真实启动冒烟测试四个场景（health 最小化、坏 JSON 400、坏图 400、超大 413）全过，监听地址确认 127.0.0.1；check-types 干净、494 测试全过。
- 内容：① `AI_MCP_HOST` 默认值 `0.0.0.0` → `127.0.0.1`（需要局域网访问时显式设置）；②未鉴权的 liveness 只返回 `{ok}`，provider/model/mcpMode 等诊断信息仅放内部 readiness/受保护端点；③ `/chat` 增加可配置的请求体大小上限、合法 JSON/data URL/MIME 校验与解析失败的 400/413 处理；④ README/部署说明明确"当前仅限本机/内网"。当前前端允许 20MB 原图，Base64 后约为 26.7MB，再加 JSON 开销，因此服务端上限必须与前端原图限制联动（可先设约 28MB，或同步下调前端限制），不能直接设 15–20MB 导致合法上传被拒。
- 涉及：`src/config.ts`、`src/server.ts`、`pascal-ai-mcp/README.md`。
- 完成标准：默认启动只监听回环地址；超过统一限制的请求返回 413，畸形 JSON/data URL 返回 400，合法的当前最大图片仍可提交；公开健康响应不暴露部署配置。
- 依据：§5.1、§14-3、§14-4。

### [x] T0.4 优雅退出：SIGTERM + session flush
- 完成于 2026-07-17。实现：SessionStore 新增 `flushAll()`（等待 write queue 落定；日常写入仍吞错误但记录 `lastFlushError`，flushAll 时上抛，后续成功写入会清除）；agent 暴露 `flushSessions()`；server 统一 `shutdown()` 处理 SIGTERM/SIGINT——`server.stop()` 停接新请求 → 在 `AI_MCP_DRAIN_TIMEOUT_MS`（默认 5s）内 drain session 写入 → 关 MCP；flush 失败或超时以非零码退出；重复信号幂等（第二次信号立即 exit 1）。验证：新增 `session-store.test.ts` 3 个用例（正常落盘、最终写失败上抛、后续成功写清除失败），仅覆盖协作式退出路径不涉 SIGKILL；真实进程 SIGTERM 冒烟测试 exit 0 + 日志正确；497 测试全过、check-types 干净。
- 内容：server.ts 同时处理 SIGTERM/SIGINT；停止接收新请求后，在配置的 drain timeout 内等待 SessionStore write queue flush 完成再关闭 MCP。SessionStore 暴露 `async flushAll()`（等待 writeQueue 落定，并把最终写入失败向调用方抛出，而不是吞掉）。重复信号要幂等；超时后以非零状态退出并留下明确脱敏日志。
- 涉及：`src/server.ts`、`src/session-store.ts`。
- 完成标准：收到 SIGTERM/SIGINT 的正常优雅退出路径中，最后一次已接受的 `set` 要么持久化成功，要么进程以非零状态明确失败；测试不把 SIGKILL 等不可拦截退出误算为可保证场景。
- 依据：§6.1、§7.5。

---

## 阶段 1：可观测与数据基础（评估 §9 Phase 1）

阶段目标 / 验收：能回答“某个用户请求调用了几次哪些模型、每次多少 Token、耗时多少，以及哪一次模型 operation/attempt 失败”。施工流程中“具体哪个 workflow step 失败”的持久化查询能力由 T2.2 补齐，不计入本阶段完成标准。

### [ ] T1.1 模型响应 usage 穿线
- 内容：① `ChatCompletionResponse` 补 `usage`（input/output/reasoning/cache tokens）、`id`、`model`、`created`；② `openai-compatible.ts` 的 `complete()/json()` 返回统一 `ModelCallResult<T>`（结构见评估 §6.2 代码块）；③把仅计数的 `onAttempt()` 扩展为 attempt 生命周期事件（如 `onAttemptStarted` + `onAttemptFinished`，或一个可 begin/finalize 的 telemetry sink），每次真实 HTTP attempt——包括网络错误、429/5xx、取消和内部重试——都产生独立结果，记录 status、attemptNo、latency、HTTP/供应商错误码，成功时再补 usage/finishReason/providerRequestId。Token 未返回时必须为 `null/undefined`，不能写 0。
- 涉及：`src/types.ts`、`src/openai-compatible.ts` 及全部调用点（agent.ts、plan-builder.ts 等）。
- 完成标准：单测注入“成功、429 后重试、网络失败、取消”四种情形，telemetry sink 对每个真实 attempt 都收到一条完整且脱敏的结果；成功调用能读取真实 token/model，失败调用也有状态和耗时；当前完整测试集全过且测试数不减少。普通业务日志和 session 不作为模型调用真相源。
- 注意：调用点很多，可以先让 `ModelCallResult` 兼容旧返回（output 字段透传），但兼容层必须标注删除条件，不能长期形成两套返回契约。
- 依据：§6.2。

### [ ] T1.2 `ai_model_calls` 落库
- 内容：引入 SQLite（bun:sqlite，独立于场景库，如 `.data/ai.db`）。先把连接、migration、transaction helper 做成 `src/persistence/` 的共享基础，不能私有化在 telemetry 中，以便 T1.5 并行复用；再建 `ai_model_calls` 表，由 persistence/telemetry adapter 消费 T1.1 的 attempt 事件，模型客户端不直接依赖 SQLite。每次 attempt 一行，至少包含 operation、provider、实际 model、attempt_no、status、nullable tokens、latency、finish_reason、http_status、provider_error_code、provider_request_id、prompt_version、prompt_hash、非敏感 request params、session_id、request_id、started_at/completed_at；失败与取消同样落行。价格换算不做，先存原始量；不保存完整 Prompt、消息或原始供应商响应。
- 涉及：新 `src/telemetry/` + `src/persistence/`、`src/openai-compatible.ts` hook 接线。
- 完成标准：跑一个含重试的 eval case 后，能用 SQL 按服务端 `requestId` 查出全部真实 attempt，行数与 telemetry 事件和 `modelCallsTotal` 对得上；数据库故障不会被误报为“计量成功”，并有明确的请求处理/降级策略。
- 依赖：T1.1、T1.3（表在创建时就使用权威 requestId，避免先落无关联数据再迁移）。
- 参考：`docs/AI_USAGE_AUDIT_DESIGN.md` 已有更完整表设计，可直接取子集。
- 依据：§6.2、§8.1。

### [ ] T1.3 traceId / requestId 全链路
- 内容：① 前端每次发送只生成 `clientRequestId`（用于界面关联，未来也可作为 idempotency key 的来源）；②可信 BFF 创建/透传 `traceId`，AI API 为每次业务动作创建权威 `requestId` 并返回给前端；③ AI 服务建立显式 `RequestContext`，把 requestId/traceId/sessionId 传入所有应用步骤、trace 和结构化日志，T1.2 再写入 `ai_model_calls`。幂等语义此阶段不做（T2.2），只做贯穿标识；浏览器自报的 requestId/traceId 不能覆盖服务端值。
- 涉及：`apps/editor/components/ai-assistant-bubble.tsx`、`apps/editor/app/api/ai/[...path]/route.ts`、`src/server.ts`、`src/agent.ts`、`src/types.ts`。
- 完成标准：给定 AI API 返回的 requestId，能在前端状态、代理日志、AI 日志和测试 telemetry 中检索到同一请求；伪造客户端 requestId 不会覆盖服务端主键。T1.2 完成后，同一 ID 可继续检索 `ai_model_calls`。
- 依赖：可与 T1.1 并行；T1.2 依赖本任务，不反向依赖 T1.2。
- 依据：§5.2、§9 Phase 1。

### [ ] T1.4 模板 Zod schema + schemaVersion
- 内容：① 定义并导出 `TemplateRecordSchema`（Zod），替换 `JSON.parse(...) as TemplateRecord`；② 增加 `schemaVersion` 字段与迁移函数（全部现有模板补 version 1）；③ `market/quality/typology/roomProgram` 改枚举；④启动时加载全库并输出健康摘要。生产环境遇到非法 good 模板时保持 liveness 可用但 readiness=false、拒绝业务流量；开发模式可 warn 后跳过该模板，但 CI/测试必须失败，不能让坏模板悄悄进入主分支。
- 涉及：`src/template-seed.ts`、`templates/**/*.json`、`scripts/check-templates.ts`。
- 完成标准：故意写坏一个字段，加载即报具体路径错误而不是运行时命中才炸；`templates:check` 复用同一 schema。
- 依赖：建议在 T0.2 之后（CI 已能拦住回归）。
- 依据：§6.6。

### [ ] T1.5 SessionStore 迁移到 SQLite
- 内容：把整文件 JSON 换成 SQLite：`ai_sessions`（当前状态+version，预留 nullable user_id/org_id/project_id）、`ai_messages`（用户可见消息）、`ai_requests`（每次 chat/confirm/cancel）。旧 `sessions.json` 只作一次性迁移源。图片 Base64 不入库，改存 artifact 引用。不要把同步 `get/set` 整体替换接口永久保留下来：新增 repository 接口和带 `expectedVersion` 的事务更新/CAS（如 `updateSession`），消息和请求通过各自 repository 写入，避免 session JSON 与拆表形成两个真相源；若为降低改造风险保留旧接口，只能作为有明确删除任务的临时 adapter。
- 涉及：`src/session-store.ts`（重写/过渡 adapter）、新 `src/persistence/` repository 与迁移脚本、`src/agent.ts` 调用点。
- 完成标准：重启后会话恢复行为与现在一致；并发更新中只有正确 version 能提交，冲突返回明确错误并可重试；消息/请求不再嵌套复制到 session blob；sessions.json 不再增长；迁移可重复执行且不会重复导入。
- 依赖：T1.3。与 T1.2 共用同一 SQLite/migration 基础，但两项业务实现可以并行；T1.5 不以 `ai_model_calls` 完成为前提。
- 依据：§6.1、§8.1。
- 顺带解决：既有备忘中的"sessions.json 单文件无清理策略会一直涨"。

### [ ] T1.6 附件引用化与基本删除语义（最小版）
- 内容：只实现当前本机/内网阶段必要的数据卫生：① `ai_artifacts` 保存私有文件引用、hash、MIME、大小和可配置过期时间，不保存 Base64/永久公开 URL；②定义基础 session 删除语义（删除消息与短期附件，去标识化用量/状态可保留，场景历史不被聊天删除连带破坏）；③提供幂等清理命令处理过期附件和失败删除。本任务不包含字段/信封加密、KMS、客服原文访问审计、备份级删除或法务留存周期，这些移到 TX.3。
- 涉及：`src/persistence/`、`src/server.ts` 上传入口、文件存储 adapter、删除/清理命令。
- 完成标准：上传图片只在 DB 留引用；删除 session 后当前数据目录中的消息与短期附件不可再由应用访问，去标识化用量仍可汇总；重复执行删除/清理不会报错或产生孤儿记录。
- 依赖：T1.5；可与阶段 2 并行，不阻塞 T2.1。对外生产标准由 TX.1 + TX.3 完成。
- 依据：`AI_USAGE_AUDIT_DESIGN.md` §5.7、§9。

### [ ] T1.7 稳定错误码与日志脱敏
- 内容：建立统一错误 envelope（requestId、稳定 errorCode、stage、可公开 message），供应商错误体只转成脱敏错误码/限长摘要；本阶段默认不保存原始错误体，只有 TX.3 的短期加密 artifact 能力就绪后才允许按策略留存。结构化日志统一注入 traceId/requestId，增加对 Authorization/Cookie/Base64/Prompt/回复的 redaction 测试。
- 涉及：`src/server.ts`、`src/openai-compatible.ts`、`src/agent.ts`、代理路由、日志工具。
- 完成标准：模拟供应商返回带敏感内容的 4xx/5xx，客户端和普通日志都看不到原始响应体或凭据，但能凭 requestId/errorCode 定位阶段；现有错误 UI 仍能展示可操作提示。
- 依赖：T1.3；可与 T1.5 并行。
- 依据：`AI_USAGE_AUDIT_DESIGN.md` §9.2、§13.1。

---

## 阶段 2：长任务可靠性（评估 §9 Phase 2）

阶段目标 / 验收：AI 或代理重启后任务状态不丢；重复提交同一 idempotency key 不重复扣费/施工。

### [ ] T2.1 /chat 改为异步任务：202 + requestId
- 内容：`POST /chat` 立即创建 `ai_requests` 行（status=queued）返回 `202 {requestId}`；实际执行移入单进程 worker，但队列真相源必须是 DB，不能使用“内存队列 + 仅写状态”作为可靠方案。worker 通过 lease/locked_until/heartbeat 领取任务，启动时扫描 queued 与过期 lease；设置全局并发上限、每 session/scene 并发限制、最大队列深度和 429/503 backpressure。新增 `GET /requests/:id` 查询状态与结果。移除 `bunServer.timeout(request, 0)` 和 Next.js 代理的全量缓冲 workaround（§14-1 所指的两个补丁一并清理，LangGraph checkpointer 注释见 T2.6）。
- 涉及：`src/server.ts`、`src/agent.ts`（入口拆分）、`apps/editor/app/api/ai/[...path]/route.ts`。
- 完成标准：数分钟的生成不再依赖一条长 HTTP 连接；请求中断/代理重启后客户端凭 requestId 查到最终结果；服务在“任务已入库但尚未领取”时被 kill，重启后会继续领取；过期 running lease 不会永久变成幽灵任务；压测超过并发/队列阈值时明确拒绝而非拖垮进程。正在执行步骤的安全续跑由 T2.2 的幂等/步骤语义决定。
- 依赖：T1.3、T1.5。
- 依据：§5.2。

### [ ] T2.2 幂等键与 workflow_steps
- 内容：① `/chat` 接受 `idempotencyKey`，按可信主体 + action/session/scene 范围建立唯一约束，同 key 重复提交返回原 request；② 建 `workflow_steps` 表，生成/修改的每个阶段（intent、plan、structure、openings、furniture、gates、repair-N）记录开始/成功/失败/取消和补偿结果；③每步有稳定 operation key，读步骤可安全重试，写步骤必须先通过 scene version/工具幂等能力证明才能重放。进程崩溃重启后，已 completed 的请求直接可查；无法证明安全的 in-flight 写步骤标记为 failed-recoverable，不能自动重放整次施工。本任务不承诺通用断点续跑。
- 涉及：`src/agent.ts`、`src/persistence/`。
- 完成标准：模拟中途 kill 进程，重启后 request/step 状态正确、无永久幽灵"进行中"；同一作用域的同 key 双击发送只创建一个 request、只扣一次模型费用；不同用户/scene 的相同 key 不互相串单。
- 依赖：T2.1。
- 依据：§5.2。

### [ ] T2.3 前端进度事件
- 内容：`GET /requests/:id/events`（SSE）或前端轮询 `GET /requests/:id`，替换现在"发出后干等 + 空响应再读 session 猜结果"的交互；phase 变化实时反映到 AI 气泡（可复用 workflow_steps 数据）。
- 涉及：`src/server.ts`、`apps/editor/components/ai-assistant-bubble.tsx`、代理路由。
- 完成标准：生成过程中 UI 按阶段更新；断网重连后状态自动追上。
- 依赖：T2.1、T2.2。
- 依据：§5.2。
- 顺带解决：既有备忘中的"运行中无进度流"。

### [ ] T2.4 场景写入的版本边界与失败清理
- 内容：①先形成 scene capability matrix：当前是否支持权威 scene version、compare-and-swap、checkpoint/restore、批量原子写、幂等 operation key；②有正式能力时，施工前记录 scene version/checkpoint，失败时回滚或标记；③能力不足时，fresh build 优先采用“新 scene 构建成功后再发布/切换”，失败 scene 作为 abandoned 记录到 DB 并由幂等清理命令处理；对原 scene 的 destructive rebuild 必须显式标为不可原子回滚并要求用户确认/禁用自动重试；④同 scene 并发请求用 DB 锁/租约取代进程内 `sessionLocks`。**禁止把 `get_scene + delete_node` 当作通用回滚方案**：它不能恢复原 ID、引用、metadata 和并发期间的第三方改动。若缺必要能力，本任务先停在设计/约束结论，再申请解除 ⚠️MCP 约束，不能用危险补偿假装完成。
- 涉及：`src/agent.ts`（rebuildScenePlanFirst、clearLevelChildren 一带）、`src/persistence/`。
- 完成标准：注入一次施工中途失败，原 scene 要么通过权威 checkpoint 回到施工前版本，要么保持未发布状态；新建半成品被持久标记并可幂等清理。系统不得把部分 delete/recreate 宣称为成功回滚，用户能看到明确状态和下一步。
- 依赖：T2.2。
- 依据：§5.2、§8.2。
- 顺带解决：既有备忘中的"生成中断的半成品场景不回滚"。

### [ ] T2.5 健康检查与运行生命周期
- 内容：`/health` 拆 liveness（进程活着、响应最小化）与内部/受保护 readiness（DB 可写、模板库加载有效、MCP 可调用；模型供应商状态仅作 degraded 信息不挡 ready）；AI 侧 MCP client 增加有上限的 reconnect/circuit-breaker 与连接代次管理，旧 transport 失败后不能继续被复用，本项不要求修改 `packages/mcp` 服务端。graceful shutdown 扩展 T0.4：停止接新请求和领取新任务 → drain/续租在跑任务或标记 recoverable → flush → 关 MCP。
- 涉及：`src/server.ts`、`src/mcp.ts`（连接状态暴露）。
- 完成标准：MCP 子进程被 kill 时 readiness 变 false 且有明确脱敏错误；子进程恢复后 AI client 可在上限内重新建立连接并恢复 ready；SIGTERM 下在跑请求不产生幽灵状态。
- 依赖：T2.1、T2.2。
- 依据：§7.5。

### [ ] T2.6 LangGraph 去留决策
- 内容：二选一并执行：(a) 接入 checkpointer 让 graph 真正承担持久化工作流；(b) 移除 LangGraph，5 个 node 改为 application service 的显式路由（当前每回合单 super-step、状态整体从 session 加载，graph 只是路由包装）。结合 T2.2 的 workflow_steps 现状判断，倾向 (b)。
- 涉及：`src/agent.ts#createWorkflowGraph` 及 5 个 node 方法、`package.json` 依赖。
- 完成标准：决策写进本文件（此条目下），代码与决策一致；测试全过。
- 依赖：T2.2 完成后再决策（届时持久化机制已明朗）。
- 依据：§5.2、§14-1。

### [ ] T2.7 工具调用、场景变更与验证审计
- 内容：补齐 `ai_tool_calls`、`ai_scene_changes`、`ai_validation_results` 的最小表与写入链路。每次写工具调用记录 request/step/operation key、工具名、脱敏参数摘要、状态、错误码和耗时；场景变更记录 before/after scene version、变更类型、节点数量和大型 diff artifact 引用；validator/gates 记录被验证版本、结果、问题摘要和 repair round。普通读工具默认只记摘要，不把完整场景或工具返回塞入日志/数据库文本列。审计从 SceneGateway/工具调用 adapter 统一产生，业务工作流不各自拼 SQL。
- 涉及：`src/persistence/`、SceneGateway/工具调用 adapter、validator/gates 接线。
- 完成标准：给定 requestId，可按顺序还原“模型调用 → 工具写入 → scene version 变化 → 验证/修复”的摘要链；失败和取消同样有记录；大型场景数据仅通过 artifact 引用，审计写入失败有明确处理策略。
- 依赖：T1.5、T2.2、T2.4 的 scene version/capability 决策。
- 排序：属于阶段 2 末尾的审计完备性增强，不阻塞 T2.3 前端进度流、T2.5 生命周期治理或可靠性主线验收。
- 依据：评估 §6.1、§8.1；`AI_USAGE_AUDIT_DESIGN.md` §5.4–§5.8。

---

## 阶段 3：领域数据与模块边界（评估 §9 Phase 3）

阶段目标 / 验收：删除 AI session 后场景仍能准确识别房间类型并校验；domain 单测不需要模型/MCP/DB/React。

### [ ] T3.1 房间语义进场景 schema ⚠️SCHEMA ⚠️MCP
- 内容：先写并评审空间语义 ADR，再改 schema。当前 `ZoneNode` 同时用于室内房间和 `Back garden` 等外部区域，不能直接把 AI 的 `RoomType` 枚举塞进 core，也不能假设所有 Zone 都是房间。ADR 至少决定：①场景领域自己的 `SpaceUsage`/分类模型（室内、室外、交通、服务等）以及 AI `RoomType → SpaceUsage` 显式映射；②未知/自定义用途的前向兼容；③来源、置信度、templateId/planRoomId/planVersion 的契约；④schema version 与旧场景迁移。方案确定后，Zone schema（或新的正式空间语义能力）和 MCP `create_room`/更新工具支持该契约，新增可选字段且不破坏既有调用；无字段的旧场景只在迁移/导入时按 room-vocab 推断并标记低置信，正常运行不反复猜。**动手前需确认解除"不改 packages/mcp"约束**，并读 `wiki/architecture/node-schemas.md`、`layers.md`、`plugin-authoring.md`。
- 涉及：`packages/core/src/schema/nodes/zone.ts`、`packages/mcp`（create_room 工具）、迁移逻辑。
- 完成标准：ADR 获得确认；新生成的室内空间带场景领域用途，花园等外部 Zone 不会被误标成房间；非 AI 入口（直接打开场景）能读到；旧场景仍可解析，未知新枚举不会导致整场景加载失败。
- 依据：§6.3、§8.1。

### [ ] T3.2 AI 侧消费场景语义，session 降级为缓存
- 内容：`scene-executor.executeLayoutPlan` 施工时写入 T3.1 的场景用途和 plan 来源引用；gates/metrics/modify 中依赖房间分类的逻辑优先读场景字段，`zoneRoomTypes` 与名字正则降级为旧场景迁移兜底（保留并有删除指标）。LayoutIntent/LayoutPlan 仍由 AI application DB 持有，并通过 scene 上的来源引用关联；不要误把“房间用途进 scene”理解为删除 session 后可凭 room type 恢复完整计划。
- 涉及：`src/scene-executor.ts`、`src/agent.ts`（gateTargetsForSession、collectDiagnostics 一带）、`src/layout-metrics.ts`。
- 完成标准：删掉 AI session 后，inspect、校验、家具清单以及 modify 中仅依赖房间分类的判断结果不变；用户重命名房间不再影响类型判定。需要完整 LayoutPlan 的重建/拓扑修改必须从 AI DB 的 scene/plan 关联读取，缺失时明确降级或拒绝，不能静默假装可恢复。
- 依赖：T3.1。
- 依据：§6.3。

### [ ] T3.3 agent.ts 拆分（application/domain/ports/adapters）
- 内容：按评估 §6.4 的目录结构分批拆：第一批 ports（model-client、scene-gateway、workflow-store）+ adapters 提取，agent.ts 只依赖接口；第二批 generate/modify/inspect 三条工作流拆成独立 application service；第三批房名/面积/动线等辅助算法沉入 domain。每批独立提交、测试全过再下一批，不做一次性大爆炸重构。
- 涉及：`src/agent.ts`（行数下降作为趋势指标，不把 `<800` 当架构验收门槛）、新 `src/domain|application|ports|adapters/`。
- 完成标准：domain 目录零依赖 HTTP/MCP/DB/LangGraph；application 只依赖 ports，不直接依赖具体 adapter；依赖边界测试进 CI；`bun test` 全过且 eval 抽查 2–3 个 case 结果不变。
- 依赖：建议在 T2.x 落定后做（异步化会改 agent 入口，先拆会白拆一部分）。
- 依据：§6.4。

### [ ] T3.4 面积/房型 policy 收口
- 内容：把 `areaBoundFor`、`TYPE_TO_KIND`、房型分类、窗/动线/最小门边、必需空间、DK/LDK 市场规则从 `plan-validator.ts` 等处抽到 `domain/policy/`（或并入 norms/），validator、strategy、modify-ops、template matcher 统一从 policy 导入，消除"策略层反向依赖校验器"。
- 涉及：`src/plan-validator.ts`、`src/strategy.ts`、`src/modify-ops.ts`、`src/norms/`。
- 完成标准：`grep "from './plan-validator'" src/strategy.ts src/modify-ops.ts` 为空；行为零变化（现有单测全过）。
- 依赖：可独立做，也可作为 T3.3 第三批的一部分。
- 依据：§7.2。

### [ ] T3.5 core 纯边界决策与执行 ⚠️SCHEMA
- 内容：先决策（评估 §7.1 方案 A：core 提纯 / 方案 B：新增纯 `@pascal-app/scene-model`），同时处理当前架构文档与代码中对 Three/R3F/NodeDefinition 所有权的矛盾，把决策和理由记录到 `wiki/architecture/`；执行前列出 `@pascal-app/*` 公共 API、registry/plugin authoring、npm 消费方和 private-editor submodule 的兼容/semver 影响。然后分阶段迁移并加 dependency boundary 检查（lint rule 或测试：core 禁 import three/R3F —— 若选 A）。这是 editor 仓库层面的大改动，单独开分支/PR，与 AI 侧任务解耦，并使用 `review-architecture` 流程审阅。
- 涉及：`packages/core/**`、`wiki/architecture/`、`AGENTS.md`、CI。
- 完成标准：文档与代码一致；边界检查进 CI 会拦截违规 import；公共包和插件迁移有明确兼容策略/major version 决策，不能只让仓库内构建通过。
- 依据：§7.1、§7.4。

### [ ] T3.6 反向代理去数据库直读
- 内容：`/proxy/scenes` 的项目列表改为调用 Editor/Scene API 而非直接 `SELECT ... FROM scenes`；封面与展示元数据保留在 proxy.db（它是这些数据的正当主人）；`Program.cs`（825 行）拆 routes/auth/catalog/cover/db/proxy-config 模块。
- 涉及：`pascal-reverse-proxy/Program.cs`、可能需要 Editor 暴露场景列表 API（确认 `apps/editor` 是否已有）。
- 完成标准：SceneStore 表结构变化不再可能悄悄弄坏代理；代理进程不再打开 pascal.db。
- 依据：§6.7。

### [ ] T3.7 防护栏前移
- 内容：在 requirement extraction 之前加低成本 scope 判定：确定性规则只拦截高置信、明确越界内容；不确定时 fail-open 到 fast model 或 extraction，避免关键词 allowlist 误伤自然语言。带户型图片/DXF 的请求默认视为有建筑上下文，除非有明确安全原因。被拦截请求写独立 `ai_guardrail_events`（reason_code、policy_version、decision、latency），并关联 ai_requests；现有 extraction 内的 `relevant:false` 保留为第二道。若 fast model 参与分类，它的调用照常进入 ai_model_calls，不能宣称模型用量为 0。
- 涉及：`src/agent.ts`（ingest 前）、`src/lang/`。
- 完成标准："今天天气怎么样"被确定性规则拦截且 `ai_model_calls` 里该请求零调用；中文/日文/英文正常户型语料和带图短文本的回归集无明显误拦截；所有决策有稳定 reason_code/policy_version 可统计。
- 依赖：T1.2（验证零调用需要计量在位）。
- 依据：§7.3。

---

## 阶段 4：真正的 template-first 与质量闭环（评估 §9 Phase 4）

### [ ] T4.1 模板候选前置到模型 Intent 之前
- 内容：按评估 §6.5 流程图改造 `plan-builder`：确认 brief 后先用确定性事实（roomProgram、面积、market、kitchenPreference——`briefFactsFor` 已有）构造模板查询；唯一高置信命中 → 直接 adapt+validate 零模型调用；多候选/缺字段 → 才调用模型补 Intent 再 rerank；无模板 → partitioner。现有 `findTemplateSeed` 的匹配规则可复用为查询谓词。
- 涉及：`src/plan-builder.ts`、`src/template-seed.ts`、`src/agent.ts`（generate 入口）。
- 完成标准：标准房型（如"2LDK 55㎡"）在模板命中时 `ai_model_calls` 为 0 次 Intent 调用；eval 全量回归通过。
- 依赖：T1.2（用计量数据验证）；建议 T1.4 之后（schema 稳定）。
- 依据：§6.5。

### [ ] T4.2 模板可伸缩表达
- 内容：模板从"整图等比缩放"升级为"拓扑 + 比例约束 + 可伸缩区域"，命中后由 solver 局部调整而非缩放失败即全回退。设计文档必须区分面积比例窗口与线性缩放比例（例如面积 0.8–1.25 对应边长约 0.894–1.118，不等同于面积 ±10%），并定义共享墙、门窗宿主、最小尺寸和非矩形 footprint 的约束。这是算法项，先写设计文档和固定 fixtures 再动码。
- 涉及：`src/template-seed.ts`、`templates/` schema（schemaVersion+1）、新设计文档。
- 完成标准：在明确的面积段 fixture 中，同一模板服务范围较基线显著扩大；fatal=0 比例、soft warning 分布、几何一致性和人工修改量均不劣于基线。不要用含义不明确的“validator 满分率”作为唯一指标。
- 依赖：T1.4、T4.1。
- 依据：§6.5、§14-5。

### [ ] T4.3a 模板命中与拒因闭环
- 内容：落库记录每次生成的 template direct hit / after enrichment / partitioner fallback、候选集合与模板拒绝原因（seedTrace 已有，落库即可），形成 §11 指标中不依赖前端事件的最小集。
- 涉及：`src/persistence/`、`src/template-seed.ts` trace 接线。
- 完成标准：能用 SQL 回答"哪个模板命中率最高、哪个最常被拒、拒因分布"，且统计可按 roomProgram/面积段/market 分组。
- 依赖：T1.2、T4.1。
- 依据：§9 Phase 4、§11。

### [ ] T4.3b 生成后人工修改量闭环
- 内容：定义“AI 完成后人工结构修改”的稳定事件契约与观察窗口，记录 scene/version、AI request/template、修改类型和匿名/可信主体；不要仅用固定“5 分钟内”且不区分撤销、自动修复与用户编辑。前端事件采集必须有项目/场景授权，服务端校验关联关系。
- 涉及：Editor 事件出口、BFF/AI telemetry、`src/persistence/`。
- 完成标准：能比较各模板生成后的人均结构修改量、撤销率和主要修改类型；同一修改不会因重连重复计数。
- 依赖：T4.3a、TX.1（或先完成匿名但不可跨用户归因的受限版本）。
- 依据：§9 Phase 4、§11。

### [ ] T4.4 eval 分层：PR gate + nightly
- 内容：stubbed deterministic eval（0 token）作为 PR gate 进 CI；真实供应商 eval 改 nightly/手动触发并保存基线报告（按 roomProgram/面积段/市场维度跟踪成功率与调用数）。
- 涉及：`eval/`、workflow。
- 完成标准：PR 不花模型钱也能拦住规划/模板回归；nightly 报告可对比历史。
- 依赖：T0.1。
- 依据：§7.4。

---

## 独立轨道：对外开放前置（P0，何时做取决于对外计划）

当前部署是本机/内网（T0.3 收口后风险可控），以下任务在**任何形式对外暴露之前**必须完成，不阻塞阶段 1–4：

### [ ] TX.1 身份与授权贯通
- 内容：按评估 §5.1 建议 1–4：浏览器只走认证 BFF；AI 服务绑内网 + 服务间鉴权；session/request/scene 操作绑定 userId/orgId；读取删除 session 校验所有权。前置决策：反向代理走 edge-proxy 还是正式 BFF（关联 T3.6，评估 §6.7 的二选一）。
- 依赖：T1.5 只需预留 nullable `user_id/org_id/project_id` 和正常 migration 能力，完整身份/BFF 归属决策不阻塞建表与阶段 2；本任务的完整实现依赖 T1.5、T2.1，并在任何对外暴露前作为硬门槛完成。

### [ ] TX.2 用户级额度与费用护栏
- 内容：基于 `ai_model_calls` 实现每用户/组织/session 的请求数、并发、token、费用额度与预警；价格表带生效时间和 price_version，历史调用按调用时价格结算；长任务采用额度预占 + 实际 usage 结算/释放，供应商未返回 usage 时进入待核对状态。替换现在"模型 HTTP 尝试次数上限"这一伪限流，但保留它作为单请求熔断上限。
- 依赖：TX.1、T1.2。

### [ ] TX.3 生产级内容隐私与留存治理
- 内容：在 T1.6 最小数据卫生之上补齐对外 SaaS 能力：消息和敏感工具参数使用字段/信封加密，密钥进入正式 KMS/轮换流程；附件使用服务端加密和短期签名 URL；查看原文需要权限、理由和访问审计；删除覆盖缓存、索引、对象存储和备份策略；正式留存周期由产品/法务按目标市场与合同确认并版本化。
- 涉及：`src/persistence/`、artifact storage adapter、BFF/权限层、运维与隐私文档。
- 完成标准：越权主体无法读取其他用户内容；密钥轮换与删除任务可测试、失败可重试并告警；普通日志/APM/Sentry 不含敏感原文；留存策略有负责人和版本记录。
- 依赖：TX.1、T1.6。任何形式对外开放前必须完成，不阻塞当前本机/内网可靠性主线。
- 依据：`AI_USAGE_AUDIT_DESIGN.md` §9。

---

## 建议的执行顺序（主线起步）

评估 §13 的主线，落到任务号：

```text
T0.1 → T0.2 → T0.3 → T0.4   （一周内可全部完成的小任务）
→ T1.1 → T1.3                （先定义调用事件和权威 ID）
          ├→ T1.2            （模型调用计量，共享 persistence 基础）
          └→ T1.5            （session/request 持久化，可与 T1.2 并行）
T0.2 ──────→ T1.4            （模板 schema，可并行）
T1.5 → T2.1 → T2.2 → T2.3   （优先解决长请求与进度体验）
```

T1.6、T1.7 可在 T1.5/T1.3 后并行，不阻塞阶段 2 主线；T1.2 仍应尽早完成，以便后续用真实数据验证成本和模板效果。T2.7 排在阶段 2 末尾，不阻塞 T2.3/T2.5。阶段 3 的 T3.1（房间语义）需要先完成 ADR 并解除 packages/mcp 约束，可以在做阶段 2 时提前讨论，但不要先写 schema。

## 变更记录

- 2026-07-17：初版，依据 ARCHITECTURE_ASSESSMENT.md（含复核）拆分。
- 2026-07-17：Codex 复核修订：纠正 requestId 归属与 T1.2/T1.3 依赖；补齐失败 attempt 计量、隐私留存、错误脱敏、持久队列租约/容量保护；移除危险的 delete-node 回滚建议；把空间语义改为 ADR 先行；拆分模板命中与人工修改量闭环。
- 2026-07-17：Claude/Codex 交叉复核修订：收窄阶段 1 验收到模型 operation/attempt；T1.6 降为本地最小数据卫生，生产隐私治理移至 TX.3；解除 T1.5 对 T1.2 和身份架构的隐性阻塞；明确 T2.7 不挡可靠性与进度主线。
