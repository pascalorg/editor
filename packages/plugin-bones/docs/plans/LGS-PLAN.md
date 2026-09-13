# LGS PLAN — light-gauge (cold-formed) steel framing (2026-08-23)

ORIGIN (X.com feedback, via Julien): "Can it be configured to use light gauge steel
framing? … the main LGS rolling machines such as FRAMECAD, Howick, etc could be
selected and their profiles populate the framing."

UX ORIGIN (Julien, direct): "let's really think of the UI/UX experience… we did a
good job keeping it light — flexibility but not new clutter."

Code anchors: IRC 2021 **R603** (CFS wall framing) · **R505** (CFS floors) ·
**R804** (CFS roofs) — all three share the AISI member-designation system and the
same applicability limits (≤60 ft × 40 ft, ≤3 stories, Vult < 140 mph Exp B/C,
ground snow ≤ 70 psf; R804 adds roof slope 3:12–12:12). Beyond limits →
AISI S230 (R603.1.1.1). 2024 IRC text could NOT be verified (only the AISI
edition adoption was) — the data encodes 2021 only.

## Phases

### PHASE 0 — data model + profile catalog (THIS branch, feat/lgs-phase0)
Zero behavior change; E5 master-baseline byte-identical.
- `data/lgs-profiles.json`: AISI generic families (the always-verified base),
  vendor → machine catalogs (FRAMECAD, Howick + Scottsdale/Pinnacle stubs),
  punch patterns, fastener basis, full citations block.
- Spec plumbing: `FramingSpec.framingSystem?: 'lumber' | 'lgs'` +
  `lgsMachine?: string` (optional, NOT in DEFAULT_SPEC — absent == lumber,
  byte-parity); `FramingNode.framingSystem/lgsMachine` optional zod fields with
  NO defaults (absent round-trips absent); `WallConstruction` gains `'lgs'`
  (the CMU per-wall override channel carries it; type only, engines untouched).
- Pure `src/engines/lgs-profiles.ts`: designator parsing, family lookup,
  machine → rollable set, `profileFor(role, spec)` with the honest chain
  (machine profile → generic AISI family → 'engineered design required').
- Gates: suite + tsc; E5 byte pin; schema round-trip; citation-completeness
  data-shape test (every vendor row has sources or the explicit unverified
  status); module pure tests incl. the unverified-machine path.

### PHASE 1 — LGS wall engine (R603), behind `framingSystem === 'lgs'`
- Geometry strategy: **box-envelope members first** — every member renders as
  today's box at the PROFILE's true envelope (web × flange), with
  **profile-truth labels** ('350S162-33 (20ga) stud — IRC R603.3.2'); the
  C-shape render (web + flanges + lips, punchouts) is a later enhancement of
  the same members, not a blocker. Wall thickness stays byte-stable by
  construction: 350 web ≡ 2x4 depth (3.5"), 550 ≡ 5.5" — the lumber↔LGS web
  mapping in lgs-profiles.ts is dressed-depth-matched on purpose.
- Member recipe per R603: studs 350S162/550S162 (33–68 mil per the sixteen
  R603.3.2(2)–(16) mil-selection tables: width/spacing/height/snow/wind);
  track top+bottom, **track mils ≥ stud mils** (R603.3.2 verbatim rule);
  headers = 2 equal C box or back-to-back (R603.6) + head/sill track
  (R603.8); jack/king per R603.7; NO stud splices (R603.3.5), NO flange/lip
  cut or notch (R603.3.4); strap bracing rows at mid-height/third-points
  (R603.3.3); fasteners: stud-to-track 2×No.8 C1513 (one per flange),
  sheathing No.8 @6/12, gypsum No.6 @12 (Table R603.3.2(1), R603.2.5).
- Machine constraint: `profileFor` already resolves machine → profile with the
  fallback statuses; the engine's only job is to consume the resolution and
  surface `status` through the existing label/flag/warning channels.
- Takeoff: steel books by profile designator + length (and kg via design
  thickness), screws by count — same collapsed categories, derived from labels
  like every other row.

### PHASE 2 — floors (R505) + roofs (R804)
Joists 800/1000/1200S162 (S230 floor tables carry 33–97 mil rows), rim track
T125, bearing stiffeners, 24" max cantilever; roofs R804 within 3:12–12:12.
**Marquee integration: punch-aligned MEP routing** — the factory service
punchouts (S240 A5.9: centerline, ≥24" c-c, ≥12" from ends; SFIA standard
1-1/2"×4") are exactly where plumbing/electrical want to cross members. The
MEP engines gain a 'route through punchouts' mode for LGS levels: runs snap to
the 24" punch rhythm instead of emitting drill-through geometry — the demo
that sells the whole feature.

### PHASE 3 — machine export (research notes, UNVERIFIED leads)
Goal: hand the framed model to the selected machine's production software.
To research before any claim: FRAMECAD's design-to-production suite (FRAMECAD
Structure/Detailer) ingest formats; Howick's BIM pipeline (their pages mention
CSV component input and dual-head inkjet part marking — the CSV schema is the
lead); neutral routes (Vertex BD, Scottsdale SCOTSTEEL). NOTHING here is
verified vendor API/format documentation yet — Phase 3 starts with its own
research round. Machines do NOT publish min/max component length (checked:
neither FRAMECAD nor Howick spec sheets carry it) — export validation needs
vendor contact or field data.

