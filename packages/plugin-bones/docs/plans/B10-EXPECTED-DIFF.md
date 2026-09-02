# B10 EXPECTED-DIFF MANIFEST — high-wind wall uplift path (R802.11 / R301.2.1 WFCM)

Expected-diff enumeration for LOD-400 BATCH 10 (branch `feat/lod400-b10`,
base `1bd3a7d`), following the B5/B11 playbook. The batch continues the
uplift path the roof's hurricane ties start: LA (130 mph) walls used to be
byte-identical to INTL — `hurricaneTies` fed ONLY roof-framing's `tieAt`,
and the sole acknowledgment was a disclaimer buried in
data/fastening-schedule.json that never surfaced. Anything outside the
classes below is a defect.

## Trigger (source of truth)

New spec flag `highWindUplift`, set in `applyJurisdiction` from the data's
own highWind overlay rule (data/wall-assemblies.json:
`ultimateWindMph >= 130 && flags.hurricaneTies`):

```
next.highWindUplift = profile.hurricaneTies && profile.ultimateWindMph >= 130
```

DELIBERATELY narrower than `hurricaneTies`: the sub-130 coastal
belt-and-braces states (TX AL GA NY CT DE MA MS NJ NC RI SC) keep their
roof ties with **no wall-side claim — walls byte-equal to master** (this is
what keeps E5's TX baseline byte-identical; the backlog's blast radius is
"≥130 mph profiles only"). LOD 200 never applies jurisdiction, so it never
books the hardware (matches the roof-tie behavior).

## The uplift set (derived from profiles' data, no hardcoded lists)

- **LA (130 mph), HI (130 mph)** — framed exteriors book the hardware.
  HI is ALSO seismic (SDC D): both hardware families coexist (see M1).
- **FL (140 mph)** — `exteriorWallDefault: 'cmu'`: default scenes book
  ZERO framed hardware (no studs to tie; masonry anchorage is the B18b
  grouted-cell/dowel story) and stay **byte-equal to master**. A wall
  overridden to framed construction books the full set (gated).

Everything else (INTL + 48 states): REQUIRED byte-equal — members,
fixtures, warnings, takeoff, all scenes.

## Enumerated classes (the ONLY allowed diffs, uplift states only)

