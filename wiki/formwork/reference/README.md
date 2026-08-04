# Formwork Domain Reference

Captured domain research backing the formwork feature. These are **reference material, not architecture rules** — they record what the standards, vendor catalogs, and published literature actually say, so the engine in `packages/core/src/systems/formwork/` can be checked against a source rather than against someone's recollection.

## Pages

| Page | Covers |
|---|---|
| [design](design.md) | Lateral concrete pressure (ACI 347 / DIN 18218 / CIRIA 108), component design chain (sheathing → joist → waler → tie → bracing), striking times and cycles, surface finish classes, the full input list a design tool must collect |
| [products](products.md) | Modular panel systems (PERI TRIO, Doka Framax) with panel sizes and tie-hole geometry, conventional ply + timber, ties and props, cut optimisation practice, costing and rental structures, the proposed catalog data model |
| [coverage](coverage.md) | Which faces need formwork and why, pour sequencing and lifts, what existing software does, exhaustive edge-case list, the proposed coverage algorithm |

## Confidence is not uniform — read the markers

Numbers in these files carry different levels of verification, and the code must preserve the distinction rather than flatten it. Every `CatalogEntry` therefore carries a `verification` field and every capacity a `capacityBasis`.

- ⚠️ — secondary source
- ❌ — unverified
- **DIN 18218 tE-correction slopes** (F1 0.030 / F2 0.053 / F3 0.077 / F4 0.140) were reverse-engineered by probing PASCHAL's public calculator, because the standard is paywalled. They reproduce that calculator exactly, but they are *derived*. The non-round values suggest DIN tabulates discrete tE columns that the calculator interpolates.
- **Vendor capacity conflicts are real, not transcription errors.** H20 beams are quoted as 5 kNm / 11 kN / 450 kNm² (Doka, permissible) and 11 kNm / 24 kN / 460 kNm² (PERI-branded sheets, design resistance). DW20 appears as 140, 150 and 160 kN. Treating a design resistance as permissible is a factor-of-2 error in the unsafe direction.
- **Metric and imperial ACI paths give different answers by design** (600 psf rounds *up* to 30 kPa; 14 ft rounds *down* to 4.2 m). Do not unify them by conversion.

## Buy or verify before presenting any of this as a certified design

Ranked by risk.

| # | Item | Why it matters |
|---|---|---|
| 1 | **DIN 18218:2010-01** | The tE correction table. Currently derived, not transcribed. Highest-risk item. |
| 2 | **CIRIA R108** (~£50) | The `C1`/`C2` table. Weakest number in the set. |
| 3 | **Metric film-faced ply design values** (`f_m`, rolling shear, `E_mean`, span tables) | Genuinely product-specific — Metsä WISA-Form / UPM / Doka 3-SO datasheets, or EN 13986 / EN 789 declarations. Must be material-library inputs, never hardcoded. |
| 4 | **EN 13670:2009 §5.5** | Formwork removal and tolerance classes. Needed before claiming EN coverage. |
| 5 | **CESMM Class G** and **POMI** clause text | Needed before shipping those measurement standards. |
| 6 | **H20 capacity basis per vendor** | Resolve the permissible-vs-design conflict above. |
| 7 | **PERI SRS / QUATTRO / SKYDECK / MULTIFLEX, Doka Frami** tables | Unverified; fetch the product data sheets. |
| 8 | **The 250 kN/m² DIN ceiling** | May be a calculator or system limit rather than a DIN limit. |
| 9 | **`topFormAngleThreshold`** | No cited numeric threshold found for when a sloping top must be formed. Ships configurable, default 10°. |

## Source URLs

`design.md` §6 and `products.md` carry the fetched source URLs per claim. ACI 347R-14 and NRM2 primary PDFs could not be parsed during capture (no PDF renderer available); the ACI formulas were corroborated from the ACI-04 full text and Hurd (2007).
