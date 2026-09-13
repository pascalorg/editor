# Wall Assemblies — Research Notes

**Scope:** layer stacks for the Bones wall-layers engine (interior partitions, dwelling–garage
separation, exterior walls with cladding families), plus the climate/jurisdiction modifiers that
change them. Companion dataset: [`data/wall-assemblies.json`](../../data/wall-assemblies.json).
**Code basis:** 2021 International Residential Code (IRC) chapter 7 + R302 + R602, and the
2021 IECC / IRC ch. 11 for insulation. 2015/2018 renumbering and 2024 deltas noted in §10.

> **Disclaimer.** Drafting aid, not engineering. Typical/approximate values — verify with the
> local authority having jurisdiction (AHJ). Layer thicknesses are *render/BOM* values; several
> real materials (WRB film, vapor retarders, veneer ties) are geometrically negligible and are
> carried as thin symbolic layers or metadata.

---

## 1. How the values were sourced and verified

- **Primary verbatim text:** IRC-based **Ohio Residential Code ch. 7 PDF** (2018 IRC text,
  codes.ohio.gov rule 4101:8-7-01) — R702.3.5, R702.7, R703.2, R703.3(1), stucco and veneer
  sections read cell-for-cell; plus 2015/2018 ICC ch. 3 text for R302.5/R302.6/R302.11.
- **Vapor retarder tables** (class prohibitions, Class III insulated-sheathing minimums incl.
  Zone 7 R-10/R-15 and Zone 8 R-12.5/R-20) verified online against the **UpCodes mirror of
  2021 IBC 1404.3**, which is identical to IRC R702.7 Tables R702.7(1)–(2). `verified: true`.
- **2021 IECC wall R-value rows**, HVHZ, WUI and termite overlays are from established code
  knowledge — ICC/PNNL sources were paywalled or 403 during the session (2026-08-14). Tagged
  `verified: "knowledge-base"` in the dataset.
- **2021 renumbering cross-checked:** stucco = R703.7, anchored veneer = R703.8, siding table =
  Table R703.3(1), vapor retarders restructured into Tables R702.7(1)–(4). See §10.

---

## 2. The three stacks (overview)

Exterior wall assembly order, inside-out, per **[R703.1 / R703.2 / R703.3]**: interior gypsum
board → (interior vapor retarder, by climate zone) → framing cavity with insulation → structural
sheathing over studs → (optional foam plastic insulating sheathing) → water-resistive barrier
"applied over studs or sheathing" → exterior cladding. The WRB is always immediately behind the
cladding/drainage plane, outside any structural sheathing.

| Wall type | Stack (inside → out) | Typical total |
|---|---|---|
| Interior partition | 1/2″ gypsum \| 2x4 cavity \| 1/2″ gypsum **[R702]** | 4-1/2″ (114 mm) |
| Garage separation | 1/2″ gypsum (house) \| 2x4 cavity \| 1/2″ gypsum (garage side) **[Table R302.6]** | 4-1/2″ |
| Exterior (vinyl example) | 1/2″ gypsum \| VR note \| 2x4/2x6 + batt \| 7/16″ WSP \| (foam ci) \| WRB \| cladding **[R703.1–.3]** | varies by cladding |

**ENGINE:** `wall-layers.ts` stacks member roles outward from the stud envelope:
`drywall | insulation (in bays) | sheathing | foam? | wrb | cladding`. Interior partitions emit
only drywall+drywall — exterior/interior is a wall-type switch, never a shared stack. Openings
punch every layer with the RO footprint.

---

## 3. Interior partitions — gypsum board [R702.3.5 + Table R702.3.5]

Gypsum board on both faces. Table R702.3.5 (walls, "Either direction"):

| Board | Max framing spacing | Notes |
|---|---|---|
| 1/2″ (12.7 mm) | 24″ o.c., either orientation | the default |
| 5/8″ (15.9 mm) | 24″ o.c., either orientation | the Type X thickness |
| 3/8″ (9.5 mm) | 16″ o.c. only | banned under water-based texture |

