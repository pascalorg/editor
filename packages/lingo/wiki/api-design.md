# API design

*How lingo's public surface gets designed, extended, and reviewed. Read before
adding or changing any exported symbol, option, issue code, or unit. The
result-shape philosophy is spec'd in plans 001/009/014; this page is the
operational rulebook distilled from them. For resource-style output object
modeling, use [`resource-design.md`](resource-design.md).*

## Design in the plan first

Public API starts as a **Design section in a plan** — real TypeScript
signatures in fenced blocks, not prose — marked `(locked-in YYYY-MM-DD)` once
settled. Implementation diverging from the sketch updates the plan in the same
change. The plan's Acceptance section names the gates that prove it done.

## Shape rules

1. **One text argument, one options bag.** `parse*(text, opts?)`. New knobs are
   options-bag fields with defaults that preserve current behavior; no
   positional parameters, no boolean traps.
2. **Results are versioned discriminated unions** — switch on `.type`;
   `schemaVersion: 3` makes serialized parse results self-identifying (flat
   shape, self-describing spans — D57), and `ok` is the success discriminator.
   `issues` always rides along (warnings/infos accompany success). Failed
   results use `type:'failure'` and attach `candidate` where a plausible
   reading exists; successful ambiguous results attach ranked `alternatives`
   (CONTEXT.md draws the candidate/alternative/suggestion line).
3. **Spans are mandatory** on every parse-path issue, indexing the original
   input (hard rule 3). The sole exception is field-level `RANGE_MIN`/`RANGE_MAX`
   from the `/ai` fields: they're built after a successful parse, with no text
   to point at, so they carry no span (documented on `LingoIssue.span`).
4. **Strictness composes; it doesn't fork.** New leniency/safety behavior plugs
   into the existing dials — `strictness`, `accept`, `tolerance`, `escalate` —
   rather than adding a parallel mechanism. `/ai` fields may ship stricter
   *defaults* (D20), but through the same dials, always with a one-line escape
   hatch.
5. **New issue codes ship complete:** English copy in the message pack, typed
   `data` payload in `IssueDataMap`, README + llms.txt listings, corpus cases,
   and escalate-ability. Codes are add-only; renaming one is breaking.
6. **Deterministic and serializable.** Explicit `now`, no locale sniffing, no
   hidden clock or environment reads; results survive
   `toJSON()`/`fromJSON()`.
7. **Two-way.** Anything new that formats or humanizes must re-parse to the
   same value, with round-trip tests.

## Semver — the sharpened rule

**Changing the interpretation of previously-valid input is MAJOR**, even if no
API changed (D4). Mechanically: `scripts/corpus-diff.mjs` classifies every
change against the corpus contract —

- **ADDITIVE** (inputs that previously failed now parse; new codes on new
  paths): minor.
- **BREAKING** (an existing corpus entry's value, type, unit, or issue set
  changed): major + a `decisions.md` entry making the case.

New warnings on previously-clean parses count as interpretation changes —
they're visible to `escalate` users. The gate catches this; don't argue with
it, write the D-entry.

## Size & tree-shaking

- Every entry has a budget; `scripts/size.mjs` is the single source of truth.
  Over budget ⇒ tree-shake, cut, or write the recalibration D-entry (D11/D14/
  D17 pattern). Overruns stop and escalate — never land silently (D19 records
  the one breach and its post-hoc cost).
- A feature that drags a heavy graph (the date engine, say) into a lean entry
  needs either its own entry or a shakeability gate like `./ai`'s
  quantityField-only budget — the gate exists so refactors can't silently
  re-couple.

## Review checklist (use for PRs touching public API)

1. Plan Design section matches what shipped (or was amended in this PR)?
2. Semver impact stated; corpus-diff class checked (BREAKING ⇒ D-entry)?
3. Zero new runtime deps — `check-zero-deps` green?
4. Every new issue carries a span; candidate/alternatives attached where the
   shape rules promise them?
5. Two-way: new formatted/humanized output re-parses, round-trip tested?
6. Determinism: explicit `now` respected; no `Date.now()`/locale sniffing?
7. TSDoc `@example` on every new export; README/llms.txt/CHANGELOG/site synced?
8. Corpus cases added; hostile inputs considered?
9. Size budgets green — or the recalibration case written?
10. New codes have message-pack copy; `/core` stays copy-free (D14)?
11. Resource-style output changes follow `wiki/resource-design.md`?

If the change fully complies, say so explicitly — don't invent nits to appear
thorough.