## UI/UX PRINCIPLES (binding on Phases 1–2)
Origin: Julien — "we did a good job keeping it light — flexibility but not new
clutter."

1. **TWO CONTROLS TOTAL**, both riding existing surfaces:
   (a) the wall card's existing construction selector gains ONE option —
   Framed · **Steel** · CMU (· Skip) — the per-wall override channel users
   already know from CMU (same segmented control in
   src/inspector/wall-engineering.tsx, same `wallOverrides` persistence);
   (b) the Bones panel gains ONE compact **'Framing' row** (`Lumber ▾`
   default). PROGRESSIVE DISCLOSURE: a 'Machine' row (`Generic AISI ▾` |
   FRAMECAD F325iT | Howick FRAMA 3200 | …) exists ONLY while Steel is
   selected. Lumber users see zero change.
2. **NO new modals/wizards/config pages.** Machine constraints speak
   exclusively through the existing honesty channels: can't-roll resolutions →
   the 'engineered design required' warning/flag class (Warnings drawer +
   Flags takeoff block); unverified vendor rows → the generic-fallback label
   class ('unverified — generic AISI fallback' rides the member label).
3. **Takeoff/schedule/legend adapt via the existing derived-from-labels
   machinery** — steel rows land in the same collapsed categories: profile
   lengths + kg + screw counts, AISI designations + machine brand on labels
   (e.g. '350S162-33 (FRAMECAD F325iT)').
4. **DEFAULTS:** Steel with no machine = Generic AISI, honestly labeled; a
   machine choice only CONSTRAINS + BRANDS. `framingSystem` absent = lumber,
   byte-parity (the Phase-0 gate).
5. **Placement follows the existing settings grammar** (panel.tsx): the
   'Framing' row slots between the JurisdictionPicker and the detail/spacing
   `SegmentedControl` row (it is a code-basis peer of jurisdiction, not a
   view toggle); the disclosed 'Machine' row sits directly under it as a
   select styled like JurisdictionPicker. No new section, no new panel.

## Research notes (verified 2026-08-23 — full citations in data/lgs-profiles.json)

