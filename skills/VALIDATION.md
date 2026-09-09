# Skill package validation

Bundle version: **0.1.4**. `pascal-3d` skill metadata version: **0.1.0**. `furniture-fit` skill metadata version: **0.1.3**. Prepared September 9, 2026.

## Bundle 0.1.4 candidate validation

This unreleased candidate adds exactly one structured, blocker-aware `nextAction` to each furniture-fit report. The action follows the unresolved part of the user's requested decision: a passing footprint with unresolved height evidence requests the decisive measurement; a failed footprint offers a pose only when known geometry supports one; exhausted poses request a user-supplied alternate instead of inventing one; and a prospective candidate excluded from the door check requests a candidate-aware read-only check. Only a result with no unresolved requested blocker offers an optional related item or pose check. Every next action carries available project/revision context and states that it does not authorize project mutation, account or workspace changes, publication, rendering or generation work, or additional spending.

The candidate `furniture-fit/SKILL.md` SHA-256 is `52f050d487344afe2ee401cbca15722cc15b875f06d4537aab9e91cffbab0760`. Package validation and strict plugin-manifest validation cover the source shape, bundled references, canonical authority and cost boundaries across every example, and structured semantic next-action cases with exact required evidence vectors, including eval 2's passing-pose, failed-pose, and missing-height combination. No native agent-host task cohort, clean installation, publication, marketplace review, external adoption, or retention result is claimed for bundle 0.1.4; the skill metadata therefore records `package-checks-only`.

## Prior bundle 0.1.3 validation

This release adds a fail-closed input gate for furniture assessments. When the request itself establishes that a decisive dimension, room scale, target, pose, or clearance is missing, the skill preserves the supplied facts and asks only for the blocking input instead of producing conditional fit thresholds. A minimal read-only scene lookup remains allowed when it can resolve that value from existing measured evidence; assessment and mutation calls remain blocked until the input is resolved.

The exact `furniture-fit/SKILL.md` bytes at SHA-256 `c5283ef5d593f7c8beb66d20d8131966305b24b27104398f42343498138a1bd4` passed one prospectively frozen three-case native Claude Fable 5.1 gate: both decisive-missing-input cases made zero Pascal MCP calls, and the complete-input control used the real read-only candidate collision path while preserving the graph hash, version, and export bytes. All three deterministic outcomes and all 12 separately judged semantic criteria passed without task retries. The semantic judge ran in a separate first-party Fable process whose receipt reported no tools, MCP servers, plugins, or tool calls. The prior three-case diagnostic with an ambient Codex MCP configuration remains a failed promotion gate and was not rescored or replaced.

The two setup references changed after that exact skill-body gate. Their release checks are separate: extracted Claude commands rejected unset and empty keys, preserved an existing synthetic key, stored the exact header in private user configuration, and were visible from two isolated working directories; extracted Codex commands stored only the `PASCAL_API_KEY` environment-variable name after explicit placeholder replacement. Package validation, strict Claude marketplace validation, and diff checks pass for the combined bundle. These setup checks do not turn the skill-body task receipt into a blanket whole-bundle native claim.

The 0.1.2 candidate strengthens height-evidence boundaries and keeps every geometry inspection within the explicitly requested project, level, and room. Local package and strict Claude marketplace validation pass. Candidate commit `cf729f1decbf9fda5c6e6bb9cd82e06156af9ea3` then passed one prospectively frozen 20-case native Claude gate through the managed CLI connector: 20/20 native tasks, deterministic assertions, host checks, semantic evidence checks, and graph/export nonmutation checks passed with no retries. Whole-response review of the purchase, delivery, and export-boundary cases also passed. Those skill and package-manifest bytes were merged to public `main` at `72d4451202e79bbbb22090016543874a7c2e9836` and installed successfully through five fresh Claude configurations, a clean skills.sh project install, and a clean isolated Codex Git marketplace install. These are synthetic task and package-installation results for the tested source; they do not establish physical furniture fit, general hosted-session continuity, adoption, or automatic skill routing. The `native-host-validation: source-hash-recorded-separately` metadata points to versioned evidence rather than promising a blanket pass.

## Candidate source

