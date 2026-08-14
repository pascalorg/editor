<!--
Domain research reference for the formwork feature. Captured 2026-08-01 from
web research (primary standards, vendor catalogs, published papers).

PROVENANCE MATTERS HERE. Numbers in this file carry different confidence
levels, and the code must not treat them uniformly:

  - Items marked ⚠️ come from a secondary source.
  - Items marked ❌ are unverified.
  - The DIN 18218 tE-correction slopes were reverse-engineered by probing
    PASCHAL's public calculator (the standard is paywalled). They are
    internally consistent and exactly reproducible, but DERIVED, not
    transcribed.
  - Vendor capacity figures conflict because some are permissible/allowable
    and some are design resistances. Every catalog capacity needs an
    explicit capacityBasis flag; conflating them is a factor-of-2 error.

See wiki/formwork/reference/README.md for the buy/verify list before any of
this is presented to a user as a certified design.
-->

# FORMWORK GEOMETRY / COVERAGE / SEQUENCING — TECHNICAL REFERENCE

## 0. Where your code stands today (the gap)

`/Users/ar/Documents/code/editor/packages/nodes/src/formwork-system/geometry.ts` currently:
- unconditionally builds **both** faces (`SIDES = ['front','back']`) — no adjacency, no single-sided case
- has **no stop-ends** at all (`start`/`end` of the wall are never formed)
- has **no opening/box-out handling**, no deductions
- has **no cast order / pour concept** — it dresses one wall in isolation
- tiles panels as `wallLength / ceil(wallLength/panelWidth)` — i.e. it *invents* a non-standard panel width rather than using real modules + a filler/compensation piece. Real systems never do this; panel widths are fixed SKUs.
- ties are placed on a `wallLength/tieSpacing` fractional grid, again not on the panel module, and tie columns land mid-panel rather than at panel joints where the real tie points are.

`/Users/ar/Documents/code/editor/wiki/formwork-system-plan.md` acknowledges this is v1 "confirm the layout math visually." The schema you have to work with:
- `WallNode` (`/Users/ar/Documents/code/editor/packages/core/src/schema/nodes/wall.ts:173`): `start`, `end` (2D tuples), `thickness`, `height`, `curveOffset` (sagitta — so curved walls already exist in your model), `assemblyLayers`, `formworkType`, `tieSpacing`, `walerSpacing`, `scaffoldRequired`
- `ColumnNode` (`/Users/ar/Documents/code/editor/packages/core/src/schema/nodes/column.ts:84`): `radius`, `width`, `depth`, `shaftCornerRadius`, shape variants — so circular columns already exist
- Slab has `hole-editor.tsx` / `boundary-editor.tsx` → openings and arbitrary boundaries already exist
- **There is no `castOrder` / `pourId` field anywhere.** That is the single most important schema addition.

Note `getWallAssemblyFaceOffsets` (wall.ts:262) already separates **core** layers from finish layers. Formwork forms the **core (structural concrete) face**, not the finished face — your contact area must be computed off the core thickness, not `wall.thickness`. This is a real bug risk: `geometry.ts:126` uses `wall.thickness` directly.

---

## 1. WHICH FACES NEED FORMWORK — THE RULES

### 1.1 The governing principle

Formwork is measured and procured as **contact area**: the area of form face that touches wet concrete. Sources are unanimous on this (finitefield, build-construct, theconstructor).

**Critical distinction your software must make — two different numbers:**

| Number | Purpose | Behaviour at intersections |
|---|---|---|
| **Measured area** (QS / contract) | valuation, BOQ, subcontract payment | intersections **not** deducted; small openings **not** deducted below threshold |
| **Physical panel area** (procurement / layout) | how many panels to hire, cut list, crane weight | intersections **are** cut around; every void is real |

These diverge by several percent on a junction-heavy building. Existing software conflates them and estimators complain about it. Emit both.

### 1.2 Freestanding wall

| Face | Formed? | Notes |
|---|---|---|
| Side A | Yes | full height × length |
| Side B | Yes | poured concrete pushes both ways — a single skin blows out |
| End 1 | Yes — **stop-end / bulkhead** | only if the end terminates free |
| End 2 | Yes — stop-end | |
| Bottom | No | bears on kicker / slab / blinding |
| Top | **Usually no** | open, screeded/trowelled |

**When the top IS formed** (this is the rule people get wrong):

1. **Inclined / sloping top** — once the top surface rises above roughly 10–15° from horizontal, concrete will slump and the top must be held down. Below that it's screeded. *(The exact threshold is a project/mix decision — I am reasoning here; I found no single cited numeric threshold. Treat it as a configurable `topFormAngleThreshold`, default ~10°.)*
2. **Battered / tapered wall with an inclined face** — the *sloping face itself* becomes a "top form" in the structural sense: it is loaded in **uplift**, not lateral pressure, because the concrete pushes perpendicular to it and that has an upward component. This form must be **anchored down**, not just propped sideways. ULMA and Doka both sell inclined single-sided brackets specifically for this (ULMA SBF-185/SBM-240 "designed for the construction of strongly inclined walls"; Doka dam formwork "transfer all pouring loads into the previous pouring section"). Also needs **vent/blowholes** in the soffit-facing form, or air pockets form under the slope.
3. **Blind pour under an existing slab** — the top is bounded by the underside of hardened concrete; you need a pressure-relief/grout port arrangement, not a form.
4. **Curved-in-two-directions tops** — HKSMM4 explicitly has a separate classification "curved in more than 1 direction" for end formwork, which tells you the industry prices these as a distinct, expensive item.

### 1.3 Wall abutting previously-cast concrete — the contact area reduction

If a wall end butts a column or wall with a **lower cast order**, that end gets **no stop-end**. The hardened concrete is the form. This is the single largest source of contact-area reduction in a real building and the reason cast order must be a first-class field.

Corroborated by HKSMM4/HKSMM4R (kctang.com.hk): *"Exclude formwork intersected by slabs"* for structural walls/columns, and *"Formwork at wall-column-beam-slab intersections is deducted (no formwork surface exists there)."*

**Construction joint treatment at that interface** — the full menu, and which applies:

| Treatment | When | Detail |
|---|---|---|
| **Roughening / exposed aggregate** | almost always, for shear transfer | Target **CSP 5–7, ~3–6 mm amplitude**; remove all laitance and weak mortar until **coarse aggregate is exposed 30–50%**. Methods: bush hammer, scabbler, needle scaler; for mature joints, wet sandblast or UHP water jet (quollnet, structville) |
| **Shear key** | where designed shear must cross the joint; common at wall/base | formed by a tapered rebate strip nailed to the stop-end. Adds contact area to the stop-end and creates a re-entrant that must be **draft-tapered** or it won't strip |
| **Dowels / starter bars** | continuity of reinforcement — *"continuity of reinforcements at construction joints ensures maximal shear transfer"* (structville) | starter bars must **pass through the stop-end** → the stop-end needs slotted/drilled penetrations. This is a real geometric constraint: a stop-end is never a plain plate |
| **Waterstop** | water-retaining, basement, below-grade | PVC (heat-welded laps, **centralised within ±5 mm**, straight and untwisted) or hydrophilic strip (**gap under 3 mm** to the substrate, compatible adhesive). A PVC waterstop **splits the stop-end into two halves** either side of the centre bulb — geometrically significant |
| **Bonding agent** | where specified | cement slurry / polymer-modified / epoxy; continuous film, no pinholes, within open time; substrate **SSD for cement slurries, dry for epoxies** (quollnet) |
| **Expanding/injectable hose** | remedial or high-spec basements | |

**Where joints are allowed to go** (structville — this constrains your auto-splitting):
- Beams/slabs: perpendicular to main reinforcement, **at low shear or points of contraflexure** — typically midspan or the **central third** of the span, confirmed by the SE
- In girders: at a distance **twice the width of the incident beam** from the beam
- Columns/walls: at the **underside of slabs and beams**, and at the **top of the floor slab** for columns continuing upward
- Most common horizontal joint of all: **floor-to-wall interface** where a wall sits on a previously cast slab (build-construct)

### 1.4 Corners and T-junctions — the double-count problem

Physically, a corner needs **two** dedicated units: an **inside corner** (in the re-entrant) and an **outside corner** (wrapping the external angle). Dayton Superior's outside hinged corner covers **135° down to 5°**; Doka Frami uses galvanised hinged inside corners for acute and obtuse angles.

**The arithmetic rule** (Advance Concrete Form, "Laying Out the Job") — this is the one concrete layout rule I found stated numerically:

> outside corner size = inside corner dimension + wall thickness

e.g. an 8″ wall with 4″×4″ inside corners requires **12″** outside corner fractions. Generalised: `outsideCornerLeg = insideCornerLeg + coreThickness`.

**How to count area without double-counting.** The geometric truth is that at a 90° L-corner of two walls of thickness `t1`, `t2`:
- the **outer** faces wrap continuously; total outer run = `L1_outer + L2_outer` where each outer length extends to the outside corner point
- the **inner** faces stop short; each inner face is shortened by the *other* wall's thickness
- the two walls' end faces at the corner **do not exist** — no stop-end

The clean way (this is my recommendation, reasoning not citation): **model walls on centrelines, and assign every square millimetre of face to exactly one owner via a deterministic tiebreak.** Rule:

```
ownership of a corner overlap region → the wall with the LOWER castOrder;
tie → lower nodeId (stable, deterministic, reproducible across runs)
```

