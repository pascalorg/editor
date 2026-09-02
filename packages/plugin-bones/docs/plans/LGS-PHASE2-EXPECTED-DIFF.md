# LGS Phase 2 — expected diff manifest (feat/lgs-phase2)

Phase 2 of docs/plans/LGS-PLAN.md: machine-selection UX + the can't-roll
warning channel. Exactly TWO user-facing controls land (the plan's binding
UI/UX principles — "two controls total, progressive disclosure, flexibility
without clutter"), both riding existing surfaces:

- (a) the wall card's construction SegmentedControl gains ONE segment —
  Framed · **Steel** · CMU · Skip (src/inspector/wall-engineering.tsx);
- (b) the Bones panel gains ONE compact **'Framing'** row (Lumber | Steel)
  between the JurisdictionPicker and the detail/spacing row, with a
  progressive-disclosure **'Machine'** select that exists ONLY while Steel
  is selected (src/panel.tsx + the new pure src/panel-framing.ts).

No new section, no modal, no wizard. Machine constraints speak exclusively
through the existing honesty channels (level warnings → Warnings drawer +
paper Flags block; label statuses — Phase 1's channel, unchanged).

## THE BOUNDARY (stated per the phase mandate; scope corrected — round-1 skeptic F3)

**Phase 2 changes nothing about how a machine resolves profiles** —
`profileFor`'s chain is byte-untouched this phase; Phase 2 only adds the
WARN channel (`machineConstraintWarning`) on top of Phase 1's label
branding. What a machine choice does, stated at the true scope (LGS-PLAN
principle 4: it **CONSTRAINS + BRANDS**):

- **At the code LODs (300/400)** the conservative pick already sits at the
  table-domain maximum, so members are **byte-identical** with or without
  a machine — labels/flags/warnings only (round-1 skeptic byte-proved it
  across all 19 catalog machines + an unknown key).
- **At LOD 200** a machine NARROWS the generic 33-mil pick to its thinnest
  rollable variant — `550S162-33 → 550S162-43` under TF550H:
  `member.profile` and the compression-flag text change, the envelope
  does not (family dims are mil-invariant). Pinned as the stated
  exception in lgs-wall-framing.test.ts.
- **The vendor-own-profile path** (a verified machine standing its OWN
  geometry in for the family, e.g. howick/frama3200 at 200) draws the
  vendor's published dims (89 mm web vs the 88.9 mm generic) — verified
  dims, delta noted on the label.

Both non-300+ behaviors are **Phase-1 resolution behaviors, unwidened** —
Phase 2 adds no new consumer of vendor dims and no new resolution branch.
An earlier revision of this manifest claimed "machine selection NEVER
changes geometry / profiles resolve identically", which is byte-false at
200 and on the vendor-own path; the claim sites (this section,
schema.ts's MCP describe, the engine header, the panel comments) are all
scoped to the above.

## 1. EXISTING corpora: ZERO computed deltas

- **E5 master-baseline**: recaptured on the Phase-2 tree — **cmp-proven
  byte-identical** (`bun scripts/capture-master-baseline.ts` then `cmp`
  against the committed pin; the baseline scene has no steel walls and no
  machine). The suite's INTL/TX byte pins hold unmodified.
- **Spec round-trip**: `framingSystem`/`lgsMachine` absent round-trip
  absent (the Phase-0 gate, extended over the NEW write path): the panel's
  Lumber and 'None (generic AISI)' writes store an explicit `undefined`
  that merges over the stored value and JSON-serializes to ABSENT — a
  scene flipped to Steel (± machine) and back persists byte-identically
  to one never touched (pinned in panel-framing.test.ts).
- No engine consumes anything new on lumber/CMU/skip paths: the warning
  emission lives inside `lgsFrameWalls` (steel walls only), the card
  suffix inside the `construction === 'lgs'` assembly branch.

## 2. UI-ONLY delta classes (every scene, no byte changes)

- **Panel 'Framing' row**: visible on every X-rayed level (value Lumber
  when the field is absent). While Lumber is selected there is NO machine
  row — lumber users see exactly one new compact row and nothing else.
- **Wall card 4th segment**: the construction control now shows Steel on
  every wall card — same control, same size/shape, no new rows. Because
  the control's value is the RESOLVED construction, an MCP-set 'lgs'
  wall now highlights its segment (the Phase-0 documented gap, closed).
  The write path is the CMU channel verbatim (`constructionOverride` →
  `wallOverrides`, string form, engineering fields preserved on flips,
  `cmuHeightM` dropped when leaving CMU).

## 3. NEW input-class delta: machine-set steel scenes (LOD 300+)

Per-level warnings from `machineConstraintWarning` (P4 prints them
verbatim on paper; the panel folds them into the Warnings drawer). Three
honest shapes, never conflated:

- VERIFIED machine that can't roll a composed resolution →
  `Machine <name> cannot roll <designator> (<class>) — generic AISI
  fallback used; verify with vendor` — the claim basis IS the published
  ranges the rollable derivation used. Emitted per composed member CLASS
  (studs / tracks / bridging channels) so the warning is exactly as wide
  as what's drawn/booked. **Canonical exhibit (the real Phase-1
  finding): TF550H rolls the 68-mil S162 studs but its published
  34–63 mm flange range excludes T125 track → the track warning fires,
  a stud warning never does — and the warning channel provably agrees
  with the label channel member-by-member.**
- UNVERIFIED machine (Pinnacle) → `Machine <name> is unverified — generic
  AISI dims used for every steel profile; verify capability with the
  vendor` — never a "cannot roll" claim (nothing was checked; an
  unverified machine claims no rollable rows AND earns no incapability
  verdicts).
- Unknown key → `Machine '<key>' not found in the catalog — …`.

LOD ladder: warnings at 300+ only (Phase 1's ladder — 200 makes no
claims); the LABEL statuses stay un-gated at 200 exactly as Phase 1
shipped them. Generic (no machine): zero machine warnings, all LODs.

## 4. Card suffix change class (machine-set steel walls)

`· machine <key> (constraint warnings land in Phase 2)` →
`· machine <key>` plus, only when this wall's resolutions fall back, the
honest count: `(1 profile falls back)` / `(2 profiles fall back)` /
`(3 profiles fall back)` — counted from the SAME resolver the members
build from (lgsWallProfiles: stud + track + the bridging resolution, the
last counted ONLY when backing members actually compose on the wall —
round-1 skeptic F2: the stud+track-only count printed '1' on the exhibit
wall whose drawn steel carried fallback labels in two classes). The gate
derives the expected count from the drawn members' own fallback labels,
so card and 3D can't disagree; the exhibit (baseline w_s + TF550H) pins
2, a backing-free wall (w_mid) pins 1, F325iT pins 3. No machine → no
suffix (byte-stable card line).

## 5. Machine select content (the catalog verbatim, honesty as ordering)

One `<optgroup>` per vendor; 'None (generic AISI)' first (steel with no
machine IS the generic base). VERIFIED machines list verbatim; unverified
rows keep their honest `(unverified)` suffix, sort below their vendor's
verified rows, and all-unverified vendors (Pinnacle — the catalog's live
fallback example) group last. A stored-but-not-an-option key (MCP
case-variant or unknown) surfaces as an honest trailing option instead of
the native-select first-row lie. Nothing hidden, nothing invented.

## 6. Gates + probes

- src/engines/lgs-wall-framing.test.ts — MACHINE CONSTRAINTS describe:
  TF550H exhibit (track warns / studs never / channels agree),
  per-designator double fallback (F325iT at 68 mil), fully-rollable
  machine → ZERO warnings (synthetic verified vendor, injected +
  restored per the zzforge precedent — no real catalog machine claims
  T125 rollability, which is itself the honest state of the data),
  generic/unverified/unknown legs, 3-site LOD ladder (tee scene so the
  backing site is non-vacuous), BRIDGING-only fallback (round-1 skeptic
  F1: synthetic machine rolling studs+tracks but not 150U050 — pins the
  '(bridging channels)' class word verbatim, the branded classes never
  leak into a warning, and the emits-guard: a tee whose stud gap is
  under the 3" buildable minimum composes zero backing members and must
  warn zero), end-to-end computeLevel → paper (P4).
- src/engines/lgs-profiles.test.ts — card suffix truth table (1/2/none).
- src/panel-framing.test.ts — pure write/option truth tables incl. the
  byte-parity JSON round-trips.
- src/panel.test.ts — source gates: slot order (Jurisdiction → Framing →
  detail), one Lumber|Steel control, disclosure guard, pure patches, no
  literal `'lumber'` write, honest extra option; wall card: exact-order
  4-segment regex + one-control pin + resolved-value pin.
- src/panel-selection.test.ts — 'lgs' write truth table (string form,
  fields preserved, cmuHeightM drop, schema round-trip).
- Mutation probes (14/14 die — the original "11/11" claim was FALSE,
  round-1 skeptic F1: the bridging warning site was behaviorally correct
  but UNTRACKED, so three of its mutants survived the full suite; the
  tracked bridging-only-fallback gate above kills them): per-site
  LOD-ladder codeClaims drops (studs/tracks/backing), backing-site
  emission delete, backing class-word lie ('bridging channels'→'studs'),
  backing emits-guard drop (warning wider than what's drawn),
  unverified→cannot-roll conflation, message→null, card IOU revert,
  fallback-count hardcode, Steel segment drop, disclosure-guard removal,
  literal-lumber write, unverified-suffix drop.
- Suite 1883 → 1910, tsc clean, E5 recapture cmp-byte-identical.

## S18 (the LGS honesty chain) — how Phase 2 upholds it

(a) label truth: no new labels; the card suffix and warnings derive from
the same resolutions the labels print. (b) basis strings: untouched; the
select's derivation-based rollable lists stay data-side with their per-row
`basis`. (c) fallback chain: order unchanged (no profileFor edits);
unverified machines still claim no rollable rows — and now provably earn
no capability verdicts either. (d) energy-code truth: untouched, both
leak directions still gated. (e) strap bracing: untouched. (f) ladder:
the new warning class obeys 300+/none-at-200, pinned per emission site.