Edges/ends must land on framing; fasteners: nails 8″ o.c. / screws 12–16″ o.c. on walls
**[Table R702.3.5]**.

**Ceiling rows + footnote d [Table R702.3.5]:** 1/2″ handles joists/trusses at 16″ o.c. in any
orientation but must run **perpendicular** at 24″ o.c.; water-based texture bumps 3/8→1/2 at 16″
and 1/2→5/8 (or sag-resistant 1/2) at 24″; 3/8″ may not support insulation or texture.

**ENGINE:** partition assembly = 12.7 mm drywall each side of the stud envelope (2x4 total
89 + 2×12.7 = 114 mm = 4-1/2″). `gypsumThickness ∈ {12.7, 15.9}`; reject 9.5 mm when
`studSpacing > 406 mm`. Ceiling drywall thickness = f(framingSpacing, texture/garage flags):
610 mm spacing → 15.9 mm default. Wall drywall box height = floorToCeiling − ceilingBoardThickness
(boards meet, no overlap). Fastener schedules are takeoff metadata (LOD 500), not geometry.

---

## 4. Dwelling–garage separation [Table R302.6, R302.5]

This is a **separation, not a rated assembly** — no fire-resistance rating is prescribed.

| Table R302.6 row | Requirement |
|---|---|
| From the residence and attics | **≥ 1/2″ gypsum board or equivalent applied to the garage side** (verbatim). Base code does **not** require Type X on the wall — 5/8″ Type X there is a local amendment / builder upgrade only. |
| From habitable rooms above the garage | **≥ 5/8″ Type X** on the garage **ceiling**, perpendicular to framing (max 24″ o.c.), fastened 6″ o.c. with 1-7/8″ 6d coated nails or equivalent screws **[+ Table R702.3.5 Type X row]**. The only place R302.6 demands Type X. |
| Structure(s) supporting the separation | Walls, beams, columns supporting that floor/ceiling: **1/2″ gypsum**. |
| Detached garages < 3 ft from the dwelling | 1/2″ gypsum on the interior side of the exterior walls facing the gap. |

**Openings [R302.5.1]:** no door from garage directly into a sleeping room; other doors 1-3/8″
solid wood, 1-3/8″ solid/honeycomb-core steel, or 20-minute rated, **with self-closing device**
(reinstated 2018). **Ducts [R302.5.2]:** min No. 26 gage sheet steel, no openings into the garage.

**ENGINE:** corrects the round-13 spec — the `garageSeparation` face flag lives on the
garage-facing side; base-code member = 12.7 mm drywall with a `fireSeparation` tag. If Bones
renders 15.9 mm Type X there (design choice), the code-checker must treat 12.7 mm regular as
compliant, and takeoff labels cite Table R302.6, not a fire rating. `garageBelowHabitable` →
15.9 mm Type X ceiling board; any bearing wall/post under it gets a 12.7 mm drywall member even
in an unfinished garage. Openings punched through a `fireSeparation` wall carry doorType
constraints (35 mm solid / 20-min, `selfClosing: true`); the validator rejects garage→bedroom
doors; duct members crossing the plane get `material=26ga-steel`.

---

## 5. Exterior stack, layer by layer

### 5.1 Interior vapor retarder [R702.7, Tables R702.7(1)–(4); = 2018 R702.7/Table R702.7.1; = IBC 1404.3]

Class I: poly/foil ≤ 0.1 perm. Class II: kraft-faced batts. Class III: latex/enamel paint.
Required Class I or II on the interior of frame walls in **CZ 5–8 + Marine 4**; the 2021 edition
also **prohibits interior Class I in CZ 1–3 and Class II in CZ 1–2** (hot-humid walls must dry
inward). Class III permitted in the cold zones with vented cladding or sufficient exterior ci —
full table in §8.2. Basement/below-grade walls exempt; never combine interior Class I with
low-perm exterior foam (double vapor barrier) **[R702.7 exceptions]**.

