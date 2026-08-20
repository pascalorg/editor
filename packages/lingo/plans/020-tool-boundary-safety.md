---
id: 020
title: Tool-boundary safety defaults (/ai v2)
status: done
created: 2026-07-04
updated: 2026-07-07
---

# Tool-boundary safety defaults — make "LLM tools safer" true by default

Driver: the tagline-alignment review (D20). The `/ai` fields are the boundary
the tagline names, yet they defaulted to the form-field posture: warnings
swallowed on success, no bounds, open object schemas, wall-clock reference
dates. Verified failure scenarios: `"1,234 kg"` →
1234 silently (alternative 1.234 dropped); `"3pm EST"` → 15:00 host-zone with
TZ_IGNORED discarded; `"tomorrow"` resolved at retry time; `-5 kg` / `2000000 kg`
accepted; `additionalProperties: true` rejected by OpenAI strict mode.

## Design principle

The two halves of the tagline want different defaults from one parser. Human
fields keep `forgiving` (errors are UX; a person reads the hint). Tool fields
escalate **only the dangerous-ambiguity subset** — a blanket `confirm` default
would gut the absorption value that makes lingo better than naive coercion, and
would fail our own eval regression gates (`lingo acceptance ≥ naive per
category`, `tests/ai-eval.test.mjs`).

Why surgical, not blanket (each backed by the eval corpus):

- `TYPO_CORRECTED` / `SLANG_UNIT` stay warnings: absorbing model sloppiness IS
  the product (`typod-slang-units` category expects acceptance).
- `UNIT_ASSUMED` stays a warning: the field's input schema *tells* the model the
  canonical unit ("canonicalized to kg"), so a bare number is the schema
  contract, not a guess (`unit-omission` category; naive accepts these, gate
  requires lingo ≥ naive).
- `AMBIGUOUS_DATE` stays a warning: it is emitted even when `dayFirst` is
  explicitly configured, and the `date-drift` category (naive accepts all 16)
  would invert the gate. Surfaced via the warnings channel; one-line escalate
  for stricter tools.
- `AMBIGUOUS_NUMBER` escalates to **error**: `1,234` is a silent 1000× trap with
  a machine-actionable candidate ("Did you mean 1234 kg?"). Naive rejects these
  anyway (`Number("1,234")` → NaN), so gates hold.

## Changes

2026-07-06 supersession: D36 moved the reference-time guard into the core date
parser. The `/ai` field still owns the tool-boundary default, but it no longer
has to probe a hidden wall-clock candidate.

1. **Escalation defaults.** `quantityField`/`rangeField`: effective options =
   `{ ...opts, escalate: { AMBIGUOUS_NUMBER: 'error', ...opts.escalate } }`.
   `dateField`: `{ ...opts, escalate: { TZ_IGNORED: 'error', ...opts.escalate } }`.
   User-overridable by passing the code back at a lower severity.
2. **Reference-dependent dates require `now`.** `dateField` option
   `requireNow?: boolean` (default `true`). When `now` is absent, inputs such as
   `"tomorrow"`, `"March 5"`, and `"at 3pm"` fail with `NOW_REQUIRED` and no
   implicit candidate. Fully absolute dates are unaffected. Opt out with
   `requireNow: false`, which resolves from the wall clock at the field
   boundary rather than inside core parsing.
3. **Warnings surfaced on success.** `safeParse` success gains
   `warnings?: FieldWarning[]` (`{ code, severity, message }`) — a
   standard-compliant extra property (`issues` stays `undefined`, preserving the
   Standard Schema discriminator). `canonicalizeValues` issues become
   `{ path, message, severity: 'error' | 'warning', code? }`; warnings are
   reported while the canonical value is still applied. `repairTextWith`
   repairs when there are no **error**-severity issues (warnings no longer
   block repair).
4. **Bounds.** `min?` / `max?` on quantity fields (numbers in the field's
   `unit`), on range fields (applied to both ends), and on `dateField`
   (`Date | ISO string`). Violations fail with RANGE_MIN / RANGE_MAX (existing
   codes + en copy, values formatted with the unit). JSON Schema: output gains
   `minimum`/`maximum`; input **description** states the accepted window so the
   model is steered before generation (dates: description only — JSON Schema
   has no date bounds).
5. **Closed object schemas.** `lingoObject(shape, opts?)` with
   `passthrough?: boolean` (default `false`): unknown keys fail with
   `Unexpected property "x"`; input AND output schemas emit
   `additionalProperties: false`. `InferLingoObject` drops the
   `& Record<string, unknown>` index. `passthrough: true` restores v1 behavior.
   New structural test asserts OpenAI-strict compatibility for every emitted
   object node (`additionalProperties === false`, `required` = all keys).
6. **Float-safe outputs.** Canonical numbers pass through
   `Number(value.toPrecision(12))` (kills `1.3607771100000001`; plan 019 polish
   item).
7. **Numeric input policy.** Raw JSON numbers keep coercing through the string
   path; under the new defaults a bare number is accepted in the schema's unit
   with a surfaced UNIT_ASSUMED warning (documented; escalate for strict tools).

## Non-goals

- Core `ParseOptions` min/max (field-level covers the tool boundary; a core
  lift is a separate, corpus-affecting decision).
- Changing the eval corpus or its gates.
- New MCP entry point (plan 021).

## Acceptance

- `bun run check` green (typecheck, tests incl. updated `ai.test.ts`, build,
  the `/ai` size budget + shakeability gate per `scripts/size.mjs` (D20),
  corpus-diff clean).
- `bun run ai-eval` gates hold (per-category + overall acceptance ≥ naive,
  silent wrong ≤ naive); README/site numbers regenerated from the new run.
- Every verified failure scenario listed in the driver paragraph has a test:
  ambiguous separator fails with candidate, TZ fails, relative-without-now
  fails, bounds reject, closed object rejects unknown keys, strict-schema
  shape test.
