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
- **Agent first, by hand second.** Pascal is built agent-first. When a person could do by hand what an agent tool does, offer that alternative, in the same change or as a follow-up, reading the same core rule; it never blocks an agent tool from shipping. Example: `place_items` refuses a floor item in a door's clearance or too large for its room (`blocks_door`, `too_large_for_room`), and the editor's item tool warns about the same placement while the item is placed or moved, from the same check (`floorItemFit` in `core/building`).

### Parity by layer

A tool has three layers, and only the last one may differ between surfaces:

1. **Contract** — name, description, input schema — one definition in `@pascal-app/core/agent-tools` (a plugin's tool: in the plugin, see [Plugin tools](#plugin-tools)), registered by the MCP and defined by the chat from the same object. Kept zod-only: the chat declares tools inside a sandbox that rejects Node-dependent packages (`contracts-purity.test.ts`).
2. **Operation** — validation, defaults, clamping, refusals, the nodes to create — one pure function in core (`planWallOpening`, `verifyScene`, `duplicateLevel`…).
3. **Executor** — applying to a store (the chat's live store, the MCP's bridge) and the result envelope (live sync, persistence). Surface context resolves here too: "the active floor" is what the person is viewing in the chat. An edit that reads construction the host derives (re-derived rooms, auto ceilings, floor plates — the room and floor tools) returns `afterReconcile`; both hosts run it through `applyAgentOutcome` with their own reconciler, in one undo step.

**The editor is the reference.** What a person can do by hand is what an agent may do: the operation reuses the editor tool's own rules (for openings: `clampDoorToWall`, `clampWindowToWall`, `findWallChildOverlap`, no openings on curved walls, overlap allowed only with force — the editor's Alt; a window style only on a Fixed window, as the panel offers it, one entry per look: `picture` is accepted as an alias of `single`). An agent-only guard is the exception, kept only when it is sane and worth giving the editor too.

**Refusals are answers.** An operation that cannot do what was asked throws `AgentRefusal(code, message, details)` — "Wall wall_a is 0.80 m long, too short for a 0.90 m door." Both surfaces return `{ error, code, ...details }`; the code is stable and counted (per thread, per week), and the message says what would work.

**Tests follow the layers.** A tool's edge cases are written first as one table (e.g. `building/__fixtures__/wall-opening-cases.ts`, or the shared `agent-operations/__fixtures__/cases.ts`) and run by three runners: the core operation (`operations.test.ts`), the MCP tool through a real client (`shared-tools.test.ts`), the chat executor on the real store. A change that makes one layer disagree fails.

## Adding a tool to both surfaces

A tool is written once and registered twice; never build the same tool separately for the chat and the MCP.

1. **Contract** in `packages/core/src/agent-tools/<area>.ts`: `{ name, title, description, input }`, zod only, and added to `AGENT_TOOL_CONTRACTS` (`agent-tools/index.ts`). The description is what both agents read: say what it does, its defaults, and its refusal codes.
2. **Operation** in `packages/core/src/agent-operations/`: a pure function over the scene's nodes that returns `{ result, changes }` and refuses with `refuse(code, message, details)`; registered by tool name in `AGENT_OPERATIONS`.
3. **Cases** in the shared fixture table, written failing first; the core and MCP runners pick them up.
4. **MCP**: an entry in `SHARED_TOOLS` (`packages/mcp/src/tools/shared-tools.ts`) with its annotations and output schema; the annotation policy (`scripts/openai-tool-annotation-policy.ts`) and `plugin-evals/tool-annotation-justifications.json` list it.
5. **Hosted chat**: the hosted repo defines its chat tool from the same contract and runs the same operation through its shared-tool executor; its `agent-surface-parity.test.ts` checks that the two surfaces' name, description and input schema match.
6. **By hand**, where possible: offer the editor's alternative, in the same change or as a follow-up. It never holds the tool back (agent first).
7. **Knowledge**: the `pascal-3d` skill, the agent guide (`pascal://agent-guide`) and the MCP README's tool table.

A tool that needs something only a host has keeps the same contract and operation; the host passes the missing piece to `createPascalMcpServer`. Without a renderer (`sceneViews`) or a script runtime (`geometryScripts`) the tool still exists and answers with a code (`view_unavailable`, `scripts_unavailable`); without a `catalog` the item tools draw from a small built-in list; hosted service tools are registered only with a `services` executor.

## Plugin tools

A plugin's tools keep the three layers; the plugin owns the first two instead of core (E-016). The contract is in its `./agent-tools` export, a `PluginAgentTools` of `PluginAgentTool`s (an `AgentToolContract` plus where it runs), zod only under the same purity rule. The operation of each `runsIn: 'operation'` tool is in its `./agent-operations` export, an `AgentOperations`. The executor is the host's. Both surfaces register from those same objects:

