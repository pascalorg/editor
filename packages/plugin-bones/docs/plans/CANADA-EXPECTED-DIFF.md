# CANADIAN JURISDICTIONS — expected diff (feat/canada-jurisdictions, 2026-08-24)

Adoption of community PR #1 (JonathanNus / Terra Modular) by CHERRY-PICK
with authorship preserved: commit `6861d07` ("feat(jurisdiction): add
Canadian provinces and territories") picked onto master `7743886` as-is —
authored by Jonathan Nusbaum <jonathan@terramodular.com>. The PR branch was
stacked with two other commits (a view-takeover fix superseded by master's
activation-scoped design, and a white-label brand commit never meant
upstream) — NEITHER was taken; the branch-wide diff greps clean of any
brand/takeover content. The picked commit touches ONLY jurisdiction data
files, `guess.ts` and its tests, exactly as reviewed.

WHAT LANDS: 16 rows — 10 provinces (Ontario split S/E/N on its frost/
seismic spread), 3 territories, and the `CA-GEN` NBC-2020 national fallback
— in `jurisdictions-adoption.json` + `jurisdictions-climate.json`, ISO-style
`CA-*` codes (bare `CA` stays California), `defaultCladdingByState` +
`stateClimateZone` rows in `wall-assemblies.json`, Canadian IANA timezone
guesses + the `en-CA → CA-GEN` locale fallback in `guess.ts`. Every row:
`ircBase: null` (the Wisconsin-UDC precedent), NBC Division B Part 9 (or
provincial variant) citation, per-row kPa→psf / mm→in conversion
documentation, the "typical provincial values … AHJ governs" caveat,
Quebec's NBC-2015 one-cycle-behind flag, and the verbatim inference-engine
note carrying the NBC 9.23.13 bracing difference (noted, deliberately NOT
implemented).

## CONFLICT RESOLUTION (their 2026-08-16 base vs master, 444 → 1883 tests)

The cherry-pick itself applied CLEAN (git, byte-level). The real conflicts
were semantic — master's jurisdiction sweeps grew enumeration pins of
"what the data derives to TODAY", and the CA rows legitimately join those
derived sets. One follow-up commit per concern, my authorship:

1. B11 snow bands (`profiles.test.ts`): CA-BC/GEN/MB/SK/YT → the 50-psf
   header column; CA-NB/NL/NS/NT/NU/ON-E/ON-N/PE/QC → the 70-psf column
   (CA-NL at 73 psf carries the "exceeds the table — engineered design
   required" assumption clause). Band-uniqueness held for all 16 unchanged.
2. B10 uplift set (`wall-framing.uplift.test.ts`, `roof-framing.test.ts`):
   CA-NL (140) / CA-NS (130) / CA-PE (130 mph, hurricaneTies) join the
   ≥130 FULL wall-path set — connectors/straps/foundation ladder counts
   already passed on them. The sub-130 belt is UNCHANGED (12 states).
3. B9 SDC-D set (`wall-bracing.test.ts`): CA-BC (SDC D) joins the
   seismicHoldDowns portal set — portal census passed on it unchanged.
4. Their `canada.test.ts` needed NO adaptation (their found-bug class,
   insulationByClimateZone dead keys, was already fixed on master via
   `climateZoneOf` — see gate below; their test never asserted around it).

## DELTA CLASSES (everything that moves, and everything that must not)

1. NEW-INPUT CLASS ONLY — the 16 CA-* jurisdictions. Everything they
   compose (members, fixtures, takeoff, paper, warnings) is a NEW class:
   no scene could select these codes before. Notable inside the class:
   - frost: CA-SK composes 83-in footings — deeper than every US state
     (the PR's motivating case; deepest US row is 60 in) — gated to reach
     real foundation GEOMETRY, not just the spec;
   - snow: kPa-converted psf drives the 2x8/2x10 rafter bumps, the
     R802.4.1(5) span table and the Table R602.7(1) header bands with the
     stated assumption;
   - seismic: CA-BC (D) builds the hold-down kit @ 4-ft bolts; CA-ON-E
     (C — the Ottawa Valley row) is pinned BELOW the hold-down line;
   - wind THIRD class (round-1 skeptic F1): CA-NU (140 mph,
     flags.hurricaneTies:false — the row's NBC research carries no
     prescriptive uplift-continuation claim, and the researched value is
     KEPT) is the first-ever profile on applyJurisdiction's '|| ≥130'
     wind leg alone: it mints roof ties but neither shipped label was
     true — the belt clause claims 'below 130 mph' (false at 140) and
     the plain label implies B10's wall continuation (never built here).
     The optional spec field `highWindTiesOnly` (folded ONLY when the
     class applies — absent keeps the E5 spec bytes) routes `tieAt` to
     the true label ('… high-wind wall/foundation uplift continuation
     not modeled for this jurisdiction (no prescriptive-uplift flag in
     its researched data); verify against the governing code'). A THIRD
     enumeration arm pins the class (today exactly {CA-NU}) so boundary
     drift shows up in the pins, bans BOTH false labels on it, proves
     label-only strip-equality vs the ≥130 bytes across all 7 tying
     shapes, and pins the field ABSENT on belt/full/INTL specs;
   - every CA compose carries the non-IRC confession warning (below).
2. EXISTING US/INTL CORPORA: byte-identical. E5 `master-baseline.json`
   (INTL + TX) recaptured via `bun scripts/capture-master-baseline.ts` —
   `git diff` empty (cmp-byte-identical) after every slice. The four sweep
   pins above are TEST-side enumerations, not output changes.
3. TWO HONEST DEVIATIONS — WI + VT warning-only deltas (round-1 skeptic
   F2: VT was the unenumerated 18th member): the ircBase:null honesty
   line (below) fires on every `ircBase: null` row, and Wisconsin (UDC)
   AND Vermont ('No statewide residential building code…') are that same
   class at base and tip — scoping the confession to CA-only would
   encode a lie. The full confession set is EXACTLY 18 = 16 CA-* + WI +
   VT, enumerated and pinned in the gate. Each gains exactly one string
   appended to `result.warnings` (and therefore the paper flag block) at
   300+; members/fixtures/takeoff/areas byte-equal on both (skeptic-
   verified on VT); no WI/VT byte-pinned corpus exists (E5 is INTL+TX),
   so no recapture moves. TAIL VARIANT: rows whose residentialCode
   describes the ABSENCE of a code (/^No\b/ — today exactly VT) read
   '…verify against local/municipal requirements: …' instead of the
   incoherent '…verify against the governing code: No statewide…'; WI
   and the CA rows keep the governing-code tail byte-for-byte (their
   strings are examiner-verified on paper).
4. PANEL RENDER-ONLY: the JurisdictionPicker now renders `profile.notes`
   — COUNT: all 51 US rows (50 states + DC) gain their researched
   amendment/frost/snow notes line in the picker, INTL gains its one-line
   generic pointer, and the 16 CA rows render theirs (incl. the
   territories' PERMAFROST warning — the channel this change exists for).
   UI-only; zero compute bytes.
5. DATA-FILE PROSE: one sentence appended to the climate disclaimer
   stating the CA conversion factors (1 kPa = 20.885 psf, 25.4 mm = 1 in).
   No US row content touched anywhere in the branch.

## ircBase:null HONESTY — SWEEP RESULT (the seam attacked hardest)

`ircBase` was consumed NOWHERE in src/ — zero consumers existed. The
engines' member labels, flags and prescriptive checks cite IRC/IECC/NEC
sections UNCONDITIONALLY; nothing keys on the adoption row. With a
Canadian jurisdiction selected, IRC-section labels DID print on members
and paper — a pre-existing gap (Wisconsin and
Vermont had it since their rows landed) that the 16 CA rows turn from an
edge case into a storefront.

RESOLUTION (flag-honestly-gated; the full fix is board-queued): compute
pushes ONE level warning at 300+ on any `nonIrcCode` profile —

    non-IRC jurisdiction (<name>): members and checks cite IRC/IECC/NEC
    sections from the generic engine — treat as generic practice and
    verify against the governing code: <residentialCode>

The panel warnings drawer and the paper schedules flag block both print
`result.warnings` verbatim, so the one channel serves panel + paper +
compute. LOD 200 makes no code claims and stays silent. INTL/unknown
codes stay warning-free (they claim no local code at all — and the E5
byte pin requires it). Per-label suppression/re-citation keyed on the
code family (IRC vs NBC vs UDC) is the REAL fix — blast radius is every
engine; queued on the board, not smuggled into a cherry-pick adoption.

## GATES (all in-tree, mutation-checked)

- `src/jurisdiction/canada.test.ts` (their 11 tests preserved + follow-ups):
  CA≠California pin + unique codes; CA-* contiguous dropdown block right
  after California; citation-completeness gate (LGS style: ircBase null,
  NBC residentialCode, verbatim 9.23.13 note, Quebec NBC-2015 flag,
  caveat + per-row kPa→psf / mm→in arithmetic re-derivation at the stated
  factors, PERMAFROST escape pinned to exactly YT/NT/NU); non-IRC
  confession presence (CA-GEN/CA-SK/CA-QC + WI + VT with the
  local-requirements tail), absence (TX/California/INTL/LOD-200), and the
  exact-18 confession-set enumeration; Canadian compose gate (83-in footings in
  real members + deeper-than-every-US sweep, kPa→psf snow into rafter/
  header machinery, live seismic field on the Ontario split); tz-guess
  gates (every mapped zone code resolves to a real row, split-Ontario
  pins, the documented Montreal→America/Toronto fold, en-CA → CA-GEN).
- `src/jurisdiction/profiles.test.ts`: B11 band sweep with the CA-extended
  enumerations. `src/engines/wall-framing.uplift.test.ts` +
  `src/engines/roof-framing.test.ts`: uplift/belt enumerations.
  `src/engines/wall-bracing.test.ts`: SDC-D enumeration.
- `src/engines/wall-layers.test.ts`: the dead-key class (their found-bug
  note) closed for all 67 stateClimateZone rows + CA-SK/CA-BC live-label
  pins (incl. the 4C→4M marine row).
- `src/panel.test.ts`: source gate — `profile.notes` passed AND rendered
  (the territories' PERMAFROST channel; it was data-file-only before).
- Mutation probes (all die): psf-figure drift, 9.23.13 clause drop,
  schema value out of documented range, province claiming the PERMAFROST
  escape, confession never pushed, nonIrcCode predicate inverted, frost
  clamped at 60 in, panel notes unrendered, CA-NT zone '9' dead key.

## SUITE

Base master 7743886: 1883 pass. Branch tip: 1916 pass / 1 todo / 0 fail (round-2 fixes added 4 tests),
tsc clean, E5 recapture byte-identical at every slice.