**ENGINE:** zero-thickness layer — emit a `vaporRetarder` note (class + basis) on the assembly,
not geometry; kraft facing on the batt member satisfies Class II.

### 5.2 Cavity insulation [N1102.1.3 / 2021 IECC Table R402.1.3]

Values in §8.1. Practical batts: R-13/R-15 fill a 2x4 bay (3-1/2″); R-19/R-21/R-23 a 2x6 bay
(5-1/2″); "ci" is the exterior foam layer, never cavity fill.

**ENGINE:** insulation members are LOD-400 batt boxes filling **bays** between studs (the gate
matrix must NOT allowlist insulation × framing). Thickness = stud depth (89/140 mm). When the
zone demands more than R-21 cavity, the assembly auto-adds the foam ci layer instead of
thickening the wall.

### 5.3 Structural sheathing [Table R602.3(3), R602.10.4, Table R602.3(1) items 30–32]

Wood structural panel (OSB/plywood): min **3/8″** span-rated 24/0 at studs 16″ o.c.; **7/16″**
24/16 at 24″ o.c. — 7/16″ OSB is the near-universal field default and the thickness other
sections key on (veneer tie backing demands ≥ 7/16 WSP). Fastened 6″ edges / 12″ field with 8d
common; braced-wall panels (Method WSP/CS-WSP) use the same panels at ≥ 3/8″.

- **Gypsum sheathing option [R702.3.5 + Table R703.3(1) fastener column]:** ASTM C1396/C1177
  glass-mat, 1/2″ or 5/8″, a recognized substrate for every siding — but not a WSP: bracing must
  come from another method (WSP corner panels, let-in braces, Method GB). Typical under stucco
  and brick veneer.
- **Foam plastic insulating sheathing [R703.15, Tables R703.15.1/.2; R703.16/R703.17; Table
  R703.8.4(2)]:** the "ci" layer, typically 1/2″–2″ XPS/polyiso/EPS, non-structural, sits between
  structural sheathing and WRB (or serves as WRB when faced/taped as an approved system).
  Cladding over it needs the R703.15 fastener/furring tables (longer fasteners or vertical
  furring; heavy claddings generally need 3/4″ furring at 16″ o.c.); masonry-veneer ties may pass
  through **at most 2″** of foam into ≥ 7/16 WSP.

**ENGINE:** sheathing member = 11.1 mm box on the exterior stud face, full height, punched at
ROs; 4x8 sheet takeoff with 6/12 nailing note citing Table R602.3(1). `sheathingType='gypsum'` →
12.7 mm glass-mat layer + validator requires a bracing source elsewhere. Foam layer thickness =
ciR/5 × 25.4 mm (R-5 ≈ 1″ XPS), capped at 51 mm under brick veneer; presence flips fastener
metadata to R703.15 and can satisfy the Class III condition (§8.2).

### 5.4 Water-resistive barrier [R703.1 / R703.2]

Verbatim: "One layer of No. 15 asphalt felt, free from holes and breaks, complying with ASTM D226
for Type 1 felt or other approved water-resistive barrier shall be applied over studs or
sheathing of all exterior walls." Approved equivalents: plastic housewraps (ASTM E2556),
WRB-faced sheathings, per manufacturer instructions. Applied horizontally shingle-fashion, upper
course lapped **≥ 2″** over lower, **≥ 6″** at vertical joints, continuous to the top of walls,
terminated at penetrations to complete the envelope, integrated with flashing **[R703.4]**.

**Omissions [R703.2 Exception; R703.1.1 Exc. 1–2]:** (1) detached accessory buildings — base-IRC
exception, some states (e.g. Ohio) delete it; (2) concrete/masonry walls designed per ch. 6 and
flashed per R703.4/R703.8; (3) assemblies passing ASTM E331 (6.24 psf, 2 h). Everywhere else the
WRB is mandatory under **every** cladding type — the old "no WRB under some sidings" table column
died with the 2009 code.

