---
id: 005
title: Dates & durations
status: approved
created: 2026-07-03
updated: 2026-07-29
---

# Dates & durations (`@pascal-app/lingo/date`)

Zero-dep, English v0.1, host-timezone civil arithmetic, explicit `now`. Not a chrono
clone: we cover the high-frequency 95% with exact two-way behavior and honest
ambiguity, in ~5 kB.

Time-of-day coverage (17h, o'clock, quarter past…), timezone detection/`applyZone`,
and time ranges/slots (`parseDateRange`) are specified in plan 030 (D58).

## API

```ts
parseDate(text, { now, locale?, weekStart? = 1, forwardDates? = true, dayFirst?,
                  strictness?, escalate?, messages? })
  → { ok, date: Date, grain: 'year'|'month'|'week'|'day'|'hour'|'minute'|'second',
      known: string[],   // chrono-style certain vs implied: calendar fields pinned
                         // down, plus 'implied-hour'/'implied-day'/'weekday' markers
      span, issues, alternatives? }
parseDuration(text, opts?)
  → { ok, duration: Quantity /* kind duration; .parts for faithful reformat */, span, issues }
humanizeDate(date, { now, numeric?: 'auto'|'always', maxUnit?, minUnit?,
                     rounding? = 'round', justNowUnder? = 10_000 })
humanizeDuration(secondsOrQuantity, { largest? = 2, style?: 'narrow'|'short'|'long'|'natural' })
```

`now` is required for every reference-dependent date input: deictics, weekdays,
calendar periods, year-less dates, and time-only inputs. Fully absolute dates
(`2026-07-03`, `March 5 2026`) parse without it. Missing `now` returns
`NOW_REQUIRED` with no implicit candidate.

`lingo()` from the main entry recognizes date/duration inputs when `kind: 'date'` /
`'duration'` or when unambiguous (contains deictic/weekday/month words).

## Parse coverage (each line = corpus rows)

**Deictic**: now, today, tonight (22:00), yesterday, tomorrow, day after tomorrow,
day before yesterday, this morning (09:00) / afternoon (15:00) / evening (19:00) /
noon / midnight (00:00 today, next if `forwardDates`).

**Offsets**: `in N <unit>`, `N <unit> ago`, `N <unit> from now`, `N <unit> from
<anchor>` (anchor = deictic or weekday: "a week from Friday"), `half an hour ago`,
`an hour ago` (number-word values reuse plan 002 layer). Units: second…year; month/
year offsets use calendar arithmetic with end-clamping (Jan 31 + 1 month → Feb 28/29),
day+ offsets via civil-date arithmetic (DST-safe: add days on the calendar, keep
wall-clock time).

**Weekdays**: `Monday…Sunday` + abbreviations (mon, tue(s), thu(r)(s)…).
- bare weekday: next occurrence strictly after `now`'s date unless today matches and
  `forwardDates` false → today; issue `WEEKDAY_ASSUMED_NEXT` info.
- `this <weekday>`: within current week (weekStart); `next <weekday>`: THE AMBIGUOUS
  ONE — default = first occurrence in *next* week (mainstream expectation), alternative
  interpretation (soonest occurrence) attached with its date; `last <weekday>` mirror.
- `next week/month/year` → grain-sized result (Monday of next week etc.);
  `next <monthname>` / `last <monthname>` → the named month strictly after/before
  the current month period; `weekend` / `this|next|last weekend` → that week's
  Saturday (grain day), `end of (the) month/week/year`, `beginning/start of …`,
  `mid-<month>` → 15th.

**Absolute**: ISO `2026-07-03`, `2026-07-03T14:30(:ss)`, compact `20260703` NOT
supported (ambiguity with big ints). `7/3/2026`, `7/3` — slash/dot/dash numeric
dates honor `dayFirst` (default from locale option: en-US false, everything else
true); ambiguity (both ≤ 12) → warning + alternative. `March 5`, `March 5th, 2026`,
`5 March`, `5th of March`, `Mar 5 '26`, month names + 3-letter abbrevs (+ `sept`).
Year-less dates: with explicit `now`, nearest occurrence per `forwardDates` (default:
future-biased, so past month/day and bare-month starts roll to next year); without
`now`, `NOW_REQUIRED`. 2-digit years: 69/70 pivot (≤69 → 20xx).

**Times attached**: `at 3pm`, `at 15:30`, `3:05 pm`, `noon`, `7 in the morning/evening`,
`17h30` (French-ish but common). With explicit `now`, time-only input → today at
that time (next day if past and `forwardDates`); without `now`, `NOW_REQUIRED`.
Additional clock forms (bare `17h`, o'clock, quarter/half past/to, dot separator,
military `0900 hours`, `midi`/`minuit`) per plan 030.

**Locale packs**: loaded packs contribute date vocabulary through
`LanguageProfile.date`: month/weekday names, date filler words (`de`, `le`, `el`),
deictic day offsets, day-part/time phrases, relative offset frames, period
modifier words, and compact CJK offset suffixes. Implemented examples include
French `midi demain`, `le mois prochain`, `dans 3 jours`; Spanish `mañana`
(tomorrow), `en la mañana` / `por la mañana` (morning), `el mes que viene`,
`hace 3 días`; Portuguese `amanhã de manhã`, `mês que vem`; Chinese `明天中午`,
`下个月`; Japanese `明日の正午`, `来月`; en-GB numeric dates stay day-first.
Spanish ambiguity policy: bare `mañana` is tomorrow, while morning requires a
prepositional frame, so `mañana por la mañana` is tomorrow morning.

**Date ranges**: `parseDateRange` covers time slots per plan 030, duration
ranges anchored by a date/time (`N <duration> starting <anchor>`, including glued
duration units like `3days starting tomorrow`) → `[anchor, anchor + duration)`,
and calendar ranges per D71:

- **Date to date** — the same separators as time slots, with date endpoints:
  `July 1 to July 5`, `Aug 3 - Aug 9`, `between Aug 3 and Aug 9`,
  `from tomorrow to friday`, `Mon-Fri`, `2026-08-01 to 2026-08-05`, plus open
  ends (`from monday`, `until august 9`). The clock pass runs first, so `2pm to
  4pm` stays a time slot. The end parses against the *start* as its reference,
  never `now`, so a relative pair cannot read backwards. Two absolute endpoints
  can still be given in the wrong order — `2026-08-09 to 2026-08-03` is swapped
  and reported with `RANGE_REVERSED`, per D72. Only the dated path swaps; `9pm
  to 5am` is a real overnight slot. A `\d{4}-\d{2}` run in the input disables
  the lazy dash split and demands a spaced dash — `2026-08-01 - 2026-08-05`
  parses, `2026-08-01-2026-08-05` does not.
- **Calendar periods** — any date coarser than a day names a period, and the
  range spans it: `next week` → Mon–Sun, `this month`/`next month` → 1st–last,
  `this year`/`2027` → Jan 1–Dec 31, `August`/`next August` → the whole month.
  No separate period-range grammar; it widens the single-date result. The same
  widening applies to a coarse endpoint that *closes* a span, so `July to
  August` ends August 31 and `until August` ends August 31, while `from August`
  opens on the 1st (D72).
- **Weekends** — `weekend`, `this weekend`, `next weekend`, `last weekend` →
  Saturday through Sunday. Day-grained, so widened explicitly. On a Saturday or
  Sunday, `this weekend` is the weekend in progress rather than the next one.
- **Not covered** — elliptical right sides (`Aug 3–9`) and quarters (`Q3`); see
  `plans/backlog.md`.

`humanizeDateRange` renders calendar ranges as dates (`2026-07-01 to
2026-07-05`, `from 2026-07-06`, `until 2026-08-09`) rather than clock phrases,
carrying the time only when an endpoint is hour-grained or finer. Provenance
rides on a runtime-only `dated` flag, like `anchored`.

**Durations**: `90 min`, `1h30`, `1:30` (with kind duration: h:mm; warns of mm:ss
alternative), `1 h 30 min`, `an hour and a half`, `2 hours 15 minutes`, `three quarters
of an hour`, ISO 8601 `PT1H30M`, `P2DT3H` (full support incl. weeks `P2W`), `1.5h`,
`2 days`, colloquial `half an hour`, `90'`+`45''` ONLY under explicit duration kind
(soccer-style, warn). Output Quantity kind duration (base seconds) with `parts` for
faithful reformat.

## Humanize (two-way guaranteed)

Round-trip-optimized threshold table (N = |Δ|, past shown, future symmetrical
with "in …"):

| Δ | output | grain |
|---|--------|-------|
| < `justNowUnder` (10 s) | just now | second |
| < 60 s | N seconds ago | second |
| < 45 min | N minutes ago | minute |
| 45–89 min | an hour ago | hour |
| < 24 h | N hours ago | hour |
| 24–47 h | calendar compare → yesterday / tomorrow | day |
| 2–6 d | N days ago | day |
| 7–29 d | N weeks ago (units option can disable) | week |
| 30–319 d | N months ago | month |
| else | N years ago | year |

Rounding: `rounding: 'round'` at the selected grain (date-fns-strict default;
`trunc` available). Day-level bucketing uses DST-normalized minutes. Invariant
test: for random instants, `parseDate(humanizeDate(d, {now}), {now})` differs
from `d` by less than one grain unit. `numeric: 'auto'` upgrades to calendar
phrases when exact ("yesterday", "today", "tomorrow", weekday names within 6
days: "last Tuesday"/"on Friday") — all of which our parser reads back.

`humanizeDuration`: decompose base seconds into y/mo/w/d/h/min/s (civil averages for
y/mo flagged), keep `largest` units; `narrow`/`short`/`long` join parts with spaces,
`natural` joins `', '` + `' and '`, renders a lone hour as "an hour", and
special-cases halves ("an hour and a half", "half an hour").
Round-trips via `parseDuration`.

## Binding refinements

1. **Weekday semantics = chrono's table, made explicit** (credit: wanasit/chrono
   calculation/weekdays.ts): `this X` → forward within current cycle, today counts;
   `next X` → next week's instance (from Sunday: within coming 1–6 days; from
   Saturday: next Sat +7, next Sun +8); `last X` → backward; bare `X` → closest
   occurrence, forward wins ties — but lingo defaults **`forwardDates: true`**
   (inclusive-dates lesson: input UIs want the future), making bare X = soonest ≥
   today. Bare/`next` forms attach the alternative interpretation.
