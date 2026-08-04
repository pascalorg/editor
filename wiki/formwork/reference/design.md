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

# Structural Formwork Design — Implementation Reference

**Source-verification note:** ACI, APA, BS 8110, and Doka data below are transcribed from primary documents I retrieved and extracted directly. The DIN 18218 coefficient set was **reverse-engineered by systematically probing PASCHAL's public DIN 18218:2010 calculator** (the standard itself is paywalled — only a 4-page preview is free). Those values are internally consistent and exactly reproducible, but I flag them as **derived, not transcribed** — verify against a purchased copy of DIN 18218:2010-01 before shipping. CIRIA 108 C1/C2 values are the weakest link and are flagged individually.

---

## 1. LATERAL CONCRETE PRESSURE

### 1.1 ACI 347 — the base ("fluid") case

Applies whenever the special-case conditions are *not* met, and **mandatorily** for SCC and unfamiliar set-retarding/slump-enhancing admixtures.

```
p = w·h        (lb/ft², w in lb/ft³, h in ft)      Eq. 2.1a
p = ρ·g·h      (kPa, ρ in kg/m³, g = 9.81 N/kg, h in m)   Eq. 2.1b
```

`h` = depth of fluid/plastic concrete from top of placement to point considered. For columns or any form filled rapidly before stiffening, **h = full form height** (or distance between horizontal construction joints for multi-lift).

Critically: **"Minimum values given for other pressure formulas do not apply to Eq. (2.1a) and (2.1b)."** So the 600Cw / 30Cw floor is *not* applied to the hydrostatic case.

### 1.2 ACI 347 — special-case formulas

Validity envelope (both unit systems): slump ≤ 7 in. (175 mm), **and** normal internal vibration to a depth ≤ 4 ft (1.2 m).

Element definition (§2.2.2.1.3):
- **Column** = vertical element with **no** plan dimension exceeding 6.5 ft (2 m)
- **Wall** = vertical element with **at least one** plan dimension > 6.5 ft (2 m)

| Case | Inch-pound (lb/ft²) | SI (kPa) |
|---|---|---|
| **Eq. 2.2 — Columns**, any height | `pmax = Cw·Cc·[150 + 9000R/T]` | `pmax = Cw·Cc·[7.2 + 785R/(T+17.8)]` |
| **Eq. 2.3 — Walls**, R < 7 ft/h (2.1 m/h) AND H ≤ 14 ft (4.2 m) | `pmax = Cw·Cc·[150 + 9000R/T]` | `pmax = Cw·Cc·[7.2 + 785R/(T+17.8)]` |
| **Eq. 2.4 — Walls**, R < 7 ft/h with H > 14 ft; **and all walls** R = 7–15 ft/h (2.1–4.5 m/h) | `pmax = Cw·Cc·[150 + 43,400/T + 2800R/T]` | `pmax = Cw·Cc·[7.2 + 1156/(T+17.8) + 244R/(T+17.8)]` |

Units: R = rate of placement, ft/h (m/h). T = **concrete** temperature during placing, °F (°C).

**Bounds on all three of Eq. 2.2/2.3/2.4:**
- Minimum: **600·Cw lb/ft²** (**30·Cw kPa**)
- Maximum: never greater than Eq. 2.1 (`w·h` / `ρgh`)

**Rate bands — the complete decision tree:**
- R > 15 ft/h (4.5 m/h): **Eq. 2.4 does not apply.** Use full hydrostatic `p = wh`. (ACI: "Because Committee 347 has insufficient data on observed pressure at higher rates, Eq. (2.4) does not apply for rates of placement greater than 15 ft/h.")
- Columns: no rate band — Eq. 2.2 applies at any height, but is still capped at `wh`.

**Exact conversion audit** (so your metric path is provably the same code):
- 150 psf × 0.04788 = **7.18 kPa → 7.2**
- 9000·R_ft/T_F → 9000 × 0.04788 / 0.3048 / 1.8 = **785.4 → 785**, with T+17.78 → **T+17.8**
- 43,400/T_F → 43,400 × 0.04788 / 1.8 = **1154.7 → 1156**
- 2800·R_ft/T_F → 2800 × 0.04788 / 0.3048 / 1.8 = **244.3 → 244**
- 600 psf = 28.7 kPa → **rounded up to 30**
- 14 ft = 4.267 m → **4.2**; 7 ft/h = 2.13 m/h → **2.1**; 15 ft/h = 4.57 m/h → **4.5**

Note the metric minimum (30 kPa) is ~4.5% *more conservative* than the imperial (600 psf), and the metric height threshold (4.2 m) is *lower* than 14 ft. Metric and imperial paths give slightly different answers — don't unify them by converting.

**Table 2.1 — Unit weight coefficient Cw**

| Inch-pound | Cw | SI | Cw |
|---|---|---|---|
| < 140 lb/ft³ | `Cw = 0.5[1 + (w/145)]`, **not less than 0.80** | < 2240 kg/m³ | `Cw = 0.5[1 + (w/2320)]`, **not less than 0.80** |
| 140–150 lb/ft³ | 1.0 | 2240–2400 kg/m³ | 1.0 |
| > 150 lb/ft³ | `Cw = w/145` | > 2400 kg/m³ | `Cw = w/2320` |

(The ACI-04 PDF has a typo in the SI middle row: "2240 to 2400 kN/m³" — should be kg/m³.)

**Table 2.2 — Chemistry coefficient Cc**

| Cement type or blend | Cc |
|---|---|
| Types I, II, III **without** retarders | **1.0** |
| Types I, II, III **with** a retarder | **1.2** |
| Other types/blends containing **< 70% slag or < 40% fly ash**, without retarders | **1.2** |
| Other types/blends containing < 70% slag or < 40% fly ash, **with** a retarder | **1.4** |
| Blends containing **> 70% slag or > 40% fly ash** | **1.4** |

Footnote (this is the one people get wrong): *"Retarders include any admixture, such as a retarder, retarding water reducer, retarding midrange water-reducing admixture, or high-range water-reducing admixture (**superplasticizer**), that delays setting of concrete."* → **Any superplasticizer that delays set bumps Cc to 1.2 (or 1.4 with a blended cement).** Your UI must ask about superplasticizer separately from "retarder."

### 1.3 ACI 347 pressure modifiers (§2.2.2.3–2.2.2.5)

- **Pumped from base of form:** design for **full hydrostatic `wh` + minimum 25% for pump surge.** "In certain instances, pressures can be as high as the face pressure of the pump piston."
- **External vibration, or internal vibration deeper than 4 ft (1.2 m):** special-case formulas are void → use `p = wh`. (APA states this explicitly.)
- **Shrinkage-compensating or expansive cements:** "Pressures in excess of the equivalent hydrostatic head can occur." Add allowance.
- **Slipforms:** see §7.3.2.4 (separate treatment).

### 1.4 DIN 18218:2010-01 — derived model

Scope: concrete to DIN EN 206-1 / DIN 1045-2 and SCC to the DAfStb SCC guideline, max aggregate 63 mm. Applies to vertical formwork and forms up to **±5° off vertical**. Supersedes DIN 18218:1980-09. New in 2010: consistency classes **F5, F6, SCC**; partial-safety-factor concept; **fresh concrete temperature** effect; **compaction (vibration)** effect; specified test methods for end of setting (Annex A, "knead bag" method).

Symbols: `σhk,max` = characteristic max horizontal fresh concrete pressure (kN/m²); `v` = placing/rise rate (m/h); `tE` = end of setting (h) at reference temperature `TRef` (°C); `Tc,placing` = fresh concrete temp directly after placing (°C); `γc` = fresh concrete unit weight (kN/m³); `H` = pour height (m); `hs` = hydrostatic height (m).

**Base formulas — validated at γc = 25 kN/m³, tE = 5 h, Tc,placing = TRef:**

| Consistency class | σhk,max (kN/m²) | Equivalent head h_eq = σ/γc (m) |
|---|---|---|
| **F1** (stiff) | `21 + 5v` | `0.84 + 0.20v` |
| **F2** (plastic) | `19 + 10v` | `0.76 + 0.40v` |
| **F3** (soft) | `18 + 14v` | `0.72 + 0.56v` |
| **F4** (very soft) | `17 + 17v` | `0.68 + 0.68v` |
| **F5** (flowable) | `25 + 30v` | `1.00 + 1.20v` |
| **F6** (very flowable) | `25 + 38v` | `1.00 + 1.52v` |
| **SCC / SVB** | `25 + 33v` | `1.00 + 1.32v` |

Note the structural break: F1–F4 have a **decreasing** constant term (0.84→0.68 m) — that's the vibration-immersion surcharge `d`, roughly 0.5–0.8 m. F5/F6/SCC all sit at a constant 1.00 m. Slopes rise monotonically except SCC sits between F5 and F6 (SCC is not vibrated, so it behaves slightly better than F6 which is both flowable *and* vibrated).

**Density scaling** — verified exactly proportional:
```
σhk,max(γc) = σhk,max(25) × γc / 25
```
(Probed F3 at γc = 20/22/24/25/26/28 → 36.8/40.48/44.16/46/47.84/51.52. Ratio constant at 1.84 per unit γ.)

**Setting-time correction** — verified as a *uniform multiplier on the whole expression* for F1–F4, and *on the v-term only* for F5/F6/SCC:

| Class | Correction |
|---|---|
| F1 | `σ(tE) = σ(5) × [1 + 0.030(tE − 5)]` |
| F2 | `σ(tE) = σ(5) × [1 + 0.053(tE − 5)]` |
| F3 | `σ(tE) = σ(5) × [1 + 0.077(tE − 5)]` |
| F4 | `σ(tE) = σ(5) × [1 + 0.140(tE − 5)]` |
| F5 | `σ = γc/25 × [25 + 30·v·(tE/5)]` |
| F6 | `σ = γc/25 × [25 + 38·v·(tE/5)]` |
| SCC | `σ = γc/25 × [25 + 33·v·(tE/5)]` |

Verification samples (γc=25, T=TRef): F3 tE=10, v=2 → 18×1.385 + 14×1.385×2 = **63.71** ✓ (calculator: 63.71). F5 tE=10, v=3 → 25 + 30×3×2 = **205** ✓. SCC tE=8, v=2 → 25 + 33×2×1.6 = **130.6** ✓.