### AISI designator system (S240 A5.3; SFIA guide p.7–8)
`<web 1/100 in><letter><flange 1/100 in>-<mils>`; 350S162-33 = 3.5" web lipped
C, 1-5/8" flange, 33 mil (min base metal = 95% of design thickness, S240
A5.1.1). Letters: S = lipped C stud/joist · T = track (web INSIDE-to-inside) ·
U = unlipped channel · F = furring · L = angle. Standard C webs 162–1400;
C flanges 125–350; lips per S240 A5-10 (162 flange → 1/2"). Thickness rows
(mils | design in | design mm | ga): 33|0.0346|0.879|20-struct ·
43|0.0451|1.146|18 · 54|0.0566|1.438|16 · 68|0.0713|1.811|14 ·
97|0.1017|2.583|12. Gauge is deprecated (SFIA only); 18/27/30 mil are
nonstructural (S220) and their mm design thickness is unpublished — not
encoded. Yield: 33/43 mil → 33 ksi; ≥54 mil table-selected → 50 ksi (S230
A4.4). ASTM A1003 Type H; coating ≥ G60/CP60.

### IRC R603 structure (2021 text verified)
R603.2 now POINTS to AISI (S240/S230) for materials/web holes/ID. Studs
limited to 350S162 + 550S162 (Table R603.2.3/S230 A4-1; 33–68 mil); stud
spacing max 24"; SIXTEEN prescriptive mil-selection tables R603.3.2(2)–(16)
keyed width 24–40 ft × spacing 16/24 × height 8/9/10 ft × snow 20–70 ×
wind ≤140C. Track rule verbatim: "Top and bottom tracks shall have the same
minimum thickness as the wall studs." Web holes — THREE regimes, never
conflate: IRC/S230 field hole (≥24" c-c, width ≤ min(d/2, 1.5"), length
≤4.5", ≥10" from bearing); S240 A5.9 factory punchout (width ≤ min(d/2,
2.5"), ≥12" from end); SFIA manufacturing punchout (1.5"×4" for d>2.5").

### Vendor machines (public spec sheets only; discrepancies recorded verbatim)
FRAMECAD (live pages + archived vendor PDFs): F325iT / F325iT-L
(0.55–1.2mm, webs 63–150mm, flange 34–50mm), F450iT (0.70–1.6mm, 75–150mm),
TF550H (0.95–2.0mm, 89–150mm, flange 34–63mm), ST825iT (0.75–1.6mm,
60–152mm), ST925iT (0.95–2.0mm, 89–305mm), ST950H (1.15–2.5mm; ⚠ live says
250–305mm dedicated, 2021 PDF said 150–305mm — both recorded, derivation uses
the conservative intersection). FRAMECAD publishes NO lip dims and NO
component length limits.
Howick (live spec tables): FRAMA 3200 (0.75–1.15mm, webs 45–150mm discrete,
flange 41/39mm, lip 8/10mm), FRAMA 4200 (⚠ two thickness prints on one page —
both recorded), FRAMA 5600 (0.95–1.55mm, flange 45mm), FRAMA 7600
(75–200mm; ⚠ bolt-hole print transposed — 13mm unverified for this model),
FRAMA 6800/7800 (floor cassettes, 1.85–2.5mm, lips 15mm), X-TENDA 3600
(⚠ header vs table thickness ranges differ — both recorded). Howick profile
geometry is Howick's own (10mm lips vs AISI 12.7") — FRAMA 3200's 89mm C maps
to 350S162 as `nearestGeneric` with the lip delta noted; nothing pretends
they're identical.
Dropped as unverifiable: FRAMECAD non-suffixed model names, "FRAMA 900",
"X-CALIBUR", Vertek, Knudson standalone, Metroll (products, not machines).
Pinnacle LGS machines listed UNVERIFIED (thickness ceilings only — the
catalog's live example of the unverified-vendor fallback path).

## Honesty rules for vendor data (Phase 0 convention, binding forever)
1. Never invent dims. A verified row carries its source URLs in the data.
2. Vendor-page self-contradictions: record BOTH values verbatim with dates;
   capability derivations use the conservative reading.
3. Derived compatibility (machine ranges → AISI family) is labeled as
   derivation (`basis` string per row), tolerance ±0.5mm for imperial
   roundings; thickness compatibility via mil MIN-BASE mm within the
   machine's published coil range.
4. Anything unverifiable ships as `"unverified — generic AISI fallback"` and
   resolves generic dims — the status string surfaces on every resolution.
5. 2024 IRC: nothing encoded (text unverified).
6. **E5 byte-parity scope (the F1 caveat, spelled out):** the master-baseline
   pin proves byte-identity for every EXISTING input — no stored scene
   carries an `'lgs'` wall or `framingSystem`, and absent fields round-trip
   absent. `'lgs'` walls are a NEW INPUT CLASS the pin cannot see: they are
   governed instead by the `framesAsLumber` predicate (framing/schema.ts) +
   the F1 gates — an `'lgs'` wall must stay byte-equal to its `'framed'`
   twin on members AND takeoff areas, and the wall card must say "framed as
   lumber until the steel engine lands", never "Skipped". A value that
   parses but half-routes (members without booked sheathing, or a card that
   denies the members on screen) is the F1 defect class — any new
   construction value must land with the same three-site routing +
   card-truth gates.