2. **Casual heuristics** (chrono): `midnight` → hour 0 next day when ref hour > 2;
   `last night` → hour 0 same day when ref < 06:00; `tonight` → implied 22:00. Also
   parse `just now`, `right now`, `a moment ago` → ref instant (needed for round-trip).
3. **Composite offsets clamp once**: "in 1 month and 1 day" applies largest-first as
   one composite (clamping is non-associative: Jan 31 +1mo+1mo ≠ +2mo).
4. **Durations**: no bare "P" (ISO requires ≥1 component); only smallest component
   may be fractional; `P1M` month vs `PT1M` minute; months never map to fixed ms —
   symbolic parts materialized only against an anchor (humanize-duration's fixed
   2629800000 ms month is what we're avoiding; tinyduration's tiny parse/serialize
   surface is the model).
5. **Announce the interpretation, not keystrokes** (inclusive-dates): DOM layer's
   date fields echo the resolved date politely once ("Tuesday, May 2 selected"-style
   via hint slot); `aria-describedby` points at the error region only while an error
   exists.

## Shorthand idioms (texting/chat, P1)

Real users type shorthand everywhere the long form works. Requirements:

1. **Offset units accept the short lexicon in ALL offset positions** — `in 2d`,
   `in 5h`, `2w ago`, `3mo from now`, `in 10m` (minutes under date context),
   `1y from now` — same set the duration lexicon accepts (s/sec, m/min, h/hr,
   d, w/wk, mo, y/yr), glued or spaced (`in2d` no; `in 2d` and `in 2 d` yes).
2. **Deictic shorthand works as ANCHORS, not just standalone** — `3min from
   tmrw`, `2h after tmr`, `a week from tdy`? (tdy uncommon — include tmr, tmrw,
   tmrw., yday, y'day, tonite). Anywhere `tomorrow` parses, its abbreviations
   parse.
3. **Weekday shorthand in modifier forms** — `next tues`, `this thurs`, `last
   sat`, `on fri`.
4. **Casual glue** — `3min from tmrw` (glued number+unit), `@ 3pm`. Open-ended
   `till`/`until` forms parse as time ranges per plan 030.
5. Systematic idiom corpus: every construct row in this plan gets a shorthand
   twin in tests.

## Explicit non-goals

Recurring rules ("every Tuesday"), holidays ("next Easter"), non-Gregorian
calendars, business-day math (fortnight IS included — it's one line). Listed in
plan 013 / roadmap. Timezone designators and time ranges/slots are IN scope via
plan 030 (D58): detected zones are exposed on `DateResult.zone` (opt-in
`applyZone` resolves the UTC instant), and "2pm to 4pm" / "9-5" / "from 3pm"
parse via `parseDateRange`.
