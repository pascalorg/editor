---
id: 003
title: Unit registry & conversion
status: approved
created: 2026-07-03
updated: 2026-07-07
---

# Unit registry & conversion

## Definitions

```ts
interface UnitDef {
  id: string            // stable id, unique within kind: 'm', 'ft', 'C', 'KiB'
  symbol: string        // preferred display symbol: 'm', 'ft', '°C', 'KiB'
  name: string          // singular long name: 'meter'
  plural?: string       // default name + 's'; 'feet', 'inches' set explicitly
  factor: number        // toBase(x) = x*factor + offset
  offset?: number       // temperature only in v0.1
  aliases?: string[]    // additional parse strings (lowercase unless caseExact)
  caseExact?: string[]  // aliases that match ONLY case-sensitively ('mm' vs 'Mm', 'b' vs 'B')
  system: 'metric' | 'us' | 'imperial' | 'shared'
  subunit?: { unit: string, per: number }   // compound continuation: ft→{in,12}, h→{min,60}, m→{cm,100}
  intl?: string         // Intl.NumberFormat sanctioned unit id when one exists ('meter')
  best?: number         // toBest threshold weight; undefined = excluded from best-fit ladder
}

interface KindDef {
  kind: Kind
  baseUnit: string
  units: UnitDef[]
}
```

Registry API (`src/core/registry.ts`):

- `createRegistry(kinds: KindDef[])` → lookup structures (alias→candidates map built once,
  lazily on first parse; candidates ranked).
- `registerKind(reg, kindDef)` / `registerUnits(reg, kind, units)` — user extension:
  custom kinds (e.g. currency with static rates) and house units get first-class
  parsing/formatting/suggestions for free.
- `defaultRegistry` — all built-in kinds (main entry); `@pascal-app/lingo/core` exports the
  engine with an empty registry for BYO-data builds.

## Alias resolution order

1. Exact string match against `caseExact` aliases (data units, metric-prefix hazards).
2. Case-insensitive match against alias map. If multiple kinds claim the alias
   (`oz` mass|volume, `'` length|angle, `m` length|duration-slang):
   - kind context (option `kind` or surrounding compound/range kind) decides;
   - else ranked by per-alias priority list (declared in data: `oz`→mass first),
     winner returned, losers become `alternatives`.
3. Multi-word aliases matched longest-first (`fluid ounce`, `metric ton`, `sq ft`,
   `nautical mile`, `degrees celsius`, `light year`).
4. No match → typo pass: bounded Damerau–Levenshtein over alias keys (≤1 edit for
   len 3–4, ≤2 for len ≥5; len ≤2 never fuzzy-matched — too dangerous: `m`→`mm`).
   Within-kind-context candidates first. Result: `UNKNOWN_UNIT` error with
   `suggestions` (max 3), or auto-accept when exactly one candidate at distance 1
   AND kind context matches → success + `TYPO_CORRECTED` warning.

## Hazard table (encode as tests)