Then each wall computes its own faces from its **trimmed** extents and no region is ever counted twice, and the sum over all walls equals the true wrapped area. Corner *hardware* (the inside/outside corner units) is then emitted as a separate `CornerJoint` record owned by the junction, not by either wall — so the BOM gets exactly one inside + one outside corner per L, and the panel layout on each leg starts *offset by the corner leg length*.

**T-junction** (wall B ends on the side face of wall A):
- B gets **no stop-end** at that end if `castOrder(A) < castOrder(B)`; instead the joint is a construction joint into A's face, with starter bars pre-set in A
- if **monolithic** (`pourId(A) == pourId(B)`), B still has no stop-end, but A's face formwork must be **notched around B** — two inside corners on A's face, one each side of B, and A's face panel run is interrupted
- **measured** area: per HKSMM, do not deduct where B intersects A
- **physical** panel area: you must deduct `t_B × h_overlap` from A's face and add two inside corners

**Cross junction:** four inside corners, four leg starts. All four legs' stop-ends suppressed.

**Non-90° junctions:** hinged corners cover 135°→5° (outside) — outside that range you're into custom timber/steel filler. Flag as `requiresCustomCorner` when the angle falls outside `[minHingeAngle, maxHingeAngle]`. Acute angles below ~60° also create a **rebar congestion + concrete-flow** problem and often get a chamfered/filleted corner instead.

### 1.5 Single-sided formwork — wall against earth or existing structure

When one face cannot be reached (against sheet piling, secant piles, an existing building, rock), you get **single-sided formwork**. The loads are completely different: with no opposing panel there is nothing to tie to, so the entire lateral thrust **plus an overturning moment** must go into the base.

Two anchoring strategies, both cited:

**(a) Bracket / supporting-construction frame on the base slab** — Doka: *"concreting forces safely transferred by way of diagonal anchors"* when through-ties aren't feasible.
- Doka **Variable frame**: pour heights to **4.0 m**, manually positionable, standard steel walings
- Doka **Universal F**: heights to **12.80 m** by stacking — base Universal F 4.50 m + F 1.50 m + F 2.40 m add-ons
- Spindle footplates for uneven terrain; wheeled repositioning to reduce crane dependency

**(b) Climbing, anchored into the previous lift** — PERI SCS: *"fresh concrete pressure … transferred via the brackets into the climbing anchors of the previous concreting section."*
- **SCS 190** (1.90 m bracket): cheapest, formwork simply tilted to strike
- **SCS 250** (2.50 m): formwork carriage retracts **63–79 cm without a crane**
- **SCS Starter Brace Frame** handles the *first* segment, where there is no previous lift, by **diagonal anchoring into the bottom slab** — then strongback/spindle/formwork are reused up the wall
- SCS also converts to **two-sided tied** formwork up to **6.00 m** with few extra parts
- Inclinable platforms for battered structures, keeping working decks horizontal
- Applications: dams, locks, cooling towers, bunkers, strongroom vaults, pier heads, tunnels
- ULMA equivalents: **SBF-185** (fixed, 5 cm stripping distance, 185 cm platform) and **SBM-240** (mobile, 65 cm stripping, 240 cm platform), **max 4 m formwork height per lift**, **DW20–DW26** anchor points

**Software consequences of single-sided:**
- contact area for that wall = **1 × face** (plus ends), not 2
- `tieCount = 0` — replaced by `climbingAnchorCount` in the base slab or the previous lift
- **anchors must be pre-set in the previous pour** → creates a hard dependency: the *earlier* element's model must carry the anchor positions for the *later* element's formwork. This is a genuine cross-element data dependency and the reason single-sided cannot be computed per-element in isolation
- lift height is capped by the bracket, typically **4.0 m** (ULMA/Doka variable) — a 10 m wall against sheet piling is 3 lifts, not 1
- base slab needs a **local thickening / reinforcement check** for the anchor pull-out — flag it

### 1.6 Retaining walls, basement walls, blinding, kickers

- **Blinding**: a lean-mix layer under the base. Formwork for the blinding itself is usually trench-side/nil; but the blinding provides the **level datum** that the wall kicker and formwork sole plates set out from.
- **Basement wall with external waterproofing**: if the membrane is applied to the outside face, you often *cannot* have through-ties penetrating it → forces single-sided or taper-tie/she-bolt solutions.
- **Kicker** (theconstructor, dreamcivil): **50–150 mm** high, **150 mm optimal** — *"less than 150 mm is structurally undesirable, greater than 150 mm tends to slump under concrete weight."* Width and length match the column/wall. Normally *"placed monolithically with the slab."*
  - **Advantages**: maintains alignment between floors, restrains starter bars from moving, guarantees cover, speeds subsequent formwork erection (the kicker is the seal the wall form lands on)
  - **Disadvantage**: *"the possible formation of joints at the bottom of columns"* — a guaranteed extra construction joint at the worst possible place, right at the base where water gets in
  - **Kickerless construction**: eliminated, with the wall/column form clamped or dowelled directly to the slab. Faster, but higher error risk and much harder to seal against grout loss
  - **Measurement**: HKSMM4 — kickers are **included within** structural wall / column / non-structural wall measurement, **not itemised separately**. So do not emit them as a separate BOQ line, but *do* emit their formwork as physical items (a kicker is its own tiny two-sided form, or a "kicker clamp/rail")

### 1.7 Columns

- **4 faces** for rectangular; **perimeter × height** for circular (finitefield)
- **Minus** any face where the column is monolithic with, or embedded in, a wall. A column in the plane of a wall (a **pilaster**/thickening) may have only 1 or 2 exposed faces, or the "column" may be entirely absorbed into the wall's face run
- **Column head / beam junction**: the top of the column stops at the **underside of the beam/slab soffit** (structville). Formwork is measured/needed to that soffit level only. If there is a **column head drop / flared capital**, that is a separate, custom, non-modular form
- **Circular columns**: steel or cardboard tubes; contact area `π × D × h`. Cardboard tubes are single-use → your reuse counter must special-case them
- **HKSMM4 note**: exclude formwork intersected by slabs

### 1.8 Slabs

- **Soffit** (the big one) — measured by **thickness stages (0–200 mm, then 100 mm increments)** and **soffit height above support stages (0–3.50 m, then 1.50 m increments)** per HKSMM4. Both matter because deeper slabs and higher soffits cost more (heavier falsework, longer props)
- **Edge forms / stop-ends**: perimeter. finitefield notes *"Perimeter is usually one face. Choose two faces when formwork is needed on both sides"* — the two-face case is an upstand or a downstand edge beam
- **Openings**: box-outs. HKSMM4 — *"deduct formwork from openings exceeding 1.00 m²"*, and openings in concrete deducted above **0.10 m²**. **CESMM4 Class G** is different: *"No deduction… for openings and holes each not exceeding 0.5 m² in area"* (verified 2026-08-15, ISBN 978-0-7277-5751-7). theconstructor is more permissive (*"do not deduct any openings or cutouts in slabs"*) — so **this is contract-dependent and must be a configurable rule set**, not a hardcoded constant. finitefield confirms the industry reality: three templates — *always deduct / deduct above area threshold / deduct above width-height thresholds* — and explicitly warns *"Opening deduction conditions … vary by owner, company, and contract."*
- **Drop beams**: soffit of the beam is lower than the slab soffit → the falsework steps, and the beam gets 2 sides + soffit; the slab soffit stops at the beam side. Edge beams are *"a combination of plywood and timber, supported from the main propping system or from brackets."*
- **Striking + back-propping**: *"As soon as a form panel is dropped, the backprops have to go in"*; removal progresses *"from midspan to columns and walls."* Drophead systems allow early panel recovery while leaving props standing

### 1.9 Beams

- **Soffit + 2 sides** — universally stated (finitefield, theconstructor: *"combined surface area of two sides and bottom"*)
- **Minus** the side where a slab or wall frames in at full depth. A beam integral with a slab above loses no side (slab is above the beam sides), but a beam with a slab at mid-depth on one side loses that portion
- Beam **top excluded** (finitefield: *"beam top excluded"*), end faces optional
- **Do not deduct** at beam intersections or beam-to-column/wall intersections (theconstructor, kctang: *"Do not deduct formwork intersected by beam ends"*)

### 1.10 Openings in walls — box-outs

- **4 internal reveal faces get formed.** Reveal area = `openingPerimeter × coreThickness`. This is *added*, and it is frequently forgotten — a wall full of windows can have more reveal area than the area deducted.
- **The wall face area is DEDUCTED** — twice (both faces) — **above a threshold**. HKSMM4: **formwork deducted from openings exceeding 1.00 m²**. Configurable per contract.
- Net effect for a 1.2 × 1.5 m window in a 200 mm wall: deduct `2 × 1.8 = 3.6 m²`, add reveals `2×(1.2+1.5) × 0.2 = 1.08 m²`. Net −2.52 m². For a 0.6 × 0.6 m duct penetration in the same wall: deduct 0 (below threshold), add reveals `2.4 × 0.2 = 0.48 m²`. **Net positive.** Small openings *increase* formwork.
- **Box-out hardware** (PERI door/window former): patented corner system giving **pressure relief before stripping**, telescopic adjustment, chamfer strips optional, powder-coated aluminium. Weights: **Mini 15.2 kg, Window 24.8 kg, Door 29.43 kg**. "Fix" versions for wall thicknesses **20, 24, 25 cm**.
- **Draft/taper** is essential: a box-out with parallel sides locks in and cannot be struck. Either taper the reveals or use a collapsible/pressure-relief former.
- **Openings float in the tie grid** → ties cannot pass through the opening. The tie layout must be locally re-solved around each opening, and the panel run must be broken. This is the #1 clash source.
- **Lintels**: over-opening beams. If cast with the wall, the lintel soffit is the top of the box-out — no extra form. If cast separately (precast lintel), the wall pour splits horizontally.
- A **door** opening reaching the floor has only **3** reveal faces (head + 2 jambs); the sill face doesn't exist. Trivially wrong if you blindly compute `perimeter × t`.