- **MCP**: `registerOperationTool(server, operations, { contract, operation, annotations })` from `@pascal-app/mcp/tools/shared-tools`, the runner of the shared tools: parse, plan, apply in one history step, `achieved`, the persistence envelope, refusals as `{ error, code }`. A `runsIn: 'editor'` tool needs an editor tab: the host routes it to one, as `view_scene` does, or refuses with a code.
- **Hosted chat**: the same contract defines the chat tool; `'operation'` tools run on the live store through its shared-tool executor, `'editor'` tools through the plugin's `PluginChatExtension.execute`.

Beyond the rules above:

- **Offered by the host.** A plugin's tools are offered only where the plugin is installed and the host's policy allows. A client's list of tools, or its claim that a plugin is installed, is never trusted.
- **Annotations from the host.** The host classifies each tool from its own review and registers it with its own annotations; a contract's `annotations` are the plugin's hints and never decide a write scope, a retry or an approval. A tool the host has not classified is not registered.
- **Versioned.** `PluginAgentTools.version` is the revision of the plugin's contracts; a host that runs long turns pins the revision a turn was offered.
- **Exceptions are recorded.** `chatOnly` is a request, honoured only as a reviewed exception to capability parity, written down like any other.
- **One name each.** A plugin tool's name collides with no core tool and no other plugin's; prefix it with the plugin.
- **Tests follow the layers.** The plugin's edge cases as one table, run against its operation and through `registerOperationTool` with a real client; `shared-tools.test.ts` does this for a synthetic plugin.

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
| `create_stair` | `createStairTool` in `core/agent-tools` | `AGENT_OPERATIONS.create_stair` | Shared-tool adapter; sizes the flight as the editor's stair tool does (`planStairCreation`) and owns the floor openings it cuts | Same contract and operation, one undo step |
| `measure_stair` | `measureStairTool` in `core/agent-tools` | `AGENT_OPERATIONS.measure_stair` | Shared-tool adapter; read-only measurements and layout alternatives | Same contract and operation, read-only |
| `fit_stair` | `fitStairTool` in `core/agent-tools` | `AGENT_OPERATIONS.fit_stair` | Shared-tool adapter; applies the planned changes atomically | Same contract and operation, one undo step |

Both surfaces use the zod-only `@pascal-app/core/agent-tools` contracts and the plans in `@pascal-app/core/agent-operations`. The published `pascal-3d` skill and MCP agent guide describe the same sizing, winder and measurement semantics. Design targets are preferences, not code certification; measurement reports only the modeled obstacles it supports.

## Looking at the scene: `view_scene`

One contract (`viewSceneTool`) and one plan (`sceneViewPlan` in `core/agent-operations`): the plan turns the request (a target, a side or an exact eye, a projection, a photo's camera) into a camera pose and an image size, and, when a photo region is given, a crop of the photo to return beside the view. Only the rendering differs by surface:

- **Hosted chat**: the editor in the same page renders the pose.
- **MCP**: the server has no renderer. It asks the host's `sceneViews` (a `SceneViewHost`, passed to `createPascalMcpServer`) for a capture of the active project. The hosted Pascal app answers through the person's editor tab open on that project, as a screenshot job the tab runs; with no tab open the call is refused `editor_tab_required` with the editor link, and with the tab in the background `editor_tab_hidden`, so the agent asks the person to bring it forward. A server without a `sceneViews` host refuses `view_unavailable`; a session with no project, `no_project`; a photo crop the host cannot make, `photo_crop_unavailable`.

The answer is the picture plus the pose it was taken from, and which tab rendered it and when. A picture is not a measure: sizes and counts come from the tools.

## Emptying a project: `clear_scene`

A write that would leave a populated project empty is far more often an accident than an intent, so a store may refuse it: the save options carry `allowSceneWipe`, and without it a guarding store throws `SceneWipeBlockedError` (a `SceneInvalidError`). Live sync answers that refusal as `scene_wipe_blocked` with `mutationApplied: false` and loads the stored scene back into the session, so the agent's next write builds on the project as stored; when the stored scene cannot be read back, it says to call `load_scene` first.

`clear_scene` is the only way to empty a project on purpose: it resets the scene to the host's default scaffold (a site, a building, one level), keeps the project's installed plugins, clears the undo history, and saves with `allowSceneWipe`. Its `reason` says what the person asked. The by-hand counterpart is the hosted editor's **Clear the project**, offered on the notice when a save is refused as a wipe. A store with no wipe guard (the local SQLite store) saves either way.
