# Residential Electrical Layout Rules — Research for the Bones Electrical Engine

**Basis: NEC 2023 (NFPA 70).** Companion dataset: [`data/electrical-rules.json`](../../data/electrical-rules.json).

> Drafting aid, not engineering. Typical/approximate values — verify with the local authority having jurisdiction (AHJ).

This doc explains the *layout-computable* subset of the US residential electrical code: rules an inference engine can evaluate from walls, rooms, openings, counters, and fixtures alone. Wire sizing, box fill, conduit, service calcs beyond the basics, and anything requiring load knowledge are out of scope.

---

## 1. Which code edition applies (jurisdiction matters)

The NEC is revised every 3 years; states adopt on their own schedule. As of mid‑2026 (per the [Faraday NEC adoption tracker](https://faradaycrew.com/resources/nec-adoption-by-state) and NFPA's [enforcement maps](https://www.nfpa.org/education-and-research/electrical/nec-enforcement-maps)):

| Edition | States | Notes |
|---|---|---|
| NEC 2023 | ~34 states | AZ, AR, CA, CO, DE, FL, GA, HI, ID, IL, IA, ME, MD, MA, MI, MN, MS, NE, NV, NJ, NY, ND, OH, OK, OR, RI, SD, TN, TX, WA, WV, WY, … |
| NEC 2020 | 13 states | AL, AK, CT, KY, LA, MT, NH, NM, NC, PA, SC, UT, VA |
| NEC 2017 or earlier | 3 states | IN, KS, WI |
| No statewide code | MO | Adopted city/county by county; NEC 2023 common in big metros |

**Approximate:** adoption is a moving target and local AHJs can enforce a different edition or amendments than the state. The engine should treat edition as a jurisdiction setting with `2023` default and `2017`/`2020` fallbacks; the two rules that actually differ for layout are flagged below (kitchen islands, kitchen GFCI, garage circuit, wall-space breaks).

## 2. Receptacle outlets — NEC 210.52 (the core geometry)

Source: Mike Holt, *Understanding the 2023 NEC*, [210.52 excerpt PDF](https://www.mikeholt.com/files/PDF/23_UNEC1_210.52.pdf) (verbatim rule text with commentary); overview at [UpCodes](https://up.codes/s/dwelling-unit-receptacle-outlets). All receptacles here are 125 V, 15 A or 20 A.

### 2.1 General wall spacing — 210.52(A) ("the 6-foot rule")

**210.52(A)(1):** in every kitchen, family room, dining room, living room, sunroom, parlor, library, den, bedroom, recreation room, and *similar* room, receptacles must be placed so that **no point along the floor line of any wall is more than 6 ft, measured horizontally along the floor line, from a receptacle**. Consequences for the engine:

- Maximum spacing between two receptacles on a continuous wall line: **12 ft**.
- First receptacle within **6 ft** of every break (doorway edge, etc.).
- Measurement follows the **floor line** — it *wraps around inside corners*. Two 5 ft walls meeting in a corner are one 10 ft wall line, not two independent segments.

**210.52(A)(2) — what counts as "wall space":**

1. Any wall space **2 ft or more in width**, unbroken along the floor line by **doorways, fireplaces, stationary appliances, and fixed cabinets without countertops or work surfaces**. (The last two breaks — appliances and counterless fixed cabinets — are **new in 2023**; under 2017/2020 they did not break the wall line.)
2. The space occupied by **fixed panels** (e.g., fixed glass in an exterior wall) **counts as wall space** — a floor-to-ceiling window does *not* break the line.
3. **Fixed room dividers such as railings** and freestanding bar-type counters count as wall space too.

**210.52(A)(3):** a **floor receptacle within 18 in of the wall** counts toward the requirement (this is how you satisfy the rule at fixed glass panels and railings).

**Receptacles that do NOT count** (210.52 opening text): part of a luminaire or appliance; controlled by a listed wall-mounted control device (switched receptacles serving as the room's lighting outlet); inside cabinets/cupboards; **more than 5½ ft above the floor**. Countertop receptacles never count toward wall space [210.52(A)(4)] and vice versa.

### 2.2 Wall-walk algorithm (what the engine should do)

```
for each room in {kitchen, dining, living, bed, den, family, rec, sunroom, parlor, library, similar}:
  build the room's wall polyline at floor level (interior face)
  breaks = door openings, fireplaces,
           + (edition >= 2023) stationary appliances, fixed counterless cabinets
  # windows, fixed glass panels, railings/half-walls are NOT breaks
  split polyline at breaks -> wall spaces (may wrap corners)
  drop spaces shorter than 2 ft
  for each wall space of length L:
    n = ceil((L - 6) / 12) + 1   # if L <= 6, n = 1... more simply:
    # place greedily: first receptacle at min(6 ft, L/2) from a break,
    # then every <= 12 ft, ensuring last one is within 6 ft of the far break
  emit receptacle at 15 in AFF (convention, see §7)
  where the space is fixed glass or a railing -> emit floor receptacle within 18 in of the line
```

A minimal correct count for a wall space of length `L` ft is `ceil(L / 12)`, positioned so no floor-line point is >6 ft from one — e.g. at `6, 18, 30, …` ft with the last clamped to `L − 6` (or `L/2` if `L < 12`).

### 2.3 Kitchen countertops — 210.52(C)

- Applies to countertops and work surfaces **12 in or wider** [210.52(C)(1)].
- **No point along the countertop wall line more than 24 in**, measured horizontally, from a receptacle → **max 48 in between receptacles**, first within 24 in of each end.
- Not required in the strip directly **behind a range, counter-mounted cooktop, or sink** where the counter behind is **< 12 in** deep (straight run) or **< 18 in** (corner-mounted unit) — NEC Figure 210.52(C)(1) via the Mike Holt excerpt.
- Location [210.52(C)(3), tightened in 2023]: **on or ≤ 20 in above the countertop**, or a **receptacle assembly listed for in-countertop use**. Face-up unlisted, under-cabinet-in-appliance-garage, or below-overhang placements do not count.

**Islands & peninsulas — the big 2023 change [210.52(C)(2)]:** a receptacle is **no longer required** at island/peninsular countertops. If none is provided, **provisions must be installed for future addition** (junction box/raceway at the island). If one *is* provided it must follow (C)(3) — on/above the surface or a listed in-counter unit; **side-of-cabinet receptacles below the overhang are prohibited** (child cord-pull hazard drove the change). Contrast: **NEC 2017** required ≥1 receptacle per island/peninsula; **NEC 2020** required one per 9 sq ft of island surface. Sources: Mike Holt PDF above; change confirmed by NAHB/Hubbell/expertce coverage surfaced in search.

### 2.4 Other required receptacles

| Location | Rule | Section |
|---|---|---|
| Bathroom | ≥1 receptacle **within 3 ft of the outside edge of each basin**, on adjacent wall/partition or side/face of the cabinet; **≤ 12 in below** the countertop; one receptacle may serve two basins if within 3 ft of both | 210.52(D) |
| Outdoors (1–2 family) | One at the **front and one at the back**, readily accessible from grade, **≤ 6½ ft above grade** | 210.52(E)(1) |
| Balcony/deck/porch | ≥1 within 4 in (horizontally) of the dwelling, ≤ 6½ ft above the surface, if accessible from inside | 210.52(E)(3) |
| Laundry area | ≥1 receptacle in the area where laundry equipment is intended | 210.52(F) |
| Garage | **One per vehicle bay** (with electric power), **≤ 5½ ft above the floor** | 210.52(G)(1) |
| Accessory buildings | ≥1 in each accessory building with electric power | 210.52(G)(2) |
| Basement | ≥1 in **each unfinished portion** | 210.52(G)(3) |
| Hallway | ≥1 if hallway is **≥ 10 ft long, measured along the centerline without passing through a doorway** | 210.52(H) |
| Foyer | If **> 60 sq ft**: receptacle on each wall space **≥ 3 ft wide** unbroken by doorways/floor-length windows | 210.52(I) |

## 3. GFCI protection — NEC 210.8(A)

2023 scope: **all 125 V–250 V receptacles** on single-phase circuits ≤ 150 V to ground (earlier editions: 125 V 15/20 A only). Locations ([callout.app NEC 2023 210.8](https://www.callout.app/codes/nec-2023-210-8)): bathrooms; **kitchens (all receptacles — see below)**; garages and accessory buildings; outdoors; crawl spaces at/below grade; **basements, finished and unfinished** (finished added in 2020); laundry areas; **within 6 ft of any sink** (top inside edge of bowl) [210.8(A)(7)]; within 6 ft of bathtubs/shower stalls; indoor damp/wet locations.

**2023 kitchen change:** "where the receptacles are installed to serve the countertop surfaces" was deleted from 210.8(A)(6) — **every receptacle in a kitchen** now needs GFCI, including range, dishwasher, and refrigerator receptacles ([sygfci.com analysis](https://sygfci.com/2026/07/16/gfci-within-6-feet-of-sink-nec-210-8-a-kitchen-rule/)). Under 2017/2020, only countertop-serving + within-6-ft-of-sink.

Engine rule: tag emitted receptacles GFCI by room type + proximity tests (≤ 6 ft from sink/tub polygon edge).

## 4. AFCI protection — NEC 210.12

All **120 V single-phase 10/15/20 A** branch circuits (10 A added 2023) supplying outlets/devices in: kitchens, family rooms, dining rooms, living rooms, parlors, libraries, dens, bedrooms, sunrooms, rec rooms, **closets, hallways, laundry areas**, and similar — i.e. nearly everything except bathrooms, garages, unfinished spaces, outdoors ([callout.app NEC 2023 210.12](https://www.callout.app/codes/nec-2023-210-12)). Kitchens + laundry need **both** AFCI and GFCI (dual-function breakers in practice). For the engine this is a per-circuit boolean, not a geometric rule.

## 5. Lighting outlets & switches — NEC 210.70

- **≥1 lighting outlet controlled by a listed wall-mounted control device in every habitable room, kitchen, and bathroom** [210.70(A)(1)]. In rooms *other than* kitchens/bathrooms, one or more **switched receptacles** may substitute (Ex 1).
- Additional required, wall-switch-controlled lighting outlets: **hallways, interior stairways, attached garages, detached garages with power**, and **exterior entrances/exits with grade-level access** [210.70(A)(2)]; storage/equipment spaces (attic, underfloor, utility, basement) containing serviceable equipment [210.70(A)(3)].
- **Stairways: where there are ≥ 6 risers between floor levels, a wall switch at each floor level and each landing that includes an entryway** → the classic top-and-bottom 3-way pair [210.70(A)(2)(3)].
- **Approximate/convention:** the NEC does not dictate switch height or "switch at every entry". 48 in AFF is the near-universal convention (and the ANSI A117.1/ADA max reach); switch-per-entry and 3-ways for rooms with two remote entries are design practice the engine should emit anyway.

## 6. Clothes-closet luminaires — NEC 410.16

Source: [buildingcodegeek NEC 410.16 explainer](https://buildingcodegeek.com/closet-lighting-code-requirements-nec-410-16/).

Storage-space geometry (Art. 100): **24 in deep** off side/back walls (or rod), floor to **6 ft or highest rod**; above that, **12 in deep** (or shelf width) to ceiling; 12 in each side of rods accessible both sides. Minimum clearance from luminaire to nearest storage-space point:

| Luminaire | Clearance |
|---|---|
| Surface incandescent/LED, fully enclosed | **12 in** |
| Surface fluorescent | **6 in** |
| Recessed incandescent/LED, fully enclosed | **6 in** |
| Recessed fluorescent | **6 in** |
| Surface fluorescent/LED **identified for use within storage space** | 0 (permitted inside) |

Prohibited outright: open/partially-enclosed incandescent lamps, pendants, pendant lampholders. Engine rule: closet light goes on ceiling or wall above the door, ≥ clearance from the computed storage volume.

## 7. Smoke & CO alarms — IRC R314/R315 (not NEC)

Per [ICC IRC 2021 R314.3](https://codes.iccsafe.org/s/IRC2021P3/part-iii-building-planning-and-construction/IRC2021P3-Pt03-Ch03-SecR314.3): smoke alarm **in each sleeping room**, **outside each separate sleeping area** in the immediate vicinity of bedrooms, and **on every story** including basements and habitable attics (not crawl spaces/uninhabitable attics). New construction: **hardwired with battery backup, interconnected**. Placement clearances [R314.3.3, approximate — verify edition]: **≥ 3 ft** horizontally from a bathroom door containing tub/shower; from permanently installed cooking appliances **≥ 20 ft** (ionization), **≥ 10 ft** (ionization w/ silencing switch), **≥ 6 ft** (photoelectric). CO alarms [R315]: **outside each sleeping area** when the dwelling has fuel-fired appliances or an attached garage.

## 8. Required branch circuits & load — NEC 210.11(C), 220

([callout.app NEC 2023 210.11](https://www.callout.app/codes/nec-2023-210-11), [Leviton Captain Code 210.11(C)(4)](https://captaincode2020.leviton.com/node/132), Mike Holt 210.52(B) excerpt.)

- **Two or more 20 A small-appliance circuits** for kitchen/pantry/breakfast/dining receptacles [210.11(C)(1), 210.52(B)]; no other outlets on them (clock + gas-range receptacles excepted); refrigerator may instead sit on an individual ≥ 15 A circuit; countertop receptacles must be split across ≥ 2 of these circuits [210.52(B)(3)].
- **One 20 A laundry circuit** [210.11(C)(2)]; **one 20 A bathroom circuit** [210.11(C)(3)] (receptacles of several bathrooms, or everything in one bathroom).
- **One 20 A garage circuit** [210.11(C)(4)] — **2020 addition, not in NEC 2017**; may also feed readily accessible outdoor receptacles.
- **General lighting load: 3 VA/sq ft** of floor area — NEC 2023 **220.41** (renumbered from Table 220.12 in 2017/2020; [electricianprep load-calc reference](https://electricianprep.co/learn/load-calculation)). Small-appliance and laundry circuits: 1500 VA each [220.52]. Minimum dwelling service 100 A [230.79(C)]; 150–200 A typical today (approximate guidance).

## 9. What is approximate vs. hard code

**Hard geometric code (safe to enforce):** 6 ft/12 ft wall rule and its break list; 2 ft min wall; 18 in floor-receptacle credit; 5½ ft counting ceiling; 24/48 in counters; 12 in counter minimum; 20 in above counter; 3 ft/12 in bathroom; 6½ ft outdoor; 10 ft hallway; 60 ft²/3 ft foyer; garage per-bay/5½ ft; 6-riser stairway switches; 410.16 clearances.

**Approximate/convention (flag in UI):** receptacle 15 in AFF and switch 48 in AFF (convention + ANSI A117.1 reach, not NEC); switch-at-every-entry and generic 3-way pairing; smoke-alarm cooking clearances (edition-dependent); state adoption table (changes yearly, AHJ can differ); service size guidance. **Edition-dependent:** island receptacles (2017 required / 2020 per-9-ft² / 2023 optional+provision), kitchen-wide GFCI (2023), garage circuit (2020+), wall-space breaks at appliances/cabinets (2023).

## Sources consulted

- Mike Holt Enterprises, *Understanding the 2023 NEC Vol. 1*, §210.52 excerpt — https://www.mikeholt.com/files/PDF/23_UNEC1_210.52.pdf (primary basis for §2)
- UpCodes, Dwelling Unit Receptacle Outlets — https://up.codes/s/dwelling-unit-receptacle-outlets
- Callout NEC 2023 references — https://www.callout.app/codes/nec-2023-210-8, …/nec-2023-210-11, …/nec-2023-210-12
- Building Code Geek, NEC 410.16 — https://buildingcodegeek.com/closet-lighting-code-requirements-nec-410-16/
- Faraday, NEC adoption by state — https://faradaycrew.com/resources/nec-adoption-by-state; NFPA enforcement maps — https://www.nfpa.org/education-and-research/electrical/nec-enforcement-maps
- SYGFCI, 2023 kitchen GFCI change — https://sygfci.com/2026/07/16/gfci-within-6-feet-of-sink-nec-210-8-a-kitchen-rule/
- Leviton Captain Code, 210.11(C)(4) — https://captaincode2020.leviton.com/node/132; Mike Holt forum thread — https://forums.mikeholt.com/threads/2020-nec-210-11-c-4-garage-branch-circuit.2555830/
- ICC, IRC 2021 R314.3 — https://codes.iccsafe.org/s/IRC2021P3/part-iii-building-planning-and-construction/IRC2021P3-Pt03-Ch03-SecR314.3
- Electrician Prep, NEC 220 load calculation — https://electricianprep.co/learn/load-calculation
- Electrical License Renewal NEC content (210.52/210.70 summaries surfaced via search) — https://www.electricallicenserenewal.com/Electrical-Continuing-Education-Courses/NEC-Content.php
