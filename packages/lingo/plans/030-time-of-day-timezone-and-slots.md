---
id: 030
title: Time-of-day coverage, timezones, and time slots
status: done
created: 2026-07-07
updated: 2026-07-07
goal: "Detect the ways people write/type/speak times — 17h, o'clock, quarter past, dot, midi/minuit, military — plus timezones (exposed + opt-in applied) and time ranges/slots."
success_criteria:
  - "New single-time forms parse: 17h (bare), o'clock, quarter/half past/to (incl. British 'half 5'), dot separator, midi/minuit, military 'hours' — each corpus-gated and two-way"
  - "Timezone detected is EXPOSED on DateResult by default (civil instant unchanged); `applyZone` opt-in resolves to a UTC instant"
  - "Time ranges parse: '2pm to 4pm', 'between 9 and 5', '9-5', open-ended, am/pm inference, cross-midnight"
  - "No regression to existing date/time parsing; /ai dateField TZ policy updated coherently"
---

# Time-of-day coverage, timezones, and time slots

Driver: semantic detection for time slots — 17h, 5pm, timezones — including the
idioms and mannerisms people actually type. This SUPERSEDES plan 005's original
non-goals (timezone designators ignored; till/until open ranges out of scope).
Decision record: D58.

Design decisions:
- **Timezone:** BOTH, opt-in — expose the detected zone by default (keep the
  civil/wall-clock instant), with `applyZone` to resolve to a UTC instant.
- **Time ranges:** parse "2pm to 4pm", "between 9 and 5", "9-5", open-ended.
- **Forms:** o'clock, quarter/half past/to, dot separator, French midi/minuit,
  military — "just like other ways of writing, typing or speaking"; idiom
  research folded into corpus rows.

## Constraints (unchanged)

Zero deps (`Intl.*` allowed — used for IANA offset resolution). Deterministic
core, explicit `now`, no `Date.now` in parsing. Two-way `humanizeDate` guarantee.
Size budgets. The date model stays civil/wall-clock unless `applyZone`.

## A. Single-time forms

Single-time and range endpoints share one grammar: `parseTimeCore(source,
issues)` (extracted from `parseTimeOnly`). Additive branches, ordered so
pre-existing forms are unaffected:

- `17h` bare, with optional minutes (`17h30`) — grain hour when bare.
- o'clock — `5 o'clock`, `5 o'clock pm`, `5 o'clock in the afternoon`.
- quarter/half past/to — `quarter past 5`, `half past 3`, `half 5` (British=5:30),
  `twenty past 4`, `ten to 6`, `quarter to 6`, `5 to 6`, `5 till 6`. Number-word
  minutes resolve via a small `TIME_NUM_WORDS` map. `parseRelativeMinutes`
  requires a minute WORD (not a bare digit) after `to/till/before`, so `9 to 5`
  / `2 to 4` fall through to the range parser instead of misreading as `9:55` /
  relative minutes.
- dot separator — `5.30pm` (12h) and `17.30` (24h, hour ≥ 13 only) — only in a
  time context, never a bare decimal.
- French — `midi` (noon), `minuit` (midnight).
- Military — `0900 hours`, `1730 hrs`, `1700h` (REQUIRE an hours suffix so it
  can't swallow a year/plain number).
- Approximate forms (`around 5pm`, `~5pm`, `5ish`) are DEFERRED to the backlog:
  they need an `approximate` flag on `DateResult` that touches the whole date
  result shape, out of this plan's scope.

Collision policy: risky forms (`half 5`, `9-5`, bare `1700`) only resolve as
times under a time/date context or an explicit suffix.

## B. Timezone

`DateResult` exposes a `zone`:
`{ name?, offsetMinutes, source: 'offset'|'abbrev'|'iana'|'named' }`, detected
by `date/zone.ts`. Parsed forms: explicit offsets (`+05:30`, `UTC+2`, `GMT-5`,
`Z`), a curated common abbreviation set (EST/PST/CET/…), IANA names
(`Europe/Paris` — offset resolved DST-correctly via `Intl` at the *target*
instant), and common named zones (`Eastern`, `Pacific Time`).

Abbreviations are ALL flagged `ambiguous: true` (even single-region ones) and
emit `AMBIGUOUS_TIMEZONE` (warning); offsets/IANA/named are unambiguous.
Default behavior keeps the civil instant and attaches `zone`; the
detected-not-applied state emits `TZ_IGNORED` — a warning in the core,
escalated to an error at the `/ai` tool boundary. `applyZone: true` resolves
`date` to the UTC instant (civil − offset). `/ai` dateField policy: an EXPOSED
zone is not a "wrong instant," so it does not hard-error by itself.

## C. Time ranges / slots

Standalone `parseDateRange` returning its own `date-range` result type — NOT a
polymorphic `parseDate`, NOT the numeric `QuantityRange`. Coverage: `2pm to
4pm`, `between 9 and 5`, the `9-5` shift idiom, open-ended (`from 3pm`,
`until 5`), cross-midnight (`10pm to 2am` — the end rolls forward silently,
deterministic like `forwardDates`).

am/pm inference is directional: bare descending pairs read as the `9-5`
workday shift; a bare end inherits a stated end's half when it keeps the pair
ascending. Endpoints are reference-dependent, so an absent `now` fails
`NOW_REQUIRED`.

Zone-in-range: a trailing zone binds to the WHOLE slot — `9am to 5pm PST` is
both-PST, peeled once before splitting and inherited by any zone-less endpoint
(per-endpoint zones like `2pm EST to 4pm PST` resolve independently). The
am/pm inference runs on the zone-STRIPPED text so `3am EST to 5pm` keeps its
3am, and the TZ issue span points at the zone token, emitted once for a shared
zone.

Two-way: `humanizeDateRange` is the inverse. `/ai` gains `dateRangeField` →
`{ start?, end?: ISO }` with the same tool-boundary defaults as `dateField`.

## Gates

Corpus rows (additive) for every accepted form/range/zone; grammar/date tests;
two-way round-trip; `bun run check` green; size budget; decision record D58
covers the tz + range model and the size recalibration.
