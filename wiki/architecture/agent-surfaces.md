# Agent surfaces

*Parity between the MCP server, the hosted AI chat, and the agent knowledge Pascal publishes.*

Applies to: `packages/mcp/**`, `skills/**`, and the scene operations and tool contracts in `packages/core/src/**` that agents call.

Pascal has two agent surfaces: the MCP server in this repo, used by external agents (Claude Code, Codex, …), and the AI chat of the hosted editor, whose loop lives in the hosted product. Both drive the same scene. What agents know about building in Pascal travels with them as the `pascal-3d` skill (`skills/pascal-3d/`) and the `pascal://agent-guide` resource. Treat these as **three presentations of the same capabilities** — the same default expectation as [2D ↔ 3D behavioral parity](tools.md).

## The rule

- **Capability parity.** A scene capability available to one surface's agent is available to the other's. The *mechanism* may differ (a server-side MCP handler vs a client-side chat executor); the *contract* must not: same name or a recorded alias, same input schema, same meaning in the description.
- **Same change.** When you add or change a capability on one surface, port it to the other in the same change, or write down why it genuinely doesn't apply (PR description and the parity map).
- **Operations live once.** A new capability is a core operation over `SceneApi` (`createSceneApi(store)`); each surface only adapts inputs and outputs. Never implement the same scene edit twice.
- **Rules live in the operation, not the loop.** A refusal or diagnostic that exists only in one surface's prompt or step logic is not enforced for the other surface's agents. Put realism refusals and `check`-style diagnostics where both surfaces execute them.
- **Knowledge parity.** A lesson that changes how an agent should build — a realism rule, a tool-choice rule, a known pitfall — is added to the published guide (skill references, agent guide) in the same change that teaches it to the chat, worded for any agent.

### Parity by layer

A tool has three layers, and only the last one may differ between surfaces:

1. **Contract** — name, description, input schema — one definition in `@pascal-app/core/agent-tools`, registered by the MCP and defined by the chat from the same object. Kept zod-only: the chat declares tools inside a sandbox that rejects Node-dependent packages (`contracts-purity.test.ts`).
2. **Operation** — validation, defaults, clamping, refusals, the nodes to create — one pure function in core (`planWallOpening`, `verifyScene`, `duplicateLevel`…).
3. **Executor** — applying to a store (the chat's live store, the MCP's bridge) and the result envelope (live sync, persistence). Surface context resolves here too: "the active floor" is what the person is viewing in the chat.

**The editor is the reference.** What a person can do by hand is what an agent may do: the operation reuses the editor tool's own rules (for openings: `clampDoorToWall`, `clampWindowToWall`, `findWallChildOverlap`, no openings on curved walls, overlap allowed only with force — the editor's Alt). An agent-only guard is the exception, kept only when it is sane and worth giving the editor too.

**Refusals are answers.** An operation that cannot do what was asked throws `AgentRefusal(code, message, details)` — "Wall wall_a is 0.80 m long, too short for a 0.90 m door." Both surfaces return `{ error, code, ...details }`; the code is stable and counted (per thread, per week), and the message says what would work.

**Tests follow the layers.** A tool's edge cases are written first as one table (e.g. `building/__fixtures__/wall-opening-cases.ts`) and run by three runners: the core operation, the MCP tool through a real client, the chat executor on the real store. A change that makes one layer disagree fails.

## What stays surface-specific

Hosted service tools have public contracts in `core/agent-tools` and a shared request operation in `core/agent-operations`. A host opts into them with `createPascalMcpServer({ services })` or `registerHostedServiceTools`. Without that executor, the open-source server exposes its local scene tools only. Tool arguments carry project/plugin references and an approved credit ceiling; the host supplies verified identity and enforces access, billing and retained-result ownership. Provider selection, workflow prompts and orchestration belong to the host. Public discovery includes only the released contract inventory.

- **Loop control** — step caps, progress ledgers, prompt injection. The chat owns its loop; MCP clients own theirs.
- **Session and file operations** of the MCP (scenes, units, templates, export) have no chat counterpart unless the chat needs them.
- **UI-bound chat tools** (current selection, clarification questions) get an MCP counterpart only when external agents need the same information.

## Tells that parity is broken

- A tool exists on one surface with no entry in the parity map.
- Two tools share a concept but not a schema — e.g. a length that accepts `"6 ft"` on one surface only.
- An agent on one surface hand-builds, through `apply_patch`, what the other surface does in one operation.
- A chat prompt rule has no counterpart in the agent guide, or a guide rule contradicts a tool description (`apply_patch` described as "batch-first is the default" while the skill says to prefer semantic tools).

## Enforcement

- `@pascal-app/core/agent-tools` holds the shared contracts; the hosted repo's `agent-surface-parity.test.ts` fails when a shared tool's name, description or input schema differs between the MCP and the chat. Tools still defined twice are tracked in its tool-surface alignment plan.
- `review-architecture` loads this page for changes under `packages/mcp/**` and `skills/**`.

## Stair capability parity

| Capability | Shared contract | Shared operation | MCP | Hosted AI chat |
|---|---|---|---|---|
| `measure_stair` | `measureStairTool` in `core/agent-tools` | `AGENT_OPERATIONS.measure_stair` | Shared-tool adapter; read-only measurements and layout alternatives | Needs hosted-chat registration and executor port (companion change in private-editor) |
| `fit_stair` | `fitStairTool` in `core/agent-tools` | `AGENT_OPERATIONS.fit_stair` | Shared-tool adapter; applies the planned changes atomically | Needs hosted-chat registration and executor port (companion change in private-editor) |

Both surfaces use the zod-only `@pascal-app/core/agent-tools` contracts and the plans in `@pascal-app/core/agent-operations`. The hosted-chat port needs registration, executor integration and parity tests. The published `pascal-3d` skill and MCP agent guide describe the same sizing, winder and measurement semantics. Design targets are preferences, not code certification; measurement reports only the modeled obstacles it supports.