**Stucco doubles it [R703.7.3, split into R703.7.3.1/.2 in 2021; = 2018 R703.6.3]:** over
wood-based sheathing the WRB must be equivalent to **two layers of Grade D paper** as separate
continuous planes (sacrificial bond-break + drainage plane), unless a 60-minute Grade D WRB is
separated from the stucco by a non-absorbing layer or a ≥ 90 %-efficiency drainage space.
Dry-southwest jurisdictions commonly amend this — exposed as an override in the dataset. The
single most-missed stucco rule.

**ENGINE:** one thin box per wall face (render 1.6 mm per round-13 design; real material
~0.25–0.5 mm — the render thickness is symbolic). Continuous full height after RO punch; takeoff
in sqft + 10 % lap factor, label "R703.2". `claddingType=stucco && sheathingType=WSP` →
`wrb.layerCount=2` in the takeoff (geometry stays one box). `suppressWrb` only when
`wallContext=detachedAccessory` (jurisdiction caveat flag) or `wallStructure=masonry/concrete`
— never on cladding type alone.

### 5.5 Cladding attachment generalities [R703.3 + Table R703.3(1)]

Fasteners corrosion-resistant, penetrating studs or WSP sheathing unless the table/manufacturer
says otherwise. Table R703.3(1) gives a fastener spec per substrate column — WSP+stud,
fiberboard+stud, gypsum sheathing+stud, over foam (deferring to R703.15), direct-to-stud (several
sidings "Not allowed" direct). Verbatim: "Nominal material thicknesses in Table R703.3(1) are
based on a maximum stud spacing of 16 inches on center" — wider spacing needs manufacturer
documentation. Support grid: studs 16″ (406 mm) o.c. default, 24″ (610 mm) max.

**ENGINE:** cladding fastener metadata = f(claddingType, outermost substrate layer) — derive the
table column automatically from the stack. Warn when `studSpacing=610 mm` and cladding lacks a
mfr-spacing note; foam-only sheathing → flag "fasten to studs only".

### 5.6 Openings [R703.4 + R703.2]

Every RO through the exterior stack needs pan/head flashing integrated shingle-fashion with the
WRB so drainage-plane water exits over the cladding — layers terminate onto each other at
openings. **ENGINE:** the wrb member keeps a `flashing` edge annotation on all four RO edges
(takeoff: lineal ft per opening, cite R703.4); no separate LOD-400 geometry, but the dollhouse
renderer must show the cavity cut cleanly through drywall→cladding with no layer bridging the RO.

---

## 6. Cladding families — thicknesses and rules

Assembly offset = added thickness outside the WRB (outside the sheathing for stucco, which wraps
its own paper).

| Family | Render/offset | Material min | Key citation | Vented (Class III credit) | Weight |
|---|---|---|---|---|---|
| Vinyl | 0.75″ (19 mm) | 0.035″ nominal panel | R703.11 + Table R703.3(1) | yes | ~1–2 psf |
| Fiber cement lap | 0.625″ (16 mm) effective | 5/16″ board | R703.10.2 | no (face-sealed) | ~2.3 psf |
| Fiber cement panel | 0.25″ (6 mm) (+3/4″ battens) | 1/4″ | R703.10.1 | no | ~2.3 psf |
| Wood lap (bevel) | 0.75″ (19 mm) | 3/8″ rustic/drop; 19/32 shiplap avg; 7/16 bevel (3/16 tip); hardboard 7/16 | R703.5 + Table R703.3(1) | no (unless furred) | ~2 psf |
| Stucco 3-coat | 1.0″ (25 mm) incl. lath | 7/8″ plaster (3/8+3/8+1/8, ASTM C926) | R703.7 (= 2018 R703.6) | no | ~10 psf |
| Brick veneer | 4-5/8″ (117 mm) | 3-5/8″ wythe + 1″ airspace | R703.8 | yes (airspace) | ~40 psf |
| EIFS w/ drainage | 2.0″ (51 mm) | EPS 3/4″–4″ | R703.9 / ASTM E2568 | no | ~1–2 psf |

### 6.1 Vinyl [R703.11 + Table R703.3(1) vinyl row]