⚠️ The F1–F4 slopes (0.030/0.053/0.077/0.140) are not "clean" numbers, which suggests DIN Table 2 actually **tabulates discrete tE columns (likely 5/10/15/20 h)** and the calculator linearly interpolates. Treat my linear form as an interpolation of the real table; get the real table before shipping.

**Temperature correction** — verified linear, and **asymmetric for the flowable classes**:

| Class | Colder than TRef | Warmer than TRef |
|---|---|---|
| F1–F4 | **+3% per °C** | **−3% per °C** |
| F5, F6, SCC | **+5% per °C** | **−3% per °C** |

```
σ = σ_base × [1 + k·(TRef − Tc,placing)]
    k = 0.03 if Tc,placing ≥ TRef  (all classes)
    k = 0.03 (F1–F4) or 0.05 (F5/F6/SCC) if Tc,placing < TRef
```
Verified: SCC base 91 → T=16 gives 91×(1+0.05×4)=**109.2** ✓; T=25 gives 91×(1−0.03×5)=**77.35** ✓. F3 base 46 → T=10 gives 46×1.30=**59.8** ✓; T=30 gives 46×0.70=**32.2** ✓. Also confirmed only the **delta** matters (TRef=15/T=15 gives the same 46 as TRef=20/T=20).

**Caps and envelope:**
```
σhk,max_final = min( σhk,max_formula , γc · H , 250 kN/m² )
hs = σhk,max_final / γc        (hydrostatic height, m)
```
- Hydrostatic cap verified: F3, v=2, tE=5 at H=1 m → 25 kN/m² (=γc·H), at H≥2 m → 46 (formula governs).
- **250 kN/m² ceiling** observed across all classes (F5 at v=8, F6 at v=6, SCC at v=7 all clamp to 250). May be a calculator/system limit rather than a DIN limit — verify.
- No independent minimum floor exists; `γc·H` governs at shallow depth (F1, v=0.5, H=0.4 → 10 kN/m² = 25×0.4).

