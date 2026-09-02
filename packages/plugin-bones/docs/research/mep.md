# MEP (Plumbing + HVAC) — research notes for the Bones inference engines

**Status:** researched 2026-08-13 against the 2021 IRC (read via the Pennsylvania adoption on UpCodes, which carries the model-code text for these chapters) plus industry references. Companion dataset: [`data/mep-rules.json`](../../data/mep-rules.json).

> **Disclaimer:** drafting aid, not engineering. Everything here is typical/approximate and meant to let a plugin draw a *plausible* system. Real designs need a licensed plumber/HVAC designer, ACCA Manual J/S/D calculations, and the local authority having jurisdiction (AHJ). Jurisdictions on the **UPC** (IAPMO — most of the US West) differ materially from the **IRC/IPC** numbers below; the biggest geometric difference (trap-arm length) is called out explicitly.

---

## 1. Code landscape (what governs what)

- **IRC Part VII, chapters 25–33** is the residential plumbing code in IRC states: ch. 27 fixtures, ch. 28 water heaters, ch. 29 water supply, ch. 30 sanitary drainage, ch. 31 vents, ch. 32 traps. ([IRC ch.30](https://up.codes/viewer/pennsylvania/irc-2021/chapter/30/sanitary-drainage), [ch.31](https://up.codes/viewer/pennsylvania/irc-2021/chapter/31/vents), [ch.29](https://up.codes/viewer/pennsylvania/irc-2021/chapter/29/water-supply-and-distribution))
- **IRC Part V, chapters 12–24** is the residential mechanical code: ch. 13 general (access/clearance), ch. 14 heating/cooling equipment, ch. 15 exhaust, ch. 16 ducts. ([IRC ch.15](https://up.codes/viewer/pennsylvania/irc-2021/chapter/15/exhaust-systems), [ch.14](https://up.codes/viewer/pennsylvania/irc-2021/chapter/14/heating-and-cooling-equipment-and-appliances), [ch.13](https://up.codes/viewer/pennsylvania/irc-2021/chapter/13/general-mechanical-system-requirements))
- **UPC/IMC states**: California, Washington, Oregon, Nevada, etc. use the IAPMO UPC for plumbing. Values differ (see §2.4). Flag jurisdiction in the plugin UI.
- **HVAC design proper** is not in the code text: the code (IRC M1401.3) *delegates* to **ACCA Manual J** (room-by-room loads), **Manual S** (equipment selection), **Manual D** (duct design). Exact M1401.3 text: *"Heating and cooling equipment and appliances shall be sized in accordance with ACCA Manual S or other approved sizing methodologies based on building loads calculated in accordance with ACCA Manual J..."* ([IRC ch.14](https://up.codes/viewer/pennsylvania/irc-2021/chapter/14/heating-and-cooling-equipment-and-appliances))

---

## 2. Plumbing — DWV (drain, waste, vent)

### 2.1 Fixture drain and trap sizes (IRC Table P3201.7)

| Fixture | Min trap/drain | Notes |
|---|---|---|
| Lavatory | 1¼ in | |
| Kitchen sink | 1½ in | often run as 2 in in practice for grease margin (approximate) |
| Bathtub | 1½ in | |
| Shower | 2 in | 1½ in only allowed for ≤ 5.7 gpm flow; model 2 in |
| Clothes washer standpipe | 2 in | |
| Water closet | 3 in | via Table P3005.4.1 — no WC on pipe < 3 in |

Trap seal 2–4 in deep (P3201.2). Source: [IRC ch.32](https://up.codes/viewer/pennsylvania/irc-2021/chapter/32/traps).

### 2.2 Slope, branch and building-drain capacity

- **Slope (P3005.3):** 2½ in and smaller → **¼ in/ft** (2%); 3 in and larger → **⅛ in/ft** (1%) minimum. An engine should drop drain elevation by `run_ft × slope` when routing.
- **DFU loads (Table P3004.1):** lav 1, kitchen sink 2, shower 2, tub 2, WC (1.6 gpf) 3, full-bath group 5, half-bath group 4, washer standpipe 2.
- **Capacity (Tables P3005.4.1/.4.2):** horizontal branch: 1½ in → 3 DFU, 2 in → 6, 3 in → 20, 4 in → 160. Stack: 3 in → 48. Building drain at ¼ in/ft: 3 in → 42 DFU, 4 in → 216 — i.e. a 3-in building drain covers essentially any ≤ 3-bath house; use 4 in beyond that.
- Source: [IRC ch.30](https://up.codes/viewer/pennsylvania/irc-2021/chapter/30/sanitary-drainage).

**Engine sizing algorithm:** sum DFU downstream of each node → pick smallest pipe whose table capacity ≥ sum → never decrease size downstream → force ≥ 3 in once a WC is upstream.

### 2.3 Venting and trap arms (IRC ch. 31)

- Every trap needs a vent within the **trap-arm limit** (Table P3105.1, at the slopes above): **1¼ in → 5 ft, 1½ in → 6 ft, 2 in → 8 ft, 3 in → 12 ft, 4 in → 16 ft**. WCs (self-siphoning) are exempt from the distance limit in the IRC.
- Vent size: ≥ **half the drain served, min 1¼ in** (P3113.1); +1 pipe size if developed length > 40 ft.
- At least **one vent pipe must extend to outdoors** per building drain (P3102.1). Roof termination ≥ **6 in above the roof** (or snow line, P3103.1); where the 97.5% design temp ≤ 0 °F, roof penetrations must be ≥ **3 in diameter** (frost closure, P3103.2) — so a full-height 3-in stack is the correct default model everywhere.
- Source: [IRC ch.31](https://up.codes/viewer/pennsylvania/irc-2021/chapter/31/vents).

### 2.4 UPC difference that changes geometry

UPC Table 1002.2 trap arms are far shorter: **1¼ in → 2 ft 6 in, 1½ in → 3 ft 6 in, 2 in → 5 ft, 3 in → 6 ft, 4 in → 10 ft** ([HQ Plumbing code library](https://hqplumbingandair.com/resources/code-library/upc-table-1002-2-trap-arm-length)). In UPC states fixtures must sit much closer to a vented wall — the dataset carries both maps (`maxTrapArmFtBySize` vs `maxTrapArmFtBySizeUpc`).

### 2.5 Water supply (IRC ch. 29)

- **Service:** min **¾ in** (P2903.7); 1 in typical for larger homes (approximate).
- **Distribution:** industry practice is a ¾ in trunk (or manifold) with **½ in branches** to fixtures; formal sizing per Table P2903.6 / Appendix AP.
- **Pressure:** max **80 psi static** (PRV above that, P2903.3.2); minimum is "meets fixture flow pressures" per Table P2903.1 (e.g. shower 2.5 gpm @ 20 psi, WC tank 3 gpm @ 20 psi, lav 0.8 gpm @ 8 psi). 40–60 psi is the usual design band (approximate).
- **Velocity caps** (Table P2903.8.1, manifolds): 12 ft/s plastic, 8 ft/s metallic.
- Source: [IRC ch.29](https://up.codes/viewer/pennsylvania/irc-2021/chapter/29/water-supply-and-distribution).

### 2.6 Fixture clearances and rough-in dimensions

**Code (IRC P2705.1, P2708.1** — [ch.27](https://up.codes/viewer/pennsylvania/irc-2021/chapter/27/plumbing-fixtures)):
- WC/lav/bidet: **≥ 15 in centerline to side wall/vanity**, **≥ 30 in center-to-center** between fixtures, **≥ 21 in clear in front**.
- Shower: ≥ **900 in² interior**, ≥ **30 in min dimension**, maintained to 70 in above drain.

**Industry rough-in (approximate — not code; [horow.com guide](https://horow.com/blogs/guide/bathroom-rough-in-dimensions-plumb-guide-for-bathroom-plumbing)):**
- Toilet flange **12 in from finished wall** (10/14 in variants); supply ~6 in left of centerline, ~7 in AFF.
- Lav drain **18–20 in AFF**, supplies 2–3 in above drain at 8-in spread; rim 30–32 in (vanity-dependent).
- Shower valve **38–48 in AFF** (guide cites ~48; 44 is a common drafting default), head ~**80 in**; tub valve 28–36 in, spout 4–6 in above rim.

### 2.7 Wet walls (where plumbing lives)

A **wet wall** is a 2x6 (or double-2x4) wall carrying the stack, vents and supplies. 2x4 = 3.5 in actual is **too shallow for a 3-in DWV stack**, which needs ~3.5 in clearance at fittings; 2x6 gives 5.5 in ([washingtonplumbers.net](https://washingtonplumbers.net/glossary/wet-wall/)). Stud boring limits (~40% bearing/60% non-bearing) reinforce this. Steel shield plates required where pipes pass < 1.5 in from the stud face (IRC P2603.2.1).

### 2.8 Water heater placement

30 in × 30 in level working space at the control side (M1305.1); ignition source **18 in above garage floor** (M1307.3); attic installs need a 30×22 in passageway ≤ 20 ft with flooring (M1305.1.2); drain pan when above finished space (P2801). Source: [IRC ch.13](https://up.codes/viewer/pennsylvania/irc-2021/chapter/13/general-mechanical-system-requirements).

---

## 3. HVAC

### 3.1 Sizing (all rules of thumb — Manual J/S is the code-required method)

- **Cooling:** baseline **~20 Btu/h·ft²** ⇒ ~**500 ft²/ton** (range 400–700 by climate/vintage). ENERGY STAR's room-AC table (e.g. 450–550 ft² → 12,000 Btu/h) confirms ~500–600 ft²/ton for average envelopes ([energystar.gov](https://www.energystar.gov/products/room_air_conditioners)); PNNL notes well-built low-load homes exceed **1,000 ft²/ton** ([basc.pnnl.gov](https://basc.pnnl.gov/resource-guides/air-conditioning)).
- **Heating:** **30–60 Btu/h·ft²** by climate zone — hot 30–35, warm 35–40, moderate 40–45, cool 45–50, cold 50–60; ±10% for insulation ([inchcalculator.com](https://www.inchcalculator.com/calculate-btus-to-heat-home/)).
- **Selection band:** Manual S / PNNL — capacity at design conditions should be **95–115% of design load**; never oversize cooling (humidity control fails); furnaces tolerate ~150% ([basc.pnnl.gov](https://basc.pnnl.gov/resource-guides/air-conditioning)).

### 3.2 Ducted systems (Manual D territory)

- **Airflow:** **400 CFM/ton** nominal; ~350 hot-humid, ~450 hot-dry; manufacturers publish a 350–450 band — check the blower table ([hvacprocalculator](https://hvacprocalculator.com/guides/cfm-per-ton), [MEP Academy](https://mepacademy.com/how-many-cfm-per-ton)).
- **Friction rate:** legacy default 0.1 in wg/100 ft; real Manual D derives it from available static — HVAC School's worked example computes **0.05 in wg/100 ft** on a 0.2 in wg low-static unit and sizes **8-in flex per 100 CFM branch, 14-in flex for a 400 CFM return** ([hvacrschool.com](https://www.hvacrschool.com/manual-d-speedsheet-walkthrough/)). Rigid round runs smaller: 6-in ≈ 100–125 CFM is the classic bedroom branch (approximate).
- **Trunks (approximate contractor convention, derived from 400 CFM/ton at ~700–900 fpm):** 2 ton ≈ 8×14 in, 3 ton ≈ 8×18 in, 4 ton ≈ 10×20 in; taper after takeoffs. **Flagged: no single primary source — Manual D governs.**
- **Registers/returns:** one supply register per habitable room at the perimeter (under windows for heating climates); one large central return per floor with door undercuts/transfer grilles from closable rooms (Manual D practice, [basc.pnnl.gov](https://basc.pnnl.gov/resource-guides/air-conditioning)).

### 3.3 Ductless mini-splits

- Wall-cassette capacity steps: **6k / 9k / 12k / 18k / 24k Btu/h**; 9–12k for bedrooms, 12–18k living areas (manufacturer lineups; ENERGY STAR table above for per-room selection).
- Mounting: **~7 ft (84 in) AFF, ≥ 3 in below ceiling** (8+ in better), ≥ 2 in side clearance; exterior wall shortens linesets; don't blow directly on beds/occupants; avoid recessed pockets that starve return air ([aircondlounge.com](https://aircondlounge.com/mini-split-placement-best-location-for-mini-splits/)).

### 3.4 Ventilation & exhaust (IRC ch. 15 — hard code numbers)

| Item | Value | Section |
|---|---|---|
| Bath fan | **50 CFM** intermittent / 20 continuous | Table M1505.4.4 |
| Kitchen exhaust (range hood) | **100 CFM** intermittent / 25 continuous | Table M1505.4.4 |
| Range hood makeup air trigger | > **400 CFM** | M1503.6 |
| Dryer duct | **35 ft max** developed length, −5 ft per 4-in 90° elbow, 4-in duct | M1502.4.6.1 |
| Exhaust termination | ≥ **3 ft** from openings/property line, ≥ 10 ft from mechanical intakes | M1504.3 |
| Whole-house ventilation | 30–165 CFM continuous by area × bedrooms | Table M1505.4.3(1) — full matrix in dataset |

Source: [IRC ch.15](https://up.codes/viewer/pennsylvania/irc-2021/chapter/15/exhaust-systems).

### 3.5 Equipment access

Same M1305.1 rules as water heaters: 30×30 in working space, 24-in access doors, 18-in garage ignition elevation, attic passageway limits ([IRC ch.13](https://up.codes/viewer/pennsylvania/irc-2021/chapter/13/general-mechanical-system-requirements)).

### 3.6 Ducts vs. the structure — why the trunk lives in the ATTIC (prod report 2026-08-16)

A user's production scene showed the supply trunk boring straight through wall **top plates**. That is not a thing framers or mechanicals do, and the code chain says why:

- **IRC R602.6 (drilling/notching of studs) + R602.6.1 (top plate)**: where a top plate is cut, drilled or notched **more than 50 % of its width**, a galvanized metal tie **not less than 0.054 in thick (16 ga) and 1½ in wide** must be fastened across the opening with eight 10d nails each side. Those limits exist for *pipes* — a 14×8 in (or even 6 in round) supply duct can never satisfy a plate-boring limit, so **ducts simply do not pass through top plates**. (IRC 2021 ch. 6, wall construction — same UpCodes source family as the rest of this file.)
- **IRC M1601 (duct systems)**: duct installation rules (M1601.4 support/joints; R-value per N1103.3 when outside conditioned space). Nothing in M1601 offers a plate-penetration path; installation guidance assumes ducts run in **open framing cavities: attics, floor trusses, dropped chases**.
- **Residential practice** (Manual D guidance, §4 item 6 above): single-storey slab homes run the **rectangular trunk in the attic above the ceiling joists**, branches tee off at attic elevation, and each supply register is a **ceiling boot** dropping through the ceiling plane between joists — geometrically identical to a recessed-light rough-in. Two-storey supply alternatives (floor-truss webs, dropped hallway soffits) still never cross a plate: they run *below* it or *above* it.

**Engine model (dataset `hvac.attic`):** trunk + branches route at `wall.height + trunkAboveWallTopM` (0.30 m ≈ ceiling-joist depth 0.24 m + clearance); supply registers sit at the ceiling plane (`meta ceiling:true`) fed by short vertical boots; bath/dryer exhaust exits through a **stud bay** below the plate band. Gate: no duct-run member's OBB may enter any wall's top-plate band `[wall.height − topPlateBandM, wall.height]` (0.09 m ≈ doubled 2x plate).

---

## 4. Spatial placement — how an inference engine should lay this out

This is the "WHERE" logic. Items 1–4 are strong industry conventions; code cites are noted.

1. **Find the wet core.** Cluster wet rooms (baths, kitchen, laundry). The shared wall between back-to-back fixtures (bath/bath, bath/kitchen, bath/laundry) becomes the **2x6 wet wall**. Multi-storey: prefer stacking wet rooms vertically so one DWV stack serves all floors.
2. **Vent stack:** place the 3-in stack in the main bath's wet wall, behind/near the WC (shortest trap arms), rising straight through the roof, terminating ≥ 6 in above it (P3103.1). Secondary wet areas beyond trap-arm reach (§2.3/2.4) get their own 1½–2 in vents, which may re-join the stack ≥ 6 in above the highest fixture flood rim or exit the roof separately.
3. **Drains fall downhill:** route fixture drains within trap-arm limits to the wet wall, drop down the stack, then run the **building drain** at ¼ in/ft (⅛ in/ft ok at 3 in+) under the slab / along the basement ceiling toward the street or septic side. Every horizontal length costs elevation — check crossings with footings/beams.
4. **Supply tree:** ¾-in main enters near the water heater location; ¾-in hot+cold trunks chase alongside the DWV in the same wet walls/joist bays; ½-in branches to each fixture group. Keep hot runs short: put the **water heater adjacent to the wet core** (garage/basement/utility closet), 30×30 in clear in front, 18 in ignition lift in garages.
5. **Air handler/furnace near the duct centroid:** central closet, basement, garage, or attic. Attic installs must satisfy the M1305.1.2 passageway.
6. **Supply trunk down the hallway spine:** rectangular trunk in a dropped hallway ceiling chase, open-web floor trusses, or under the basement ceiling — hallways run down the middle of houses, which minimizes branch lengths and keeps the soffit out of rooms. Taper the trunk after each group of takeoffs.
7. **Branches & registers:** 6-in round (8-in flex) per room to a perimeter register under/near windows; 2+ registers for large rooms (> ~150 CFM).
8. **Returns:** one big central hallway return per floor (filter grille), plus a return path (undercut/transfer grille) from every closable room.
9. **Condenser/heat-pump outdoor unit:** side/rear exterior pad, minimizing lineset to the air handler; keep manufacturer clearances and local setbacks.
10. **Point exhausts are exterior-wall seekers:** dryer (35-ft budget, elbows expensive) wants the laundry on/near an exterior wall; range hood ducts up through the roof or straight out behind the range; bath fans duct up to roof caps or out gable/soffit-adjacent wall caps, ≥ 3 ft from openings (M1504.3).
11. **Mini-split alternative:** if no duct network, place one head per thermal zone (ENERGY STAR table per room), high on an exterior wall ~84 in AFF, linesets dropping outside to a shared outdoor unit.

---

## 5. What is code vs. what is approximate

**Hard code numbers (IRC 2021):** trap/drain sizes, DFU tables, slopes, trap-arm lengths, vent min sizes, roof termination, 15/21/30-in fixture clearances, 900 in² shower, ¾-in service, 80 psi max, 50/100 CFM exhaust, 400 CFM makeup-air trigger, 35-ft dryer duct, whole-house ventilation matrix, 30×30 service space, 18-in garage elevation.

**Approximate / practice (flag in UI):** 2x6 wet wall, ½-in branch convention, rough-in heights (valve 38–48 in etc.), all ft²/ton and Btu/ft² sizing, 400 CFM/ton, 0.1 friction rate, trunk-by-tonnage table (weakest-sourced item in the dataset), register CFM, mini-split mount height, 4-in bath-fan duct, every placement heuristic in §4.

**Known jurisdiction deltas:** UPC trap arms (§2.4); UPC also requires different venting details and (in CA) water-heater seismic strapping — not modeled. IPC (non-IRC states) trap arms match IRC values (IPC Table 909.1).

---

## Sources

All consulted 2026-08-13:

- IRC 2021 via UpCodes (PA adoption): [ch.13](https://up.codes/viewer/pennsylvania/irc-2021/chapter/13/general-mechanical-system-requirements) · [ch.14](https://up.codes/viewer/pennsylvania/irc-2021/chapter/14/heating-and-cooling-equipment-and-appliances) · [ch.15](https://up.codes/viewer/pennsylvania/irc-2021/chapter/15/exhaust-systems) · [ch.27](https://up.codes/viewer/pennsylvania/irc-2021/chapter/27/plumbing-fixtures) · [ch.29](https://up.codes/viewer/pennsylvania/irc-2021/chapter/29/water-supply-and-distribution) · [ch.30](https://up.codes/viewer/pennsylvania/irc-2021/chapter/30/sanitary-drainage) · [ch.31](https://up.codes/viewer/pennsylvania/irc-2021/chapter/31/vents) · [ch.32](https://up.codes/viewer/pennsylvania/irc-2021/chapter/32/traps)
- [PNNL Building America Solution Center — Air Conditioning](https://basc.pnnl.gov/resource-guides/air-conditioning)
- [ENERGY STAR — Room Air Conditioners sizing table](https://www.energystar.gov/products/room_air_conditioners)
- [HVAC School — Manual D Speedsheet Walkthrough](https://www.hvacrschool.com/manual-d-speedsheet-walkthrough/)
- [hvacprocalculator — CFM per ton](https://hvacprocalculator.com/guides/cfm-per-ton) · [MEP Academy — How many CFM per ton](https://mepacademy.com/how-many-cfm-per-ton)
- [inchcalculator — Heating BTU by climate zone](https://www.inchcalculator.com/calculate-btus-to-heat-home/)
- [aircondlounge — Mini split placement](https://aircondlounge.com/mini-split-placement-best-location-for-mini-splits/)
- [HQ Plumbing — UPC Table 1002.2 trap arm lengths](https://hqplumbingandair.com/resources/code-library/upc-table-1002-2-trap-arm-length)
- [washingtonplumbers.net — Wet wall (2x6 framing)](https://washingtonplumbers.net/glossary/wet-wall/)
- [horow — Bathroom rough-in dimensions](https://horow.com/blogs/guide/bathroom-rough-in-dimensions-plumb-guide-for-bathroom-plumbing)
