# Skill package validation

Package version: **0.1.0**. Recorded September 8, 2026.

The `native-host-validation: source-hash-recorded-separately` metadata is a pointer to this record, not a blanket pass. Source and package checks do not establish task success on every host, real-world furniture installation, or market adoption.

## Evaluated source

| Component | SHA-256 |
| --- | --- |
| `furniture-fit/SKILL.md` | `7eaae2daee4322c3cbb937a21ffc5ebef4000f5e2e547c248717fe7f8d90aba7` |
| MCP implementation used by native tasks | `362105d01c95df3296b15d40cbe289872952b18e6f4e340897f564d685e84540` |
| Compiled MCP runtime used by native tasks | `cd91d1c638e7928936a45ca2f0ef066a7c763b2d74eded960d38b17ed6d6ec03` |

The implementation hash covers the evaluated runtime source manifest; it is not a Git commit. Native furniture fixtures used local SQLite storage and direct stdio MCP. The CLI's `mcp connect` command forwards to its managed HTTP service, a distinct transport path with separate runtime smoke and native-task checks. Published CLI and hosted versions must be checked separately. The skill gained an explicit input and source-ID cross-check after these initial trials; its final evaluation is pending.

## Completed checks

| Check | Result and scope |
| --- | --- |
| Package structure | Repository validator and Claude Code 2.1.258 strict marketplace validation pass. |
| Codex installation | Codex CLI 0.153.4 installed and listed the final native marketplace package in a fresh Linux container. No login or credential prompt was required for this skills-only package. |
| MCP runtime | 356 unit tests and 20 real stdio transport cases pass, including candidate nonmutation and reconnect persistence. |
| Claude native tasks | Claude Code 2.1.258 with Bedrock Claude Fable 5.1 completed three paired synthetic tasks. With `furniture-fit`: 3/3 tasks and 22/22 assertions. Without the skill: 14/22 assertions. All six runs used real MCP calls and preserved scene hash, version, and node count. |
| Codex native release gate | Final 20-case suite is in progress; no passing claim is made yet. |

Claude's three task pairs are a small diagnostic sample. They do not establish a general performance uplift. Baseline and treatment prompts were fixed before execution; task reports explicitly separated missing doors, ceiling, delivery, and candidate-only checks.

## Unverified paths

- `pascal-3d` has source, packaging, and fixture review; the furniture-specific native results do not prove all general construction and hosted account workflows.
- Use one active agent client per local CLI service. The standalone HTTP bridge shares scene state across clients; concurrent independent client isolation is not supported. Hosted Community MCP uses a different session-isolated bridge.
- Cursor Agent can list the configured MCP tools, but is signed out in the validation environment. A native Cursor task is not counted as passed.
- Hosted MCP, published beta CLI installation, official marketplace listing, external users, and retention require their own receipts.
- Headless GLB export, delivery-route analysis, full door-swing geometry, and vertical clearance remain unsupported by the assessed layout tools.

Run the package checks with `bun scripts/validate-skills.ts` and `claude plugin validate . --strict`. Runtime regression cases live in `packages/mcp/scripts/furniture-fit-journey.ts`; native task prompts and expectations are bundled under each skill's `evals/` directory.