| input | trap | resolution |
|-------|------|------------|
| `mm` vs `Mm` | milli vs mega meter | `Mm` caseExact; lowercase path → mm |
| `Mg` vs `mg` | mega vs milli gram | `Mg` caseExact megagram (=tonne magnitude); lowercase/sloppy `MG` → mg |
| `mHz` vs `MHz` | milli vs mega hertz | `mHz` caseExact millihertz; sloppy `mhz`/`MHz` → megahertz |
| `mPa` vs `MPa` | milli vs mega pascal | `mPa` caseExact millipascal; sloppy `mpa`/`MPa` → megapascal |
| `Mbar` vs `mbar` | mega vs milli bar | `Mbar` caseExact megabar; `mbar` → millibar |
| `mJ` vs `MJ`, `mWh` vs `MWh` | milli vs mega joule / watt-hour | `mJ`/`mWh` caseExact; `MJ`/`MWh` → mega |
| `ML` vs `mL` | mega vs milli liter | **megaliter NOT registered** — `ML` is also the common casual milliliter spelling ("250 ML"), so there is no safe silent default; `ML`/`mL`/`ml` → milliliter until an explicit disambiguation lands |
| `mb` / `MB` / `Mb` / `MiB` | byte-vs-bit, deci-vs-binary | caseExact `Mb`(=megabit), `MB`; lowercase `mb` → MB with `AMBIGUOUS_UNIT` warning (bit alternative) |
| `oz` | avoirdupois mass vs fluid volume | priority mass; volume kind context → fl oz |
| `t` | metric tonne vs short ton | tonne (metric); `ton` → short ton under system 'us', long under 'imperial'; always emit warning naming the chosen one |
| `'` `"` | feet/inches vs arcmin/arcsec vs quote chars | length priority; angle kind context wins for ′ ″ after degrees (`5° 30′`) |
| `m` | meter vs minute (chat slang) | meter; duration kind context → minute + `SLANG_UNIT` warning |
| `min` | minute vs minim | minute always (minim excluded from v0.1) |
| `C` | Celsius vs coulomb | Celsius by default; `kind:'charge'` resolves coulomb; `coulomb(s)` is unambiguous |
| `M` / `uM` / `µM` | molarity vs meter/micrometer | exact-case concentration shorthands; lowercase `m`/`um` stay length |
| `mol/L` | declared concentration vs general unit algebra | accepted as a finite concentration unit family; this does not enable arbitrary unit expressions |
| `m/s²`, `N*m`, `cd/m²` | declared quotient/product units vs general unit algebra | accepted only as finite units in their own kinds; arbitrary expressions still fail |
| `g` | gram vs standard gravity | gram by default; acceleration uses `g0`, `gee`, or `standard gravity` |
| `Nm` / `nm` | torque newton-meter vs nanometer | `Nm`/`kNm` are exact-case torque aliases; lowercase `nm` remains nanometer |
| `rad` | radian vs legacy radiation absorbed dose | radian only; radiation absorbed dose uses `Gy`/`gray` and keeps `rad` deferred |
| `Gy`, `Sv`, `Bq`, `Ci` | radiation symbols are case-sensitive | exact-case symbols only; lowercase forms fail unless written as words (`gray`, `sievert`, `becquerel`, `curie`) |
| `V/A`, `C/s`, `Ω*m` | dimensional expressions vs simple unit refs | out of scope until dedicated unit-expression models exist; fail with explicit issues |
| `gal` | US vs imperial gallon | system option (`'us'` default) + warning listing the other |
| `cup` | US legal 240 mL vs US customary 236.588 vs metric 250 | US customary; others as `cup-metric` etc. |
| `mile` | statute vs nautical | statute; lowercase `nm` is nanometer, `nmi`/`nautical mile` → nautical mile, uppercase `NM` remains deferred |
| `st` | stone vs street | stone under mass context only; never free-text |
| `"in"` | inch vs preposition | inch only in terminal/unit-slot position (plan 004 §unit-slot rule) |

## Conversion semantics

