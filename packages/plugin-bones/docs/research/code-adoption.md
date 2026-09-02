# US Residential Building-Code Adoption by State

Research for the Bones inference engines (framing / electrical / plumbing / HVAC). Companion dataset: [`data/jurisdictions-adoption.json`](../../data/jurisdictions-adoption.json).

> **Disclaimer:** Drafting aid, not engineering. Typical/approximate values — verify with the local authority having jurisdiction (AHJ). Researched 2026-08-13; adoption status changes constantly.

## 1. How US residential codes work (the 60-second model)

There is **no national building code** in the US. A private nonprofit, the International Code Council (ICC), publishes model codes on a 3-year cycle — for houses, the **International Residential Code (IRC)** (editions: 2015, 2018, 2021, 2024). Model codes have no legal force until a state or local government **adopts** them, almost always **with amendments** ([UpCodes state pages](https://up.codes/codes/alabama), passim).

Adoption patterns fall into three buckets:

1. **Statewide-mandatory** (majority of states): a state agency, board, or the legislature adopts one IRC edition + a state amendment package. Some forbid local amendment entirely (CT — "adopted at the state level and cannot be amended locally" per [UpCodes CT](https://up.codes/codes/connecticut); also IN, VA, NJ, OR); others let locals amend upward (CA, WA, GA, MD).
2. **Statewide code, local-option enforcement**: the state defines the code but towns choose to (or are too small to) enforce it — Maine (enforcement mandatory only in municipalities >4,000 pop., [UpCodes ME](https://up.codes/codes/maine)), Minnesota (residential enforcement optional outside the Twin Cities metro), Montana (1–2 family permits only in "certified" local jurisdictions), West Virginia (county opt-in), North Dakota, Iowa, Tennessee (local opt-out by 2/3 vote).
3. **Local adoption** (~14 jurisdictions in our dataset): no statewide residential code — each city/county picks its own edition and amendments. **Texas** (IRC "as it existed on May 1, 2012" is the statutory municipal baseline; cities adopt newer editions by ordinance; unincorporated areas largely unregulated — [Tex. Loc. Gov't Code §214.212](https://texas.public.law/statutes/tex._local_gov%27t_code_section_214.212)), **Missouri**, **Colorado** ("home rule" cities/counties, [UpCodes CO](https://up.codes/codes/colorado)), **Kansas** ("home rule state; the responsibility for adoption and enforcement… lies with local jurisdictions", [UpCodes KS](https://up.codes/codes/kansas)), plus AZ, AK, DE, IL (until the 2025 statewide backstop), MS (opt-in/opt-out), NV, SD, VT, WV, WY.

Two states are special: **Wisconsin** uses its own state-written **Uniform Dwelling Code** (SPS 320–325) rather than the IRC ([UpCodes WI](https://up.codes/codes/wisconsin)) — different table numbering, different bracing rules. **Florida** publishes the standalone **Florida Building Code — Residential** (8th ed. 2023, 2021 IRC base, eff. 2023-12-31, [FBC-R 8th](https://up.codes/viewer/florida/fl-residential-code-2023)) with hurricane provisions woven throughout and extra-strict **HVHZ** rules in Miami-Dade and Broward.

## 2. Does framing practice change by state or by zip code?

**Both, in different ways — and this is the key architectural insight for Bones:**

### 2a. The *rulebook* (code edition + amendments) is mostly chosen at the state level

37 of 51 jurisdictions in our dataset have a statewide-adopted residential code. So "which IRC edition and which amendment package" is primarily a **state-level lookup**. The 14 local-adoption states (TX, MO, CO, KS, AZ, AK, DE, IL, MS, NV, SD, VT, WV, WY) need a city/county-level lookup — but even there, jurisdictions pick from the same small menu of IRC editions (2012–2024), so a representative default per state (with a "verify locally" flag) is a sound fallback.

Prescriptive framing between IRC editions 2015→2024 is *evolutionary*, not revolutionary: span tables shifted slightly with updated lumber design values (notably the 2013 Southern Pine downgrades), wall-bracing and deck provisions got refined, and wind maps moved to newer ASCE 7 editions. A framing inference engine keyed to "generic modern IRC" is a reasonable approximation across editions — flag, don't fork, per edition.

### 2b. The *numbers you plug into the rulebook* vary by county/city — sometimes by zip

Every IRC-family code has a **Table R301.2(1) "Climatic and Geographic Design Criteria"** that the local jurisdiction fills in. These locally-determined values are what actually change framing outputs within a state:

- **Ground snow load (Psf)** — drives rafter/ridge sizing. Varies enormously within states (CO front range ~30 psf vs mountain towns 75–150+; UT and MT publish their own elevation-based snow studies replacing map values).
- **Ultimate design wind speed (Mph)** — drives wall bracing, sheathing nailing, uplift connectors. Coastal counties in FL/TX/LA/NC/SC sit in 140–180 mph zones with wind-borne-debris opening protection; inland ~105–115 mph. Texas coastal counties additionally have the TDI/TWIA windstorm certification regime (2024-IRC-based standard eff. 2026-04-01, [UpCodes TX](https://up.codes/codes/texas)).
- **Seismic Design Category** — SDC D0–E (much of CA, western WA/OR, Wasatch Front UT, Charleston SC, New Madrid MO/TN/AR) restricts prescriptive framing and forces engineered lateral design; SDC A–B (most of the east/midwest) doesn't.
- **Frost line depth (In)** — sets footing depth: ~12 in in the Gulf South, 30–42 in mid-Atlantic/midwest, 48–60+ in MN/ND/ME/AK. County or municipal amendment territory.
- **Weathering, termite exposure, ice-barrier underlayment, flood zones** — same table, same local variation.

So: **adoption is (mostly) state; loads are local.** A zip/county resolver for climatic values matters *more* for framing correctness than tracking every local amendment. FEMA's Building Code Adoption Tracking (BCAT) tracks this at the community level (fema.gov blocks automated fetch; portal: `fema.gov/emergency-managers/risk-management/building-science/bcat`).

### 2c. Recommended two-layer model for Bones

1. **Layer 1 — jurisdiction/adoption (state key, this dataset):** IRC base edition, amendment flavor, special regimes (HVHZ, WUI, energy code, windstorm).
2. **Layer 2 — site design values (county/lat-long key, separate dataset):** snow, wind, seismic, frost, termite. Source from ASCE 7 Hazard Tool / ATC hazard maps and state amendment tables, not from the adoption layer.

## 3. State-by-state highlights (verified 2026-08-13)

Editions below were confirmed against UpCodes adoption records (which mirror ICC Digital Codes) and state sources; full detail incl. effective dates is in the JSON.

**On the 2024 IRC already (6):** GA (eff. 2026-01-01, skipped 2021 — [UpCodes GA](https://up.codes/viewer/georgia/irc-2024)), NY (2025 RCNYS eff. 2025-12-31 — [UpCodes NY](https://up.codes/viewer/new_york/irc-2024)), CA (2025 CRC, Title 24 Part 2.5, eff. 2026-01-01 — [CA BSC](https://www.dgs.ca.gov/BSC/Codes); CRC base is the 2024 IRC), IA (eff. 2025-09-10), ND (eff. 2026-01-01), NH (eff. 2026-07-01). MD boards began adopting 2024 editions Nov 2025 (MBPS-wide status: verify). MS designated the 2024 IRC (eff. 2025-01-01) for opt-in jurisdictions.

**On the 2021 IRC (largest cohort):** AR, CT, FL (FBC-R 8th), LA, ME (MUBEC eff. 2025-04-07), MD (MBPS eff. 2023-05-29), MA (780 CMR 10th ed. eff. 2024-10-11), MI (2021 MRC eff. **2025-08-29** — recent!), MT, NJ, NM, OR (2023 ORSC), PA (eff. **2026-01-01** — just switched from 2018), RI (eff. **2025-12-01**), SC, UT, VA, WA, and CO/HI as representative bases.

**On the 2018 IRC:** AK (AHFC), ID (2020 Idaho code), IN (2020 Indiana code), MN (2020 MN code), NE, OK (eff. 2022-09-14), TN, WV, and AZ/DE/KS/MO/WY as representative local bases.

**Still on the 2015 IRC:** **AL** (2015 Alabama Residential Code, eff. 2016 — [UpCodes AL](https://up.codes/viewer/alabama/irc-2015)), **KY** (the "2018 Kentucky Residential Code" is *named* 2018 but *based on the 2015 IRC* — trap!), **NC** (2018 NCRC = 2015 IRC base; the 2024 NCRC (2021 base) has been postponed repeatedly by session law — [UpCodes NC](https://up.codes/viewer/north_carolina/irc-2015)), **DC** (2017 DC Codes = 2015 I-codes, eff. 2020).

**No IRC at all:** WI (state-written UDC), VT (no state residential code for detached 1–2 family; only RBES energy standards statewide).

### Special regimes an inference engine should know about

- **FL HVHZ** (Miami-Dade/Broward): impact protection, enhanced uplift, product approval.
- **CA Chapter 7A / WUI**: ignition-resistant exterior assemblies in Fire Hazard Severity Zones; CO stood up a Wildfire Resiliency Code Board (2025) for mapped WUI areas.
- **TX coastal windstorm (TDI/TWIA)** and **industrialized housing (2021 IRC, eff. 2024-07-01)** run on their own IRC editions independent of city codes.
- **Energy codes** often ride a different edition than the building code (e.g., WA's state-written energy code; IL statewide energy + plumbing codes despite local building adoption; TN's reduced energy requirements).
- **NYC** has its own construction codes, separate from the NYS Uniform Code.

## 4. What is approximate in the dataset (read before trusting)

- **Local-adoption states**: `ircBase` is a *representative* metro value, not a guarantee (flagged in each `note`). TX/CO/MO especially — the same house design may face 2015 IRC in one suburb and 2024 in the next.
- **Alabama**: UpCodes still shows the 2015 base as current; the Energy & Residential Codes Board has been reviewing newer editions — verify.
- **Hawaii**: state adopted 2018 (and recorded a 2021 adoption in 2022), but county codes control and lag; Honolulu practices on the 2018 base.
- **Maryland**: MBPS 2021 confirmed; a 2024 MBPS update appeared imminent (plumbing board already on 2024 IRC, eff. 2025-11-24).
- **North Carolina**: the 2024 NCRC (2021 base) is adopted-but-postponed; legislative delays (S.L. 2024-57, S.L. 2025-2) make its effective date volatile.
- **Illinois**: the 2025 statewide backstop exists ([CDB](https://cdb.illinois.gov/business/codes.html)) but CDB's designated editions weren't verifiable from the page — 2021 assumed.
- **Effective-date cliffs around now**: PA (2026-01-01), GA (2026-01-01), NH (2026-07-01), NY (2025-12-31), ND (2026-01-01), NJ (2024-base subcode expected 2026-08-17). Projects permitted under transition provisions may legally use the prior edition.
- **Enforcement ≠ adoption**: many "state" rows (ME, MN, MT, IA, ND, TN, OK, AL) have thin-to-zero rural enforcement; the code still nominally applies.

## 5. Sources

Primary/authoritative consulted: [Texas Loc. Gov't Code §214.212](https://texas.public.law/statutes/tex._local_gov%27t_code_section_214.212) (texas.public.law mirror; statutes.capitol.texas.gov is JS-only), [California BSC](https://www.dgs.ca.gov/BSC/Codes), [Oregon BCD adopted codes](https://www.oregon.gov/bcd/codes-stand/Pages/adopted-codes.aspx), [WA State Building Code Council](https://sbcc.wa.gov/), [Illinois CDB](https://cdb.illinois.gov/business/codes.html), [Ohio Admin. Code 4101:8](https://codes.ohio.gov/ohio-administrative-code/4101:8), [MN DLI codes](https://www.dli.mn.gov/business/codes-and-laws). Per-state adoption records: UpCodes state pages and adoption viewers (full URL list in the JSON `sources` array) — UpCodes mirrors official adoption filings incl. links to ICC Digital Codes and state registers (e.g., Michigan Register No. 10-2025 for the 2021 MRC, eff. 2025-08-29). ICC's own adoption map (`iccsafe.org/advocacy/code-adoption-map/`) and FEMA BCAT block automated access; they are the canonical cross-checks for a human reviewer.