### 1.11 Joints that split a wall into separate pours

| Joint type | Splits pours? | Stop-end needed? |
|---|---|---|
| **Construction joint / day joint** | Yes | Yes, on the first pour; the second pour butts it |
| **Pour break** (planned, for volume/rate) | Yes | Yes |
| **Expansion / movement joint** | Yes, always | Yes, plus a **compressible filler board + sealant + often a waterstop**, and the two sides are **structurally independent** — no starter bars crossing (except dowels through sleeves in some details) |
| **Contraction joint** | Sometimes | Often an induced crack former (crack inducer strip), not a full stop-end |
| **Isolation joint** | Yes | Yes |
| **Sliding joint** | Yes | Yes, plus a slip membrane |

An **expansion joint is a hard partition** in the pour graph: it can never be bridged by a monolithic pour, and both faces are formed on both sides. A construction joint is a **soft partition** — it is a *choice* made to satisfy pour volume, rate, formwork availability, or shrinkage control.

**Alternate bay construction**: pours are *"divided into initial-pour and closure-pour segments"* to manage thermal and shrinkage stresses; closure/infill strips are poured later once the primary bays have shrunk. For large water-retaining tanks, practice cited is **pour lengths limited to ~25 ft with 14-day intervals between adjacent pours**. Alternate-bay **doubles** stop-end count versus sequential pouring (each initial bay gets stop-ends on both ends), which is exactly the kind of tradeoff your software should surface.

---

## 2. POUR SEQUENCING AND LIFTS

### 2.1 The real sequence for a floor

ConcreteToolkit states the base rule: *"footings before walls, walls before slabs, lower floors before upper floors."* Beyond that, the two schools:

**(a) Columns/walls first, then slab (the common high-rise sequence)**
1. Kickers cast with the slab below (monolithic, per theconstructor)
2. Vertical elements: columns and cores. **Cores/lift shafts usually lead** — often by several floors, on jump/climbing formwork
3. Columns and walls cast to the **underside of the slab soffit**
4. Slab and beams cast as one, landing on the hardened verticals
5. Next kickers cast with this slab

*Why:* verticals strip in **16–24 h**, so they cycle fast and don't hold up the crane. The slab soffit can then bear on them. Joints land where the SE wants them: *"lower surfaces of floor slabs and beams, and the upper surface of floor slabs for columns that extend to the subsequent floor."*

*Coverage consequence:* every column has **4 formed faces, no top form**; the slab soffit is **interrupted** by the columns (physical deduction, no measured deduction); the wall faces stop at soffit level.

**(b) Monolithic (walls + slab in one pour)**
Used for thin-wall residential (aluminium formwork systems, "mivan"), where the entire floor of walls + slab is one pour, one set of aluminium panels, 4-day cycle.

*Coverage consequence:* **no stop-ends between wall and slab**, no horizontal construction joint, but the wall form must be **kickerless** (nothing to land on) and the wall/slab junction needs an internal corner form. This is why aluminium systems dominate that market: the corner condition is standardised.

**(c) Wall-to-wall within a floor:** whichever wall is cast first becomes the form for the second. So the *order* determines *which* wall carries the stop-end cost. A planner will deliberately order pours to **minimise total stop-end area** — a real optimisation objective for your software.

### 2.2 Lifts

**Why lifts exist:**
1. **Formwork panel height** — you own 2.4 m or 3.0 m panels. PERI MAXIMO offers **3.00 m and 3.60 m** panel heights specifically so tall storeys go in one lift.
2. **Lateral pressure grows with pour height.** Pressure at the base is bounded by hydrostatic `w·h`. A 10 m single lift generates ~240 kPa at the base — beyond any standard panel and tie system. Splitting into 4 × 2.5 m lifts caps the pressure at ~60 kPa each time, because each lift starts on hardened concrete.
3. **Bracket capacity** for single-sided — **4.0 m max** (ULMA, Doka variable frame).
4. **Free-fall limit.** ACI guidance is *"commonly interpreted to restrict the free fall or drop height of concrete to a maximum of 4 feet (1.2 m)"* (Stronghold tech bulletin). This does **not** cap the lift height, because you use a **tremie / elephant trunk / drop chute** to get down the form — but it *does* mean a tall lift requires drop pipes, and the pipes must fit past the rebar, and there must be **pour ports / access windows** in the form face at intervals up the wall if a chute can't be used. Those ports are geometric objects that appear on the panel layout.
5. **Rate of placement `R`** is a *design input*, and the placement crew's realistic rate combined with the lift height determines the pressure. Slowing the pour lowers pressure but risks a cold joint.

**Typical lift heights** (reasoning from the panel modules and bracket limits cited): 2.4–3.6 m for building walls (one storey = one lift is the goal); 2.5–4.0 m for civil/retaining; 3.0–5.0 m for dam lifts on climbing brackets.

**How lifts stack formwork:** the lift-1 panels are struck, the climbing anchors cast into lift 1 are exposed, brackets bolt on, and the *same* panel set climbs. Hence "**N sets of panels, M lifts**" with `N << M`.

### 2.3 Formwork pressure (design driver for tie count)

ACI 347R-14 is the governing reference. **The following formulas are from my recall — I was not able to fetch the ACI PDF text (no PDF renderer available) and the calculator sites gave inconsistent variants. Verify against ACI 347R-14 §2.2 before shipping.**

Imperial:
- **Columns:** `p = C_w·C_c·[150 + 9000R/T]`, min `600·C_w` psf, max **3000 psf** or `w·h`, whichever less
- **Walls, R ≤ 7 ft/hr and pour height ≤ 14 ft:** `p = C_w·C_c·[150 + 9000R/T]`, min `600·C_w` psf, max **2000 psf** or `w·h`
- **Walls, R ≤ 7 ft/hr with height > 14 ft, or 7 < R < 15 ft/hr:** `p = C_w·C_c·[150 + 43400/T + 2800R/T]`, min `600·C_w` psf, max **2000 psf** or `w·h`
- `R > 15 ft/hr` → **use full hydrostatic** `w·h`

Metric variant, as returned by NovaSolver (cite: novasolver.jp/en/tools/concrete-formwork-pressure-aci-347.html):
- Walls: `P_max = w_c(7.2 + 720R/(T+17.8))·C_w ≤ w_c·h`
- Columns: `P_max = w_c(7.2 + 785R/(T+17.8))·C_w` — *"Stiffer than walls because there is no lateral relief"*
- A **30 kPa floor** applied to both

Coefficients — NovaSolver's naming is muddled (it calls the admixture factor `C_w`), but the values it gives for the **admixture/chemistry** factor are usable: no admixture 1.0, lignosulfonate 1.0, naphthalene-based **1.2**, polycarboxylate high-range WR **1.4**. In ACI these are `C_c`; `C_w` is the **unit weight** coefficient (1.0 for normal weight ~150 pcf, higher for light/heavy). Vinawood confirms the column form `P = 150 + 9000R/T` psf *"capped at the lesser of the hydrostatic value or 3,000 lb/ft²."*

**Tie derivation** (vinawood, directly usable):
> *"each tie resists the design pressure multiplied by the area of form it serves (its horizontal spacing times its vertical spacing)"*

Worked: 60 kN/m² with ties at 600 × 600 mm → each tie carries `60 × 0.36 = 21.6 kN`.

So: `tieCapacity ≥ P_design × s_h × s_v`. **Solve for spacing given a known tie SKU capacity.** Note that in a real panel system the spacing is **not free** — tie holes are at fixed positions in the panel frame, so you pick from a discrete set. PERI MAXIMO: **3.00 m panels require only 2 anchors**, MX 18 anchor system to **60 cm wall thickness**, tie installed **from one side only, without spacer tubes and cones**.

Pressure is highest at the **base** of a lift, so real tie layouts are **denser at the bottom and sparser at the top**. Your current code uses uniform `tieSpacing` — that's conservative-and-wasteful at the top, or unsafe at the bottom.

### 2.4 Pour zones and bays

