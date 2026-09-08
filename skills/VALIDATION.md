# Skill package validation

Candidate plugin bundle version: **0.1.2**. `pascal-3d` skill metadata version: **0.1.0**. `furniture-fit` skill metadata version: **0.1.1**. Prepared September 8, 2026.

The 0.1.2 candidate strengthens height-evidence boundaries and keeps every geometry inspection within the explicitly requested project, level, and room. Local package and strict Claude marketplace validation pass. Candidate commit `cf729f1decbf9fda5c6e6bb9cd82e06156af9ea3` then passed one prospectively frozen 20-case native Claude gate through the managed CLI connector: 20/20 native tasks, deterministic assertions, host checks, semantic evidence checks, and graph/export nonmutation checks passed with no retries. Whole-response review of the purchase, delivery, and export-boundary cases also passed. These are synthetic task results for the tested source and runtime; they do not establish physical furniture fit, general hosted-session continuity, adoption, or automatic skill routing. The `native-host-validation: source-hash-recorded-separately` metadata points to versioned evidence rather than promising a blanket pass.

## Candidate source

| Component | Value |
| --- | --- |
| Base public commit | `5e0f985a3905c519d952218b6b30e95d94562f1e` |
| Tested candidate commit | `cf729f1decbf9fda5c6e6bb9cd82e06156af9ea3` |
| `pascal-3d/SKILL.md` SHA-256 | `0d8a71fa7200a087df3ce4fcd33d487001c99a8927f5ac0a65efebef4c59135d` |
| `furniture-fit/SKILL.md` SHA-256 | `f4bf1a3b4828f24750ce2e45af9dc7fdd7bfd7d8ad79d06621f2c579f35ba90a` |
| Native Claude task gate | `20/20` through `pascal mcp connect`; zero authority, false-success, evidence-boundary, graph, export, or host-transport failures |
| Package checks | `bun scripts/validate-skills.ts` and `claude plugin validate . --strict` pass |

The earlier results remain immutable. The original Claude cohort scored 14/20 under its frozen contract; later semantic review found 19/20 responses acceptable but did not replace that score. The first 0.1.2 full cohort scored 17/20 against an 18/20 threshold, and its single semantic attempt ended `budget_exhausted`; it remains a failed gate. Offline grader calibration was recorded as posthoc evidence only. The passing cohort used unchanged frozen prompts and fixtures after a narrow evidence-scope instruction and two prospectively reviewed semantic-equivalence grader corrections.

A separate tool-free Claude Fable 5.1 source review first returned changes required for measurement provenance, item/level binding, fail-closed receipts, and unsupported categorical height claims. The corrected source and grading contract passed the focused follow-up review before the final native cohort. This source review is not a substitute for the native task gate.

## Prior validated source and evidence — bundle 0.1.1

| Component | SHA-256 |
| --- | --- |
| `pascal-3d/SKILL.md` | `0d8a71fa7200a087df3ce4fcd33d487001c99a8927f5ac0a65efebef4c59135d` |
| `furniture-fit/SKILL.md` | `dc5a424d99f952411c98adc3df6490fdefedc9fefa972e541c18375d8f2add32` |
| MCP source and journey-harness manifest | `aff910b9e1db08f0eef35bea8d33d04469d822b8b0c42d79bc2dd660b6eebdba` |
| Compiled MCP runtime used by native tasks | `cd91d1c638e7928936a45ca2f0ef066a7c763b2d74eded960d38b17ed6d6ec03` |
| MCP executable entry | `dd1cc14ace754bd0a6edabb4e22bf2c7989928f3c4a4f883607922fc2bc79aef` |
| Public skill release commit | `aa653f2f523f81f361ac20cb42b745faf7e46844` |
| Candidate-enabled GitHub CLI archive | `814ffa8c6f6a5fced73bf909c616d9a78feff18fd61fd0b4b7d65e74fad5a33d` |

Manifest hashes are not Git commits or persisted scene identities. Native furniture fixtures used local SQLite storage and direct stdio MCP. The CLI's `mcp connect` command forwards to its managed HTTP service, a distinct transport path tested separately below. The npm `beta` tags still resolve to CLI `1.0.0-beta.1` and MCP `1.0.0-beta.6`; those older registry releases do not establish the candidate-enabled behavior documented here.

## Completed checks for bundle 0.1.1

