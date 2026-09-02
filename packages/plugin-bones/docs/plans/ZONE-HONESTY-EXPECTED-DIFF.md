# NIGHT-10 EXPECTED-DIFF MANIFEST — zone/classifier honesty batch

Branch `feat/zone-classifier-honesty` (base `db7ada2`, suite 1644 → 1661).
Four items: (1) zone-twin dedupe at extraction, (2) classifier head-noun /
anchoring refinements, (3) outdoor exclusion from the room-coverage slab
warning, (4) concrete sub-batch display note. Items (1)–(3) change REAL
scene output on the enumerated name/shape classes below; item (4) is
takeoff wording only. Anything outside these classes is a defect.

## BASELINE: byte-identical, confirmed

`master-baseline.json` recaptured after EVERY slice (a/b/c/d commits) —
`git diff` empty each time. The baseline scene's zone names are plain
(`Kitchen`, `Bathroom`, `Bedroom`, `Hallway` — no outdoor words, no
compound names, no twins, no uncovered rooms, and its pours don't hit the
display collapse), so members, fixtures AND warnings are byte-equal in
both INTL and TX. Room ORDER through the dedupe is pinned scene-order
(first cut re-sorted by id and the E5 byte gate caught LTG-3/LTG-4
circuit renumbering — reverted to in-place dedupe, gated).

## C1 — head-noun tie-break: trailing outdoor word now wins

Names carrying an indoor category word FOLLOWED by an outdoor keyword
flip `bedroom|kitchen|bathroom|…` → `outdoor`. Witness class:
`Master terrace`, `Bedroom terrace`, `Bedroom balcony`, `Kitchen garden`.

What they LOSE (correct — these are open-air spaces):
- R314 smoke alarm (in-room + sleeping-area-proxy participation) — and
  for sleeping-word names (`Master terrace`, `Bedroom terrace`) the R314
  open-air warning NOW FIRES: 'zone "Master terrace" reads as open-air —
  no smoke alarm placed (R314); rename if it is conditioned space'. The
  warning keys on the RESULT (category + SLEEPING_NAME_RE), so the new
  head-noun path speaks exactly like the leading-qualifier path (gated:
  'Master terrace' speaks / 'Garden bedroom' silent pair).
- HVAC service (supply register, tonnage contribution, equipment-room /
  thermostat / heat-pump anchoring), kitchen counter walk + GFCI zones
  for `Kitchen garden`, conditioned floor area/volume in characteristics
  (basis stated in notes), indoor pseudo-slab coverage in the exterior
  election (M4: outdoor zones never count as coverage).
- The room-coverage slab warning (item 3 — see C4).

What stays: `Garden bedroom` / `Terrace bedroom` / `Patio kitchen` /
`Garden bath` keep their INDOOR category (head noun indoor) — alarms,
registers, stubs intact. `Outdoor kitchen` / `Exterior hall` (leading
qualifier) and `Winter garden` / `Garden room` (conservatory class)
unchanged outdoor. `Master bath` stays a bathroom (indoor category still
resolves in ROOM_PATTERNS order, not name order).

## C2 — word-anchored garden/yard: substring traps flip indoor

`Kindergarden` and `Vineyard cellar` (and kin: any name where
garden/yard is a SUBSTRING of another word — `Gardenia room`,
`Graveyard`, `Shipyard`) flip `outdoor` → `other`.

What they GAIN (correct — these are rooms): treated as conditioned
space — floor area/volume count, general-lighting service, coverage in
the exterior election, the slab-coverage warning when uncovered, HVAC
participation on their level.
What they LOSE: nothing they honestly had.
Anchored survivors (gated): `Courtyard`, `Backyard`, `Front yard`,
`Gardens`, `Back garden`, `Winter garden` — all still outdoor.

## C3 — `terrazza` (Italian) joins the anchored terrace forms

`Terrazza`, `Terrazza coperta` etc. flip `other` → `outdoor`: they lose
conditioned-space treatment (area/volume, register, alarm eligibility,
election coverage) and gain the outdoor exemptions. `Terrazzo` /
`Terracotta` (material adjectives) still never match (M4 harm class,
pinned).

## C4 — outdoor zones excluded from the room-coverage warning

Scenes with `slabs.length > 0` and an OUTDOOR zone not covered by a slab
LOSE the warning `Room "<name>" has no floor slab under it` (e.g.
'Back garden' beside a slabbed house). Indoor rooms keep it — gated both
directions on the same geometry. No member/fixture drift; warning-list
only.

## C5 — zone-twin dedupe (S8 class)

Scenes carrying DUPLICATE zones (polygons vertex-for-vertex within 1 cm,
any start vertex/winding, same level) collapse to ONE room at
extraction. Tiebreak (stated): categorized-beats-'other' → longer
trimmed name → smaller id; dropped twin's boundaryWallIds union onto the
kept room; room order stays scene order. Effects on twin-carrying scenes
ONLY:
- duplicated per-room output disappears (double alarms/registers/GFCI
  walks over one space; the E6 false-traveler dup-zone weld class);
- honesty warnings stop contradicting the sheets — the exhibit:
  a 'Living / Kitchen' twin printed 'countertop receptacles … not
  modeled' for the sink-less twin while the other twin's counter run was
  drawn. Now: one kitchen, counter drawn, no false warning;
- a NEW warning states the merge: 'duplicate zone "X" shares "Y"'s
  polygon — merged (classified once, not twice)' (P4: prints on paper).
Genuinely distinct zones (≥ 5 cm apart) never merge (gated; tolerance
mutations bite both directions). Every extractRooms consumer (compute,
service seeding, panel garage check) sees the same deduped census (A4
parity).

## C6 — takeoff wording only (item 4, zero quantity drift)

Concrete pour rows where the ceiled +5% order figure equals the net
quantity at 0.1 yd³ display resolution append '(waste smaller than the
0.1 yd³ display step — net and order figures meet at display rounding)'
to the detail. Quantity column byte-identical; non-collapse pours
byte-identical including detail.

## Mutation record (probes from /tmp backups, restored + re-green)

- outdoor classification dead → 14 fails (day-9's 8-fail span SURVIVES,
  now wider)
- SLEEPING_NAME_RE weakened → 1 fail; R314 warning deleted → 2 fails
- head-noun tie-break removed → 2 fails; qualifier dead → 3 fails
- garden/yard anchors stripped → 1 fail; terrazza dropped → 1 fail
- zone-twin dedupe disabled → 7 fails (incl. the countertop exhibit)
- coverage exclusion removed → 1 fail; blanket-inverted → 1 fail
- collapse note always → 6 fails; never → 1 fail

Suite 1661 green + tsc clean at every commit; baseline recapture
byte-identical at every commit.