**Pressure envelope shape** (this is the key difference from ACI):
```
0 ≤ h ≤ hs :   σ(h) = γc · h              (triangular / hydrostatic)
h > hs     :   σ(h) = σhk,max             (constant rectangular block to base)
```
i.e. a **trapezoid**, not ACI's single scalar. For component design this matters enormously: your tie/waler spacing can legitimately open up in the top `hs` metres. ACI's `pmax` is a single envelope value applied over the full height (APA's worked example does note the drop-off above `pmax/w` = 4 ft but keeps spacing uniform for buildability).

**Boundary conditions declared by the PASCHAL implementation** (these mirror DIN's own scope limits — enforce them as input validation):
- Ambient temperature has no influence on fresh concrete temperature
- **v ≤ 7 m/h**
- **H ≤ 10 m**
- Compaction by **internal** vibrators
- Immersion depth of internal vibrator **< hs** and **< 1 m**
- Concrete placed **from the top** of the form

That "immersion depth < hs" condition is a genuine design coupling most tools miss: if the poker goes deeper than the hydrostatic zone it re-liquefies already-stiffening concrete and the model is invalid.

### 1.5 CIRIA Report 108 (1985) / BS 5975 — UK

```
Pmax = D · [ C1·√R + C2·K·√(H − C1·√R) ]        (kN/m²)

subject to:  Pmax ≤ D · H
and:         if C1·√R ≥ H  then  Pmax = D · H     (full hydrostatic)

K = (36 / (T + 16))²      T = concrete placing temperature, °C
```
- `D` = concrete weight density, kN/m³ (25 typical)
- `R` = rate of rise, m/h. For pumped placement into a uniform section: `R = pump_rate(m³/h) / (wall_length × wall_thickness)`
- `H` = total pour height, m
- `C1` = coefficient for **size/shape of section**: **1.0 for walls, 1.5 for columns** (narrow sections)
- `C2` = coefficient for **constituent materials** (cement type + admixtures), range **0.30 – 0.60**

**Height of hydrostatic zone:** `Hz = C1·√R` (below which the pressure plateaus). Worked example from a published CIRIA 108 spreadsheet: D=25, R=3.0 m/h, H=3.30 m, T such that K=0.56, C1=1.0 → `C1√R = 1.73 m`, `Pd1 = 53.87`, `Pd2 = D·H = 82.50` → **design pressure 53.86 kN/m²**, `Hz = 2.15 m`.

⚠️ **C2 is my least-verified number.** CIRIA groups concretes 1–7 (Group A = basic: CEM I/SRPC/IIA+metakaolin or silica fume, sub-split by no admixture / non-retarding / retarding; Group B = retarded: IIIA/IIA/IIB, plus SCC with non-retarding admixtures, plus IIIB/IVB; Group C = heavily retarded: SCC with retarding properties, SCC with IIIB/IVB). One paper states C1=1.5, C2=0.45; a spreadsheet implementation shows C2 = 0.30 for plain CEM I and 0.45 with retarders/blends, 0.60 for the slowest blends. **Buy CIRIA R108 (~£50, ciria.org, product code R108/R108D) and transcribe Table 1 properly.**

**BS 5975:2019** permits either the CIRIA R108 method **or** a conservative shortcut: **design pressure = 25 × depth of pour (kN/m²)** — i.e. plain full hydrostatic at 25 kN/m³. This is a genuinely useful "no-inputs" fallback for your tool.

### 1.6 Self-compacting concrete (SCC)

Three different regulatory positions — support all three:

1. **ACI 347-04/347R-14:** No SCC provisions. Mandates the hydrostatic equation: *"When working with mixtures using newly introduced admixtures that increase set time or increase slump characteristics, such as self-consolidating concrete, Eq. (2.1a) [(2.1b)] should be used until the effect on formwork pressure is understood by measurement."* Hurd (2007) confirms: *"Committee 347 didn't have sufficient test data to develop separate provisions for self-consolidating concrete."*
2. **DIN 18218:2010:** Has an explicit SCC row (`25 + 33v` at tE=5h, γc=25) — *less* than full hydrostatic for deep pours, and with `d = 0` (no vibration surcharge, since SCC isn't vibrated). This was the headline change in the 2010 edition.
3. **CIRIA 108:** SCC appears in Groups B and C (with non-retarding vs. retarding admixtures) → highest C2.

**Why full hydrostatic for SCC:** SCC has essentially zero yield stress at rest until thixotropic structural rebuilding kicks in. There is no aggregate interlock / arching / silo effect to shed load into the form face, so the fluid column pressure is transmitted undiminished. Pressure decay depends entirely on thixotropy (structural rebuilding rate) and set time, both mix-specific. Rapid placement + low thixotropy = literally hydrostatic. Billberg/Silfwerbrand/Österberg (Concrete International 27(10), 2005) is the canonical reference.

**Implementation rule:** if `SCC == true` and code == ACI → force `p = ρgh` and **suppress the 30Cw/600Cw minimum** (per ACI's explicit exclusion). Never let a user get an SCC design cheaper than hydrostatic under ACI.

### 1.7 Vertical loads (ACI 347 §2.2.1)

- **Dead load** = weight of formwork + reinforcement + freshly placed concrete
- **Live load** = workers, equipment, material storage, runways, impact
- **Minimum live load: 50 lb/ft² (2.4 kPa)** of horizontal projection
- **With motorized carts: minimum live load 75 lb/ft² (3.6 kPa)**
- **Minimum combined dead + live: 100 lb/ft² (4.8 kPa)**
- **Minimum combined with motorized carts: 125 lb/ft² (6.0 kPa)**

Implementation:
```
w_total = max( DL + LL_specified , 4.8 kPa )                    // no carts
w_total = max( DL + max(LL,3.6) , 6.0 kPa )                     // motorized carts
where LL_min = 2.4 kPa (no carts) / 3.6 kPa (carts)
DL = t_slab · γc + w_formwork(≈0.25–0.75 kPa) + w_rebar
```
Multi-storey shoring/reshoring must include **all loads transmitted from floors above per the proposed construction schedule** (§2.5).

### 1.8 Horizontal loads, wind, uplift (ACI 347 §2.2.3–2.2.4)

**§2.2.3.1 — Slab/floor edge (building construction):** assumed horizontal load from wind, dumping of concrete, inclined placement, and equipment, acting **in any direction at each floor line**:
```
H = max( 100 lb/lin ft (1.5 kN/m) of floor edge ,
         2% of total dead load on the form, distributed per linear m of slab edge )
```

**§2.2.3.2 — Wall form bracing:**
- Meet local code or **ANSI/SEI/ASCE 7** wind, adjusted for shorter recurrence interval per **SEI/ASCE 37**
- For wall forms exposed to the elements: **minimum wind design load 15 lb/ft² (0.72 kPa)**
- Bracing designed for **at least 100 lb/lin ft (1.5 kN/m) of wall length, applied at the top**
- §2.2.3.3: "Wall forms of unusual height or exposure should be given special consideration."

**Brace force resolution** (implement this): for a horizontal design line-load `H` (kN/m) effectively applied at the top of a form of height `h`, with rakers at spacing `s` connecting at height `a` above the base, inclined at `θ` to the horizontal:
```
Horizontal reaction at brace level per metre:  R = H · h / a
Brace axial force:                             P = R · s / cos θ
Vertical component into the kicker/anchor:      V = P · sin θ = R · s · tan θ
```
Check the raker for **buckling in compression** (slenderness), and the base anchor for the horizontal *and* vertical components. APA: *"Wood bracing must be designed so it will not buckle under axial compression load."* Wall forms must resist wind **from either side** — inclined wood braces take tension and compression so one-sided bracing is acceptable; **guy wires resist tension only, so they are required on both sides.**

**Uplift (§2.2.4):** design for *"unsymmetrical placement of concrete, impact of machine-delivered concrete, uplift, concentrated loads of reinforcement, form handling loads, and storage of construction materials."* Also §2.1.4 lists as a common failure cause: *"Insufficient anchorage against uplift due to battered form faces"* and *"Inadequate provisions to tie corners of intersecting cantilevered forms together."*

APA's practical rule: *"In general, wind bracing will also resist uplift forces on the forms, provided the forms are vertical... If forms are inclined, uplift forces may be significant. Special tiedowns and anchorages may be required."*

For a form face battered at angle `β` from vertical, the normal pressure has a vertical component:
```
uplift per unit area = p · sin β        (acting to lift the form)
total uplift U = ∫ p(h) · sin β dA over the battered face
```
Also **§2.1.4: "Inadequate provisions to prevent rotation of beam forms where the slabs frame into them on only one side"** (ACI Fig. 2.1) — a real asymmetric-load check for beam forms, and **§2.1.4: "Failure to account for elastic shortening during post-tensioning"** plus **§2.2.5:** shores/reshores/backshores must be analyzed for *both* placement loads and post-tensioning load transfer. §3.8.7: post-tensioning a slab produces a downward load at the beam that shored formwork must carry, magnitude approaching *"the dead load of ½ the slab span on both sides of the beam."*

### 1.9 Safety factors for accessories (ACI 347 Table 2.3)

| Accessory | Safety factor | Type of construction |
|---|---|---|
| **Form tie** | **2.0** | All applications |
| **Form anchor** | **2.0** | Formwork supporting form weight and concrete pressures only |
| **Form anchor** | **3.0** | Formwork supporting weight of forms, concrete, construction live loads, and impact |
| **Form hangers** | **2.0** | All applications |
| **Anchoring inserts used as form ties** | **2.0** | Precast-concrete panels used as formwork |

*"Safety factors are based on the ultimate strength of the accessory when new."* → For reused hardware you must derate; ACI §2.3: *"For formwork materials that will experience substantial reuse, reduced values should be used."*

---

## 2. COMPONENT DESIGN CHECKS

### 2.1 The design loop (order matters — each step's output is the next step's input)

```
1.  Inputs: element type, geometry, concrete (γ, class/slump, cement, admixtures),
    R (or pump rate), T, H, code, SCC flag, pumped-from-base flag, vibration depth
2.  → PRESSURE p (or envelope σ(h) for DIN)          [§1]
3.  → SHEATHING check: given panel type/thickness/orientation and p,
      solve max support spacing L1  (bending, rolling shear, deflection — take min)
4.  → JOIST/STUD spacing := L1 (rounded down to a buildable module)
5.  → JOIST line load w2 = p × L1                     (kN/m)
      → solve max joist span L2 (bending, shear, deflection)
6.  → WALER spacing := L2 (rounded down)
7.  → WALER line load w3 = p × L2                     (kN/m)
      → solve max waler span L3 from waler capacity
8.  → TIE spacing := L3 (rounded down); TIE FORCE F = p × L2 × L3
      → select tie with SWL ≥ F, or reduce L3 := SWL / (p × L2)
9.  → BRACING / raker design from wind + minimum lateral load   [§1.8]
10. → iterate: if tie force exceeds available hardware, go back and reduce
      waler spacing (step 6) — do not just add ties
```

Real engineers run this **bottom-up on the governing pressure**, then **normalize spacings to a symmetric, repeatable module** even where the pressure diagram would permit wider spacing higher up. APA's own example is explicit: studs calculated at 32" are placed at **24"** and ties calculated at 22.5" are placed at **12"** — *"To maintain a symmetrical layout"* and *"For construction sites, however, equal spacings will reduce errors."* Your tool should output both the *calculated* and the *adopted* (rounded, modular) spacing.

### 2.2 Sheathing (plywood) as a continuous beam

**Continuous-beam coefficients** — the whole method reduces to these. Uniform load `w`, equal spans `L`:

| Spans | Mmax | Vmax | Δmax |
|---|---|---|---|
| 1 (simple) | `wL²/8` | `wL/2` | `5wL⁴/(384EI)` |
| 2 | `wL²/8` | `0.625wL` | `wL⁴/(185EI)` |
| 3+ | `wL²/10` | `0.600wL` | `wL⁴/(145EI)` |

**APA mixed-unit forms** (verified to map exactly onto the above):

```
Bending:      wb = 96·Fb·KS / L1²    (2 spans)      wb = 120·Fb·KS / L1²   (3 spans)
Rolling shear: ws = 19.2·Fs·(Ib/Q) / L2  (2 spans)   ws = 20·Fs·(Ib/Q) / L2 (3 spans)
Bending defl:  Δb = w·L3⁴ / (2220·E·I) (2 spans)     Δb = w·L3⁴/(1743·E·I)  (3 spans)
Shear defl:    Δs = C·w·t²·L2² / (1270·Ee·I)
```
- `wb, ws, w` = uniform load, **psf**; `Fb, Fs, E, Ee` = **psi**; `KS` = in³/ft; `Ib/Q` = in²/ft; `I` = in⁴/ft; `t, L` = **in**
- `C` = **120 for face grain across supports, 60 for face grain parallel to supports**

**Three different span definitions — APA is very specific and this is a common bug:**
- `L1` = span **centre-to-centre of supports** → use for **bending**
- `L2` = **clear span** → use for **shear stress and shear deflection**
- `L3` = **clear span + 1/4 in** for 2-in nominal framing; **clear span + 5/8 in** for 4-in nominal framing → use for **bending deflection**

**Span continuity assumption** (APA's rule of thumb): face grain **across** supports → assume 3 spans up to 32 in spacing, 2 spans above. Face grain **parallel** to supports → 3 spans up to 16 in, 2 spans for 19.2 and 24 in.

**Table 12 — Section properties (per ft width), Plyform Class I / Class II / Structural I**

Format: `Perf.Category | wt psf | t in | [∥ face grain: I, KS, Ib/Q] | [⊥ face grain: I, KS, Ib/Q]`

*CLASS I*
| Cat | wt | t | I∥ | KS∥ | Ib/Q∥ | I⊥ | KS⊥ | Ib/Q⊥ |
|---|---|---|---|---|---|---|---|---|
|15/32|1.4|.469|0.066|0.244|4.743|0.018|0.107|2.419|
|1/2|1.5|.500|0.077|0.268|5.153|0.024|0.130|2.739|
|19/32|1.7|.594|0.115|0.335|5.438|0.029|0.146|2.834|
|5/8|1.8|.625|0.130|0.358|5.717|0.038|0.175|3.094|
|11/16|2.0|.688|0.164|0.409|6.175|0.044|0.183|3.524|
|23/32|2.1|.719|0.180|0.430|7.009|0.072|0.247|3.798|
|3/4|2.2|.750|0.199|0.455|7.187|0.092|0.306|4.063|
|7/8|2.6|.875|0.296|0.584|8.555|0.151|0.422|6.028|
|1|3.0|1.000|0.427|0.737|9.374|0.270|0.634|7.014|
|1-1/8|3.3|1.125|0.554|0.849|10.430|0.398|0.799|8.419|

*CLASS II*
| Cat | wt | t | I∥ | KS∥ | Ib/Q∥ | I⊥ | KS⊥ | Ib/Q⊥ |
|---|---|---|---|---|---|---|---|---|
|15/32|1.4|.469|0.063|0.243|4.499|0.015|0.138|2.434|
|1/2|1.5|.500|0.075|0.267|4.891|0.020|0.167|2.727|
|19/32|1.7|.594|0.115|0.334|5.326|0.025|0.188|2.812|
|5/8|1.8|.625|0.130|0.357|5.593|0.032|0.225|3.074|
|11/16|2.0|.688|0.164|0.409|6.020|0.036|0.236|3.496|
|23/32|2.1|.719|0.180|0.430|6.504|0.060|0.317|3.781|
|3/4|2.2|.750|0.198|0.454|6.631|0.075|0.392|4.049|
|7/8|2.6|.875|0.300|0.591|7.990|0.123|0.542|5.997|
|1|3.0|1.000|0.421|0.754|8.614|0.220|0.812|6.987|
|1-1/8|3.3|1.125|0.566|0.869|9.571|0.323|1.023|8.388|

*STRUCTURAL I*
| Cat | wt | t | I∥ | KS∥ | Ib/Q∥ | I⊥ | KS⊥ | Ib/Q⊥ |
|---|---|---|---|---|---|---|---|---|
|15/32|1.4|.469|0.067|0.246|4.503|0.021|0.147|2.405|
|1/2|1.5|.500|0.078|0.271|4.908|0.029|0.178|2.725|
|19/32|1.7|.594|0.116|0.338|5.018|0.034|0.199|2.811|
|5/8|1.8|.625|0.131|0.361|5.258|0.045|0.238|3.073|
|11/16|2.0|.688|0.167|0.418|5.621|0.051|0.249|3.493|
|23/32|2.1|.719|0.183|0.439|6.109|0.085|0.338|3.780|
|3/4|2.2|.750|0.202|0.464|6.189|0.108|0.418|4.047|
|7/8|2.6|.875|0.317|0.626|7.539|0.179|0.579|5.991|
|1|3.0|1.000|0.479|0.827|7.978|0.321|0.870|6.981|
|1-1/8|3.3|1.125|0.623|0.955|8.841|0.474|1.098|8.377|

All plies are "transformed" to the face-ply properties, so you only need face-ply allowables + these section properties — no layup modelling. **Note how severely `KS⊥` and `I⊥` drop** (e.g. 3/4" Class I: `I` falls 0.199 → 0.092, a 54% loss). Orientation is a first-class design input, not a detail.

**Table 13 — Allowable stresses (already adjusted for concrete forming)**

| | Plyform Class I | Plyform Class II | Structural I Plyform |
|---|---|---|---|
| **E** (psi, adjusted — use for **bending** deflection) | 1,650,000 | 1,430,000 | 1,650,000 |
| **Ee** (psi, unadjusted — use for **shear** deflection) | 1,500,000 | 1,300,000 | 1,500,000 |
| **Fb** bending (psi) | 1,930 | 1,330 | 1,930 |
| **Fs** rolling shear (psi) | **72** | **72** | **102** |

**Concrete setting factor Cs = 1.625** applied to *wet* stresses for both bending and rolling shear. Derivation: **duration-of-load factor 1.25 × "experience" adjustment 1.30 = 1.625** — *"accounts for the ability of setting concrete to carry more of its own weight with the passage of time."* Also: *"When shear deflection is computed separately from bending deflection... the modulus of elasticity used for calculating bending deflection may be increased 10 percent"* (that's why E = 1.10 × Ee).

Rolling shear at **72 psi** is brutally low — it's the cross-ply shearing perpendicular to grain. For thin panels at close spacing, shear can govern; always compute all three.

**Deflection limits:** APA's tables use **l/360 or l/270, whichever is more conservative in load terms**, with unshaded columns = l/360 for **architectural concrete where appearance is important**, shaded = l/270. Practical industry set:
- **l/360** — architectural / exposed (ACI Class A surface)
- **l/270** — general structural
- **absolute cap 1/16 in (1.6 mm)** — often imposed additionally for Class A work
- Lumber framing tables use **l/360 with 1/4 in (6 mm) maximum**

**Table 3 — Recommended max pressures, Plyform Class I (psf), FACE GRAIN ACROSS SUPPORTS**
(each cell pair = l/360 value, then l/270 value)

| Spacing (in) | 15/32 | 1/2 | 19/32 | 5/8 | 11/16 | 23/32 | 3/4 | 1-1/8 |
|---|---|---|---|---|---|---|---|---|
|8|885/885|970/970|1195/1195|1260/1260|1360/1360|1540/1540|1580/1580|2295/2295|
|12|355/395|405/430|540/540|575/575|660/660|695/695|730/730|1370/1370|
|16|150/200|175/230|245/305|265/325|320/370|345/390|370/410|740/770|
|19.2|–/115|100/135|145/190|160/210|190/255|210/270|225/285|485/535|
|24|–/–|–/–|–/100|–/110|100/135|110/145|120/160|275/340|
|32|–/–|–/–|–/–|–/–|–/–|–/–|–/–|130/170|

**Table 4 — Plyform Class I (psf), FACE GRAIN PARALLEL TO SUPPORTS**

| Spacing (in) | 15/32 | 1/2 | 19/32 | 5/8 | 11/16 | 23/32 | 3/4 | 1-1/8 |
|---|---|---|---|---|---|---|---|---|
|8|390/390|470/470|530/530|635/635|665/665|835/835|895/895|1850/1850|
|12|110/150|145/195|165/225|210/280|235/295|375/400|460/490|1145/1145|
|16|–/–|–/–|–/–|–/120|100/135|160/215|200/270|710/725|
|19.2|–/–|–/–|–/–|–/–|–/–|115/125|145/155|400/400|
|24|–/–|–/–|–/–|–/–|–/–|–/–|–/100|255/255|

**Table 5 — Structural I Plyform (psf), FACE GRAIN ACROSS SUPPORTS**

| Spacing (in) | 15/32 | 1/2 | 19/32 | 5/8 | 11/16 | 23/32 | 3/4 | 1-1/8 |
|---|---|---|---|---|---|---|---|---|
|8|890/890|980/980|1225/1225|1310/1310|1515/1515|1590/1590|1680/1680|2785/2785|
|12|360/395|410/435|545/545|580/580|675/675|705/705|745/745|1540/1540|
|16|155/205|175/235|245/305|270/330|325/380|350/400|375/420|835/865|
|19.2|–/115|100/135|145/190|160/215|195/260|210/275|230/290|545/600|
|24|–/–|–/–|–/100|–/110|105/135|110/150|120/160|310/385|

Compare Table 3 vs Table 4 at 3/4"/16": **370 psf across grain vs 200 psf parallel** — a 46% penalty for wrong orientation.

Notes on these tables: *"ACI recommends a minimum lateral design pressure of 600 Cw but it need not exceed p = wh."* Plywood continuous across **two or more** spans. No blocking assumed at unsupported panel edges — *"under conditions of high moisture or sustained load... edges may have greater deflection than the center of the panel"*, so specify blocking at unsupported edges, **particularly when face grain is parallel to supports**. Pressures for **two layers of the same category are additive**.

**Worked example (APA Example 2), fully reproducible:** 3/4" Plyform Class I, face grain across supports at 16" o.c., l/360, 2-in nominal framing.
```
t = 0.75, I = 0.199, KS = 0.455, Ib/Q = 7.187
E = 1,650,000, Ee = 1,500,000, Fb = 1930, Fs = 72
L1 = 16", L2 = 16 − 1.5 = 14.5", L3 = 14.5 + 0.25 = 14.75"
3 spans (16 ≤ 32)

Bending:  wb = 120 × 1930 × 0.455 / 16²        = 412 psf
Shear:    ws = 20 × 72 × 7.187 / 14.5          = 714 psf
Deflection:
  Δall = 16/360                                 = 0.0444"
  Δs   = 120 × 1.0 × 0.75² × 14.5² / (1270 × 1,500,000 × 0.199) = 0.0000374"
  Δb   = 1.0 × 14.75⁴ / (1743 × 1,650,000 × 0.199)              = 0.0000827"
  wΔ   = 0.0444 / (0.0000374 + 0.0000827)       = 370 psf
→ GOVERNING: 370 psf (deflection)
```

**Metric formulation** (derive from the coefficient table, don't convert the mixed-unit constants). Per **metre width**, `p` in kN/m², `L` in m, `M_R` in kNm/m, `V_R` in kN/m, `EI` in kNm²/m:
```
Bending:      p_allow = 8·M_R / L1²   (2 spans)     10·M_R / L1²   (3+ spans)
Shear:        p_allow = V_R / (0.625·L2) (2 spans)  V_R / (0.600·L2) (3+ spans)
Deflection:   Δ = p·L3⁴ / (185·EI)   (2 spans)      p·L3⁴ / (145·EI)  (3+ spans)
              → p_allow = Δ_limit · 185·EI / L3⁴   or  · 145·EI / L3⁴
where M_R = f_m · W / γ_M ,  W = section modulus per m = 1000·t²/6 (mm³/m for solid),
      EI  = E_mean · I / γ_M ,  I = 1000·t³/12
```
⚠️ **Gap:** I could not obtain an authoritative published table of **metric film-faced plywood** design values (`f_m`, rolling shear `f_r`, `E_mean`) or 18 mm span/pressure tables. These are **product-specific** and must come from manufacturer datasheets — Metsä **WISA-Form**, UPM **WISA**, Doka **3-SO/3-S basic**, or an EN 13986 / EN 789 declaration. Typical order of magnitude for 18–21 mm birch/spruce film-faced ply, face grain across supports: `f_m ≈ 20–40 N/mm²`, `E_mean ≈ 6,000–9,500 N/mm²`, rolling shear `≈ 1.8–3.0 N/mm²` — **do not hard-code these; make them a material-library input.** Note also that Doka's Framax Xlife "sheet" is a plywood core with a plastic coating, so its properties are proprietary and the *system* is rated by permissible pressure instead (see §2.5).

### 2.3 Joists / studs

Load transfer: **`w_joist = p × joist_spacing`** (line load, lb/ft or kN/m). APA states the assumption explicitly: *"It assumes the maximum concrete pressure is constant over the entire form. Actual distribution is more nearly 'trapezoidal' or 'triangular.'"*

**Table 7 — Maximum spans for lumber framing, inches — DOUGLAS-FIR No. 2**

Format: `Equiv. uniform load (lb/ft) | 2 or 3 supports (1–2 spans): 2x4 2x6 2x8 2x10 4x4 4x6 4x8 | 4+ supports (3+ spans): 2x4 2x6 2x8 2x10 4x4 4x6 4x8`

| lb/ft | 2x4 | 2x6 | 2x8 | 2x10 | 4x4 | 4x6 | 4x8 ‖ | 2x4 | 2x6 | 2x8 | 2x10 | 4x4 | 4x6 | 4x8 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|200|48|73|92|113|64|97|120|56|81|103|126|78|114|140|
|400|35|52|65|80|50|79|101|39|58|73|89|60|88|116|
|600|29|42|53|65|44|64|85|32|47|60|73|49|72|95|
|800|25|36|46|56|38|56|73|27|41|52|63|43|62|82|
|1000|22|33|41|50|34|50|66|23|36|46|56|38|56|73|
|1200|20|30|38|46|31|45|60|20|32|42|51|35|51|67|
|1400|18|28|35|43|29|42|55|18|29|38|48|32|47|62|
|1600|16|26|33|40|27|39|52|17|26|35|45|30|44|58|
|1800|15|24|31|38|25|37|49|16|25|33|42|27|41|55|
|2000|15|23|29|36|24|35|46|15|23|31|39|25|39|52|
|2200|14|22|28|34|23|34|44|14|22|29|37|24|37|49|
|2400|13|21|27|33|22|32|42|14|21|28|36|22|35|46|
|2600|13|20|26|31|21|31|41|13|21|27|35|21|33|44|
|2800|12|19|25|30|20|30|39|13|20|26|33|20|32|42|
|3000|12|19|24|29|19|29|38|12|19|25|32|19|30|40|
|3200|12|18|23|28|18|28|37|12|19|25|32|18|29|38|
|3400|11|18|22|27|17|27|36|12|18|24|31|18|28|37|
|3600|11|17|22|27|17|26|35|11|18|24|30|17|27|36|
|3800|11|17|21|26|16|26|34|11|18|23|29|17|26|35|
|4000|11|16|21|25|16|25|33|11|17|23|28|16|25|34|
|4200|11|16|20|25|15|24|32|11|17|22|28|16|25|33|
|4400|10|16|20|24|15|24|31|11|17|22|27|15|24|32|
|4600|10|15|19|24|15|23|30|10|16|22|26|15|24|31|
|4800|10|15|19|23|14|23|30|10|16|21|26|15|23|30|
|5000|10|15|18|23|14|22|29|10|16|21|25|14|23|30|

**Table 8 — HEM-FIR No. 2** (same format)

| lb/ft | 2x4 | 2x6 | 2x8 | 2x10 | 4x4 | 4x6 | 4x8 ‖ | 2x4 | 2x6 | 2x8 | 2x10 | 4x4 | 4x6 | 4x8 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
|200|45|70|90|110|59|92|114|54|79|100|122|73|108|133|
|400|34|50|63|77|47|74|96|38|56|71|87|58|86|112|
|600|28|41|52|63|41|62|82|29|45|58|71|48|70|92|
|800|23|35|45|55|37|54|71|23|37|48|61|41|60|80|
|1000|20|31|40|49|33|48|64|20|32|42|53|37|54|71|
|1200|18|28|36|45|30|44|58|18|28|37|47|33|49|65|
|1400|16|25|33|41|28|41|54|16|26|34|43|29|45|60|
|1600|15|23|31|39|25|38|50|15|24|31|40|26|41|54|
|1800|14|22|29|37|23|36|48|14|22|30|38|24|38|50|
|2000|13|21|28|35|22|34|45|14|21|28|36|22|35|46|
|2200|13|20|26|33|20|32|42|13|20|27|34|21|33|43|
|2400|12|19|25|32|19|30|40|12|20|26|33|20|31|41|
|2600|12|19|25|30|18|29|38|12|19|25|32|19|30|39|
|2800|12|18|24|29|18|28|36|12|18|24|31|18|28|37|
|3000|11|18|23|28|17|26|35|11|18|24|30|17|27|36|
|3200|11|17|22|27|16|25|34|11|17|23|29|17|26|34|
|3400|11|17|22|27|16|25|32|11|17|22|29|16|25|33|
|3600|11|17|21|26|15|24|31|11|17|22|28|16|24|32|
|3800|10|16|21|25|15|23|31|10|16|22|28|15|24|31|
|4000|10|16|20|24|14|23|30|10|16|21|27|15|23|30|
|4200|10|15|20|24|14|22|29|10|16|21|27|14|22|30|
|4400|10|15|19|23|14|22|28|10|16|21|26|14|22|29|
|4600|10|15|19|23|13|21|28|10|15|20|26|14|21|28|
|4800|10|14|18|22|13|21|27|10|15|20|25|13|21|28|
|5000|10|14|18|22|13|20|27|10|15|20|24|13|21|27|

(Table 9 = Southern Pine No. 2, same structure; at 200 lb/ft: 2x4=44, 2x6=75, 2x8=97, 2x10=116 for 1–2 spans.)

**Basis of Tables 7–9** (must be replicated or your numbers won't match):
- 2012 **NDS** allowable stress values
- **Dry (CM = 1.0)**, **single-member (Cr = 1.0)** allowable stresses
- × **duration-of-load factor CD = 1.25** for **7-day loads**
- Deflection limited to **l/360 with 1/4" maximum**
- Spans measured **centre-to-centre** of supports

**H20 timber formwork beam** (the European workhorse) — Doka beam H20 top, solid web beam to **EN 13377**, softwood flanges + flat-pressed particle board or 3-ply web:
```
Moment      M  = 5 kNm
Shear force Q  = 11 kN
Rigidity    EI = 450 kNm²
Weight         = 5.0 kg/lin m (N version), 5.2 kg/lin m (P version)
Lengths available: 1.80, 2.45, 2.65, 2.90, 3.30, 3.60, 3.90, 4.50, 4.90, 5.90 m
```
Beware conflicting vendor figures I encountered: PERI-branded datasheets quote **M = 11 kNm, V = 24 kN, EI = 460 kNm²** while others quote **M ≤ 6.0 kNm, V ≤ 12.0 kN**. These differ by whether the value is a **design resistance** or an **allowable/permissible** value. **Doka's 5 kNm / 11 kN / 450 kNm² are permissible (allowable) values** and are the safe default. Make this a material-library entry with an explicit "allowable vs design" flag.

Using the H20 with the metric continuous-beam formulas: max joist spacing under line load `w` (kN/m), 3+ spans:
```
bending:    L ≤ √(10 × 5 / w)  = √(50/w)
shear:      L ≤ 11 / (0.6·w)   = 18.33/w
deflection: L ≤ (145 × 450 × Δlim / w)^0.25 = (65250·Δlim/w)^0.25
            with Δlim = L/360 → L ≤ (65250/(360·w))^(1/3) = (181.25/w)^(1/3)
```

### 2.4 Walers / soldiers

Load: **`w_waler = p × waler_spacing`**. If the waler is a **doubled** member, divide the load between the two: APA's example — *"Since the wales are doubled, each 2×4 wale carries 600 lbf (1200 ÷ 2 = 600)."* Then read Table 7–9 with the per-member load.

**Critical caveat APA states explicitly:** *"Tables 7, 8 and 9 are for uniform loads but the wales actually receive point loads from the studs. This method of approximating the capacity of the wales is adequate when there are three or more studs between the ties. A point load analysis should be performed when there are only one or two studs between the ties."*

→ **Implement this branch:** `n_studs_between_ties = tie_spacing / stud_spacing`. If `n < 3`, switch from the equivalent-uniform-load method to a discrete point-load continuous-beam analysis. Skipping this is a genuine unsafe-design path.

### 2.5 Form ties

**Tie force by tributary area — the core equation:**
```
F_tie = p × s_h × s_v
```
where `s_h` = horizontal tie spacing (= waler span), `s_v` = vertical tie spacing (= waler spacing). Both in m; `p` in kN/m² → `F` in kN.

**Selecting spacing from a tie's SWL** (the inverse, as APA does it):
```
Given waler line load w_waler (kN/m) and tie SWL:
   s_h ≤ SWL / w_waler        // = SWL / (p × s_v)
Then round DOWN to a buildable module.
```
APA worked example: `w_waler = 1200 lbf/ft`, tie SWL = 2250 lb → `s_h ≤ 2250 × 12 / 1200 = 22.5 in` → **adopted 12 in** for symmetry.

**Tie capacities — European DW / Rd system:**

| Rod | Root Ø | Thread Ø | Cross-section | Permissible (working) load | Max/ultimate formwork load |
|---|---|---|---|---|---|
| **DW15** | 15 mm | 17 mm | 177 mm² | **90 kN** | 150 kN |
| **Rd16** | 14 mm | 16 mm | 153 mm² | 90 kN | 150 kN |
| **DW20 / Rd20** | 17 mm | 20 mm | 227 mm² | **140 kN** | 230 kN |
| **DW26.5** | — | 26.5 mm | — | ~**250 kN** | — |

MEVA quote: *"tie rods offer a maximum load capacity of 90 kN for DW 15, 160 kN for DW 20 and 250 kN for DW 26.5."* Note MEVA's DW20 = 160 kN vs 140 kN elsewhere — **vendor-specific; make it a library entry, don't hard-code.** The DW15 at 90 kN permissible is the near-universal default; typical practice keeps working tie loads well below it (a 4 m pour at 0.5 × 0.6 m spacing gives ~30 kN, i.e. a third of capacity).

**Doka Framax accessory capacities** (illustrative of the *system-component* limits that often govern before the rod does):
| Component | Permitted capacity |
|---|---|
| She-bolt system 1½" (2:1 FoS against failure) | 37,500 lb (**166 kN**) |
| Coil rod 1" (2:1 FoS against failure) | 37,500 lb (**166 kN**) |
| Framax wedge bolt RA 7.5 (tensile in panel cross borehole) | 5.6 kip (**25.0 kN**) |
| Framax S tie-holder bracket | 3300 lb (**15 kN**) |
| Framax adjustable clamp (tensile) | 2.25 kip (**10.0 kN**) |
| Framax foundation clamp + Doka perforated tape | 2,700 lb (**12 kN**) |

**Design rule: `F_tie ≤ min(rod SWL, anchor plate/wing nut SWL, panel borehole SWL, waling connection SWL)`.** The 25 kN borehole and 15 kN bracket limits show the rod is frequently *not* the weak link.

Metric tie sizes are also commonly quoted by tonnage — **3 t / 6 t / 9 t / 15 t** (≈ 30 / 60 / 90 / 150 kN). Note **"9 t" ≈ 90 kN = the DW15 permissible load** — that's the same tie under a different naming convention, so your library should alias them.

**Safety factor:** ACI Table 2.3 → **form ties = 2.0 on ultimate strength when new**. Doka states its she-bolt/coil-rod figures as *"Permitted capacity allowing a 2 : 1 factor of safety against failure"* — consistent. If the vendor gives an **ultimate/breaking** load, divide by 2.0; if they give a **permissible/working** load, use directly. Getting this wrong is a factor-of-2 error, so make the input explicitly typed.

**Also constrain tie spacing by practicality:** ~**0.9 m maximum** is a common practical cap regardless of calculation (one commercial tool hard-codes this), and tie holes must respect the panel's hardware pattern (see §2.6, §4).

### 2.6 System (panel) formwork — rated-pressure approach

For proprietary panel systems you do **not** design the sheathing/joists/walers; the system is certified to a **permissible fresh-concrete pressure**, and your job is (a) check `σhk,max ≤ σ_perm`, (b) derive the max pour rate, (c) place ties per the manufacturer's arrangement.

**Doka Framax S Xlife:**
```
Walls:   σhk,max_perm = 1,650 psf (80 kN/m²) over the whole area, per DIN 18218
         → at γc = 25 kN/m³, hydrostatic pour height = 3.20 m
         Uprated to 2,050 psf (100 kN/m²) — but ONLY for panel widths
         105, 75, 60, 45, 30 cm (not 240, 135, 90, 122 cm)
Columns: σhk,max_perm = 1,880 psf (90 kN/m²)
         → at γc = 25 kN/m³, hydrostatic pour height = 3.60 m
         Column cross-sections to 42"×42" (106.7×106.7 cm) in 2" (5.1 cm) increments
         Using Framax outside corners + ordinary panels: 80 kN/m² only
```
Subject to **DIN 18202 Table 3 Line 6** surface planeness tolerances, and complying with **ACI 117** and **ACI 347 Table 3.1 Class of surface 'B'**.

This is the key inversion for a software tool: **given a system's `σ_perm`, solve the DIN formula backwards for the maximum permissible rate of rise `v`**:
```
For F1–F4:  v_max = [ σ_perm/(scale) − a ] / b
For F5/F6/SCC: v_max = [ σ_perm/(scale) − 25 ] / (b · tE/5)
where scale = (γc/25) × [1 + k(TRef − T)]
```
That's exactly what PERI's and PASCHAL's calculators do (both expose a bidirectional v ↔ σ toggle). **Ship both directions.**

### 2.7 Column forms — clamp / yoke spacing

Columns are the case where the **stepped (variable) spacing** genuinely pays, because the pressure diagram is strongly triangular over a short height and the form is filled fast.

**Algorithm:**
```
1. p_max per ACI Eq. 2.2 (columns), capped at w·h — and since columns fill
   rapidly, ACI directs h = FULL form height, so hydrostatic often governs.
   Under DIN, build the σ(h) envelope (triangular to hs, then constant).
2. Divide the column height into bands from the BOTTOM up (e.g. 150–300 mm bands).
3. For each band at depth h below top of pour:
      p(h) = min( γc·h , p_max )
4. Tributary load on one clamp at that level, for a column of side b:
      F_clamp(h) = p(h) × b × s(h)          [per side]
      (a 4-sided clamp/yoke resists the load from the two opposing faces it spans;
       check the clamp's rated capacity per side AND its corner/bolt capacity)
5. Solve:  s(h) ≤ SWL_clamp / ( p(h) × b )
6. ALSO cap s(h) by the sheathing's allowable span at p(h)  (§2.2) and by the
   yoke/stiffback's own bending capacity.
      s(h) = min( tie-derived, sheathing-derived, yoke-derived )
7. Walk upward accumulating positions; round each DOWN to a 25 mm / 1 in module.
8. Enforce a first-clamp offset near the base (typically ≤ 100–150 mm above the
   kicker) and a top clamp within one spacing of the pour top.
```
Because `p(h) ∝ h` in the hydrostatic zone, `s(h) ∝ 1/h` — which is precisely why the classic table reads tight at the bottom and progressively wider going up (e.g. 6", 6", 8", 10", 12", 15", 18"… from the base). **Add a monotonicity guard:** spacing must never *decrease* going up, and clamp `s` to the sheathing limit so you don't emit an 800 mm gap near the top where the ply would fail.

**Kicker:** cast integrally with the floor/footing **before** erecting the column form, commonly **50–75 mm** high — locks base position and prevents grout loss. Omitting it is cited as one of the most common avoidable column formwork errors.

**Two column-specific design notes from ACI:** (a) *"columns are defined as vertical elements with no plan dimension exceeding 6.5 ft (2 m)"* — so a 2.1 m "column" must be designed as a **wall**; (b) *"the forms for columns and piers can be removed before forms for beams and slabs"* (§3.7.2.1).

---

## 3. STRIPPING / STRIKING TIMES AND CYCLES

### 3.1 ACI 347 §3.7 — strength-based is the *preferred* method

*"Because the minimum stripping time is a function of concrete strength, the preferred method of determining stripping time is using tests of job-cured cylinders or concrete in place."*

The engineer/architect **specifies the minimum strength** before removal. Acceptable determination methods (per **ACI 228.1R**): job-cured specimens, in-place tests, the **maturity method**, rebound numbers, penetration resistance, pullout tests — but *"these methods should be correlated to the actual concrete mixture used in the project, periodically verified by job-cured specimens, and approved by the engineer/architect."*

Governing conditions: *"Supporting forms and shores should not be removed from beams, floors, and walls until these structural units are strong enough to carry their own weight and any approved superimposed load. In no case should supporting forms and shores be removed from horizontal members before the concrete has achieved the strength specified by the engineer/architect."*

Test-specimen curing rule: *"test specimens should be cured under conditions that are not more favorable than the most unfavorable conditions for the concrete the test specimens represent."*

### 3.2 ACI 347 §3.7.2.3 — fallback elapsed times (when strength is not specified)

**Time-basis definition (critical):** *"The times shown represent a cumulative number of days, or hours, **not necessarily consecutive**, during which the temperature of the air surrounding the concrete is **above 50 °F (10 °C)**."* → This is a **degree-day style accumulator**, not a calendar clock. Implement as an accumulator over hours where `T_air > 10 °C`.

Adjustments: *"If high early-strength concrete is used, these periods can be reduced as approved... Conversely, if ambient temperatures remain below 50 °F (10 °C), or if retarding agents are used, then these periods should be increased at the discretion of the engineer/architect."*

**Vertical / side forms:**
| Element | Time |
|---|---|
| Walls* | **12 h** |
| Columns* | **12 h** |
| Sides of beams and girders* | **12 h** |
| Pan joist forms†, 30 in. (760 mm) wide or less | **3 days** |
| Pan joist forms†, over 30 in. (760 mm) wide | **4 days** |

**Soffits / supporting forms** — two columns by live-load:live-dead-load ratio:

| Element | Structural LL **less than** structural DL | Structural LL **more than** structural DL |
|---|---|---|
| Arch centers | 14 days | 7 days |
| Joist/beam/girder soffits, < 10 ft (3 m) clear span | 7 days‡ | 4 days |
| Joist/beam/girder soffits, 10–20 ft (3–6 m) | 14 days‡ | 7 days |
| Joist/beam/girder soffits, > 20 ft (6 m) | 21 days‡ | 14 days |
| One-way floor slabs, < 10 ft (3 m) clear span | 4 days‡ | 3 days |
| One-way floor slabs, 10–20 ft (3–6 m) | 7 days‡ | 4 days |
| One-way floor slabs, > 20 ft (6 m) | 10 days‡ | 7 days |

Footnotes (all load-bearing on the logic):
- **\*** *"Where such forms also support formwork for slab or beam soffits, the removal times of the latter should govern."*
- **†** *"Of the type that can be removed without disturbing forming or shoring."*
- **‡** *"Where forms can be removed without disturbing shores, use **half** of values shown but **not less than 3 days**."* → `t = max(t_table/2, 3 days)`
- ACI's rationale for the shorter LL>DL column: *"Shorter stripping times listed for live load to dead load ratios greater than 1.0 are the result of more reserve strength being available for dead load in absence of live load at time of stripping."*

**Two-way slab systems:** *"Removal times are contingent on reshores where required, being placed as soon as practicable after stripping operations are complete but **not later than the end of the working day in which stripping occurs**."* Where reshores enable early stripping to limit sag/creep, *"capacity and spacing of such reshores should be designed by the formwork engineer/contractor and reviewed by the engineer/architect."*

**Post-tensioned slab systems:** *"As soon as full post-tensioning has been applied."*

### 3.3 BS 8110-1:1997 Table 6.2 — the UK/temperature-formula approach

*"Minimum period before striking formwork (concrete made with Portland cement 42.5 to BS 12:1991 or sulfate-resisting Portland cement 42.5 to BS 4027:1991)"*

| Type of formwork | Surface temp **16 °C and above** | Surface temp **t °C** (any temperature 0–16 °C) |
|---|---|---|
| Vertical formwork to columns, walls and large beams | **12 h** | **300/(t + 10) h** |
| Soffit formwork to slabs | **4 days** | **100/(t + 10) days** |
| Soffit formwork to beams **and props to slabs** | **10 days** | **250/(t + 10) days** |
| Props to beams | **14 days** | **360/(t + 10) days** |

*"NOTE This table can be applied to PC and SRPC of higher cement strength classes."*

Sanity check at t = 16: 300/26 = 11.5 h (≈12 h ✓); 100/26 = 3.85 d (≈4 d ✓); 250/26 = 9.6 d (≈10 d ✓); 360/26 = 13.8 d (≈14 d ✓). **The formulas are the primary rule and the 16 °C column is just their evaluation** — so implement the formula and use `t_eff = min(t_surface, 16)` to avoid unsafely short times at high temperature (the standard caps the benefit at 16 °C).

Note this is the **surface temperature of the concrete**, not air temperature — different from ACI's air-temperature accumulator.

### 3.4 Temperature-adjusted stripping — maturity

Two families, both worth implementing:

**Nurse–Saul (degree-days / degree-hours), matching ACI's accumulator:**
```
M = Σ (T_avg − T0) · Δt          T0 = datum temperature, typically −10 °C (or 0 °C)
```
Strip when `M ≥ M_target` calibrated from job-cured specimens. ACI's "cumulative days above 50 °F (10 °C)" is a crude special case with `T0 = 10 °C` and a binary counter.

**Arrhenius / equivalent age (more accurate, and the form DIN-based tools use for setting time):**
```
t_e = Σ exp[ (−E/R) · (1/T − 1/T_ref) ] · Δt
```
The DIN 18218 calculator family uses exactly this shape to correct `tE`:
```
tE_actual = tE_ref · exp[ 4000 · (1/T_placing_K − 1/T_ref_K) ]
```
with an activation-energy constant of **4000** (i.e. `E/R = 4000 K`, corresponding to `E ≈ 33.3 kJ/mol`), temperatures in **Kelvin**. Note this is used for **formwork pressure** (colder → longer set → higher pressure), which is the *opposite* sensitivity direction from stripping (colder → longer to strip). Both matter and they pull in opposite directions on the same temperature input — surface this in the UI.

**Percentage-of-design-strength criteria** (the common contractual specification, since ACI declines to give numbers): typical specified values are **~70% of f'c** for removing supporting formwork/props to slabs and beams, **~50%** for soffit forms where reshores remain, and vertical/non-load-bearing forms as soon as the concrete can hold its shape without damage (which is what the 12 h figures represent). ⚠️ These percentages are **contract-specific, not code-mandated** — make them a settable project parameter with sensible defaults, and label them as such.

### 3.5 Re-shoring / back-propping for multi-storey (ACI 347 §3.8)

**Definitions (§3.8.1):**
- **shores** — *"vertical or inclined support members designed to carry the weight of formwork, concrete, and construction loads."*
- **reshores** — *"shores placed snugly under a stripped concrete slab or structural member **after** the original forms and shores have been removed from a large area. This requires the new slab or structural member to deflect and support its own weight and existing construction loads applied before the installation of the reshores. **It is assumed that the reshores carry no load at the time of installation.**"*

**ACI gives no fixed number of levels** — it requires *"a rational analysis... to determine the number of floors to be shored, reshored, or backshored and to determine the loads transmitted to the floors, shores, and reshores or backshores as a result of the construction sequence."*

**The analysis must consider (§2.5):**
- Structural design load of the slab including live load, partition loads, and any other loads the permanent-structure engineer designed for. *"Where the engineer included a reduced live load for the design of certain members and allowances for construction loads, such values should be shown on the structural plans and be taken into consideration."*
- Dead load weight of concrete and formwork
- Construction live loads (placing crews, equipment, stored materials)

**The standard load-distribution model (§3.8.1) — implement this state machine:**
1. While reshoring remains in place at grade: *"each level of reshores carries the weight of only the new slab plus other construction live loads. The weight of intermediate slabs is not included because each slab carries its own weight before reshores are put in place."*
2. Once the grade-contact tier of reshores is removed: *"the system of slabs behaves elastically. The slabs interconnected by reshores will deflect equally during addition or removal of loads. **Loads will be distributed among the slabs in proportion to their developed stiffness.**"* Deflection treated as elastic, neglecting shrinkage and creep.
3. *"Shore loads are determined by equilibrium of forces at each floor level."*

**Warnings to encode as rules:**
- *"Caution should also be taken when a wood compressible system is used. Such systems tend to shift most of the imposed construction loads to the upper floors, which have less strength."*
- **Multi-tier shoring** (single-post shoring in two or more tiers) *"is a dangerous practice and is not recommended."*
- **Backshoring/preshoring** *"are not recommended unless performed under careful supervision... because excessively high slab and shore stresses can develop."*
- Reshore tightening: *"The reshore is simply a strut and should be tightened only to the extent necessary to achieve good bearing contact **without transferring load** between upper and lower floors."*
- Offset shores: *"If reshores do not align with the shores above, then calculate for reversal stresses."* Check **punching shear** and bending where shore loads are heavy or spans long.
- *"While reshoring is under way, no construction loads should be permitted on the new construction unless the new construction can safely support the construction loads."*
- Post-tensioning: stressing *"can cause overloads to occur in shores, reshores, or other temporary supports. The stressing sequence has the greatest effect."*

**Advantages of reshoring over backshoring (§3.8.2)** — the economic driver: all material removed at once; slabs support their own weight, reducing reshore load; *"usually requires fewer levels of interconnected slabs, thus freeing more areas for other trades."*

### 3.6 Cycle times and set count

Typical observed floor cycles:
- **Traditional methods: 14–21 days per slab** (curing + formwork limitations)
- **High-rise, well-organised: 7–9 days per floor**, *"again depends [on] the availability of tower crane"*
- **Aggressive target: 7-day slab cycle** with modern systems (early-strip/drophead systems, table forms)

**Set-count logic:**
```
n_sets = ceil( T_occupied / T_cycle_target )

T_occupied = time one set is tied up on a floor
           = erect + reinforce + pour + cure-to-strip + strip + transport
T_cycle_target = desired days per floor

With zoning:  n_sets = ceil( T_occupied / (T_cycle_target × n_zones) )
```
Where `cure-to-strip` comes from §3.1–3.4. The dominant lever is **early-strip (drophead) systems**: the panels and joists come out at ~1–2 days while props stay, so `T_occupied` for the *panel* set collapses while the *prop* set is sized by the full strip time. **Model panels and props as two separate inventories with different occupancy times** — that's how the real planning works and it's the whole reason drophead systems exist.

Secondary drivers noted in practice: dividing floors into zones *"allows for more efficient use of formwork and labor resources"*; *"standardizing grid dimensions accelerates worker familiarization and daily output."* Crane hook-time is frequently the binding constraint, not concrete strength — worth an explicit input.

---

## 4. SURFACE FINISH CLASSES AND TOLERANCES

### 4.1 ACI 347 §3.4 / Table 3.1 — irregularities in formed surfaces

**Table 3.1 — Permitted abrupt or gradual irregularities in formed surfaces, as measured within a 5 ft (1.5 m) length with a straightedge**

| Class of surface | A | B | C | D |
|---|---|---|---|---|
| Permitted irregularity | **1/8 in. (3 mm)** | **1/4 in. (6 mm)** | **1/2 in. (13 mm)** | **1 in. (25 mm)** |

**Intended use:**
- **Class A** — *"surfaces prominently exposed to public view where appearance is of special importance"*
- **Class B** — *"coarse-textured, concrete-formed surfaces intended to receive plaster, stucco, or wainscoting"*
- **Class C** — *"a general standard for permanently exposed surfaces where other finishes are not specified"*
- **Class D** — *"a minimum-quality requirement for surfaces where roughness is not objectionable, usually applied where surfaces will be permanently concealed"*

**Two categories of irregularity, measured differently:**
- **Abrupt** — *"Offsets and fins resulting from displaced, mismatched, or misplaced forms, sheathing, or liners, or from defects in forming materials."* → directly a function of **panel joint alignment, tie-hole leakage, and panel edge condition**
- **Gradual** — *"Irregularities resulting from warping and similar uniform variations from planeness or true curvature."* → checked with a **straightedge** for plane surfaces or a **shaped template** for curved/warped surfaces; *"the straightedge or template can be placed anywhere on the surface in any direction"*

Scope limit: this section *"is not intended for evaluation of surface defects, such as bugholes (blowholes) and honeycomb, attributable to placing and consolidation deficiencies"* (see **ACI 309.2R** for those).

**The design coupling you must implement — Class → deflection limit → spacing:** Class A at 3 mm over a 1.5 m straightedge is roughly `l/500` on the gauge length, and it must absorb **both** panel warp/deflection **and** joint mismatch. Practically:
- Class A → sheathing deflection limit **l/360 plus an absolute cap of 1/16 in (1.6 mm)**; use APA's *unshaded* table columns (*"Use unshaded columns for design of architectural concrete forms where appearance is important"*); tight, gasketed joints; new or lightly-used panels only
- Class B/C → **l/270** acceptable
- Class D → strength/shear governs; deflection largely cosmetic

Doka's Framax Xlife is rated to **ACI 347 Table 3.1 Class of surface "B"** at its full 80 kN/m² — a useful reality check that Class A generally requires *derating* a system below its structural rating, not just choosing a better panel.

### 4.2 Tolerances (ACI 347 §3.3, §5.2.3)

- *"Tolerance is a permissible variation from lines, grades, or dimensions given in contract documents. Suggested tolerances for concrete structures can be found in **ACI 117**."*
- The contractor *"should set and maintain concrete forms, including any specified camber, to ensure completed work is within the tolerance limits."*
- **Architectural concrete:** *"ACI Committee 347R notes... that concrete construction tolerances of **1/2 those called for in ACI 117** are considered the achievable limit."* → a hard floor on what you can promise. No numerical limits are given in 347 itself *"because the texture, lighting, and configuration of surfaces will all have an influence."*
- **Cumulative tolerance warning:** *"Where a project involves features sensitive to the cumulative effect of tolerances on individual portions, the engineer/architect should anticipate and provide for this effect by setting a cumulative tolerance."* → if you lay out panels by accumulating module widths, you must model **cumulative** drift, not just per-joint tolerance.
- Over-specification warning: *"Specifying permitted irregularities more stringent than those allowed for a Class C surface (Table 3.1) is incompatible with most concrete one-way joist construction techniques."*
- *"A permitted variation in one part of the construction... should not be construed as permitting violation of the more stringent requirements for any other part."*

### 4.3 Camber and pre-set (ACI §3.6.1.4, §5.2.4)

*"Additional elevation of formwork should be provided to allow for closure of form joints, settlements of mudsills, shrinkage of lumber, and elastic shortening and dead load deflections of form members."*

The contractor cambers for **formwork** deflection; the architect specifies any **additional** camber for structural deflection or **optical sag** (*"the illusion that a perfectly horizontal long-span member is sagging"*). Compliance is checked **before removal of forms and shores**. Positive means of adjustment (**wedges or jacks**) must be provided for realignment if settlement occurs, and telltale devices installed to detect movement during concreting.

### 4.4 Panel / joint / tie-hole layout implications

- **Joints cannot be hidden:** *"Because it is impossible to disguise the presence of joints in the form face, it is important for their positions to be predetermined and, if possible, planned as part of the architectural effect."* Plan joint locations *"on a scale and module suitable to the size of available materials and prevailing construction practices."*
- **Tie holes are a visible, permanent grid.** Since tie spacing is a *structural* output (§2.5), Class A work forces the loop to close the other way: pick the *architectural* tie grid first, then verify `F_tie = p × s_h × s_v` is within SWL, and if not, **reduce pressure** (lower `R`, warmer concrete, stiffer consistency class) rather than move the ties. Your tool should support **pressure-limited-by-tie-grid** as an explicit solve mode.
- **Standardisation drives cost:** the architect *"can make form reuse possible by standardizing building elements, such as columns, beams, and windows, and by making uninterrupted form areas the same size wherever possible to facilitate the use of standard form gangs or modules."*
- **Reuse limits finish:** *"If surface appearance is important, forms should not be reused if damage from previous use would cause impairment to concrete surfaces."*
- Mockups: for major architectural work, specify a **preconstruction mockup** that then *"remains at the site for the duration of the work as a standard with which the rest of the work should comply."*
- Doka references **DIN 18202 Table 3 Line 6** for panel planeness — the European counterpart to ACI 117; system pressure ratings are conditional on meeting it.

⚠️ **Gap: EN 13670** — I could not retrieve the actual clause text or Annex tolerance tables (all sources paywalled or 403). You need **EN 13670:2009 §5.5 (removal of formwork/falsework)** and its **tolerance classes 1 and 2** with mm deviations, plus the EN 13670 **execution classes**, before claiming EN coverage. Buy or access via BSI.

---

## 5. EXACT INPUTS A SOFTWARE TOOL MUST COLLECT

### 5.1 Project / code context
| Input | Type | Notes |
|---|---|---|
| Design code | enum | ACI 347 / DIN 18218:2010 / CIRIA 108 / BS 5975 simplified |
| Unit system | enum | **imperial and metric are NOT interconvertible** — ACI's two paths give different answers (§1.2) |
| Element type | enum | wall / column / slab / beam / foundation / shaft |
| Surface finish class | enum | ACI A/B/C/D (→ drives deflection limit + tie grid freedom) |
| Deflection limit | enum + value | l/270, l/360, absolute cap (1/16 in / 1.6 mm), or custom |
| Tolerance basis | enum | ACI 117 / ½ ACI 117 (architectural) / DIN 18202 / custom |
| Reuse count / condition | int + enum | derate allowables for substantial reuse (ACI §2.3) |

### 5.2 Geometry
Wall/column height `H` (m/ft) · wall thickness · wall length (needed to convert pump rate → `R`) · column plan dimensions `b × d` (**and auto-classify column vs wall at the 2 m / 6.5 ft threshold**) · slab thickness · beam width/depth · clear spans between structural supports (drives stripping table bands: <3 m, 3–6 m, >6 m) · number of lifts / construction joint positions · form batter angle `β` (uplift) · pour-height per lift.

### 5.3 Concrete
| Input | Units | Used by |
|---|---|---|
| Unit weight / density `w` / `ρ` / `γc` | lb/ft³ / kg/m³ / kN/m³ | Cw, all hydrostatic caps, DIN scaling |
| Cement type | enum: I / II / III / blended | Cc |
| Slag content > 70%? Fly ash > 40%? | bool | Cc = 1.4 |
| Retarder present? | bool | Cc |
| **Superplasticizer / HRWR that delays set?** | bool | **Cc — separate question from "retarder"** |
| Slump | in / mm | validity gate: ≤ 7 in / 175 mm for ACI special cases |
| Consistency class | enum F1–F6 / SCC | DIN formulas |
| **SCC flag** | bool | forces hydrostatic under ACI; selects SCC row under DIN |
| Design strength f'c | MPa / psi | stripping % criteria |
| End of setting `tE` | h | DIN correction |
| Reference temperature `TRef` for tE | °C | DIN correction |

### 5.4 Placement
| Input | Units | Notes |
|---|---|---|
| Rate of placement `R` / rise rate `v` | ft/h / m/h | **or** derive: `R = pump_rate / (length × thickness)` |
| Pump rate | m³/h | alternative to R |
| **Concrete temperature at placing** | °F / °C | not ambient |
| Ambient/surface temperature profile | °C over time | stripping accumulator, maturity |
| Vibration method | enum | internal / external / none(SCC) |
| **Internal vibrator immersion depth** | m / ft | gate: >1.2 m (4 ft) voids ACI formulas; DIN requires < hs and < 1 m |
| **Pumped from base of form?** | bool | → hydrostatic + **25% surge minimum** |
| Placed from top? | bool | DIN boundary condition |
| Expansive / shrinkage-compensating cement? | bool | pressures can exceed hydrostatic |

### 5.5 Loads (slabs/decks)
Formwork self-weight (kPa) · rebar weight · **live load** (default 2.4 kPa; 3.6 kPa if motorized carts) · **motorized carts flag** (→ min total 6.0 kPa vs 4.8 kPa) · concentrated/storage loads · runway loads · structural LL and structural DL of the permanent slab (**the ratio LL:DL selects the stripping-table column**).

### 5.6 Lateral / bracing
Wind: exposure, basic wind speed per ASCE 7 + **ASCE 37** recurrence reduction, or local code · **minimum 0.72 kPa (15 psf)** for exposed wall forms · minimum line load **1.5 kN/m (100 lb/ft) at top** · 2% of dead load alternative · raker angle `θ`, connection height `a`, raker spacing `s` · anchor/kicker capacity · guy-wire vs rigid brace (**guys need both sides**) · attached enclosures/windbreaks (extra wind area).

### 5.7 Materials / components (library-driven, not hard-coded)
- **Sheathing:** type (Plyform I / II / Structural I / film-faced ply / steel / plastic), thickness/Performance Category, **face grain orientation**, and either APA section properties (`I`, `KS`, `Ib/Q` per orientation) + allowables (`Fb`, `Fs`, `E`, `Ee`) or metric `f_m`, `f_r`, `E_mean`, `γ_M`
- **Joists/studs:** species+grade (DF No.2 / Hem-Fir No.2 / SP No.2), nominal size, **or** H20 beam (`M`, `Q`, `EI`) **with an allowable-vs-design flag**, or aluminium/steel section properties
- **Walers/soldiers:** section, **single vs doubled** (halves the per-member load), aluminium/steel channel properties
- **Ties:** designation (DW15/DW20/DW26.5/Rd16/coil rod/she-bolt/3t/6t/9t/15t), capacity value, and **capacity type: permissible vs ultimate** (factor-of-2 error if wrong), plus **anchor plate / wing nut / panel borehole / bracket capacities separately** — the rod is often not the weak link
- **Column clamps:** rated capacity per side, corner/bolt capacity, adjustment increments
- **System panels:** `σ_perm` (and any width-dependent uprating, cf. Framax 80 → 100 kN/m² for ≤105 cm panels), permitted column cross-section range and increment, rated ACI surface class
- **Props/shores:** capacity vs extension, base plate area, mudsill bearing capacity

### 5.8 Programme / cycle
Target floor cycle (days) · number of zones per floor · number of floors · erect/reinforce/pour/strip/transport durations · strip criterion (**time-based table vs % f'c vs maturity target**) · reshore levels or "solve by rational analysis" · high-early-strength concrete flag · crane hook-time availability · **separate panel and prop inventories** (early-strip systems).

### 5.9 Derived outputs the tool should emit
`p_max` (or the full `σ(h)` envelope + `hs`) · governing equation and why · governing check per component (bending / shear / deflection) with utilisation ratios · **calculated vs adopted (modularised) spacings** for sheathing supports, joists, walers, ties, clamps · `F_tie` and selected tie with utilisation · stepped column-clamp schedule · brace force, count, and anchor demand · uplift force · max permissible `v` for a given system rating (**the inverse solve**) · stripping time / maturity target with the temperature accumulator · reshore level count and per-level loads · set count and cycle · a validity-gate report listing every code boundary condition checked (slump, vibration depth, rate band, height limit, `H ≤ 10 m`, `v ≤ 7 m/h`).

---

## 6. SOURCE URLS

**Primary documents I extracted directly:**
- ACI 347-04 *Guide to Formwork for Concrete* (full 32-page text, §2 Design, Tables 2.1/2.2/2.3/3.1, §3.7 stripping, §3.8 reshoring) — https://ce.engineeringdesignresources.com/wp-content/uploads/2019/04/ACI-347.pdf
- ACI 347R-14 official CEU PDF — https://www.concrete.org/Portals/0/Files/PDF/CEU-347R-14.pdf
- M.K. Hurd, *Lateral Pressures for Formwork Design*, Concrete International, June 2007 (all ACI equations in both unit systems, Tables 1 & 2) — http://www.sefindia.org/forum/files/hurd_revised_formwork_formulas_ci_june07_196.pdf
- APA *Design/Construction Guide: Concrete Forming*, Form V345V (Tables 3–13, worked Examples 1 & 2, all plywood formulas) — https://apawood-europe.org/wp-content/uploads/2012/10/Concrete-Forming-DesignConstruction-Guide.pdf
- BS 8110-1:1997 Table 6.2 striking times (verbatim) — https://pdfcoffee.com/bs-minimum-period-before-striking-formwork-pdf-free.html
- Doka *Framax S Xlife* User Information 999783014 12/2021 (system pressures, accessory capacities) — https://direct.doka.com/_ext/downloads/downloadcenter/999783014_2021_12_online.pdf
- Doka *beam H20 top* datasheet (M/Q/EI, EN 13377) — https://direct.doka.com/web/media/files/doka_beam_h20top_en.pdf
- DIN 18218:2010-01 English preview (scope, symbols, contents, amendments list) — https://www.normsplash.com/Samples/DIN/115439385/DIN-18218-2010-en.pdf
- Domsa & Catinas, *Comparative Study Concerning Concrete Pressure on Formwork*, PBE2014 — https://www.fce.vutbr.cz/ekr/pbe/Proceedings/2014/013_14148.pdf

**DIN 18218 coefficient derivation (probed):**
- PASCHAL Betondruckrechner (the calculator I reverse-engineered) — https://www.paschal.de/deutsch/service/betondruckrechner.php
- PERI Formwork Load Calculator — https://apps.peri.com/SLR/index.php?lang=en
- MEVA Betondruckrechner — https://meva.net/de-ch/tools/betondruckrechner/
- DIN 18218 tE/Arrhenius form and K1 values (secondary corroboration) — https://calcformula.com/concrete-pressure-calculator/

**CIRIA 108 / BS 5975:**
- CIRIA R108 purchase (**buy this — C1/C2 tables**) — https://www.ciria.org/CIRIA/CIRIA/Item_Detail.aspx?iProductCode=R108
- CIRIA 108 formula as Excel LAMBDAs — https://gist.github.com/jsb2505/317f82dee2b5eafd1cac3ebc5eddba72
- CIRIA 108 worked pressure spreadsheet (Pd = D[C1√R + C2K√(H−C1√R)], Hz) — https://idoc.pub/documents/ciria-108-pressure-analysis-vnd5m7or5jlx
- CIRIA R108 concrete grouping table (Groups A/B/C, 1–7) — https://pdf4pro.com/file/5cf01/Concrete_Groups.pdf.pdf
- BS 5975:2019 / CIRIA overview — https://prontubeam.com/Detailed-civil-engineering-in-the-network/262

**Ties / SCC / other:**
- MEVA FormSet (DW15 90 kN / DW20 160 kN / DW26.5 250 kN) — https://meva.net/en-au/wp-content/uploads/sites/19/2021/12/FormSet-Product-Info-GB.pdf
- Tie rod working-load tables + tributary-area method — https://www.chontan.net/blog/formwork-tie-rod-guide
- Billberg et al., *Form Pressure Generated by SCC* (KTH) — https://kth.diva-portal.org/smash/record.jsf?pid=diva2:10913
- *Form pressure generated by fresh concrete: a review about practice in formwork design* — https://link.springer.com/article/10.1617/s11527-014-0274-y
- *Lateral Formwork Pressure for SCC — A Review* — https://www.mdpi.com/1996-1944/14/16/4767
- Column clamp spacing calculator — https://ellismanufacturing.com/pages/column-clamp-spacing-calculator
- High-rise floor cycle durations (7–9 days) — https://planningplanet.com/forums/planning-scheduling-programming-discussion/418608/floor-cycle-duration-high-rise-building

---

## 7. WHAT YOU STILL NEED TO BUY / VERIFY

Ranked by how much risk each carries for your implementation:

1. **CIRIA Report 108 (1985)** — the C1/C2 tables. My C1 = 1.0 (walls) / 1.5 (columns) is well corroborated; **C2 = 0.30–0.60 by concrete group 1–7 is not reliably pinned down.** Without it your UK path is guesswork. (~£50 from ciria.org)
2. **DIN 18218:2010-01 Table 2 + Annex B diagrams** — to confirm my derived F1–SCC formulas, and specifically to replace my linear `tE` interpolation for F1–F4 with the real tabulated columns. Also confirms whether the 250 kN/m² ceiling is DIN's or the calculator's. (Beuth Verlag)
3. **EN 13670:2009** — §5.5 formwork/falsework removal criteria and the tolerance class 1/2 tables. I retrieved **nothing** usable here; treat EN coverage as unimplemented.
4. **ACI 347R-14** (I worked from **347-04**) — the equations, coefficient tables, Table 3.1, and stripping times are stable across these editions, but confirm no renumbering or added SCC guidance before citing "347R-14" in your UI.
5. **ACI 117** — the actual numerical construction tolerances (347 only points at it).
6. **ACI SP-4 Formwork for Concrete, 7th ed. (Hurd)** — the canonical source for **trapezoidal/triangular** pressure-distribution design methods (which APA explicitly defers to) and for column-clamp stepped-spacing tables. This is the single best buy for §2.7.
7. **Metric film-faced plywood design values** — manufacturer datasheets (Metsä/UPM WISA-Form, Doka 3-SO) per EN 13986/EN 789. Do not ship hard-coded metric ply allowables.
8. **BS 5975:2019** — to confirm the "25 × depth of pour" simplified clause wording and its conditions of use.

One correctness warning worth repeating, because it's the easiest way for this feature to produce an unsafe design: **the ACI minimum (600Cw psf / 30Cw kPa) must not be applied to the hydrostatic equation**, and conversely **SCC under ACI must be forced to hydrostatic with no minimum floor**. ACI states both explicitly and they pull in opposite directions, so a naive `max(formula, minimum)` wrapper around every path gets one of them wrong.