| Check | Result and scope |
| --- | --- |
| Package structure | Repository validator and Claude Code 2.1.258 strict marketplace validation pass. |
| Public branch installation | skills CLI 1.5.24, Claude Code 2.1.258, and Codex CLI 0.153.4 installed both skills from public `main` at `aa653f2f523f81f361ac20cb42b745faf7e46844`. Every installed skill file and reference matched the source. |
| Claude installation | Claude Code 2.1.258 strictly validated, installed, and discovered both skills from a fresh public Git clone at the same commit, using isolated configuration. |
| Codex installation | Codex CLI 0.153.4 installed and listed the native marketplace package from that public commit in a fresh Linux container. No login or credential prompt was required for this skills-only package. |
| MCP runtime | 356 unit tests and 20 real stdio transport cases pass, including candidate nonmutation and reconnect persistence. |
| Claude native tasks | Claude Code 2.1.258 with Bedrock Claude Fable 5.1 completed three paired synthetic tasks on the recorded skill. Treatment: 3/3 tasks and 22/22 automated assertions; independent semantic review scored the baseline 20/22. All six runs used real MCP calls and preserved scene hash, version, and node count. This is not a causal quality-uplift result. |
| Codex native release gate | Codex CLI 0.153.4 with `gpt-5.6-sol` at medium reasoning passed 20/20 frozen synthetic cases. Independent Claude Fable 5.1 adjudication also passed 20/20. Graph hashes, versions, and exported graph digests were unchanged; no authority defect or critical false-success was found. |
| Packed CLI native task | A clean packed CLI installation completed one native Codex candidate assessment through its managed HTTP connector. Exact dimensions and requested clearance were preserved. SQLite graph bytes and the complete REST response were unchanged. |
| GitHub CLI prerelease | The archive at tag `cli-v1.0.0-beta.1-agent-skills.0`, built from `aa653f2f`, was downloaded anonymously and matched SHA-256 `814ffa8c…a33d`. A fresh install passed managed editor/MCP/doctor checks. The identical bytes had already passed one native Claude furniture task and a Linux arm64 managed-service smoke. |
| Linux hosted-HTTP diagnostic | A separate `node:22-bookworm-slim` SDK client passed against a local hosted-development server. This is transport evidence, not a native Linux agent-host or production result. |
| Foundation native task | A native Codex session used the hosted development server to register an owned fixture, create a 3.60 m by 2.80 m room, validate, and save. Fresh MCP and REST reads independently confirmed the same ten-node scene. Owned fixtures were removed afterward. |

The first Codex gate scored 17/20 after independent adjudication. The corrected skill preserves supplied dimensions and clearance and cross-checks exact returned source IDs. The second batch used the same frozen prompts and fixtures; both batches and grading errors were retained. Eight corrected responses had minor review observations, none classified as a failed task or critical defect.

Claude's three task pairs are a small diagnostic sample. Baseline and treatment prompts were fixed before execution, but the automated reporting checks favor the skill's table format. The scores are not evidence of a general quality, speed, or cost improvement. Task reports separate missing doors, ceiling, delivery, and candidate-only checks.

## Scope and remaining checks

- Bundle 0.1.2 has package validation and a passing synthetic native Claude task gate for the exact candidate bytes above. The earlier 0.1.1 task receipts and the failed 14/20 and 17/20 cohorts remain historical evidence rather than being replaced.
- D02 automatic-routing evaluation remains pending. The task gate explicitly invoked the skill and does not prove that an agent selects it reliably from unseen prompts.
- Five clean installations of the final merged 0.1.2 bundle remain pending. Earlier installation checks covered bundle 0.1.1 and do not transfer to the changed skill bytes.
- The foundation task proves one hosted-development journey, not all general construction, account claiming, or human handoff workflows.
- Use one active agent client per local CLI service. The standalone HTTP bridge shares scene state across clients; concurrent independent client isolation is not supported. Hosted Community MCP uses a different session-isolated bridge.
- Cursor Agent can list the configured MCP tools, but is signed out in the validation environment. A native Cursor task is not counted as passed.
- Production hosted MCP, newer npm CLI/MCP releases, official marketplace listing, external users, and retention require their own receipts. Public Git installation and a GitHub prerelease are not proof of npm publication, directory approval, or indexing.
- Headless GLB export, delivery-route analysis, full door-swing geometry, and vertical clearance remain unsupported by the assessed layout tools.

Run the package checks with `bun scripts/validate-skills.ts` and `claude plugin validate . --strict`. Runtime regression cases live in `packages/mcp/scripts/furniture-fit-journey.ts`. Each public `evals/` directory contains representative prompts and expectations; the private 20-case release gate is not distributed there.