| Component | Value |
| --- | --- |
| Base public commit | `5e0f985a3905c519d952218b6b30e95d94562f1e` |
| Tested candidate commit | `cf729f1decbf9fda5c6e6bb9cd82e06156af9ea3` |
| Public merge commit | `72d4451202e79bbbb22090016543874a7c2e9836` |
| `pascal-3d/SKILL.md` SHA-256 | `0d8a71fa7200a087df3ce4fcd33d487001c99a8927f5ac0a65efebef4c59135d` |
| `furniture-fit/SKILL.md` SHA-256 | `f4bf1a3b4828f24750ce2e45af9dc7fdd7bfd7d8ad79d06621f2c579f35ba90a` |
| Native Claude task gate | `20/20` through `pascal mcp connect`; zero authority, false-success, evidence-boundary, graph, export, or host-transport failures |
| D02 automatic-routing baseline | Failed at frozen `94/100` against the `95/100` threshold: `94/96` structurally valid observations were correct, while four invalid observations count as failures; both positive classes were `25/25`, and the two negative activation ceilings passed exactly with no headroom |
| Post-merge Claude installation | At merge commit `72d4451202e79bbbb22090016543874a7c2e9836`, `5/5` fresh isolated configurations installed bundle `0.1.2`; all 22 canonical skill and manifest files matched digest `c970e5df…9102` |
| Post-merge skills.sh installation | At merge commit `72d4451202e79bbbb22090016543874a7c2e9836`, skills CLI `1.5.24` copied both skills into a clean project; all 18 skill files matched source digest `cbb4ee93…6843` |
| Post-merge Codex installation | At merge commit `72d4451202e79bbbb22090016543874a7c2e9836`, Codex CLI `0.153.4` installed bundle `0.1.2` from the exact Git marketplace commit; all 22 canonical skill and manifest files matched digest `c970e5df…9102` |
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
- The save-and-disconnect precondition added to the preview setup references after merge `72d4451202e79bbbb22090016543874a7c2e9836` is a documentation-only safety correction. The historical installation digests above apply to that merge and do not claim byte identity for these revised setup references.
- The single-run D02 automatic-routing baseline failed and was not rerun. It recorded two semantic false activations and four budget-limit invalid observations: `96/100` observations were structurally valid, `94/96` valid observations were correct, and the frozen score remains `94/100` because invalid observations count as failures. Each skill's precision was `25/26`; the per-class and combined negative activation ceilings passed exactly with no headroom. Forty-six terminal cost receipts total `$6.7027235`; 54 early Skill captures have unknown cost rather than zero cost. Independent audit reproduced the score byte-for-byte and verified all 388 manifest entries without finding a material defect. There is no automatic-routing promotion or improvement claim because no prior-version comparison ran.
- Five clean Claude marketplace installations of the final merged 0.1.2 bundle pass. These verify installation and byte identity only; they are not five additional native task runs and did not install or validate a Pascal CLI runtime.
- Clean skills.sh and Codex Git marketplace installations also pass against the exact merge commit. These are package-install checks, not native task proof; neither installed nor validated a Pascal CLI or MCP runtime.
- The foundation task proves one hosted-development journey, not all general construction, account claiming, or human handoff workflows.
- Use one active agent client per local CLI service. The standalone HTTP bridge shares scene state across clients; concurrent independent client isolation is not supported. Hosted Community MCP uses a different session-isolated bridge.
- Cursor Agent can list the configured MCP tools, but is signed out in the validation environment. A native Cursor task is not counted as passed.
- Production hosted MCP, newer npm CLI/MCP releases, official marketplace listing, external users, and retention require their own receipts. Public Git installation and a GitHub prerelease are not proof of npm publication, directory approval, or indexing.
- Headless GLB export, delivery-route analysis, full door-swing geometry, and vertical clearance remain unsupported by the assessed layout tools.

Run the package checks with `bun scripts/validate-skills.ts` and `claude plugin validate . --strict`. Runtime regression cases live in `packages/mcp/scripts/furniture-fit-journey.ts`. Each public `evals/` directory contains representative prompts and expectations; the private 20-case release gate is not distributed there.
