# Handoff — `formwork-plan-remainder`

Written for the next agent picking this up cold. Not an OpenSpec artifact; the four artifacts beside it are the contract, this is the state of the desk they were left on.

## Read in this order

1. `wiki/formwork/implementation-status.md` — the standing narrative handoff for the whole formwork feature, ~880 lines. It is the source of truth for what is built and why. **Update it in the same commit as any code you write**, with test counts measured by running, not grepping.
2. `proposal.md` — why the remainder needs specs, and the eight capabilities.
3. `design.md` — the seven decisions and their rejected alternatives. Read this before `tasks.md`; several tasks are one line and only make sense against the decision behind them.
4. `specs/<capability>/spec.md` — the behaviour contracts. Each scenario is a test you owe.
5. `tasks.md` — 14 groups, 78 checkboxes, dependency-ordered.

The master plan the whole thing is measured against is `~/.claude/plans/currently-see-the-formwork-cozy-sky.md` (760 lines, 12 sections). It is outside the repo, so it is not in the submodule or on CI.

## Where the last session stopped

- **Last commit: `300e6d68`** `feat(formwork): let the reader take the move, then measure whether it worked` — the sequence-opt loop, 15 files, 613 insertions. All four gates passed on it.
- **Nothing in this change is committed.** `openspec/` is untracked, along with the OpenSpec tool scaffolding the CLI dropped in (`.agent/`, `.agents/skills/openspec-*/`, `.claude/commands/`, `.cursor/commands/`, `.pi/`) — 56 untracked files, none of them gitignored. **Decide with the user what of that scaffolding belongs in a public repo before committing it.** The artifacts themselves are `openspec/changes/formwork-plan-remainder/` plus `openspec/config.yaml` and an empty `openspec/specs/`.
- **No project code was touched** while planning. The working tree is otherwise clean.
- `openspec validate --changes --strict` passes: 1 passed, 0 failed.

## What is already built, and what these specs actually cover

Roughly 88% of the master plan's line items ship today. **These specs cover only the unbuilt remainder** — do not re-specify or refactor the working 88%. `openspec/specs/` is empty by design: no retrospective specs were written for shipped behaviour, because a delta describing what already ships can only go stale.

The completion table per phase (P0–P8) is in the status doc's "Completion at a glance". P1 88%, P2 93%, P3 89%, P4 100%, P5 85%, P6 75%, P7 82%, P8 82%.

## The two loops to copy, not reinvent

Task groups 11–13 (value engineering) are the **third** instance of a shape that already ships twice. Read both before writing any of it:

| | Core: the keyed decision | Nodes: plan + measure, mutates nothing | Surfaces |
|---|---|---|---|
| Findings | `packages/core/src/systems/formwork/validate/remedy.ts` | `fix-finding` | panel + `fix_formwork_finding` on both AI surfaces |
| Moves | `packages/core/src/systems/formwork/move-patch.ts` | `packages/nodes/src/formwork-assembly/apply-move.ts` | panel (two buttons) + `apply_pour_move` |

The pattern: core owns the key, the lookup and the refusal sentences; nodes returns the writes and the verdict **without mutating**; three thin callers each write in their own layer (panel via the store in one history step, chat against a plain graph, MCP via the operations bridge). Copy it. `design.md` explains why a generic abstraction over all three was rejected.

**The one thing easy to get backwards:** the saving key excludes the money; `moveKey` includes the days. That is deliberate and `design.md` says why. Do not "make them consistent".

## Traps that cost the last sessions real time

