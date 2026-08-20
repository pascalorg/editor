# Prior-art study: unit/measurement libraries

Research pass 2026-07-03 (background agent, source-level study). Libraries: convert-units v3 (main) + v2.3.4 (npm latest), js-quantities 1.8.0, UnitMath 1.1.1, mathjs 15.2.0, ECMA-402 Intl.NumberFormat (verified against Node ICU), libphonenumber-js 1.13.7. Factors re-verified arithmetically.

## API comparison

| Library | Parse | Convert | Format | Great | Clunky |
|---|---|---|---|---|---|
| convert-units | None (exact keys like `'fl-oz'`, `'nMi'`) | `convert(1).from('l').to('ml')`; `toBest({exclude, cutOffNumber, system})` | returns `{val, unit, singular, plural}` | tree-shakable measures; `possibilities()/describe()` for pickers; typed v3 | idiosyncratic keys (`Tbs`, `pnt`, `mu`, `μm` Greek); rounded anchors; npm latest is v2 (KB=1024) |
| js-quantities | Real string parser: `Qty('23 ft')`, `'1 m^2/s^2'`, `'1 m2 s-2'`, prefix composition; `Qty.parse()` null-safe | `.to()`, `.toBase()`, `.toPrec('0.1 m')`, checked arithmetic | `toString()`, `format()` | richest alias table (`'`, `"`, `#`, both µ, UK spellings); tempC/degC absolute-vs-delta split; `.kind()` | global table; rounded constants (fathom 1.829, furlong 201.2); `pt` collision; tropical year |
| UnitMath | `unit('40 km')`; `[value][num][/den]` grammar | `.to()`, `.simplify()` explicit | `config({precision, prefixMin, prefixMax, formatPrefixes})` | immutable factory config; per-unit formatPrefixes whitelist; custom units first-class | small built-in set; one-slash grammar |
| mathjs | full expressions incl. `'80 mi/h to km/h'` | `.to()`, `.toNumber()`, **`.splitUnit(['ft','in'])`** | `format({precision})`; auto-prefix unless `fixPrefix` | widest grammar; runtime `createUnit`; splitUnit = only prior art for 5'11" output; Fractions | huge; case traps (C=coulomb); temp arithmetic footguns; acre rounded |
| Intl.NumberFormat unit | none | none | 45 sanctioned units + `-per-` pairs; `formatRange(5,10)` → "5–10 kg"; formatToParts | free locale plurals/symbols (3′, 3″, -3°C, 5#) | no kelvin/knot/square-*; gallon always US; RangeError otherwise |
| libphonenumber-js | lenient extract default, `{extract:false}` strict; `findPhoneNumbersInText` with offsets | format-to-format | AsYouType incremental | **DX blueprint**: isPossible vs isValid tiers; reason codes; metadata tiers min/max/mobile/core | metadata regen burden |

## Conversion pitfalls catalog (all verified)

1. **Temperature absolute vs delta**: C = (F−32)×5/9. Factor-only gives 32°F→17.78°C (wrong: 0°C). Differences use factor only: 20°C change = 36°F change. js-quantities models both (`degC` delta vs `tempC` absolute) with forbidden-operations matrix (temp+temp throws, temp−temp→delta, temp×qty throws). mathjs docs admit "avoid calculations using celsius and fahrenheit". Anchors: −40°C=−40°F; Rankine offset 459.67.
2. **Three gallons**: US liquid = 231 in³ = 3.785411784 L exact; imperial = 4.54609 L exact (UK 1985 Act); US dry = 268.8025 in³ = 4.40488377086 L. imp/US = 1.20095. Most libs ship US only, silently.
3. **Fluid oz inversion**: US fl oz = gal/128 = 29.5735295625 mL exact; imp fl oz = gal/160 = 28.4130625 mL exact. US gallon smaller but US fl oz LARGER (128 vs 160 subdivisions). Nutrition-label fl oz = exactly 30 mL (21 CFR 101.9).
4. **Troy vs avoirdupois**: avdp oz = 453.59237/16 = 28.349523125 g exact; troy oz = 480 grains = 31.1034768 g exact (ratio 1.09714); troy lb (12 ozt) < avdp lb. Grain = 64.79891 mg both. **No JS unit lib ships troy oz** — 9.7% silent error for precious metals. Carat = 200 mg exact.
5. **Tons**: short 907.18474 kg; long 1016.0469088 kg; tonne 1000 kg. Ecosystem disagrees on `t`/`ton` (convert-units t=short; js-quantities t=metric). kiloton (short) vs kilotonne differ 10%.
6. **Nautical**: nmi = 1852 m exact (1929); knot = 1852/3600 m/s = 1.150779448 mph. convert-units' rounded anchor yields 1852.00132 m.
7. **Miles/mils**: intl mile 1609.344 exact; US survey mile 6 336 000/3937 = 1609.34721869 m; Scandinavian mil = 10 km; machinist mil (thou) = 25.4 µm. "mil" spans 9 orders of magnitude by culture.
8. **Binary vs decimal data**: drift Ki +2.4% → Pi +12.59%. convert-units v2 (npm latest) KB=1024; v3 KB=1000 — same call, different answers across versions. mathjs/js-quantities parse `kB`/`KiB` but NOT `KB` (what Windows prints). Mb vs MB ×8; mm vs Mm ×10⁹ — case is load-bearing; case-fold words, never symbols.
9. **US survey foot** = 1200/3937 m (2 ppm off intl; deprecated 2023, lives in GIS). Survey acre 4046.87261 vs intl acre 4046.8564224 m² (43560 ft² exact).
10. **Cups**: US legal 240 mL; US customary gal/16 = 236.5882365 mL; metric 250; imperial 284.130625; JP 200. Spoons: US tbsp gal/256 = 14.7867647813 mL, metric 15, **AU tbsp 20**; US tsp gal/768 = 4.92892159375, metric 5. mathjs mixes metric spoons with US cup → 1 cup = 15.77 tbsp bug.
11. **Pints/quarts/barrels**: US liq pint 473.176473 mL; imp pint 568.26125 (+20%); US dry pint 550.61047. Oil bbl = 42 US gal = 158.987294928 L; US beer barrel 31 gal; imp beer barrel 163.65924 L.
12. **Rounded-constant drift to not replicate**: convert-units anchors 3.28084/10.7639/33.8140226; js-quantities fathom 1.829 (exact 1.8288), furlong 201.2 (201.168), ly 9.460528e15 (exact 9460730472580800 m), AU 1.495979e11 (exact 149597870700). Store exact legal definitions.
13. **Calendar units**: three libs use Julian year 365.25 d / month 30.4375 d; js-quantities uses tropical 31 556 926 s (~11 min different). Pick Julian (UCUM/CODATA), document.
14. **Alias collisions in real data**: js-quantities `pt` point-vs-pint last-write-wins (points unreachable); `Gal` galileo vs `gal` gallon; convert-units bare `C/K/F/R`; mathjs `C`=coulomb, `min`=minute/`m`=meter, `h`=hour vs hecto; `cal` 4.184 vs IT 4.1868 vs `Cal` food ×1000 by case; hp mechanical 745.6998716 W vs metric 735.49875 W.

## Alias & symbol coverage (reusable lists)

- **feet**: ft, ft., foot, feet, ' (U+0027), ′ (U+2032), ’ (U+2019); **inches**: in, in., inch, inches, " (U+0022), ″ (U+2033), '' (double apostrophe), ” (U+201D). Gate bare `in` on number adjacency (preposition).
- **mass**: lb, lb., lbs, lbs., pound(s), # / oz, oz., ounce(s) (+ distinct ozt, troy oz, troy ounce) / kg, kilo(s), kilogram(s), kilogramme(s) / g, gram(s), gramme(s) / st, stone(s) / t, tonne(s), metric ton(s) vs ton(s), short/long ton.
- **temperature**: °C, ℃ U+2103, degC, deg C, celsius, centigrade, C (gated); °F, ℉ U+2109, degF, fahrenheit, F (gated); K, kelvin(s), °K (wrong but common); degree-sign folds ° U+00B0, º U+00BA, ˚ U+02DA, ∘ U+2218; "degrees Celsius" word forms; bare `-3°` + context.
- **volume**: ml, mL, millilit(er|re)(s), cc, cm3, cm³ / l, L, ltr, liter(s), litre(s), ℓ U+2113 / m3, m³, cu m, cum, cbm, CBM / fl oz, fl. oz., floz, fl-oz, fluid ounce(s), oz fl / tsp, tsp., teaspoon(s) / tbsp, tbsp., Tbs, tbs, tb, tablespoon(s) / cup(s) / pt, pint(s) / qt, quart(s) / gal, gal., gallon(s) — regional variants as distinct units.
- **area**: m2, m², sq m, sqm, sq. m., square met(er|re)(s) / ft2, ft², sq ft, sqft, sq. ft., square foot/feet, SF / ac, acre(s) / ha, hectare(s) / km², sq km / in², mi². No prior lib parses spaced "sq ft" or superscripts.
- **speed**: mph, MPH, mi/h, miles per hour / km/h, kph, kmh, kmph, km/hr / m/s, mps / kt, kn, kts, knot(s) / ft/s, fps.
- **duration**: ms, msec(s) / s, sec(s), second(s) / min, mins, minute(s) — never bare m by default / h, hr(s), hour(s) / d, day(s) / wk(s), week(s) / mo, mos, month(s) / yr(s), year(s), annum. fortnight.
- **data**: B, byte(s), kB, KB (decimal!), MB, GB, TB, PB; KiB, MiB, GiB, TiB, PiB (+ words kibibyte…); bits b, bit(s), kbit, Mbit, Gbit; caseExact Kb/Mb/Gb/Tb = bits.
- **micro**: µ U+00B5, μ U+03BC, u, mc (NFKC folds µ→μ).
- **unicode gaps nobody handles** (our greenfield): primes ′ ″, smart quotes ’ ”, ℃/℉, º/˚/∘ degree look-alikes, superscripts ²³, ℓ, vulgar fractions ½¼¾ + U+2044, NBSP/narrow-NBSP between number and unit, en dash ranges.

## Best-fit & formatting

- convert-units toBest(): same-system candidates, skip excluded, smallest abs value ≥ cutOffNumber (default 1; `cutOffNumber:10` → 900 mm = 90 cm not 0.9 m). Returns val+unit+singular+plural.
- UnitMath: explicit `.simplify()` only; autoPrefix window [0.1, 1000); **per-unit formatPrefixes whitelist** (meters only n,µ,m,c,'',k — no decameters); precision 15 trims float noise.
- mathjs: auto-prefix unless from `.to()` (fixPrefix); `splitUnit(['ft','in'])` = reference for compound output.
- Intl: plurals, narrow symbols (3′ 3″ -3°C 5#), formatRange en-dash + unit collapsing, compact notation.
- Right defaults: display target [1, 1000); stay in input's system; per-unit best-fit eligibility; 2–3 sig digits humanized, full precision in .value; expose ECMA-402 ids; formatRange semantics for ranges.

## Licenses

| Library | License | Notes |
|---|---|---|
| convert-units | MIT | © Ben Ng and contributors |
| js-quantities | MIT | Julien Sanchez; port of ruby-units (Kevin Olbrich, MIT) — credit both |
| UnitMath | Apache-2.0 | Eric Mansfield — notice required if data copied |
| mathjs | Apache-2.0 | Jos de Jong |
| libphonenumber-js | MIT | metadata from Google libphonenumber (Apache-2.0) |
| ECMA-402/CLDR | Ecma spec / Unicode License v3 | attribution if CLDR strings copied |

Factors are uncopyrightable facts; attribute alias lists borrowed from Apache-2.0 projects in credits.

## Steal vs avoid

**Steal**: libphonenumber DX shape (rich value object, lenient extract + strict mode, isPossible/isValid tiers, reason codes, findInText offsets, AsYouType, metadata tiers); js-quantities alias craft + temp delta split; UnitMath config discipline + formatPrefixes; mathjs splitUnit + exact-rational habit; convert-units toBest knobs + describe(); Intl as display backend.

**Avoid**: rounded anchors; silent binary/decimal switches; context-free single-letter aliases; case-insensitive symbol matching; alias collisions without build-time rejection; arithmetic on absolute temp scales; mixed regional conventions in one table; undocumented calendar averages; mutable global registries. None of the six libs parse `5'11"`, ′/″/℃ codepoints, `1½ cups`, decimal commas, spaced `sq ft`, `cbm`, troy oz, or ranges — that surface is ours.

## Competitive positioning update (2026-07-09)

Multi-agent web research pass 2026-07-09, cross-referencing download numbers and
feature matrices across the units/measurement ecosystem. Claims are
agent-reported and worth re-verifying.

**Download context (npm weekly, agent-reported 2026-07-09)**: convert-units ~194K,
js-quantities (not separately tracked, bundled in projects), mathjs ~1.6M (full
math suite, not just units). None parses natural-language text; all require exact
programmatic keys.

**Exclusive lingo differentiators vs the units ecosystem**:

1. Spans on every result — no units library ships character offsets.
2. Two-way guarantee — none guarantees `parse(format(x)) === x`.
3. Standard Schema implementation — no units library is a Standard Schema
   validator, so none plugs into AI SDK, TanStack Form, or react-hook-form
   without adapter code.
4. Size: lingo full (36.9 kB gz, 0 deps) is comparable to convert-units alone
   (~8 kB gz, conversion only) while covering parsing + conversion + formatting +
   fuzzy + completions.
5. NL parsing of compound forms (`5'11"`, `1½ cups`, spaced `sq ft`, decimal
   commas, primes/smart quotes) — surface no competitor handles.

**Gaps to close**: convert-units' `toBest()` `exclude`/`cutOff` options are not
yet matched in lingo's `pickBestUnit`; js-quantities' troy-oz coverage shows a
real-world demand lingo now serves (D-entry exists). The `(string & {})` escape
hatch on Kind should extend to field options (`QuantityFieldOptions.unit`) for
autocomplete-with-fallback.

(agent-researched, 2026-07-09; see also `wiki/research/competitive-landscape.md`)