- `convert(q, targetUnit)`: same-kind check → `KIND_MISMATCH` error otherwise
  (message suggests correct kinds; e.g. converting kg→cm explains it can't).
- Affine (temperature): absolute by default. `convertDelta(q, target)` uses factor only;
  docs call out "increase OF 5°F" vs "temperature of 5°F".
- Precision: factors stored at full float64 from authoritative exact values
  (international yard & pound agreement: 1 yd = 0.9144 m exact, 1 lb = 0.45359237 kg
  exact, 1 in = 0.0254 m exact; 1 gal US = 3.785411784 L exact; imperial gal =
  4.54609 L exact; °F factor 5/9 as expression not decimal literal).
- `sameQuantity(a, b, tolerance = 1e-9 relative)` helper for tests/round-trips.

## Kind coverage

length (nm→light year incl. thou, hand, fathom, furlong, survey foot flagged),
mass (mg→tonne incl. stone, troy oz flagged separate ids), temperature (K, °C, °F,
°R), duration (ns→century; month/year in duration context use the Julian/UCUM
convention — year = 365.25 d, month = 30.4375 d — with `CIVIL_AVERAGE` info issue;
calendar date arithmetic in the date module is unaffected), volume (µL→m³ plus
tsp/tbsp/cup/fl oz/pt/qt/gal and cubic feet), area (mm²→km², acre, hectare,
sq ft/yd/mi with real-estate `sf`), speed (m/s, km/h, mph, knot,
ft/s plus spoken quotient aliases such as `miles an hour`), data (b→PiB, decimal+binary,
case-exact rules), data_rate (bit/s plus kbit/Mbit/Gbit/Tbit and byte-per-second
families; bare `bps` remains percent basis points), flow_rate (m³/s plus L/s,
L/min, mL/min, gpm, cfm/cfs, and m³/h; arbitrary unit algebra remains out of scope),
pressure (Pa→hPa/mbar/kPa/MPa, bar, atm, psi, mmHg, inHg, torr,
cmH₂O/inH₂O/mH₂O water-column units, kgf/cm²/technical atmosphere), energy (J→kWh, cal/kcal,
BTU, eV), force (N plus SI scales, dyn, lbf, kgf), torque (N⋅m, kN⋅m,
lbf⋅ft), power (W plus SI scales, hp, PS, Btu/h), frequency (Hz plus SI scales,
rpm), angle (rad, deg, gon, arcmin, arcsec, turn), acceleration (m/s², cm/s²,
ft/s², standard gravity via `g0`/`gee`), luminous intensity (cd), luminous flux
(lm), illuminance (lx plus foot-candle), luminance (cd/m², nit, foot-lambert),
voltage (µV→MV), current (µA→MA), resistance (mΩ→MΩ plus ohm/kohm/megaohm
words), charge (µC→kC plus Ah/mAh), substance amount (µmol→kmol),
concentration (mol/m³ base, M/mM/µM/nM/pM, mol/L, mmol/L, µmol/L), radiation
absorbed dose (Gy/mGy/µGy), radiation equivalent dose (Sv/mSv/µSv/rem), and
radioactivity (Bq/kBq/MBq/Ci/mCi/µCi). Dimensional expressions remain out of
scope until a separate kind/model decision.

## Research addenda (units study, 2026-07-03) — binding corrections & data

Full report: `wiki/research/units-libraries.md`. Non-negotiables for the data tables:

1. **Exact legal definitions only** — never rounded anchors (convert-units' 3.28084
   and js-quantities' fathom=1.829 drift bugs). Canonical exact factors (SI base):
   in 0.0254 · ft 0.3048 · yd 0.9144 · mi 1609.344 · nmi 1852 · survey ft 1200/3937
   (expression, not decimal) · lb 0.45359237 kg · oz lb/16 · stone 14·lb · grain
   64.79891 mg · troy oz 31.1034768 g · carat 0.0002 kg · short ton 907.18474 ·
   long ton 1016.0469088 · tonne 1000 · US gal 3.785411784 L · imp gal 4.54609 L ·
   US fl oz gal/128 = 29.5735295625 mL · imp fl oz 28.4130625 mL · nutrition fl oz
   30 mL (distinct id) · US cup gal/16 = 236.5882365 mL · legal cup 240 mL · metric
   cup 250 mL · imp cup 284.130625 mL · US tbsp gal/256 · US tsp gal/768 · metric
   tbsp 15 mL · tsp 5 mL · acre 4046.8564224 m² · hectare 10⁴ · knot 1852/3600 m/s ·
   psi 6894.757293168 Pa · atm 101325 · bar 1e5 · mmHg 133.322387415 · inHg
   3386.388640341 · cal (thermochemical) 4.184 J · kcal 4184 · BTU (IT)
   1055.05585262 · eV 1.602176634e-19 · kWh 3.6e6 · deg π/180 · arcmin π/10800 ·
   arcsec π/648000 · gon π/200 · turn 2π. Write factors as expressions where the
   cmH₂O 98.0665 · inH₂O 249.08891 · mH₂O 9806.65 · kgf/cm² 98066.5. Write
   factors as expressions where the ratio is the definition (5/9, 1200/3937,
   1852/3600, Math.PI/180).
2. **Data units**: decimal kB/MB/GB = 1000ⁿ; IEC KiB/MiB… = 1024ⁿ; **uppercase "KB"
   accepted as decimal** (what UIs print); `caseExact`: `Mb/Gb/Tb/Kb` = bits,
   `B` = byte, `b` = bit; lowercase `kb/mb/gb` → bytes + `AMBIGUOUS_UNIT` warning
   naming the bit alternative; file-size slang `gig`/`gigs` → gigabytes (`GB`),
   while exact-case `Gb` remains gigabits. No JEDEC 1024-KB mode in v0.1
   (roadmap: opt-in).
3. **Alias craft from js-quantities** (the best table shipped): UK spellings
   (metre/litre/gramme), `mc` + `u` + both µ codepoints for micro, `#` for pounds,
   digit exponents (`m2`, `m^2`, `m²` — normalizer folds ²→2), `cc`, `ℓ`; plus what
   nobody ships (our greenfield): spaced `sq ft`, `cbm`, `fl. oz.`, primes, `℃`.
4. **Collision policy**: registry build throws on duplicate alias within a kind and
   on cross-kind duplicates not present in the hazard whitelist (js-quantities'
   silent `pt` point/pint shadowing is the cautionary tale).
5. **toBest**: adopt convert-units' `cutOff` knob (default 1) + UnitMath's per-unit
   eligibility (only units with `best` set participate — no decameters, no
   fathoms), stay-in-system rule confirmed.
6. **Temperature arithmetic rules** (js-quantities matrix): absolute↔absolute via
   offsets; delta path for range *widths* (a 5 °C-wide range is a 9 °F-wide range,
   never via offsets). Encode as convert tests.
7. **Credit in wiki/inspiration.md**: js-quantities table craft descends from
   ruby-units (Kevin Olbrich) — credit both.

Every unit ships: symbol variants users actually type (`′ ″ ' " ’ ”`, `°C ℃ ºC degC
"degrees C"`, `µm μm um`, `m2 m² sqm "sq m"`), full singular/plural words, common
misspellings meters/metres, liter/litre, gram/gramme.
