---
id: 014
title: Strictness, acceptance & error escalation
status: approved
created: 2026-07-03
updated: 2026-07-03
---

# Strictness, acceptance & error escalation

User requirement (2026-07-03): developers control the level of tolerance — what
inputs a field accepts (ranges? approximations? typos?), how assumptions escalate,
and full customization of error copy. Design principle: **one teachable dial,
surgical overrides, and escalated failures that carry their own fix.**

## The dial

```ts
parseQuantity(text, { strictness: 'forgiving' | 'confirm' | 'strict' })
```

| mode | behavior |
|------|----------|
| `forgiving` (default) | Today's behavior: typos auto-corrected, ambiguities resolved deterministically, slang accepted — all flagged as warnings/infos riding on success. |
| `confirm` | **Nothing is silently assumed.** Every assumption-class issue (TYPO_CORRECTED, AMBIGUOUS_NUMBER, AMBIGUOUS_UNIT, AMBIGUOUS_DATE, UNIT_ASSUMED, SLANG_UNIT, RANGE_REVERSED, COMPOUND_OVERFLOW) keeps its code but **escalates to `severity: 'error'`** → `ok: false`. The would-have-been result is attached as `candidate` (below) so UIs offer one-click confirmation. |
| `strict` | `confirm` + input must be literal: typo pass off (`UNKNOWN_UNIT` with suggestions, never auto-fix), number words / fuzzy amounts off (`NO_VALUE` for "five kg"), fuzzy vocab off, approximation qualifiers rejected (`APPROX_NOT_ALLOWED`), bare numbers rejected unless `unit` option present. For machine-grade inputs (APIs, imports, agents validating agents). |

## The candidate contract (escalation with a fix attached)

```ts
interface FailResult {
  ok: false
  text: string
  issues: LingoIssue[]
  /** Present when a stricter mode rejected an interpretation that exists:
      the full result the forgiving path would have returned. */
  candidate?: Exclude<LingoResult, FailResult>
}
```

UX recipe (dom layer + docs): `if (!r.ok && r.candidate) → render "Did you mean
{candidate.…format()}?" with an accept affordance` → accepting calls
`field.set(candidate)`. This is the "proper escalation" story: errors that teach.

## Acceptance switches (what shapes a field takes)

```ts
accept?: {
  ranges?: boolean         // default true  · false → SINGLE_VALUE_EXPECTED (candidate = the range)
  conversions?: boolean    // default true  · false → CONVERSION_NOT_ALLOWED (candidate = converted)
  compounds?: boolean      // default true  · false → single value+unit only
  fuzzy?: boolean          // default true where vocab exists · false → no fuzzy fallback
  numberWords?: boolean    // default true  · false → digits only
  approximations?: boolean // default true  · false → about/~/ish/'a few' → APPROX_NOT_ALLOWED
  bareNumbers?: boolean    // default true (unit assumed when opts.unit/kind given) · false → UNIT_REQUIRED
}
```

Explicit `accept`/`tolerance` keys always override the `strictness` preset
(presets are just defaults bundles).

## Tolerance switches (how hard we try to understand)

```ts
tolerance?: {
  typos?: 'fix' | 'suggest' | 'off'        // default 'fix' (unique distance-1 auto-accept)
  ambiguity?: 'assume' | 'confirm'         // default 'assume' (+warning); 'confirm' escalates
}
```

## Severity overrides (surgical escalation)

```ts
escalate?: Partial<Record<IssueCode, 'error' | 'warning' | 'info'>>
// e.g. { AMBIGUOUS_NUMBER: 'error', UNIT_ASSUMED: 'info' }
```

Applied after presets. `ok` is recomputed from final severities. Message COPY
stays orthogonal: the existing `messages` option (string or `(data) => string`
per code) — both documented together as the error-UX section.

## New issue codes

`APPROX_NOT_ALLOWED`, `UNIT_REQUIRED`, `CONVERSION_NOT_ALLOWED` (+ existing
SINGLE_VALUE_EXPECTED reused for ranges-off). Escalated issues NEVER change code —
a TYPO_CORRECTED error is still TYPO_CORRECTED, so `messages` overrides keep
working across modes.

## DOM layer

`lingoInput` passes `strictness`/`accept`/`tolerance`/`escalate` through; exposes
`field.result.candidate`; when invalid-with-candidate, the hint slot renders the
did-you-mean copy (message code `DID_YOU_MEAN`? no — hint uses
`formatHint(candidate)` prefixed "did you mean", overridable via `messages.
SUGGESTION_PROMPT`? keep v1: `formatCandidate?: (r) => string` option, default
`Did you mean ${format}?`) with a click-to-accept button when the developer
provides `candidateElement`. Escalation timing unchanged (incomplete never
errors; commit-time announcement).

## Implementation notes

- Escalation is a post-pass in the grammar's result assembly: collect issues →
  apply preset + escalate map → recompute ok → if newly failing, move the ok
  result into `candidate`.
- `strict`'s "no number words" gate lives in the value layer via a ValueCtx flag;
  fuzzy-off gates tryFuzzy; approx-off turns qualifier/approx flags into issues.
- Date module honors the same options (AMBIGUOUS_DATE, WEEKDAY_ASSUMED_NEXT under
  confirm).
- Confidence unchanged (still reported; strictness is about acceptance, not
  scoring).