Certified to ASTM D3679, **0.035″ min nominal** thickness; 0.120″ shank / 0.313″ head nails (or
16-ga staples) penetrating **1-1/4″** into sheathing+framing combined; nails centered in hem
slots, **not driven tight** (panel floats); over foam use R703.11.2 wind-pressure-adjusted
attachment; ≥ 140 mph zones need high-wind certification (VSI/ASTM D7793). Counts as vented
cladding for R702.7 Class III. **ENGINE:** render box 19 mm (lap-profile bounding depth; skin is
only ~1 mm) with `materialThickness=0.9 mm` metadata so takeoff quotes the code number; sets
`assembly.ventedCladding=true`.

### 6.2 Fiber cement [R703.10; Table R703.3(1) rows]

Lap: **≥ 5/16″** thick (ASTM C1186), ≤ 12″ wide, lapped ≥ 1-1/4″, 6d common nails into studs
through the sheathing (max 24″ o.c.); standard 8.25″ boards, 7″ exposure; ≥ 6″ clearance to
grade. Panel: **≥ 1/4″**, vertical joints over framing, battens optional (3/4 × 2-1/2″).
**ENGINE:** lap → 7.9 mm board box, 16 mm effective offset at laps; panel seams snap to the stud
grid; not vented by default. In WA/OR add 3/8″ rainscreen furring as best practice (total 1″).

### 6.3 Wood / hardboard lap [R703.5 + Table R703.3(1) wood rows]

Lap ≥ 1″ (≥ 1/2″ rabbeted/shiplap); face-nailed to each bearing, penetrating framing 1-1/2″,
one nail per bearing to 6″ widths, two over 8″; butt joints over framing. **ENGINE:** default
19 mm render box (bevel bounding depth) with profile-specific min-thickness metadata; hardboard
maps to 11.1 mm.

### 6.4 Stucco [R703.7/.7.1/.7.2.1 (= 2018 R703.6/.6.1); ASTM C926/C1063; Table R702.1(1)]

