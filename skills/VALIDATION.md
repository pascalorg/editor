# Skill package validation

Package version: **0.1.0**. Recorded September 8, 2026.

The `native-host-validation: source-hash-recorded-separately` metadata is a pointer to this record, not a blanket pass. Source and package checks do not establish task success on every host, real-world furniture installation, or market adoption.

## Evaluated source

| Component | SHA-256 |
| --- | --- |
| `pascal-3d/SKILL.md` | `0d8a71fa7200a087df3ce4fcd33d487001c99a8927f5ac0a65efebef4c59135d` |
| `furniture-fit/SKILL.md` | `dc5a424d99f952411c98adc3df6490fdefedc9fefa972e541c18375d8f2add32` |
| MCP source and journey-harness manifest | `aff910b9e1db08f0eef35bea8d33d04469d822b8b0c42d79bc2dd660b6eebdba` |
| Compiled MCP runtime used by native tasks | `cd91d1c638e7928936a45ca2f0ef066a7c763b2d74eded960d38b17ed6d6ec03` |
| MCP executable entry | `dd1cc14ace754bd0a6edabb4e22bf2c7989928f3c4a4f883607922fc2bc79aef` |

Manifest hashes are not Git commits or persisted scene identities. Native furniture fixtures used local SQLite storage and direct stdio MCP. The CLI's `mcp connect` command forwards to its managed HTTP service, a distinct transport path tested separately below. These observations were collected before beta publication; they do not establish the behavior of every published or deployed version.

## Completed checks

| Check | Result and scope |
| --- | --- |
| Package structure | Repository validator and Claude Code 2.1.258 strict marketplace validation pass. |
| Public branch installation | skills CLI 1.5.24 installed both skills from public commit `ef1d03188ab98e8eba550a9ed4618c8c794eb0b3` for Claude and Codex. Every installed skill file and reference matched the source. |
| Claude installation | Claude Code 2.1.258 strictly validated, installed, and discovered both skills from a fresh public Git clone at the same commit, using isolated configuration. |
| Codex installation | Codex CLI 0.153.4 installed and listed the native marketplace package from that public commit in a fresh Linux container. No login or credential prompt was required for this skills-only package. |
| MCP runtime | 356 unit tests and 20 real stdio transport cases pass, including candidate nonmutation and reconnect persistence. |
| Claude native tasks | Claude Code 2.1.258 with Bedrock Claude Fable 5.1 completed three paired synthetic tasks on the recorded skill. Treatment: 3/3 tasks and 22/22 automated assertions. All six runs used real MCP calls and preserved scene hash, version, and node count. |
| Codex native release gate | Codex CLI 0.153.4 with `gpt-5.6-sol` at medium reasoning passed 20/20 frozen synthetic cases. Independent Claude Fable 5.1 adjudication also passed 20/20. Graph hashes, versions, and exported graph digests were unchanged; no authority defect or critical false-success was found. |
| Packed CLI native task | A clean packed CLI installation completed one native Codex candidate assessment through its managed HTTP connector. Exact dimensions and requested clearance were preserved. SQLite graph bytes and the complete REST response were unchanged. |
| Foundation native task | A native Codex session used the hosted development server to register an owned fixture, create a 3.60 m by 2.80 m room, validate, and save. Fresh MCP and REST reads independently confirmed the same ten-node scene. Owned fixtures were removed afterward. |

The first Codex gate scored 17/20 after independent adjudication. The corrected skill preserves supplied dimensions and clearance and cross-checks exact returned source IDs. The second batch used the same frozen prompts and fixtures; both batches and grading errors were retained. Eight corrected responses had minor review observations, none classified as a failed task or critical defect.

Claude's three task pairs are a small diagnostic sample. Baseline and treatment prompts were fixed before execution, but the automated reporting checks favor the skill's table format. The scores are not evidence of a general quality, speed, or cost improvement. Task reports separate missing doors, ceiling, delivery, and candidate-only checks.

## Scope and remaining checks

- The foundation task proves one hosted-development journey, not all general construction, account claiming, or human handoff workflows.
- Use one active agent client per local CLI service. The standalone HTTP bridge shares scene state across clients; concurrent independent client isolation is not supported. Hosted Community MCP uses a different session-isolated bridge.
- Cursor Agent can list the configured MCP tools, but is signed out in the validation environment. A native Cursor task is not counted as passed.
- Production hosted MCP, installation from the published beta/default branch, official marketplace listing, external users, and retention require their own receipts. A public Git install is not proof of directory approval or indexing.
- Headless GLB export, delivery-route analysis, full door-swing geometry, and vertical clearance remain unsupported by the assessed layout tools.

Run the package checks with `bun scripts/validate-skills.ts` and `claude plugin validate . --strict`. Runtime regression cases live in `packages/mcp/scripts/furniture-fit-journey.ts`; native task prompts and expectations are bundled under each skill's `evals/` directory.