- **`bun run build` can exit 1 with no visible output.** Last session this was `.turbo/cache` filling the disk — the failure printed only as a trailing `WARNING IO error: No space left on device (os error 28)` after all 7 turbo tasks *succeeded*. The cache had reached **266 GB**. `.turbo` is gitignored and regenerable: `rm -rf .turbo/cache` fixes it. It is at **11 GB** as of this handoff; check it before diagnosing any silent build failure. If you need to read the build log, writing it to a file in the repo and reading that worked where pipes did not.
- **Cross-package tests read `dist/`, not `src/`.** `@pascal-app/*` resolves to compiled output, so a core change is invisible to a `packages/nodes`, `packages/mcp` or `apps/editor` test until you run `bun run --filter '@pascal-app/core' build` (then nodes). `tooling/check-dist-parity.mjs` is the gate. This bites on nearly every task in groups 1–3.
- **Anything reachable from `apps/editor/app/api/**/route.ts` is a Server Component.** A React client hook anywhere in that import graph fails `next build`. Reach pure functions through `@pascal-app/nodes/formwork-assembly/headless`, never the barrel. `apps/editor/lib/server-imports.test.ts` enforces it.
- **Run biome scoped to the paths you touched, never repo-wide.** There is ~1,300 lines of pre-existing formatting drift across 18 unrelated files. The user has explicitly asked for that as its **own separate cleanup commit** — sweeping it into a feature commit will be rejected.
- **Read `next build`'s warnings, not only its errors.** "Encountered unexpected file in NFT list" means a `path.*`/`fs.*` call over a value the tracer cannot see through pulled the whole project into a route.

## The four gates, before calling anything done

```
bun run check-types
bun test
bunx biome check --write   # scoped to touched paths only
bun run build
```

`check-types` and `bun test` pass on code `next build` rejects, so the build is not redundant.

**Baseline test counts** as recorded in the status doc (measured last session, unchanged since — nothing but planning files has been added): repo **4626 passing plus 1 skipped across 408 files**. Core 2042/124 files (1276 formwork). Nodes 1299+1 skipped/131 (369 in `formwork-assembly/`). MCP 460/47 (152 in `tools/formwork/formwork.test.ts`). Editor 487 plus 203 in `apps/editor/lib` (75 `chat-ai-project-formwork.test.ts`). Re-measure by running; if your number is lower than the baseline you deleted a test.

## Where to start, and what can go in parallel

Group order in `tasks.md` is dependency order, but only groups 1→2→3 and 11→12→13 are hard chains.

- **Start with group 1** (`solveFormwork` + the gap-carrying result shape). It unblocks group 2, and group 3's migrations are what make it worth anything. Nothing consumes it in group 1 — that is intentional.
- **Groups 4–10 are independent** of the pipeline and of each other, and each is shippable alone. Group 4 (catalog seed) is the most mechanical and the highest immediate value: registered-but-unseeded systems currently cannot be designed against at all.
- **Groups 11–13 (value engineering) go last**, because value engineering prices whatever the other groups changed.
- **Group 3 migrations must not share a commit with group 1.** Each migration carries its own unchanged-figure test over an existing fixture.

## What is blocked on something other than code

`formwork-standards-provenance` (group 8) cannot be fully closed by writing code. **DIN 18218:2010-01, CIRIA R108 (~£50), EN 13670, CESMM Class G, POMI** and several vendor datasheets must be bought or fetched before the constants resting on them move off `unverified`. Tasks 8.6 and 8.7 are written so the honest outcome — recording the citation *or* the procurement that blocks it — is a completable task either way. Do not invent values to close them; an invented constant reaching a client-facing money figure is the exact failure the capability exists to prevent.

## Standing constraints on how to work here

From `CLAUDE.md` and from the user directly:

- Read the full file before editing. Plan all changes, then make one complete edit.
- No back-compat shims, no dead code, no speculative abstractions.
- No new comments unless they explain a non-obvious **why**.
- Layer boundaries are enforced: `packages/core` is domain data and pure logic (no Three.js, no UI, no tools/modes/phases); `packages/viewer` knows nothing of the editor; `apps/editor` owns panels, tools and chat. See `wiki/architecture/`.
- Adding a node kind or an MCP tool has a registration checklist across four files, and one of them only fails at `check-types`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- When the user corrects you, stop and re-read their message. After two consecutive tool failures, change approach.

## Next step for whoever picks this up

Get the untracked-files question answered, commit the planning artifacts, then run `/opsx:apply` and start at task 1.1.