Three coats over metal/wire lath on framed walls: scratch 3/8″ + brown 3/8″ + finish 1/8″ =
**7/8″** total; corrosion-resistant lath fastened **6″ o.c.** into framing (1-1/2″ 11-ga nails or
7/8″ 16-ga staples); **two WRB layers** over wood sheathing (§5.4); No. 26 ga weep screed
(≥ 0.019″, ≥ 3-1/2″ flange) at the foundation plate line, lower edge **≥ 4″ above earth / ≥ 2″
above paving**, WRB and lath lapping the flange. FL variant: 5/8″ two-coat direct-applied on CMU,
no WRB/lath/screed (masonry substrate). **ENGINE:** 22.2 mm box outside the doubled WRB; total
stack 25 mm incl. self-furring lath + papers; stucco terminates at the weep-screed line, never
runs to grade — bottom = max(grade + 102 mm, paving + 51 mm) at the sill-plate line; screed is a
26-ga break-metal profile ~89 mm tall (reuse the foundation engine's grade line); lath is
takeoff-only. Heaviest non-masonry cladding (~10 psf) — note for dead-load checks.

### 6.5 Brick veneer [R703.8; Tables R703.8.4(1)/(2); R703.8.4.1/.2; R703.8.5/.8.6; R703.8.2/.2.1]

- **Geometry:** nominal 4″ brick = **3-5/8″ actual** wythe + **nominal 1″ airspace** (exactly 1″
  with corrugated ties; up to 4-1/2″ backing-to-veneer with No. 9 strand-wire/adjustable ties);
  veneer ≤ 5″ thick; grout may fill the airspace (R703.8.4.2 alternative).
- **Ties [R703.8.4/.8.4.1]:** min 22-ga × 7/8″ corrugated (or wire), one per **2.67 sq ft**, max
  32″ o.c. horizontal × 24″ vertical; extra ties within 12″ of openings > 16″; one per 2 sq ft in
  SDC D / high wind. Through foam: ≤ 2″ into ≥ 7/16 WSP **[Table R703.8.4(2)]**.
- **Support [R703.8.2/.2.1]:** bears on concrete/masonry foundation (brick ledge) — never on wood;
  steel lintels at openings (typ. 3-1/2 × 3-1/2 × 1/4″ loose angle); prescriptive height ≤ ~30 ft
  + 8 ft gable above support (first story only in high SDC without engineering).
- **Water management [R703.8.5/.8.6]:** flashing under the first course at the foundation and at
  all shelf angles/lintels, turned up behind the WRB; **weepholes ≥ 3/16″ at ≤ 33″ o.c.**
  immediately above every flashing line (practically every 3rd–4th head joint).

**ENGINE:** emits **two** layers: `airGap` 25.4 mm (transparent, still occupies the
interpenetration matrix) + `veneer` 92 mm. Foundation engine widens the stem wall/slab edge by
~117–127 mm as a `brickLedge` member (top 4–8″ below finish floor); veneer boxes start at the
ledge, not the sill plate; deleting the ledge invalidates the veneer. Ties = LOD-500 metadata
(count = wallArea/0.25 m²; stud grid 16″ × 24″ satisfies 2.67 sq ft). Weep/flashing = base-of-wall
metadata citing R703.8.6. Adds ~40 psf dead load and ~4.6″ jamb returns at every opening. Counts
as vented cladding for R702.7 Class III.

### 6.6 EIFS [R703.9; ASTM E2568/E2273]

On wood frame it must be **EIFS with drainage** (≥ 90 % efficiency per ASTM E2273) over a
R703.2 WRB — barrier EIFS over wood is a code violation (and the industry's most litigated
assembly). Terminations ≥ 6″ above grade, starter track (not weep screed). **ENGINE:** 51 mm
total: ~6 mm drainage plane/adhesive ribbons + 38 mm EPS (range 3/4″–4″) + ~3 mm base coat +
finish lamina.

---

## 7. Fireblocking and the wall/ceiling joint [R302.11, R302.11.1]

- **Item 1:** concealed stud spaces (incl. furred spaces, parallel/staggered stud rows) fireblocked
  vertically at ceiling and floor levels and horizontally at ≤ 10 ft. In platform framing the
  top/bottom plates **are** the vertical fireblocks; solid studs subdivide ordinary walls — the
  10-ft rule bites only in double-stud/staggered/furred assemblies and balloon-framed/tall walls
  crossing a floor line.
- **Item 2:** wall-cavity ↔ horizontal-space interconnections (soffits, dropped/cove ceilings)
  must be blocked. **Item 4:** openings around vents/pipes/ducts/cables at ceiling and floor level
  sealed with approved material.
- **Materials [R302.11.1]:** 2″ nominal lumber; two 1″ thicknesses with broken laps; 23/32″ WSP
  with backed joints; **1/2″ gypsum**; 1/4″ cement millboard; securely retained mineral/glass
  batts.

**ENGINE:** tag existing plates `fireblock:true` for the takeoff; emit explicit blocking members
only for doubleStud/furred assemblies at 10-ft intervals (batts permitted — can be an
insulation-role member) and walls crossing an intermediate floor plane. Soffit/dropped-ceiling
abutments get a fireblock cap member (12.7 mm gypsum or 38 mm lumber) at the soffit top plane.
MEP members crossing a plate line inherit a `fireblockSeal` tag (LOD-500 collar); through the
garage separation plane, the R302.11-item-4 seal tag applies.

---

## 8. Climate tables

### 8.1 Cavity insulation by IECC zone [2021 IECC Table R402.1.3 / IRC N1102.1.3; 2018/2015 Table R402.1.2]

| Zone | 2021 IECC (wood-frame wall) | 2009–2018 editions |
|---|---|---|
| 0–2 | **R-13**, or R-0 + R-10ci | R-13 |
| 3 | **R-20**, or R-13 + R-5ci, or R-0 + R-15ci | R-20 or R-13 + 5ci |
| 4–8 (unified 2021) | **R-30**, or R-20 + R-5ci, or R-13 + R-10ci, or R-0 + R-20ci | Z4–5 (incl. Marine 4): R-20 or R-13 + 5ci; Z6–8: R-20 + 5ci or R-13 + 10ci (2009 Z7–8: R-21) |

The 2021 stringency bump (zones 4–5 gaining a ci/R-30 tier) is the big delta — cavity-only 2x6
no longer complies under 2021. **Most states have NOT adopted the 2021 values**: pick the row by
the state's adopted edition, keyed to `jurisdictions-adoption.json` `ircBase` (≥ 2021 → 2021 row).
Zone 3 is the first 2x6 trigger (plan dimensions, header bearing, jamb depth).

Air tightness rides the same mapping **[2021 IECC R402.4.1.2/.3]**: ≤ 5.0 ACH50 zones 0–2,
≤ 3.0 ACH50 zones 3–8 (since 2012; gate on `ircBase ≥ 2012`).

### 8.2 Interior vapor retarder class by zone [R702.7, Tables R702.7(1)–(2); = 2018 Table R702.7.1; = IBC 1404.3(1); verified via UpCodes]

| Zone | Requirement | Prohibitions | Class III (paint) permitted if — ci min (2x4 / 2x6) |
|---|---|---|---|
| 1–2 | none | interior Class I **and** II prohibited | always (Class III is the ceiling) |
| 3 | none | interior Class I prohibited | always |
| 4 (non-marine) | none — Class III suffices | — | always |
| Marine 4 | **Class I or II** | — | vented cladding over WSP/fiberboard/gypsum, or ci ≥ R-2.5 / R-3.75 |
| 5 | **Class I or II** | — | vented cladding (as above), or ci ≥ R-5 / R-7.5 |
| 6 | **Class I or II** | — | vented cladding over fiberboard/gypsum only, or ci ≥ R-7.5 / R-11.25 |
| 7 | **Class I or II** | — | ci ≥ R-10 / R-15 |
| 8 | **Class I or II** | — | ci ≥ R-12.5 / R-20 |

Vented cladding = vinyl, brick veneer with airspace, furred siding. **Coupling rule:** where the
engine adds ci for IECC (e.g. R-5 over 2x6 in Zone 5 < R-7.5), the assembly still needs Class II
or vented cladding — compute `ciR ≥ tableMin(zone, studDepth) OR claddingVented → Class III OK,
else Class II`. Never emit interior Class I over low-perm exterior foam (double vapor barrier
error); basement walls exempt **[R702.7 exceptions]**.

### 8.3 State → dominant IECC zone [2021 IECC Figure R301.1 / county tables]

`jurisdictions-climate.json` has **no `ieccZone` field** (weathering/termite letters only) — the
overlay generator must add one; the dataset carries this mapping as `stateClimateZone` (dominant
zone + split note; split states need a "zone varies by county — confirm with AHJ" warning).
Highlights: FL 2A (1A Miami/Keys), HI 1A, TX 2A–3A, AZ 2B (5B Flagstaff), CA 3B/3C (5B–6B mtn),
most of the Northeast/Midwest 5A, MN/WI/ME/MT/ND/WY/VT 6, AK 7 (8 interior). Full 51-entry table
in the dataset.

---

## 9. Jurisdiction overlays

### 9.1 Regional default cladding (51 jurisdictions) [R703.6/.8/.10/.11 + `jurisdictions-*.json`]

| Default | States | Driver |
|---|---|---|
| **Stucco** (6) | AZ, CA, NM, NV, UT, FL | negligible weathering, termite pressure; FL usually stucco-on-CMU (5/8″ two-coat, no WRB/lath/screed) |
| **Vinyl** (28) | CT, DC, DE, IA, IL, IN, KS, KY, MA, MD, ME, MI, MN, MO, ND, NE, NH, NJ, NY, OH, PA, RI, SD, VT, WI, WV, WY, AK | cost, freeze-thaw tolerance, no termite appetite; cold states pair with 1–1.5″ foam ci; coastal NE needs R703.11.2 high-wind panels |
| **Fiber cement** (10) | GA, NC, SC, VA, WA, OR, ID, MT, CO, HI | humidity/rain durability, termite/rot immunity, WUI hardening |
| **Brick veneer** (7) | TX, OK, AR, LA, MS, AL, TN | clay supply, heavy termite, hail/heat, market expectation; Gulf-coast `hurricaneTies` → one tie per 2 sq ft |

### 9.2 HVHZ [FBC-R 8th Ed. (2023) §R4402–R4412 (wood §R4409); Miami-Dade TAS 201/202/203]

Miami-Dade + Broward counties only (`flags.hvhz`): sheathing min **15/32″ WSP**, 8d **ring-shank**
at **6″ o.c. edges AND field**; every exterior product needs an **NOA**; openings impact-protected
(TAS 201/202/203); foam sheathing cannot be the nailable substrate; blocks the 0 + 20ci IECC path.

### 9.3 High wind [R301.2.1.1/.2; AWC WFCM-2018; ICC 600-2020; R703.1.1 + Table R301.2(1)]

Vult ≥ 140 mph (or special wind regions): IRC prescriptive no longer applies — WFCM/ICC 600/ASCE 7.
Wind-borne debris (Vult ≥ 130 within 1 mi of coast, or ≥ 140 in hurricane regions): impact-protected
openings. WFCM sheathing: 8d ring-shank 4–6″ o.c. edges, 4″ o.c. corner end zones (4 ft), fully
sheathed. Where `stateWind ≥ 130 && flags.hurricaneTies` emit the nail-zone overlay + coastal-band
opening protection (county-level for AL/GA/LA/MS/NC/SC/TX/VA). At ≥ 140 mph warn on vinyl and
standard EIFS; prefer stucco-on-CMU or fiber cement with tightened fastening.

### 9.4 WUI [California Residential Code R337 (= CBC ch. 7A); SFM 12-7A-1; ORSC R327 (2023)]

CA Fire Hazard Severity Zones (all SRA + LRA Very High): exterior covering noncombustible /
ignition-resistant / heavy-timber / log, or an SFM 12-7A-1 assembly, foundation to roof;
**vinyl and untreated wood prohibited** in zone. OR adopted a mapped parallel in 2023; NV/CO/UT
have local ordinances only. `wuiOverlay: true` (CA), `'mapped-2023'` (OR).

### 9.5 Termite [R318.4 + Figure R301.2(6)]

`termiteRisk === 'very heavy'` (FL, LA, HI): no exterior/below-grade foam on foundations; 6″
inspection gap between foam and earth — terminate wall ci ≥ 6″ above grade, prefer cavity path at
grade-adjacent assemblies. `'heavy'` (AL, AR, CA, GA, MS, NC, OK, SC, TN, TX, VA): R318.1
protection + 6″ siding-to-grade warning; foam not prohibited.

### 9.6 Weathering [R703.8.2; ASTM C216/C62; Figure R301.2(3)]

Brick in `weatheringPotential 'severe'` regions (all northern/interior states) must be
**Grade SW**; `'moderate'` permits MW; drives mortar/durability selections.

---

## 10. Edition stability

R302.6 / R302.11 / R702.3.5 / R703.2 / Table R703.3(1) / stucco / veneer content is unchanged in
substance 2015 → 2021. Chapter 7 was renumbered in 2018: 2015 Table R703.4 → Table R703.3(1);
2015 R703.6/R703.7 (plaster/veneer) → R703.7/R703.8. Real 2021 deltas in scope: **R702.7 vapor
retarders** (rewritten as Tables R702.7(1)–(4) + hot-zone Class I restrictions) and the **2021
IECC wall R-value bump**. The **2024 IRC rewrites R703.2 again** (WRB performance classes) —
flagged for a future round. Dataset citations key to 2021 numbers with a `codeEdition` field;
2015/2018 states need only the R702.7 table-number alias and the pre-2021 insulation row.