- **M1 — new wall-framing steel members**, three new dedicated roles (the
  counted-by-role doctrine; B9's `strap` census untouched), all drawn to
  the S13 surface-hardware convention (1.2 mm symbolic steel on the
  framing face, under the 2 mm SAT skin, honest 'install per strapping
  schedule' labels, WFCM capacity/nailing stated as not modeled):
  - `uplift-connector` — ONE per full-height vertical's top (grid studs,
    kings, portal posts, corner backing) — the wall-side mirror of the
    per-rafter `tieAt` booking; coverage = the stud rhythm. Co-planar
    surface steel never shares a drawn spot: a taken spot (HI: B9's
    portal strap on that exact king) side-steps via a deterministic
    ±1..3 strap-width dodge ladder over a y-aware registry.
  - `uplift-strap` — one per opening side at the INNERMOST TRIMMER line
    (the stick the header bears on; never B9's king line), lapping the
    header side and the jack.
  - `foundation-strap` — 48" o.c. along slab-bearing plates (ends
    covered, door ROs skipped — a strap in a doorway anchors nothing,
    S12), then DEDUPED by compute where a foundation R403.1.6 J-bolt or
    HDU already anchors within the 0.3 m (~12") window (one anchorage point, one
    booking; the bolt is the modeled hardware and wins). HI therefore
    books FEWER straps than LA on identical scenes — its seismic 4-ft
    bolt spacing wins more spots (7 vs 11 on the sweep scene). A
    walls-only result (foundation toggled off) keeps the full ladder.
  Stripping the three roles from an uplift compose yields the master
  member list EXACTLY (order included). Existing members: byte-equal —
  the uplift set is pure insertion.
- **W1 — the flat-roof honesty statement** (the B8 sibling seam): a
  compose whose walls booked connectors while a roof frames rafters with
  ZERO steel ties (flat roofs never call `tieAt` — roof-side gap,
  sibling-owned) gains exactly ONE level warning per such roof, naming
  it: `high-wind uplift: roof <id> frames rafters with NO hurricane ties
  … R802.11 uplift path incomplete at the roof bearing, verify tie
  schedule`. A WARNING, not a label (P4 prints it). Tied roofs (gable et
  al.), roofless scenes and other-storey roofs stay silent — a missing
  system is a toggle, not missing hardware (B9c convention).
- **T1 — three takeoff rows**, member-derived (S4 both directions):
  `Stud-to-plate connectors` / `Header uplift straps` /
  `Foundation uplift straps` (Wall framing, pcs; the foundation row's
  detail STATES the dedupe convention). NO invented nail poundage (B9's
  fastener rule) and no lumber-row leak: stripping the three rows yields
  master's takeoff exactly.

Fixtures: byte-equal in every code, every scene (the hardware is
members-only). E5 baseline (INTL + TX): recaptured at B10e —
**byte-identical, zero delta**; the non-vacuity lives in the LA compose
gates (wall-framing.uplift.test.ts).

## Sweep verification (2026-08-22, at B10e)

Scratch sweep (`/tmp/b10-sweep.ts` + `/tmp/b10-diff.py`, not committed)
ran `computeLevel` + `computeTakeoff` on THREE scenes — the shared E5
baseline scene, an 8×6 shell (door + window + slab + foundation) under a
GABLE roof, and the same shell under a FLAT roof — across ALL 52
selectable jurisdiction codes, before (reference worktree at `1bd3a7d`)
vs after; the verifier fails on ANY diff outside the classes above and
derives the uplift set from data/jurisdictions-climate.json itself.

Result: **PASS — nothing moved beyond the enumerated classes.**

| metric | count |
| --- | --- |
| jurisdiction codes swept | 52 (INTL + 51 states) |
| scene composes diffed | 156 (3 per code) |
| non-uplift composes strictly byte-equal (members + fixtures + warnings + takeoff) | 150/150 (incl. TX, incl. CMU-default FL) |
| uplift composes (LA + HI × 3 scenes) | 6 |
| M1 members added (all three roles, all honest-labeled steel) | 601 |
| uplift members stripped → master byte-equal | 6/6 composes |
| W1 honesty warnings (flat-roof composes only, exactly one, naming the roof) | 2 (LA + HI) |
| T1 takeoff rows added (3 per uplift compose) | 18 |
| takeoff rows stripped → master byte-equal | 6/6 composes |
| fixture drift | 0 (all 156) |
| dedupe visible: HI foundation straps vs LA (4-ft vs 6-ft bolts) | 7 vs 11 |

## Known seams (stated, not silent)

- **Roof-side flat-roof ties** stay a SIBLING deliverable (B8b owns
  roof-framing.ts): the wall path is honest about it via W1 and does not
  depend on the roof fix landing — when flat roofs gain `tieAt`, W1
  disappears by construction (the warning keys on the composed members,
  not the roof family).
- **Sub-130 hurricaneTies states** (TX et al.) get roof ties with no wall
  path and no statement — deliberate blast-radius containment per the
  backlog; the seam is documented on the spec field and here.
  → CLOSED (NIGHT-10, feat/roof-residuals): see the addendum below — the
  tie members now state the scope themselves.
- **Mixed CMU/framed walls** route their framed zone through `frameWall`
  without `slabBearing`: connectors + opening straps book in the zone
  (path continues to the seam sill, which is already bolted to the bond
  beam — cmu.ts), foundation straps correctly don't.
- **Pre-existing grid-stud-grazes-king class** (named by the B10d census
  gate, present at INTL master): the stud keep-out ends at the king's
  outer FACE, so a grid stud whose center lands within halfT past it
  overlaps the king by up to 18 mm. Board-note queued; the B10 connectors
  dodge it rather than stack.


## NIGHT-10 ADDENDUM — the belt states its scope (tie-label expected diff)

Residual 3 of the ROOF RESIDUALS batch (base `db7ada2`): the B10 skeptic's
nice-to-have. Every hurricane-tie member emitted under a BELT spec
(`hurricaneTies` && !`highWindUplift`) now carries the label

```
hurricane tie (roof-to-wall ties only — wall/foundation uplift path not
modeled below 130 mph design wind)
```

`highWindUplift` specs (LA HI, FL-framed-override) keep the plain
`hurricane tie` — B10's wall connectors/straps ARE the continuation there.

### The ONLY allowed diff class

- **Tie member LABELS in the 12 belt states** — derived from the profiles
  data (`hurricaneTies && ultimateWindMph < 130`), enumerated and PINNED
  by the jurisdiction-truth gate (a state drifting across the 130 boundary
  fails the enumeration, never silently swaps labels):

  **AL CT DE GA MA MS NC NJ NY RI SC TX** (12)

- Applies to every tying shape (gable, shed, hip commons/kings/jacks,
  flat both-end ties, gambrel, mansard/dutch skirts).
- GEOMETRY is untouched: normalizing belt tie labels reproduces the ≥130
  spec bytes exactly (strip-equality gate per shape).
- Labels never print on paper (plan-set prints flags, not labels) and the
  takeoff counts ties by role+material+system → paper + takeoff byte-equal
  everywhere; the clause is a label, NOT a flag (no Flags row — gated).
- ≥130 states (FL HI LA), INTL and the 36 tie-less states: REQUIRED
  byte-equal — held by the ≥130 plain-label gate, the INTL byte pin, the
  11 untouched sha pins and the E5 baseline (no roof segments).
- `gable-400-windy` sha pin REPINNED for this class alone
  (cf188b8d03379ed1 → a408ae61e9011a01) — its spec is the belt.