*"dividing floors into zones allows for more efficient use of formwork and labour resources"*. Zone boundaries are driven by:
- **concrete volume per pour** vs truck supply and pump rate (a pour you can't finish before the first placed concrete sets is a cold joint)
- **max pour length** for shrinkage control
- **crane reach and hook time**
- **available formwork sets**
- **allowed construction-joint locations** (midspan / central third)
- **expansion joints** (mandatory boundaries)

### 2.5 Cast order → formwork sets and cycle

The relationship the planner actually uses:

```
setsRequired = ceil(cycleTime_perSet / takt)
```
where `takt` is the target interval between pours and `cycleTime_perSet` is erect + reinforce + pour + cure-to-strike + strike + clean + move. Cited data points: *"2 sets of formwork can help you achieve a 10-day floor cycle"*; *"a seven day slab cycle"* is achievable with modern systems. Drophead slab systems reduce sets by letting panels come out early while props stay.

Equivalently, per element type:
```
setsRequired[type] = ceil( maxOverlappingPours(type) )
```
computed by sweeping the pour schedule: for each pour, the interval `[strikeReady_start, strikeReady_end]` during which its formwork is committed; the **maximum number of simultaneously committed pours** is the number of sets. This is an **interval-graph colouring** problem and the answer is the max clique = max overlap. That is the correct formulation and it generalises to "how many inside corners do I need" as well as "how many 2.4×0.6 panels."

**Doka Tipos does exactly this constraint check:** *"It factors in available equipment quantities, ensuring formwork solutions for which there is not sufficient equipment on the site will not be included."* And it supports *"cost-effective planning of projects with multiple cycles / build sections."*

### 2.6 Striking times (gate the cycle)

From trybuildcalc, citing ACI 347, EC2, BS EN 13670, IS 456:2000, AS 3610:

| Element | Minimum |
|---|---|
| Columns, walls, beam sides (non-load-bearing) | **16–24 h** |
| Slab soffit (props retained) | ~**3 days** |
| Beam soffit (props retained) | ~**7 days** |
| Props under slabs, span ≤ 4.5 m | ~**7 days** |
| Props under slabs, span > 4.5 m | ~**14 days** |
| Props under beams, span ≤ 6 m | ~**14 days** |
| Props under beams, span > 6 m | ~**21 days** |

Temperature: above ~25 °C standard or shorter with strength confirmation; **5–15 °C extend meaningfully**; near/below freezing *"hydration effectively stalls without special measures"* — strength verification replaces calendar time. All five standards prefer **strength-based** release for load-bearing formwork.

---

## 3. WHAT EXISTING SOFTWARE DOES

### Doka
- **Tipos 9** (doka.com/en/solutions/services/dfds/dfds-planning-software/tipos-software-formwork-planning): "Schal-Igel" on-screen wizard; user inputs the structure, Tipos generates solutions automatically from **~40,000 pre-validated solutions**; outputs **complete plans**, **accurate piece lists including connections and accessories**, **3D poster graphics**; **multi-cycle / build-section planning**; interactive post-generation editing; imports ground plans, sections, photos, text; **respects on-site equipment availability**; statically accurate calculations
- **DokaCAD for AutoCAD 9**, **Piece List Editor 9**, **Beam Statics 9**
- **DokaCAD for Revit** (aecmag.com/news/doka-launches-formwork-planning-plug-in-for-revit/): automated planning against 40,000 model solutions; **~4,500 components at LOD 400**, free; establishes **cycles** optimising safety/time/cost; generates **assembly and deployment plans**; **bills of materials**
- **Easy Formwork Planner** (efp-widget.doka.com): mobile, quick planning + ordering with 3D visualisation

### PERI
- **PERI CAD** / **ELPOS**; BIM content published to **Tekla Warehouse** (construsoft), including MAXIMO
- Hardware features that encode layout rules: MAXIMO **3.00/3.60 m** panels, **MX one-sided tie**, **centrally arranged tie points** giving *"a uniform joint and pattern both horizontally and vertically"*, *"clean concrete finish without any impressions due to unused tie holes"*, working time *"up to 50% less"*
- **RUNDFLEX** for curves: internal radii **≥ 1.00 m**, adjusted by **template + spindles** with self-cleaning hexagonal threads, SW24 ratchet
- **Box-out door/window former**

### MEVA
- **MEVA planning services** (meva.net/en-us/services/planning/): *"system selection, panel layout optimisation, structural calculations"*, **detailed material schedules**, BIM interfaces
- **BIM²form** for slab formwork design
- **StarTec XT**: *"symmetrical internal tie holes result in a uniform tie hole and joint pattern"*

### Tekla Structures — the most transparent about its actual algorithm
`support.tekla.com/help/tekla-structures/formwork_placing_tools_walls_panel` exposes the parameter set, which is effectively a spec for what your layout function needs:
- preferred **panel size from a dropdown** (discrete SKUs)
- when the array length doesn't match a whole number of panels, **automatically places smaller panels of matching height**
- **filler location: start / middle / end of the array** — user-controlled
- panel array **inserted by two points**
- **offset from wall bottom**, **total array height** user-defined
- **wall thickness overridden by actual wall thickness** on insertion
- specific panels can be **flagged as avoided** during automatic insertion
- **one or both sides** of the wall
- **pour unit assignment** — initial pour auto-identified, manually reassignable
- horizontal/vertical **edge clamps and walers controlled separately**
- panel widths **manually overridable** after insertion

### Revit add-ins
- **BIM²** (bim2.eu) — automated formwork planning add-in for Revit (site was unreachable during fetch)
- **MindPal** aluminium formwork planning (construction.mindpal.co/demo/aluminium-support)
- **Fommec** aluminium formwork design software, automated panelling (fommec.com/using-aluminium-formwork-construction-design-software-for-automated-paneling/)
- **Mitaka** BIM-based aluminium formwork error prevention

### Rental / inventory
- **Avontus Quantify** (avontus.com/quantify/): inventory & asset management, **rental/hire billing**, **tagging**, delivery/return/transfer reports, invoicing, **re-rental management**
- **Avontus Designer**: *"automatically generates precise scaffolding drawings around any structure"*, 3D/AR/VR

### Advertised feature set, consolidated

| Feature | Who advertises it |
|---|---|
| Auto panel layout | Doka Tipos, DokaCAD, MEVA, Tekla, BIM², Fommec, MindPal |
| Solution library / templates | Doka (40,000 solutions), PERI |
| Clash detection | Mitaka, BIM² (implied); notably **absent** from Doka's own marketing |
| Tie layout | PERI, MEVA, Tekla (as accessories) |
| Cut lists / piece lists / BOM | Doka (piece lists incl. connections & accessories), MEVA (material schedules), DokaCAD |
| Weight / crane check | Avema (crane pick weights, lifting points) |
| Pour plan / 4D sequence | Doka Tipos (cycles/build sections), Tekla (pour units), Avema |
| Labour hours | PERI (working-time claims), Tipos |
| Rental tracking | Avontus Quantify |
| Shop drawings | Tekla, DokaCAD, Avema, MEVA |
| Panel numbering / marking | Tekla shop drawings (item number, quantity, volume), Avema (panel pick list) |
| Assembly drawings | DokaCAD ("assembly and deployment plans") |
| Equipment-availability constraint | **Doka Tipos only** — and it's the smartest feature in the set |

### What contractors expect as outputs

From Avema (avemaformwork.com/services/formwork-shop-drawings/ and /pour-sequence-drawings/) — this is the most concrete published deliverables list I found:

**Formwork layout package:**
panel layout plans; wall elevations; **corner details**; tie layout & wale plans; brace locations & pour sequence; bulkhead details; blockout/opening details; **panel sizes and filler dimensions**; **lifting points and crane pick weights**; tie type, spacing, embed locations; soldier and waler arrangement; shore/frame/prop positions; **pour-by-pour striking and re-propping notes**; material list and formwork takeoff; **panel pick list**; general notes; concrete-pressure notes; vertical load notes; AutoCAD 2D & 3D; P.Eng. seal available. 3–5 business day turnaround for mid-size projects.

**Pour sequence package (9 items):**
1. Plan view with **pour zones** — where each placement starts and stops
2. **Lift sequencing (P1/P2/P3+)** — numbered order
3. **Construction joint details** — marked to prevent unintended cold joints
4. **Waterstop continuity markups** — unbroken water-retaining envelope
5. **Bulkhead locations** — stop-end positions for formwork crews
6. **3D colour-coded pour model**
7. **Concrete volume per pour**
8. **Suggested RFI questions** for the engineer of record
9. PDF + DWG dual format

Tekla shop drawings additionally show panel details at **1:10, 1:40, 1:60** with item number, quantity, volume, embedded items.

### Published automated panel layout algorithms

**PAAD** (pmc.ncbi.nlm.nih.gov/articles/PMC11166312/) — the clearest published description, and directly transferable:
- Formulated as **2D bin packing**: **walls are bins, panels are items**
- Inverts the classic objective: from "maximise items packed" to **"minimise total panels needed"**
- **Dynamic panel generation** rather than a fixed item set
- **Largest-first placement**: panels sorted by size, larger placed first to cover maximum area
- **Openings and voids treated as stationary objects that cannot be moved** — *"Void space is used to accommodate these complexities by being interpreted as stationary objects"*
- Fitness = uncovered wall area (net of openings/voids) **+** count of placed panels
- Hard constraints: manufacturing size limits (standard / header / horizontal panel types)
- Flexible constraints handled in **post-processing** (header extension requirements)
- GA over the top: population init (Algorithm 1), mutation = random dimension adjustment, crossover = merging solutions (Algorithm 2), then **post-processing applies industry rules for structural compliance**

**Other papers** (abstracts only — ScienceDirect and MDPI both 403'd):
- Lee & Lim, *Advanced planning model of formwork layout for productivity improvement in high-rise building construction* — **Harmony Search Algorithm compared favourably against genetic algorithms** for formwork panel layout planning (researchgate.net/publication/322177899)
- *Development of formwork automation design software for improving productivity* — sciencedirect.com/science/article/pii/S092658052100131X
- *Applicability of Formwork Automation Design Software for Aluminum Formwork* — mdpi.com/2076-3417/10/24/9029
- *A BIM-based layout planning approach for the aluminum formwork system* — researchgate.net/publication/372305145
- *Advances in formwork automation, structure and materials in concrete construction* — sciencedirect.com/science/article/pii/S0926580524001092
- Related bin-packing heuristics: GRASP for 3D bin packing (webthesis.biblio.polito.it/35411/), KRIH knowledge-reuse heuristic (nature.com/articles/s41598-024-81749-5), two-layer heuristic for 3D bin design and packing (tandfonline.com/doi/full/10.1080/0305215X.2023.2269868)

**The practical algorithm shape, synthesised** (my reasoning, grounded in PAAD + Tekla's parameters + the Advance Concrete Form corner arithmetic):

```
1. CORNERS FIRST. Corners are non-negotiable fixed points — their size is
   determined by wall thickness (outsideLeg = insideLeg + t), not by choice.
   Place them, then the remaining run length is a hard constraint.
2. Then reduce to a 1D strip-packing problem per face per lift, with the
   run length = wall length minus corner legs minus abutments.
3. LARGEST-FIRST greedy over the discrete panel width set.
4. SYMMETRY: for exposed concrete, mirror the layout about the wall
   centre so the filler lands in the middle (or is split into two equal
   fillers at the ends). Tekla exposes exactly this: filler at
   start/middle/end.
5. FILLER / COMPENSATION last: the remainder r = L - sum(panels).
   If r < minOffcut, back off one panel and re-split so you get two
   viable pieces instead of one unusable sliver.
6. OPENINGS as immovable obstacles: split the run at each opening,
   solve each sub-run independently.
7. TIES: derive spacing from pressure, snap to the panel's fixed tie
   holes, then run a clash pass against rebar, openings, and waterstops.
```

---

## 4. EXHAUSTIVE EDGE CASE LIST

Grouped by what breaks. Where I mark **[R]** I am reasoning, not citing.

### 4.1 Wall geometry
1. **Curved walls** — your `WallNode.curveOffset` already produces arcs. Cited: RUNDFLEX handles **internal radii ≥ 1.00 m**; MEVA Radius **from 250 cm**. Below the system minimum → custom/site-built forms. Note the **inner and outer forms have different radii** (`R` and `R+t`) so different panel counts and different spindle settings per face. Panel count per face differs — your symmetric both-faces loop is wrong for curves. **[R]**
2. **Polygonal approximation of curves** — most systems achieve curves as *"multiple straight sections rather than continuous curvature."* You must decide chord length and report the resulting **maximum deviation from true arc** (sagitta of the chord) against tolerance.
3. **Battered / tapered walls (varying thickness up the height)** — ties get longer each row; tie length becomes a per-row value, not a constant. One face is inclined → uplift-loaded and needs **hold-down**, plus air-release ports.
4. **Walls of varying thickness along length** — thickness step needs a **stepped filler**; Advance Concrete Form: a 4″×4″ inside corner + 90° clips creates a 4″ thickness change while also forming an outside corner. Tie lengths change at the step.
5. **Non-rectangular wall elevations** (gable, raking top, wall following a stair) — panels must be **cut** or a raking timber filler used. A raking top may need a top form if the rake exceeds the slump threshold.
6. **Walls under stairs** — a soffit-bounded, raking, confined space. Almost always custom timber. Access for vibration is the binding constraint. **[R]**
7. **Short returns / nibs** shorter than the smallest panel → single-piece timber or a corner unit alone with no field panel. HKSMM4 codifies the economics: wall-side formwork **≤ 300 mm wide is measured by the metre in 100 mm stages**, not by area — because narrow strips cost per-length, not per-area. Your measurement engine must implement this switch.
8. **Walls thinner than the panel module** / thinner than the minimum tie length — the ties bottom out. PERI MX 18 spans **up to 60 cm** thickness; there's a *minimum* too. Very thin walls (100 mm) may not accept a standard tie cone.
9. **Wall height not a multiple of panel height** — **compensation/filler**. Options: stacked panels + a horizontal timber compensation waling, or a shorter panel from the range, or panels raised on a plinth with a base filler. Tekla's `offset from wall bottom` + `total array height` parameters exist precisely for this.
10. **Corner overlap / double counting** — see §1.4. Also: two abutting corners closer together than the corner leg length (a nib between two corners) → **geometrically impossible with modular corners**, needs custom.
11. **Walls meeting at non-90°** — hinged outside corners **135° → 5°**; outside that, custom. Acute angles also cause rebar congestion and poor compaction.
12. **T-junctions** — see §1.4. Note the through-wall's face panel run is **broken**, so the layout must be re-solved either side, and two inside corners appear mid-run.
13. **Cross junctions** — four inside corners, four suppressed stop-ends, and the panel runs on all four legs start offset.
14. **Wall terminating free** — stop-end. Must accommodate **starter bars passing through** it if the wall continues later.
15. **Walls with pilasters / thickenings** — a local outstand. Two outside corners + two inside corners per pilaster, or a bespoke box. Contact area is *added*, not just redistributed.
16. **Out-of-plumb tolerance** — ACI 117-10: deviation from plumb = **lesser of 0.3% × wall height or 1 in (25 mm)**; top-of-wall elevation **±3/4 in**; location of vertical elements **±1 in**. BS EN 13670 is the European equivalent. Consequence: the *as-built* previous lift is not where the model says it is, so the next lift's formwork needs **adjustment/packing capacity** — the reason spindles and adjustable walings exist. Your software should emit required adjustment range, not a rigid geometry. **[R]**
17. **Wall with a step in its base** (following a stepped footing) — the sole plate steps, each step needs a small stop-end. **[R]**
18. **Very long walls** — exceed max pour length for shrinkage → forced construction joints. Cited practice for large tanks: **~25 ft pours with 14-day intervals**.
19. **Wall taller than one lift** — see §2.2.
20. **Two walls in the same plane, different thickness, meeting end to end** — face offset jump on one or both sides; needs a compensating filler and the tie length changes. **[R]**
21. **Zero-length / degenerate walls** from bad model data — your code already guards `wallLength <= 0` at geometry.ts:123. Also guard `thickness <= 0`, `height <= 0`, and collinear-overlapping walls.

### 4.2 Openings and embeds
22. **Tie clash with rebar** — the most common site problem. Ties must thread between bars; congested zones (lap zones, boundary elements, coupling beams) may not admit a tie at all → local waler spanning is needed.
23. **Tie clash with an opening** — ties can't cross a void. Local re-solve.
24. **Tie clash with a waterstop** — a tie through a waterstop destroys the water seal. Ties must be offset clear of the waterstop line.
25. **Openings within a panel-joint distance of each other** — no room for the intermediate panel → merge into one bigger box-out or use a single spanning header. PAAD's "header panel" type exists for this.
26. **Opening near a corner** — the box-out fouls the corner unit. **[R]**
27. **Opening spanning a lift boundary** — half the box-out is in lift 1, half in lift 2. Either move the lift line or split the box-out horizontally with its own construction joint.
28. **Door opening reaching floor level** — 3 reveal faces, not 4.
29. **Openings below deduction threshold** — *increase* net formwork (reveals added, nothing deducted). See §1.10 worked numbers. HKSMM4 threshold **1.00 m²** for formwork; **0.10 m²** for concrete openings; **0.05 m³** for concrete voids. theconstructor says never deduct slab openings. **Contract-configurable, three templates, per finitefield.**
30. **Box-out with no draft** — locks in, can't be struck. Requires taper or PERI-style pressure-relief corner.
31. **Cast-in items** — sleeves, conduits, cast-in channel, anchor plates, lifting sockets. Each occupies form-face real estate and may need a hole in the panel (which then makes that panel a modified/dedicated panel that can't go back in the general pool).
32. **Recesses and rebates** — negative features requiring bolt-on formers with their own draft.

### 4.3 Slabs, beams, falsework
33. **Sloping soffits** (ramps, transfer slabs) — falsework legs vary in length continuously; props need to be individually set; the soffit form wants to slide. Needs a restraint system. **[R]**
34. **Slab formwork over an existing slab** — props land on the slab below, which must be **checked for the prop load** (and may need back-propping to *its* soffit). Where props can't land (over a void, an atrium, a plant room), you need **needle beams / birdcage / flying shores**.
35. **Back-propping** — *"as soon as a form panel is dropped, the backprops have to go in."* Striking order *"from midspan to columns and walls."* The number of levels of back-prop is a structural calculation and determines how many prop sets you own.
36. **Drop beams and upstands** — stepped falsework, plus edge forms on two faces for the upstand.
37. **Cantilever slab edges** — need needle/bracket support off the slab below or the wall, and much longer striking times.
38. **Slab openings large enough to need their own edge form and a handrail** — safety item that appears on the layout.
39. **Post-tensioned slabs** — stressing ends need pockets/anchorage recesses; **cannot strike until stressed**, which reorders the whole cycle.

### 4.4 Foundations and civils
40. **Stepped footings** — each step is a small form with its own stop-ends. Formwork for foundations is *"the surface area of four sides of foundation only"* — no bottom (on earth/blinding), no top (open) (theconstructor).
41. **Pile caps** — often cast against the excavation face (no formwork at all on the sides), or against blinding with a thin form. Pile heads project through the base — deduct their footprint from the bottom but they don't affect side forms. Large pile caps are mass concrete → **thermal cracking**, so pour splitting and temperature control matter. **[R]**
42. **Water-retaining structures** — **no through-ties permitted**. Cited: use **waterstop ties or taper ties rather than standard she-bolts** (formwork.expert). Consequences: taper ties are removed and the tapered hole is **plugged with a mechanical/hydrophilic plug** (Sika X-Plug, Solco sealing plug, FormPlug, CJ Form-Tie Waterstop) — so every tie hole becomes a BOM line and a QA hold point. Alternatively go fully single-sided. Also: waterstop continuity is a hard graph invariant (Avema markups it up as a deliverable) — **your software should verify the waterstop forms a closed loop with no breaks at pour boundaries.**
43. **Blinding and level datum** — kicker and sole-plate setting-out reference.
44. **Mass concrete lifts** — thermal, not pressure, governs lift height.

### 4.5 Architectural / exposed concrete
45. **Tie pattern must be symmetrical and specified.** Cited: PERI *"centrally arranged tie points"* → *"uniform joint and pattern both horizontally and vertically"*; MEVA StarTec XT *"symmetrical internal tie holes result in a uniform tie hole and joint pattern"*; COMETAL DELTA *"symmetrical placement of tie holes and consistent panel sizes."* Architectural concrete specs require documenting *"form-tie locations and patterns"* and *"form-facing material joints"*. ACI 347R-14 has a dedicated architectural concrete chapter. This **inverts the optimisation**: for exposed concrete you are no longer minimising panel count, you are **matching a specified joint-and-tie grid** and the panel layout is an output of the architecture, not of packing efficiency. Two entirely different solver modes.
46. **Unused tie holes leave marks** — MAXIMO markets *"no impressions due to unused tie holes."* If you place fewer ties than the panel has holes, the empty holes still print. Must either fill or use a system with the right hole count.
47. **Panel joint lines must align across floors / across returns** — a vertical joint that jogs at a floor line is a visible defect.
48. **Form-face material and reuse count** — plywood degrades; exposed concrete may allow only 2–5 uses of a face before replacement, non-visual 20+. Your reuse tracker needs a per-face-material use limit.
49. **Chamfers/arrises** — chamfer strips at every external arris (PERI box-out mentions them). They change nothing dimensionally but are a real BOM item measured in linear metres.

### 4.6 Logistics
50. **Crane reach and weight limits** — every ganged panel assembly needs a **pick weight** and a **lifting point** (Avema deliverables). Box-out weights are published (**15.2 / 24.8 / 29.43 kg**) precisely because manual handling limits matter. If a gang exceeds the crane's capacity at that radius, it must be split — which changes the panel layout.
51. **Craneless operation** — SCS 250 retracts **63–79 cm without a crane**; ULMA SBM-240 rolls back **65 cm**. Doka frames are **wheeled**. Designing for craneless stripping changes the standoff geometry and the platform width.
52. **Access / scaffold** — your `scaffoldRequired` flag exists. Real driver: any working face above ~2 m needs a platform, plus a **stripping gap**, plus edge protection. ULMA platform widths 185/240 cm.
53. **Night pours and temperature** — striking times extend materially at 5–15 °C; hydration stalls near freezing. Hot weather accelerates set → **cold joint risk** in a long pour, and higher `R` needed. Temperature `T` also feeds the pressure formula directly (lower `T` → **higher** pressure). Cold-weather pours often need heating/insulated blankets, which are a formwork accessory.
54. **Sequence conflicts** — cycles in the cast-order graph; an element whose formwork requires anchors in an element cast *later*; a single-sided wall whose base slab hasn't been cast; a pour whose stop-end position violates the SE's permitted joint locations; two pours in the same zone in the same day exceeding batch plant supply. **All of these are graph/schedule validations, and they are the highest-value output your software can produce** because they're the errors that cost money on site.
55. **Equipment availability** — Tipos' constraint: don't propose a solution the site doesn't have stock for.
56. **Minimum offcut size** — a 40 mm sliver of plywood between two panels is not buildable. Enforce `minFillerWidth` (typically 50–100 mm **[R]**) and rebalance the layout rather than emit it.
57. **Concrete volume per pour vs supply** — Avema lists *"concrete volume per pour"* as a deliverable. If a pour exceeds what can be delivered and placed before initial set, it must be split.
58. **Rate of placement achievable by the crew** — if the designed `R` needs 3 pumps and you have 1, the pressure assumption is wrong (lower R → lower pressure, so this is usually conservative, but the *cold joint* risk goes up).
59. **Grout loss at the base** — the kicker seal, or kickerless clamp detail, is where blowouts happen. Needs a sealing strip.
60. **Panel identity / marking** — a panel modified for a cast-in item, or cut for a rake, is no longer a general-pool panel. Your BOM must distinguish **standard / modified / bespoke** and your reuse count must follow the *marked* panel, not the type.

---

## 5. PROPOSED ALGORITHM

### 5.1 Required schema additions

```ts
// on every castable element (wall, column, slab, beam, footing)
castOrder:  number         // total order; ties broken by nodeId
pourId:     string         // elements sharing a pourId are monolithic
liftIndex?: number         // 0-based, within the element
// per-element overrides
formworkMode?: 'double-sided' | 'single-sided-A' | 'single-sided-B' | 'none'
againstEarthSide?: 'A' | 'B'
topSurface?: { kind: 'open' | 'formed' | 'bounded'; slopeDeg: number }
exposureClass?: 'standard' | 'architectural' | 'water-retaining'

// new node kinds / records
JointNode  { kind: 'construction'|'expansion'|'contraction'|'isolation'|'sliding',
             elementIds: [string,string], treatments: JointTreatment[] }
CornerJoint { angleDeg, wallIds: string[], insideUnits, outsideUnits, ownerId }
```

Nothing else new is needed: `curveOffset` gives you curves, `assemblyLayers` gives you core thickness via the existing `getWallAssemblyFaceOffsets`, slab `holes` give you openings, `ColumnNode.shape` gives you circular.

### 5.2 Core data model

```
Face = {
  elementId, faceRole: 'sideA'|'sideB'|'endStart'|'endEnd'|'top'|'bottom'
                      |'soffit'|'edge'|'reveal',
  outline: Polygon2D (in the face's own UV plane),
  liftIndex: number,
  formed: boolean,
  reason: FormedReason,          // why formed / why not — always explain
  grossArea, measuredArea, physicalArea,
  deductions: Deduction[],
  additions:  Addition[],
  jointTreatments: JointTreatment[],
  pressureProfile: (v: number) => number,   // v = height above lift base
}
```

### 5.3 Pseudocode

```
────────────────────────────────────────────────────────────
PHASE 0 — NORMALISE
────────────────────────────────────────────────────────────
for each element e:
    e.core   = coreThickness(e)              // assemblyLayers, NOT e.thickness
    e.axis   = centreline(e)                 // arc if curveOffset != 0
    e.base   = baseElevation(e)              // top of kicker / slab / blinding
    e.top    = topElevation(e)               // underside of soffit above, etc.
    assert e.core > 0 and e.top > e.base     // reject degenerate

────────────────────────────────────────────────────────────
PHASE 1 — TOPOLOGY: build the junction graph
────────────────────────────────────────────────────────────
# Spatial index on centrelines + footprints, tolerance TOL (~5mm)
J = []
for each pair (a, b) of elements whose bboxes overlap (inflated by TOL):
    r = classifyJunction(a, b)
    # r.kind ∈ { CORNER_L, T_JUNCTION, CROSS, COLLINEAR_BUTT,
    #            FACE_ABUT (column-in-wall), CONTAINED (pilaster),
    #            SUPPORTS (slab on wall), NONE }
    if r.kind != NONE:
        r.angleDeg   = angleBetween(a.axis, b.axis) at the junction point
        r.monolithic = (a.pourId == b.pourId)
        r.earlier    = (a.castOrder, a.id) < (b.castOrder, b.id) ? a : b
        r.later      = the other one
        J.append(r)

# Validate the graph BEFORE doing any geometry
assertAcyclic(castOrderGraph(J))
for j in J where j.kind == CORNER_L or CROSS:
    if j.angleDeg outside [MIN_HINGE, MAX_HINGE]:     # e.g. [5°, 135°]
        flag(j, 'CUSTOM_CORNER_REQUIRED')

────────────────────────────────────────────────────────────
PHASE 2 — LIFTS: split each element vertically
────────────────────────────────────────────────────────────
for each element e:
    H = e.top - e.base
    hMax = min( panelSystem.maxStackHeight(e),         # e.g. 3.6m or stacked
                bracketLimit(e.formworkMode),          # 4.0m single-sided
                pressureLimitHeight(e, R, T, tieCapacity),
                e.userMaxLift ?? INF )
    n = ceil(H / hMax)
    # Snap lift joints to PERMITTED construction-joint elevations:
    #   underside of slabs/beams, top of slabs, existing JointNodes
    e.lifts = snapToPermittedJoints( uniformSplit(e.base, e.top, n),
                                     permittedJointElevations(e) )
    for each lift L in e.lifts:
        if L is not the bottom lift:
            L.baseJoint = ConstructionJoint(horizontal)
                          .withTreatments(jointRules(e, HORIZONTAL))

────────────────────────────────────────────────────────────
PHASE 3 — PLAN SPLIT: pour zones / bays
────────────────────────────────────────────────────────────
for each element e:
    cuts = []
    cuts += hardCuts(e)                       # expansion/isolation joints
    if length(e) > maxPourLength(e.exposureClass):
        cuts += softCuts(e, maxPourLength)    # shrinkage control
    if volume(e) > maxPourVolume(site):
        cuts += softCuts(e, byVolume)
    cuts = snapToPermittedJointPositions(cuts, e)   # central third, 2×beamW
    e.segments = split(e.axis, cuts)
    # alternate-bay mode: assign parity, closure strips get later castOrder
    if e.exposureClass == 'water-retaining' and alternateBayEnabled:
        assignAlternateBayOrder(e.segments)

# each (segment × lift) is now one POUR UNIT with a unique pourNumber
POURS = topologicalSort(all pour units, by castOrder then dependency)
assignPourNumbers(POURS)          # P1, P2, P3, ...

────────────────────────────────────────────────────────────
PHASE 4 — FACE CLASSIFICATION  (the heart of it)
────────────────────────────────────────────────────────────
for each pour unit P (element e, segment s, lift L):

  # ---- 4a. SIDE FACES ----
  for side in [A, B]:
      if e.formworkMode == 'single-sided-' + opposite(side):
          emit Face(side, formed=FALSE, reason=AGAINST_EARTH_OR_EXISTING)
          # and the OTHER side becomes bracket-supported:
          markBracketSupported(opposite(side))
          requireAnchors(into: e.baseElement or previousLift(L))
          continue
      if side is fully covered by a CONTAINED junction (e.g. wall inside wall):
          emit Face(side, formed=FALSE, reason=EMBEDDED)
          continue
      emit Face(side, formed=TRUE, reason=EXPOSED_SIDE)

  # ---- 4b. END FACES (stop-ends / bulkheads) ----
  for endRole in [endStart, endEnd]:
      j = junctionAt(e, endRole)
      if j == NONE:
          emit Face(endRole, formed=TRUE, reason=FREE_END_STOP_END)
      elif j.earlier == e:
          # WE are cast first → we must stop-end against nothing yet
          emit Face(endRole, formed=TRUE, reason=STOP_END_FOR_LATER_ABUTMENT)
          attach starterBarPenetrations(j)     # slots in the stop-end
          attach jointTreatments(j)            # key / waterstop / roughen
      elif j.monolithic:
          emit Face(endRole, formed=FALSE, reason=MONOLITHIC_CONTINUATION)
      else:
          emit Face(endRole, formed=FALSE, reason=ABUTS_HARDENED_CONCRETE)
          attach jointTreatments(j)            # prep of THEIR face
  # segment cuts within an element behave identically:
  for cut in internal segment cuts:
      emit Face(cut, formed=TRUE, reason=POUR_BREAK_BULKHEAD)

  # ---- 4c. TOP FACE ----
  t = e.topSurface
  if L is not the topmost lift:
      emit Face(top, formed=FALSE, reason=LIFT_JOINT_OPEN)
  elif t.kind == 'bounded':
      emit Face(top, formed=FALSE, reason=CAST_AGAINST_SOFFIT_ABOVE)
      requireGroutPorts()
  elif t.slopeDeg > TOP_FORM_ANGLE_THRESHOLD:      # default 10°
      emit Face(top, formed=TRUE, reason=SLOPE_EXCEEDS_SLUMP_LIMIT)
      markUpliftLoaded()          # hold-down, not props
      requireAirReleaseVents()
  else:
      emit Face(top, formed=FALSE, reason=SCREEDED_OPEN)

  # ---- 4d. BOTTOM ----
  emit Face(bottom, formed=FALSE, reason=BEARS_ON_KICKER_OR_SUBSTRATE)
  if kickerMode == 'separate':
      emit KickerPour(height=150mm, castWith=slabBelow, ownFormwork=TRUE)
  # NOTE: per HKSMM4, kicker formwork is INCLUDED in wall/column
  # measurement — do not emit a separate BOQ line, only a physical item.

  # ---- 4e. SLAB / BEAM SPECIALISATION ----
  if e is Slab:
      emit Face(soffit, formed=TRUE, thicknessStage, soffitHeightStage)
      for edge in boundary(e):
          if edge abuts an earlier-cast element: formed = FALSE
          else: emit Face(edge, formed=TRUE, reason=SLAB_EDGE_FORM,
                          faceCount = isUpstand(edge) ? 2 : 1)
  if e is Beam:
      emit Face(soffit, formed=TRUE)
      for side in [A, B]:
          d = depthOfFramingElement(side)     # slab/wall framing in
          emit Face(side, formed = (d < e.depth),
                    outline = sideRect minus framedPortion)

────────────────────────────────────────────────────────────
PHASE 5 — TRIM FACE OUTLINES  (corners: no double counting)
────────────────────────────────────────────────────────────
for each junction j:
    region = overlapFootprint(j)              # the shared prism
    owner  = j.earlier                        # deterministic; tie → lower id
    for each element e in j.elements:
        if e != owner:
            for each formed side Face f of e:
                f.outline = f.outline MINUS project(region, onto f)
                f.deductions += { CORNER_OVERLAP_REASSIGNED, ownedBy: owner }
    # corner HARDWARE belongs to the junction, not to a wall
    if j.kind in {CORNER_L, CROSS, T_JUNCTION}:
        emit CornerJoint(j) with
             insideLeg   = system.insideCornerLeg
             outsideLeg  = system.insideCornerLeg + max(coreThickness of legs)
             # ← Advance Concrete Form rule
             count = insideCornerCount(j.kind)    # L:1, T:2, X:4
        for each leg wall w in j:
            w.layoutStartOffset[thatEnd] += legLengthConsumed(j, w)

# Sanity invariant:
assert sum(all trimmed formed side-face areas)
       == trueWrappedSurfaceArea(scene)  within EPS

────────────────────────────────────────────────────────────
PHASE 6 — OPENINGS: deductions and reveal additions
────────────────────────────────────────────────────────────
for each opening o hosted by element e:
    a = area(o)
    rule = contract.openingDeductionRule       # 3 templates, configurable
    deduct = rule.applies(a, width(o), height(o))    # e.g. a > 1.00 m²

    for each formed side Face f of e intersecting o:
        f.physicalArea  -= area(o ∩ f)                 # ALWAYS physical
        if deduct:
            f.measuredArea -= area(o ∩ f)              # only if over threshold
            f.deductions += { OPENING, o.id, a }
        else:
            f.deductions += { OPENING_BELOW_THRESHOLD, o.id, a, deducted: 0 }

    # REVEALS — added, and easy to forget
    sides = revealSides(o)     # 4 normally; 3 for a floor-level door;
                               # excludes any side coincident with a lift joint
    revealArea = perimeterOf(sides) * e.core
    emit Face(reveal, o.id, formed=TRUE, area=revealArea,
              reason=BOX_OUT_REVEAL)
    emit BoxOutItem(o, draftAngle or pressureReliefCorner,
                    chamferStrips, weight, wallThickness=e.core)

    # split the panel run
    e.layoutObstacles += projectedRect(o)

for each intersecting element region (T-junction, column-in-slab, beam-end):
    f.physicalArea -= area(intersection)          # you DO cut the panel
    # but per HKSMM4 / theConstructor:
    # measuredArea UNCHANGED — do NOT deduct at intersections
    f.deductions += { INTERSECTION, not_deducted_from_measured: true }

────────────────────────────────────────────────────────────
PHASE 7 — MEASUREMENT BANDING (contract output)
────────────────────────────────────────────────────────────
for each formed Face f:
    if f.faceRole in {sideA, sideB} and minWidth(f) <= 300mm:
        f.measureAs = LINEAR( stage = ceil(minWidth/100mm) * 100mm )   # HKSMM4
    else:
        f.measureAs = AREA
    if f.faceRole == soffit:
        f.thicknessStage   = band(e.thickness, [0..200, then 100mm steps])
        f.soffitHeightStage = band(heightAboveSupport,
                                   [0..3.50m, then 1.50m steps])
    if f.faceRole in {endStart, endEnd, edge}:
        f.endClass = classify(f)   # vertical | sloping | curved
                                   # | curved-in-more-than-one-direction

────────────────────────────────────────────────────────────
PHASE 8 — PRESSURE, TIES, PANELS
────────────────────────────────────────────────────────────
for each formed Face f in lift L:
    f.pressureProfile = ACI347(e.type, R, T, Cw, Cc, h = height(L))
    # NB: verify formulas against ACI 347R-14 §2.2 — see §2.3 caveat
    Pbase = f.pressureProfile(0)

    if e.formworkMode is single-sided:
        f.ties = []
        f.climbingAnchors = solveBracketAnchors(Pbase, bracketSystem)
        emit AnchorRequirement(into: previousLift(L) ?? e.baseElement)
        # ← cross-element dependency: earlier pour must carry these
    else:
        # graded, not uniform: denser at the base
        f.ties = solveTieGrid(f.pressureProfile, tieSKU.capacity,
                              snapTo = panelSystem.tieHolePositions)
        if e.exposureClass == 'water-retaining':
            f.ties = f.ties.map(t => taperTieOrWaterstopTie(t))
            emit TieHolePlug per tie
        if e.exposureClass == 'architectural':
            f.ties = matchSpecifiedTieGrid(spec)   # symmetry-driven, not
                                                   # capacity-driven
            assert isSymmetric(f.ties) about face centrelines

    # 1D strip packing per face per lift — CORNERS FIRST
    run = length(f) - sum(cornerLegsConsumed(f))
    obstacles = e.layoutObstacles ∩ f
    for subRun in splitAt(run, obstacles):
        panels = greedyLargestFirst(subRun, panelSystem.widths,
                                    avoid = system.avoidedPanels)
        r = subRun - sum(panels)
        if 0 < r < MIN_FILLER:
            panels = rebalance(panels)       # drop one, resplit into 2 fillers
        placement = (mode == ARCHITECTURAL) ? symmetricAboutCentre(panels)
                                            : fillerAt(contract.fillerPosition)
                                              # start | middle | end (Tekla)
        f.panels += placement
        f.fillers += compensationPieces(r)

    # vertical stacking + height compensation
    f.panelRows = stackToHeight(height(L), panelSystem.heights)
    f.heightCompensation = height(L) - sum(f.panelRows)

    # gang / crane check
    for gang in groupIntoGangs(f.panels):
        gang.weight = sum(panel weights) + walers + ties
        if gang.weight > craneCapacityAt(radius(gang)):
            splitGang(gang)              # ← changes the layout, re-run
        emit LiftingPoints(gang)

────────────────────────────────────────────────────────────
PHASE 9 — CLASH PASSES
────────────────────────────────────────────────────────────
clash(f.ties, rebarModel)              → relocate or span with waler
clash(f.ties, openings)                → local re-solve
clash(f.ties, waterstops)              → offset clear of waterstop line
clash(f.panels, intersectingElements)  → notch / two inside corners
clash(f.panels, cornerUnits)           → opening too near corner: CUSTOM
clash(brackets/props, slabBelow)       → prop load check, back-prop, needles
clash(scaffold, siteBoundary/adjacent) → access flag

────────────────────────────────────────────────────────────
PHASE 10 — SETS, CYCLE, SCHEDULE
────────────────────────────────────────────────────────────
for each POUR p:
    p.commitWindow = [ erectStart(p),
                       pourDate(p) + strikeTime(elementType, T, spanClass) ]
    # strikeTime: walls/cols 16-24h; slab soffit ~3d; beam soffit ~7d;
    # props ≤4.5m 7d / >4.5m 14d; beams ≤6m 14d / >6m 21d
    # extend for T in 5..15°C; strength-verify below 5°C

for each formwork item type it:
    setsRequired[it] = maxOverlap( { p.commitWindow : p uses it } )
    # = max clique of the interval graph
    if setsRequired[it] > inventory[it]:
        flag SHORTAGE(it) and either
            extend takt, or re-sequence, or split zones
        # ← Doka Tipos does exactly this constraint check

────────────────────────────────────────────────────────────
PHASE 11 — VALIDATE (highest-value output)
────────────────────────────────────────────────────────────
assert castOrder graph is acyclic
assert every single-sided element's anchor host is cast EARLIER
assert every waterstop run is a CLOSED loop across pour boundaries
assert every bulkhead position ∈ permittedJointLocations
assert no expansion joint is bridged by a single pourId
assert every pour volume ≤ site supply capacity
assert every gang weight ≤ crane capacity at its radius
assert no filler < MIN_FILLER
assert sum(trimmed formed areas) == trueWrappedArea (no double count)
assert architectural faces have symmetric tie grids
warn if any opening straddles a lift joint
warn if any curve radius < system minimum (1.00m PERI / 2.50m MEVA)
warn if any junction angle outside hinged-corner range

────────────────────────────────────────────────────────────
PHASE 12 — EMIT
────────────────────────────────────────────────────────────
per element : faces[] with formed/reason, measuredArea, physicalArea,
              deductions[], additions[], jointTreatments[]
per pour    : pourNumber, volume, zone, lift, bulkheads, joints,
              waterstop runs, strike date, RFI candidates
per face    : panel layout, marks, fillers, ties, walers, gangs,
              pick weights, lifting points
project     : BOM (standard/modified/bespoke), cut list, sets required,
              cycle, shortages, clash report, validation report
```

### 5.4 The three design decisions I'd argue hardest for

1. **`castOrder` + `pourId` are not optional metadata — they are the primary input.** Every interesting rule in this document is a function of relative cast order. Without them, "which faces need formwork" is unanswerable, and your current `geometry.ts` proves it: with no cast order it can only ever emit both faces and no stop-ends.

2. **Emit `measuredArea` and `physicalArea` separately, always, with a `reason` on every face and a typed `deductions[]` trail.** The measurement rules are contract-dependent (HKSMM4 vs theconstructor vs NRM2 differ on slab openings and thresholds), so the *rules* must be data, and the *audit trail* must be inspectable. This is also what makes the `inspect_formwork` AI verify/fix loop in your wiki plan actually work — the AI needs computed facts *with reasons*, not just a number.

3. **Corner hardware belongs to the junction, not to a wall.** Owning corners at the junction level solves double-counting, gives exactly one inside + one outside unit per L (and 2 per T, 4 per X), and gives each leg its `layoutStartOffset` for free. Trying to attribute corners to walls is where every naive implementation breaks.

### 5.5 Primary source URLs

**Measurement rules**
- kctang.com.hk/web/book/export/html/124 — HKSMM4/4R, the most precise ruleset found (thresholds, width/thickness/height stages, stop-end classes, kicker inclusion, intersections)
- theconstructor.org/building/formwork-measurement/11098/
- finitefield.org/en/tools/construction/formwork-area-calculator/ — the three opening-deduction templates
- rics.org/content/dam/ricsglobal/documents/standards/october_2021_nrm_2.pdf — NRM2 (PDF, not parsed)
- edshare.gcu.ac.uk/3911/2/pdf_download/NRM_2%20Formwork.pdf

**Pressure, tolerances, striking**
- ce.engineeringdesignresources.com/wp-content/uploads/2019/04/ACI-347.pdf (PDF, not parsed)
- concrete.org/Portals/0/Files/PDF/CEU-347R-14.pdf
- novasolver.jp/en/tools/concrete-formwork-pressure-aci-347.html — metric formula variant
- vinawoodltd.com/blog/concrete-pressure-on-formwork — tie load derivation
- strongholdicf.com/wp-content/uploads/2025/07/STRONGLHOLD-TALL-WALL-TECH-BULLETIN-1.pdf — 4 ft free-fall
- trybuildcalc.com/knowledge/concrete/formwork-striking-time-guide
- aceavant.com/aci-117-tolerances-for-concrete-construction/

**Systems / hardware**
- peri-usa.com/products/scs-climbing-system.html — single-sided load path, SCS 190/250, Starter Brace Frame
- doka.com/en/system-groups/doka-wall-systems/single-sided-formwork/supporting-construction-frame/index — diagonal anchors, 4.0 m / 12.80 m
- ulmaconstruction.com/en/formwork/climbing-formwork/single-sided-climbing-systems — SBF-185 / SBM-240, 4 m lift, DW20–DW26
- peri-usa.com/products/maximo-panel-formwork.html — 3.00/3.60 m, MX tie, 60 cm
- peri-usa.com/products/rundflex-circular-wall-formwork.html — radii ≥ 1.00 m; meva.net/en-gb/products/radius/ — from 250 cm
- peri.ltd.uk/products/door-window-former.html — box-out formers
- daytonsuperior.com/products/forms?name=steel-ply-corners — hinged corner 135°→5°
- advanceconcreteform.com/howtos/laying-out-the-job/ — outside = inside + thickness (403 on refetch; rule captured via search excerpt)
- huennebeck.com/uploads/files/h_20_wall_formwork_user_guide_en_2023-09-27.pdf

**Joints, kickers, sequencing**
- quollnet.com/chk/construction/construction-joint-interface-preparation-horizontal — CSP 5–7, 3–6 mm, 30–50% aggregate, waterstop tolerances
- structville.com/construction-joints-in-structures — permitted joint locations
- build-construct.com/structural-engineering/concrete-construction-joints-guide/
- theconstructor.org/concrete/column-kicker-formworks-application-advantages/21193/
- avemaformwork.com/services/pour-sequence-drawings/ — the 9-item pour sequence deliverable
- avemaformwork.com/services/formwork-shop-drawings/ — full shop drawing deliverables
- concretetoolkit.com/calculators/concrete-pour-sequence-calculator-usa/
- simpliengineering.com/t/staggered-pour-for-liquid-retaining-structure/2276

**Software**
- doka.com/en/solutions/services/dfds/dfds-planning-software/tipos-software-formwork-planning
- aecmag.com/news/doka-launches-formwork-planning-plug-in-for-revit/
- support.tekla.com/help/tekla-structures/formwork_placing_tools_walls_panel — the clearest published parameter set
- meva.net/en-us/services/planning/
- bim2.eu, construction.mindpal.co/demo/aluminium-support, fommec.com/aluminium-formwork-design-software/
- avontus.com/quantify/

**Algorithms**
- pmc.ncbi.nlm.nih.gov/articles/PMC11166312/ — PAAD, the transferable one
- researchgate.net/publication/322177899 — Lee & Lim, HSA vs GA for formwork layout
- sciencedirect.com/science/article/pii/S092658052100131X (403)
- mdpi.com/2076-3417/10/24/9029 (403)
- researchgate.net/publication/372305145 — BIM-based aluminium formwork layout
- nature.com/articles/s41598-024-81749-5, tandfonline.com/doi/full/10.1080/0305215X.2023.2269868 — bin packing heuristics

**Where I'm reasoning, not citing:** the 10° top-form slope threshold; the 50–100 mm minimum filler; the corner-ownership tiebreak rule; the interval-graph formulation for set counting; the measured-vs-physical area split; the inner/outer radius asymmetry consequence for curved walls; stepped-footing and pile-cap face rules; under-stair walls; and the specific 2.4–3.6 m / 2.5–4.0 m typical lift bands.