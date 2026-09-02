# Climatic & Geographic Design Parameters by State

Research for the Bones foundation/roof/framing engines. Companion dataset: [`data/jurisdictions-climate.json`](../../data/jurisdictions-climate.json) (51 entries: 50 states + DC).

> **Disclaimer:** Drafting aid, not engineering. These are *state-typical* values; the numbers that legally govern a site come from **IRC Table R301.2(1)**, which each local jurisdiction fills in — always verify with the AHJ. Entries **AL–MO + DC were reconstructed on 2026-08-13** (the original climate-a research output was lost before merge); each carries a per-entry `caveat` in the dataset.

## The parameters

| Field | Type | What it is |
|---|---|---|
| `frostLineIn` | number (inches) | Frost penetration depth — how deep the ground freezes. Footings must bear below it or they heave (IRC R403.1.4.1). ~12 in in the Gulf South, 30–42 in mid-Atlantic/midwest, 48–72 in MN/ND/ME/AK. |
| `groundSnowLoadPsf` | number (psf) | ASCE 7 ground snow load *pg* — the roof's design snow weight. 0 in FL/HI, 50–60+ in New England/upper midwest; mountain "case-study zones" (Sierra, Cascades, Rockies, Wasatch) can exceed 100–300 psf. |
| `ultimateWindMph` | number (mph) | ASCE 7 ultimate design wind speed *Vult*, Risk Category II. ~105–115 mph inland; 130–180 mph on hurricane coasts (FL/TX/LA/MS/NC/SC + New England islands), with wind-borne-debris opening protection near the coast. |
| `seismicSdc` | string | Seismic Design Category (A–E) for typical site class. A–B: prescriptive framing fine. C: some restrictions. **D+**: engineered lateral design territory — shear walls, hold-downs, tighter anchorage. |
| `flags` | object | Booleans the engines read directly: `hurricaneTies`, `seismicHoldDowns`, `hvhz` (FL High-Velocity Hurricane Zone), `deepFrostFootings` (frost ≥ ~36 in). |
| `termiteRisk`, `weatheringPotential` | string | IRC R301.2 map categories (slight → very heavy; negligible → severe). Informational today — future hooks for treated-sill and concrete-cover rules. |
| `*Note` fields | string | Human-readable range/context per state (frost, snow, wind, seismic) — surfaced as profile notes in the panel UI. |

## How the engines use them

`src/jurisdiction/profiles.ts` merges this dataset with `jurisdictions-adoption.json` into a `JurisdictionProfile`, and `applyJurisdiction()` modulates the `FramingSpec` (LOD 300):

1. **Footing depth = max(12 in, `frostLineIn`)** — the foundation engine digs footings to the frost line, never shallower than the IRC 12 in minimum (R403.1.4 / R403.1.4.1). This is why a Minnesota slab-edge footing renders 42 in deep and an Alabama one 12 in.
2. **Anchor-bolt spacing tightens in SDC D** — sill anchorage drops from 6 ft o.c. (IRC R403.1.6 baseline) to 4 ft o.c. when `seismicHoldDowns` is set (SDC D+ states: CA, AK, HI, NV, OR, UT, WA — state amendments commonly require 4 ft + 3×3 plate washers), and the foundation engine adds hold-downs at shear-wall ends.
3. **Hurricane ties at `ultimateWindMph` ≥ 130** (or the explicit `hurricaneTies` flag) — the roof engine adds rafter-to-plate uplift connectors (H2.5-style) in hurricane-prone states (FL, LA, MS, TX, SC, NC, GA, NJ, NY, RI, CT, DE, MA, HI, AL).
4. **Rafter sizing bumps with snow** — the default rafter steps 2x6 → **2x8 at pg ≥ 50 psf** → **2x10 at ≥ 70 psf**, because the R802.4.1 span tables shrink fast under load (a 2x6 that spans ~13 ft at 20 psf drops under 10 ft at 70 psf). The framing-tables dataset then does exact span checks.

Missing states fall back to conservative defaults (frost 12 in, snow 20 psf, wind 115 mph, SDC B) — with all 51 entries present the fallback should never fire; `flags` also backstop-derive from the numbers (`hurricaneTies` from wind ≥ 130, `seismicHoldDowns` from SDC D–F).

## Sources

- [ASCE 7 Hazard Tool](https://ascehazardtool.org/) and [ATC Hazards by Location](https://hazards.atcouncil.org/) — wind, snow, seismic values by address.
- [USGS Seismic Design Maps](https://www.usgs.gov/programs/earthquake-hazards/science/seismic-design-maps) — SDC derivation.
- [IRC 2021 Chapter 3](https://codes.iccsafe.org/content/IRC2021P2/chapter-3-building-planning) — Table R301.2(1) criteria, frost (R403.1.4.1), termite/weathering maps.
- [FEMA Building Science / code adoption](https://www.fema.gov/emergency-managers/risk-management/building-science/building-codes).
- State code programs consulted for statewide values: [Ohio OAC 4101:8](https://codes.ohio.gov/ohio-administrative-code/rule-4101:8-4-01), [PA UCC](https://www.dli.pa.gov/ucc/Pages/default.aspx), [Wisconsin UDC](https://dsps.wi.gov/Pages/Programs/UniformDwelling/Default.aspx), [Florida Building Code](https://floridabuilding.org/) (HVHZ), [Minnesota DLI](https://www.dli.mn.gov/business/codes-and-laws) (frost/snow zones), [Massachusetts BBRS](https://www.mass.gov/orgs/board-of-building-regulations-and-standards).
- [USU Extension](https://extension.usu.edu/) (Utah snow studies), [WBDG](https://www.wbdg.org/).
