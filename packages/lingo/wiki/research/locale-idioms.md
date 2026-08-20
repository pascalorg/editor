# Locale idiom inventory

Research pass 2026-07-09 (multi-agent, source-level). Six native-level language
studies (es, fr, pt, zh, ja, en) producing ~335 test-precise idioms, a prior-art
source audit, an engine-gap analysis with file:line evidence, and a field-coverage
matrix. Agent-researched: idioms are agent-curated from native corpora, not
independently verified by native speakers.

Companion plan: `plans/033-locale-idiom-coverage.md`.

---

## Spanish (es) — 58 idioms

Register landscape: rich spoken-number system with mandatory connectors
("treinta y cinco"), bare scales ("cien", "quinientos"), fused compounds
(veinti- forms for 21-29). Multi-word approximate phrases dominate informal
speech. Time expressions use article + cardinal + additive/subtractive fractions
with period-of-day suffixes.

### number-word

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| veintiuno | value: 21 | very-common | numberWords.ones | Fused form. Variants veintidos-veintinueve all missing from ones. |
| veintiun kilos | 21 kg | very-common | numberWords.ones | Apocopated before masculine nouns. |
| doscientos gramos | 200 g | very-common | ENGINE | Bare compound-hundred; consumedAny gate blocks it. Feminine doscientas also needed. |
| quinientos gramos | 500 g | very-common | ENGINE | Same bare-scale blocker; needs doscientos-novecientos as ones(200-900) or engine fix. |
| cien gramos | 100 g | very-common | ENGINE | Bare scale without preceding number; consumedAny=true gate. |
| mil quinientos metros | 1500 m | common | ENGINE | Depends on fixing quinientos + bare mil. |
| dos coma cinco kilos | 2.5 kg | common | ENGINE | 'coma' as spoken decimal separator; no decimalWords field exists. |

### compound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| treinta y cinco kilos | 35 kg | very-common | ENGINE | Parser checks only hyphen+ones after tens, never andWords+ones. Affects all 31-99. |
| uno ochenta | 1.80 m (height) | common | ENGINE | Number-word parser sums 1+80=81; needs domain-specific decimal-shorthand heuristic. |

### fraction

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| kilo y medio | 1.5 kg (implied 1) | very-common | ENGINE | Unit-first with implied quantity 1. |
| medio kilo | 0.5 kg | very-common | numberWords.fractionWords | Already works. |
| un cuarto de kilo | 0.25 kg | very-common | numberWords.fractionWords | Already works. |
| dos kilos y medio | 2.5 kg | very-common | numberWords.fractionWords | Already works. |
| 3 horas y media | 3.5 hours | very-common | numberWords.fractionWords | Should work via compound 'and a half' tail. |
| media docena | 6 (half a dozen) | common | ENGINE | No article between fraction and dozen word in Spanish. |

### duration

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| hora y media | 1.5 h | very-common | ENGINE | Unit-first implied 1 + parseDuration locale gap. |
| media hora | 0.5 h = 30 min | very-common | ENGINE | parseDuration does not load locale unit aliases. |
| un cuarto de hora | 15 min | very-common | ENGINE | Same parseDuration locale gap. |
| dos horas | 2 h | very-common | ENGINE | parseDuration doesn't consult locale pack 'horas' alias. |
| la quincena | 15 days (fortnight) | common | ENGINE | No custom-duration-unit mechanism. |

### approx-qualifier

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| mas o menos 5 kilos | ~5 kg | very-common | ENGINE | 3-word phrase; approximateWords single-word only. |
| unos 5 kilos | ~5 kg | very-common | grammar.approximateWords | Data fix: add 'unos'/'unas'. |
| como unos 5 kilos | ~5 kg | common | grammar.approximateWords | 'como' conflicts with conversionWords. |
| cosa de 5 kilos | ~5 kg | occasional | ENGINE | Multi-word approximate phrase. |
| por ahi de 5 kilos | ~5 kg | common | ENGINE | Multi-word approximate phrase. |
| alrededor de 5 kilos | ~5 kg | very-common | grammar.qualifierSkipAfterApprox | 'de' breaks chain after approx word; add 'de' to skip list. |
| cerca de 5 kilos | ~5 kg | common | grammar.qualifierSkipAfterApprox | Same 'de' skip fix. |
| 5 kilos y pico | ~5+ kg | very-common | grammar.trailingApproxPhrases | Data fix: add 'y pico'. |
| cinco kilos y pico | ~5+ kg | very-common | grammar.trailingApproxPhrases | Same. |
| 5 kilos y tantos | ~5+ kg | common | grammar.trailingApproxPhrases | Data fix: add 'y tantos'. |
| 5 y algo kilos | ~5 kg | common | grammar.trailingApproxPhrases | Data fix: add 'y algo'. |

### fuzzy-amount

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| veintipico kilos | ~20+ kg | common | ENGINE | Fused approx compound; value is a range, not scalar. |
| un par de kilos | ~2 kg | very-common | numberWords.fuzzyAmounts | Data fix: add 'par' {value:2, spread:[2,3]}. |
| unos cuantos kilos | ~4-5 kg | common | ENGINE | Multi-word fuzzy. If 'unos' is approxWord, 'cuantos' as fuzzyAmount might parse. |
| cuarenta y tantos anos | ~40-49 | common | ENGINE | tens + fuzzy suffix; cannot express as simple data. |

### range-bound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 5 o 6 kilos | range 5-6 kg | very-common | grammar.rangeAlternativeWords | Data fix: add 'o'. |
| de 5 a 10 kilos | range 5-10 kg | very-common | grammar.rangeFromWords | Data fix: add 'de'. |
| entre 5 y 10 kilos | range 5-10 kg | very-common | grammar | Already works. |
| desde 5 hasta 10 kilos | range 5-10 kg | common | grammar | Already works. |
| al menos 5 kilos | at least 5 kg | very-common | grammar.boundPhrases | Already works. |

### number-word (decimal/format)

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 2,5 kilos | 2.5 kg | very-common | defaults.numberFormat | Already works (comma-decimal policy). |
| pesa ochenta kilos | 80 kg | common | grammar.globalFillers | Data fix: add 'pesa'/'mide' to fillers. |

### date-relative

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| pasado manana | dayOffset +2 | very-common | date.dayOffsets | Data fix. |
| anteayer | dayOffset -2 | very-common | date.dayOffsets | Data fix. |
| antier | dayOffset -2 | common | date.dayOffsets | Regional (Mexico/Central America). |
| el lunes que viene | next Monday | very-common | date.modifiers | Already works. |
| dentro de quince dias | in 15 days | very-common | date.relative | Already works. |
| ahorita | right now / very soon | very-common | date.dayTimePhrases | Regional (Mexico). Data fix. |
| el otro dia | ~3 days ago | very-common | date.dayOffsets | Could map dayOffset -3. |
| hace un rato | ~30-60 min ago | very-common | ENGINE | Informal duration unit with no precise mapping. |
| a mediados de julio | mid-July | common | ENGINE | English-only regex for period-edge phrases. |
| a finales de mes | end of month | common | ENGINE | Same hardcoded English regex. |
| a principios de mes | beginning of month | common | ENGINE | Same. |
| el fin de semana | this weekend | very-common | ENGINE | Hardcoded English 'weekend' match. |
| de madrugada | early morning (~4h) | common | date.dayTimePhrases | Data fix. |

### time-of-day

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| las dos y media | 2:30 | very-common | ENGINE | Romance clock grammar not supported. |
| las tres menos cuarto | 2:45 | very-common | ENGINE | Subtractive time (menos=minus). |
| a las siete de la tarde | 19:00 | very-common | ENGINE | Period-of-day suffixes not recognized. |

---

## French (fr) — 60 idioms

Register landscape: vigesimal number system (60+N for 70-79, 4x20 for 80,
4x20+N for 90-99) is the dominant structural gap. Belgian/Swiss forms
(septante/huitante/nonante) already work. Multi-word approximate phrases
universal in speech. Time uses "N heures M" pattern with additive/subtractive
fractions.

### number-word (vigesimal)

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| quatre-vingts kilos | 80 kg | very-common | ENGINE | 4*20 multiplicative; parser treats tens as additive only. |
| quatre-vingt-dix kilos | 90 kg | very-common | ENGINE | 4*20+10 cascaded composition. |
| soixante-dix kilos | 70 kg | very-common | ENGINE | 60+10; 'dix'=10 rejected by tens-hyphen-ones branch (requires <10). |
| soixante-quinze kilos | 75 kg | very-common | ENGINE | 60+15; same branch rejection. |
| soixante et onze kilos | 71 kg | very-common | ENGINE | 60+11 with 'et' liaison; wrong path. |
| quatre-vingt-onze kilos | 91 kg | very-common | ENGINE | 4*20+11. |
| vingt et un kilos | 21 kg | very-common | ENGINE | 'et' after tens expects scale, not ones. |
| cent kilos | 100 kg | very-common | numberWords.scales | Bare scale; consumedAny gate blocks. |
| mille kilos | 1000 kg | very-common | numberWords.scales | Same bare-scale issue. |

### number-word (decimal)

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| deux virgule cinq kilos | 2.5 kg | very-common | ENGINE | 'virgule' as decimal-point word; no decimalWords field. |

### regional-variant

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| septante-cinq kilos | 75 kg (BE/CH) | very-common | numberWords.tens | Already works. |
| nonante-deux kilos | 92 kg (BE/CH) | very-common | numberWords.tens | Already works. |
| huitante kilos | 80 kg (CH) | common | numberWords.tens | Already works. |

### fuzzy-amount

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| une dizaine de kilos | ~10 kg | very-common | numberWords.fuzzyAmounts | Data fix: dizaine {value:10, spread:[8,12]}. |
| une vingtaine de kilos | ~20 kg | very-common | numberWords.fuzzyAmounts | vingtaine {value:20, spread:[18,25]}. |
| une centaine de kilos | ~100 kg | common | numberWords.fuzzyAmounts | centaine {value:100, spread:[80,120]}. |
| une trentaine de kilos | ~30 kg | common | numberWords.fuzzyAmounts | trentaine {value:30, spread:[25,35]}. |
| un millier de kilos | ~1000 kg | common | numberWords.fuzzyAmounts | millier {value:1000, spread:[800,1200]}. |
| une cinquantaine de kilometres | ~50 km | common | numberWords.fuzzyAmounts | cinquantaine {value:50, spread:[45,55]}. |

### approx-qualifier

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| a peu pres 5 kilos | ~5 kg | very-common | ENGINE | Multi-word; no approximatePhrases field. |
| dans les 5 kilos | ~5 kg | very-common | ENGINE | 'dans' conflicts with date futurePrefixes. |
| grosso modo 5 kilos | ~5 kg | common | ENGINE | Two-word phrase. |
| plus ou moins 5 kilos | ~5 kg | common | ENGINE | Three-word; 'plus'/'moins' have bound semantics. |
| pas loin de 5 kilos | ~5 kg | common | ENGINE | Multi-word approximate expression. |
| aux alentours de 5 kilos | ~5 kg | common | ENGINE | Four-word phrase. |
| 5 kilos environ | ~5 kg | very-common | grammar.trailingApproxWords | Data fix: add 'environ'. |
| 5 kilos a peu pres | ~5 kg | common | grammar.trailingApproxPhrases | Data fix: add 'a peu pres'. |
| un peu plus de 5 kilos | slightly >5 kg | very-common | grammar.qualifierSoftenerPhrases | Partial engine gap: softener+bound composition. |
| un peu moins de 5 kilos | slightly <5 kg | very-common | grammar.qualifierSoftenerPhrases | Same. |

### range-bound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 5 ou 6 kilos | range 5-6 | very-common | grammar.rangeAlternativeWords | Data fix: add 'ou'. |

### compound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| un metre quatre-vingts | 1.80 m | very-common | ENGINE | Compound + vigesimal subunit. |
| un metre quatre-vingt-deux | 1.82 m | very-common | ENGINE | Same vigesimal blocker in subunit. |

### fraction

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| la moitie d'un kilo | 0.5 kg | common | ENGINE | 'la moitie de' not recognized as fraction lead. |

### duration

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| une heure et demie | 1.5 h | very-common | ENGINE | As duration works; as clock time (1:30) fails. |
| un quart d'heure | 15 min | very-common | ENGINE | Apostrophe tokenization + duration module gap. |
| une demi-heure | 30 min | very-common | ENGINE | Hyphenated fraction-unit pattern. |

### date-relative

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| apres-demain | dayOffset +2 | very-common | date.dayOffsets | Data fix. |
| avant-hier | dayOffset -2 | very-common | date.dayOffsets | Data fix. |
| ce soir | this evening ~21h | very-common | date.dayTimePhrases | Data fix. |
| hier soir | yesterday evening | very-common | date.dayTimePhrases | Data fix. |
| demain soir | tomorrow evening | very-common | date.dayTimePhrases | Data fix. |
| cet apres-midi | this afternoon ~15h | very-common | date.dayTimePhrases | Data fix. |
| le week-end prochain | next weekend | very-common | date.periodWords | Data fix: add 'week-end'/'weekend' to week. |
| dans quinze jours | in 15 days | very-common | date.relative | Already works. |
| la semaine prochaine | next week | very-common | date.periodWords + modifiers | Already works. |
| lundi en huit | Monday next week | common | ENGINE | Weekday + 'en huit' offset; no pack field. |
| mardi en quinze | Tuesday in 2 weeks | occasional | ENGINE | Same. |
| d'ici lundi | by Monday | common | ENGINE | No deadline-by mechanism. |

### date-absolute

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| debut juillet | early July | common | ENGINE | English-only sub-month regex. |
| mi-juillet | mid-July | common | ENGINE | Regex only matches literal 'mid'. |
| fin juillet | end of July | common | ENGINE | Same. |
| le 1er juillet | July 1st | very-common | ENGINE | French ordinal suffix 'er' not stripped. |
| le premier juillet | July 1st | common | ENGINE | Ordinal word for day not supported. |

### time-of-day

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| quatorze heures trente | 14:30 | very-common | ENGINE | Word-based clock time not supported. |
| deux heures et quart | 2:15 | very-common | ENGINE | Fraction-based clock. |
| trois heures moins le quart | 2:45 | very-common | ENGINE | Subtractive 'moins'. |
| midi et demi | 12:30 | very-common | ENGINE | Alias + fraction tail not composable. |
| vers 15h | ~15:00 | very-common | ENGINE | Approximate time prefix not handled. |

### colloquial

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| je fais du 42 | size 42 | common | ENGINE | Clothing size idiom; outside grammar. |
| en fin d'apres-midi | ~17-18h | common | date.dayTimePhrases | Data fix (needs apostrophe normalization check). |

---

## Portuguese (pt) — 58 idioms

Register landscape: mandatory "e" connector between tens and ones (like Spanish
"y"), bare scales (cem/mil), compound hundreds (duzentos-novecentos). Brazilian
vs European Portuguese variants for teens (dezesseis/dezasseis). Spoken clock uses
"X para as Y" (X to Y) and "N e meia" (N:30).

### number-word

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| vinte e cinco quilos | 25 kg | very-common | ENGINE | Parser only checks hyphen after tens, never andWords. |
| cento e cinquenta gramas | 150 g | very-common | ENGINE | 'e' captured as rangeAndWord before number-word parser sees it. |
| cinquenta e tres quilos | 53 kg | very-common | ENGINE | Same tens+e+ones failure. |
| cem quilos | 100 kg | very-common | ENGINE | Bare scale blocked by consumedAny. |
| mil quilos | 1000 kg | very-common | ENGINE | Same. |
| mil e quinhentos metros | 1500 m | common | numberWords.ones | Needs engine fix + 'quinhentos' in pack. |
| duzentos gramas | 200 g | very-common | numberWords.ones | Missing compound hundred. |
| trezentos metros | 300 m | common | numberWords.ones | Missing. |
| quatrocentos quilos | 400 kg | common | numberWords.ones | Missing. |
| quinhentos gramas | 500 g | very-common | numberWords.ones | Missing. |
| seiscentos metros | 600 m | common | numberWords.ones | Missing. |
| setecentos metros | 700 m | common | numberWords.ones | Missing. |
| oitocentos metros | 800 m | common | numberWords.ones | Missing. |
| novecentos metros | 900 m | common | numberWords.ones | Missing. |
| dois virgula cinco quilos | 2.5 kg | common | ENGINE | 'virgula' as decimal word; no decimalWords field. |

### regional-variant

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| dezessete quilos | 17 kg (BR) | very-common | numberWords.ones | Pack has 'dezassete' (PT) not 'dezessete' (BR). |
| dezasseis quilos | 16 kg (PT) | very-common | numberWords.ones | Pack has 'dezesseis' (BR) not 'dezasseis' (PT). |
| dezanove quilos | 19 kg (PT) | very-common | numberWords.ones | Pack has 'dezenove' (BR) not 'dezanove' (PT). |

### fraction

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| dois quilos e meio | 2.5 kg | very-common | grammar.compoundJoinWords | Already works. |
| uma hora e meia | 1.5 h | very-common | grammar.compoundJoinWords | Already works. |
| meia duzia de ovos | 6 (half dozen) | common | ENGINE | No article between fraction and dozen word. |
| um quarto de hora | 15 min | common | ENGINE | parseDuration lacks locale support. |

### approx-qualifier

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| uns 5 quilos | ~5 kg | very-common | grammar.approximateWords | Data fix: add 'uns'/'umas'. |
| umas 3 caixas | ~3 boxes | very-common | grammar.approximateWords | Feminine form. |
| mais ou menos 5 quilos | ~5 kg | very-common | ENGINE | Multi-word phrase; no field. |
| por volta de 3 quilos | ~3 kg | common | ENGINE | Multi-word phrase. |
| cerca de 5 quilos | ~5 kg | very-common | grammar.qualifierSkipAfterApprox | Add 'de' to skip list. |
| vinte e poucos quilos | ~20-29 kg | very-common | ENGINE | Trailing 'e pouco' blocked by rangeAndWord 'e'. |
| vinte e tantos quilos | ~20-29 kg | common | ENGINE | Same 'e' conflict. |

### range-bound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 5 ou 6 quilos | range 5-6 | common | grammar.rangeAlternativeWords | Data fix: add 'ou'. |

### fuzzy-amount

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| um par de quilos | ~2 kg | common | numberWords.fuzzyAmounts | 'par' with articles+ofWords path. |
| bocado | a bit (PT-PT) | common | numberWords.fuzzyAmounts | Context-dependent. |

### compound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| um e oitenta | 1.80 m (height) | very-common | ENGINE | Implied meter + centimeter subunit. |
| um metro e oitenta | 1.80 m | very-common | grammar.compoundJoinWords | Add 'e' to compoundJoinWords. |

### duration

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| hora e meia | 1.5 h | very-common | ENGINE | parseDuration locale gap. |
| meia hora | 30 min | very-common | ENGINE | Same. |
| quinzena | 15 days | common | date.unitWords | No custom-duration-unit mechanism. |

### date-relative

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| anteontem | dayOffset -2 | very-common | date.dayOffsets | Data fix. |
| depois de amanha | dayOffset +2 | very-common | date.dayOffsets | Data fix (multi-word key). |
| fim de semana | weekend | very-common | ENGINE | Hardcoded English 'weekend'. |
| em quinze dias | in 15 days | very-common | date.relative | Already works. |
| segunda que vem | next Monday | very-common | date.modifiers | Already works. |
| daqui a tres dias | in 3 days | very-common | ENGINE | parseDate doesn't resolve locale number words in offset. |
| semana retrasada | week before last | occasional | ENGINE | No 'before-last' modifier. |
| inicio de julho | early July | common | ENGINE | English-only edge-period regex. |
| fim de julho | late July | common | ENGINE | Same. |
| meio de julho | mid-July | common | ENGINE | Same. |
| no comeco do mes | beginning of month | common | ENGINE | Same. |

### time-of-day

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| duas e meia | 2:30 | very-common | ENGINE | PT spoken clock not supported. |
| tres e quinze | 3:15 | common | ENGINE | Same. |
| quinze para as tres | 2:45 | very-common | ENGINE | 'para' not in subtraction prepositions. |
| meio-dia e meia | 12:30 | very-common | ENGINE | Alias + fraction not composable. |
| as sete da noite | 19:00 | very-common | ENGINE | Period-of-day suffixes not supported. |
| de madrugada | early morning | common | date.dayTimePhrases | Data fix. |
| la pelas tres | ~15:00 | common | ENGINE | Approximate time marker not handled. |
| as duas da tarde | 14:00 (PT-PT) | very-common | ENGINE | Same period-of-day gap. |
| dez para as oito | 7:50 | common | ENGINE | Same. |
| depois de amanha de manha | day+2 morning | common | date.dayTimePhrases | Compound dayOffset + time phrase. |

---

## Chinese, Simplified Mandarin (zh) — 55 idioms

Register landscape: fundamentally different numeral composition from Western
languages. Numbers built by multiplying and adding CJK scale characters
(百/千/万/亿). No spaces between tokens. Classifiers (个/只/条) mandatory between
numbers and nouns. Elliptical shorthand pervasive (一百五 = 150). Traditional
units (斤/两/里/亩) still in daily use.

### number-word

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 三公斤 | 3 kg | very-common | ENGINE | Tokenizer merges into one token; number parser cannot split. |
| 十五公斤 | 15 kg | very-common | ENGINE | 十五 positional CJK; token splitting needed. |
| 一百五十公斤 | 150 kg | very-common | ENGINE | Multi-scale composition in one token. |
| 一百五 | 150 (elliptical) | very-common | ENGINE | X百Y = X*100 + Y*10 shorthand. |
| 三万五 | 35000 (elliptical) | very-common | ENGINE | X万Y = X*10000 + Y*1000. |
| 两 | 2 (colloquial before units) | very-common | ENGINE | In ones already but CJK merge blocks matching. |
| 三点五公斤 | 3.5 kg | common | ENGINE | 点 as CJK decimal point; no mechanism. |

### compound (mixed Arabic + CJK)

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 3万5 | 35000 | very-common | ENGINE | 万 as post-digit scale not recognized. |
| 3万5千 | 35000 | common | ENGINE | Mixed digits + CJK scales. |

### numeral-system

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| ３５公斤 | 35 kg (full-width) | common | normalizer | Already works (NFKC normalization). |

### fraction

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 两公斤半 | 2.5 kg | very-common | ENGINE | Post-unit 半 pattern; no mechanism for suffix fraction. |
| 一个半小时 | 1.5 h | very-common | ENGINE | N+个+半+unit pattern. |
| 半个月 | 0.5 months | very-common | ENGINE | Leading 半 with classifier; one merged token. |
| 两斤半 | 1.25 kg (2.5 jin) | very-common | ENGINE | Traditional unit + post-unit half. |

### approx-qualifier

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 十来个 | ~10 | very-common | ENGINE | 来 as intra-token approximate suffix. |
| 二十多公斤 | 20+ kg | very-common | ENGINE | 多 as post-number 'more than' marker; intra-token. |
| 一百多公斤 | 100+ kg | common | ENGINE | Same 多 pattern at higher scale. |
| 五公斤左右 | ~5 kg | very-common | grammar.approximateWords | Works with Arabic digits; fails with CJK numerals. |
| 大概五公斤 | ~5 kg | very-common | grammar.approximateWords | Works with Arabic digits. |
| 差不多五公斤 | ~5 kg | very-common | grammar.approximateWords | Missing from current pack. Multi-char no-space. |
| 五公斤上下 | ~5 kg | common | grammar.trailingApproxWords | Missing from pack. |

### fuzzy-amount

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 几个 | a few (~3) | very-common | ENGINE | 几 not in fuzzyAmounts + CJK merge. |

### range-bound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 三四个 | range 3-4 | very-common | ENGINE | Adjacent-number range; no separator. |
| 七八个 | range 7-8 | very-common | ENGINE | Same pattern. |
| 五公斤到十公斤 | range 5-10 kg | very-common | grammar.rangeSeparatorWords | Works with Arabic digits. |
| 三至五天 | range 3-5 days | common | ENGINE | 至 in rangeSeparatorWords but CJK numeral fails. |

### unit-alias

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 三斤 | 1500g (斤=500g) | very-common | units.mass | Traditional unit; not in current aliases. |
| 二两肉 | 100g (两=50g) | very-common | units.mass | HAZARD: 两 is also numeral 2. Homograph. |
| 三里路 | 1500m (里=500m) | common | units.length | Traditional distance; 路 is filler. |
| 五亩地 | area (亩=666.67m2) | common | ENGINE | Area kind not in zh units. |

### date-relative

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 前天 | dayOffset -2 | very-common | date.dayOffsets | Missing from pack. Data fix. |
| 后天 | dayOffset +2 | very-common | date.dayOffsets | Missing. Data fix. |
| 大前天 | dayOffset -3 | common | date.dayOffsets | Data fix. |
| 大后天 | dayOffset +3 | common | date.dayOffsets | Data fix. |
| 上周三 | last Wednesday | very-common | ENGINE | No-space modifier+weekday; needs CJK weekday parsing. |
| 下周一 | next Monday | very-common | ENGINE | Same. |
| 这周五 | this Friday | very-common | ENGINE | Same. |
| 周末 | this weekend | very-common | ENGINE | Weekend concept not in pack fields. |
| 月底 | end of month | very-common | ENGINE | No period-anchored date mechanism. |
| 月初 | beginning of month | common | ENGINE | Same. |
| 三个小时后 | 3h from now | very-common | ENGINE | 个 classifier blocks compactOffset matching. |
| 一个半小时后 | 1.5h from now | very-common | ENGINE | Classifier + half + offset compound. |
| 半天 | half a day | very-common | ENGINE | 半 as leading fraction; CJK merge. |
| 一刻钟 | 15 min | common | ENGINE | 刻钟 not in unit aliases. |
| 过三天 | in 3 days | common | date.compactOffset | 过 as future prefix; not in pack. |
| 再过两天 | in 2 more days | common | ENGINE | 再过 compound prefix; no multi-char prefix field. |
| 三天以后 | after 3 days | common | date.compactOffset | 以后 not in futureSuffixes. |
| 明年三月 | March next year | common | ENGINE | Relative year + month compound. |

### date-absolute

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 7月15号 | July 15th | very-common | ENGINE | 号 as day-of-month marker not handled. |

### time-of-day

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 下午三点半 | 15:30 | very-common | ENGINE | CJK time pattern not supported. |
| 三点一刻 | 3:15 | very-common | ENGINE | 一刻 = quarter. |
| 差一刻四点 | 3:45 | common | ENGINE | Subtractive time (差=minus). |
| 晚上八点 | 20:00 | very-common | ENGINE | Day-part prefix + time. |
| 凌晨三点 | 3:00 AM | common | ENGINE | 凌晨 = early morning. |
| 中午十二点 | 12:00 noon | common | ENGINE | 中午 prefix + CJK numeral. |

---

## Japanese (ja) — 52 idioms

Register landscape: no word boundaries in CJK text; postfix grammar particles;
kanji numeral composition shares structure with Chinese but has unique features
(counters/classifiers mandatory, hiragana readings as synonyms). Wave dash
(U+301C) and fullwidth tilde (U+FF5E) are standard range separators.
After-next/before-last modifiers (再来/先々) are productive.

### number-word

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 三キロ | 3 kg | very-common | ENGINE | Single kanji + katakana unit merged as one token. |
| 三十五キロ | 35 kg | very-common | ENGINE | Compound kanji number + unit, one token. |
| 百五十グラム | 150 g | very-common | ENGINE | 百 scale + ones + unit in one token. |
| 千五百メートル | 1500 m | common | ENGINE | 千 scale; same tokenizer merge. |
| 三万五千円 | 35000 JPY | very-common | ENGINE | 万 scale composition; currency unit 円. |
| 3万5千キロ | 35000 kg | very-common | ENGINE | Mixed arabic + kanji scale. |
| 二億三千万 | 230000000 | common | ENGINE | 億 scale; multi-scale stacking. |
| 三点五キロ | 3.5 kg | common | ENGINE | 点 as decimal; all one token. |

### fraction

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 二キロ半 | 2.5 kg | very-common | ENGINE | Post-unit 半; parses as 2 kg (半 lost). |
| 一時間半 | 1.5 h | very-common | ENGINE | N+unit+半 duration; one CJK token. |
| 半年 | 0.5 years | very-common | ENGINE | Leading 半 + unit; merged token. |
| 半日 | 0.5 days | very-common | ENGINE | Same pattern. |

### approx-qualifier

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 五キロぐらい | ~5 kg | very-common | ENGINE | ぐらい merged with unit token. |
| 五キロくらい | ~5 kg | very-common | ENGINE | くらい variant; same merge. |
| 5キロほど | ~5 kg | very-common | grammar.trailingApproxWords | ほど not in any list; also CJK merge. |
| 十個前後 | ~10 (range 8-12) | common | ENGINE | 前後 implies +/- range; not expressible. |

### fuzzy-amount

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 数個 | several (~3-5) | very-common | ENGINE | 数+counter pattern; merged token. |
| 十数キロ | 10-something | common | ENGINE | Teens-ish fuzzy pattern. |

### range-bound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 三、四個 | range 3-4 | very-common | ENGINE | Adjacent-number with 、separator. |
| 5〜10キロ | range 5-10 | very-common | ENGINE | U+301C wave dash not normalized. |
| 三〜五日 | range 3-5 days | very-common | ENGINE | CJK numeral + wave dash. |
| 5～10キロ | range 5-10 | very-common | ENGINE | U+FF5E fullwidth tilde not normalized. |
| 5キロ以上 | at least 5 kg | very-common | ENGINE | 以上 merges with unit token ('キロ以上'). |
| 5キロ未満 | less than 5 kg | very-common | ENGINE | 未満 same CJK suffix merge. |

### unit-alias

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 30坪 | 99.17 m2 (tsubo) | common | units (area) | Traditional area unit; needs kind registration. |
| 6畳 | 9.93 m2 (jo/tatami) | common | units (area) | Traditional area unit. |
| 一合 | 180 ml (go) | occasional | units.volume | Traditional volume. |

### date-relative

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 一昨日 | dayOffset -2 | very-common | date.dayOffsets | Data fix. |
| おととい | dayOffset -2 | very-common | date.dayOffsets | Hiragana reading; data fix. |
| 明後日 | dayOffset +2 | very-common | date.dayOffsets | Data fix. |
| あさって | dayOffset +2 | very-common | date.dayOffsets | Hiragana reading; data fix. |
| しあさって | dayOffset +3 | occasional | date.dayOffsets | Regional (Kanto standard). |
| 再来週 | week after next | common | ENGINE | No 'after-next' modifier in DateRelativeModifier. |
| 先々週 | week before last | common | ENGINE | No 'before-last' modifier. |
| 再来月 | month after next | common | ENGINE | Same. |
| あと三日 | 3 days from now | very-common | ENGINE | あと as future PREFIX; compactOffset only has suffixes. |
| 三日以内 | within 3 days | very-common | ENGINE | 以内 (within) bounded-future; no field. |
| 一時間半後 | 1.5h from now | very-common | ENGINE | parseCompactNumber cannot handle 半 suffix. |
| 半年前 | 6 months ago | very-common | ENGINE | parseCompactNumber returns null for 半. |
| 今朝 | this morning ~8h | very-common | date.dayTimePhrases | Data fix. |
| 今夜 | tonight ~21h | very-common | date.dayTimePhrases | Data fix. |
| 今晩 | this evening ~19h | very-common | date.dayTimePhrases | Data fix. |
| 明日の朝 | tomorrow morning | very-common | ENGINE | の-joined date+time composition. |
| 週末 | this weekend | very-common | ENGINE | No weekend concept in pack fields. |
| 月末 | end of month | very-common | ENGINE | No period-anchored mechanism. |

### time-of-day

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 午後3時半 | 15:30 | very-common | ENGINE | Japanese time format not in TIME_CORE_PATTERN. |
| 午前9時 | 09:00 | very-common | date.timePattern | Needs custom regex + parsing logic. |
| 15時半 | 15:30 | very-common | date.timePattern | 半 as :30 needs engine awareness. |
| 15時30分 | 15:30 | very-common | date.timePattern | N時N分 standard format. |
| 夜8時 | 20:00 | common | ENGINE | Day-part prefix + time. |

### duration

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| 四半期 | 1 quarter (3 months) | common | ENGINE | Fixed compound word; not decomposable. |

### compound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| りんご三個 | 3 apples | very-common | ENGINE | noun+number+counter; no counter concept. |

---

## English (en) — 52 idioms

Register landscape: base language with most mature pack. Remaining gaps are
mostly edge cases: colloquial elision ("one eighty"), pre-unit -ish, currency
multiplier words, UK date patterns, day+time-part compounds without "at",
and number-word clock hours.

### approx-qualifier

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| twenty-odd | ~20 | very-common | grammar.trailingApproxWords | Data fix: add 'odd'. |
| thirty-something | ~30-39 | common | grammar.trailingApproxWords | Data fix: add 'something'. |
| 5-ish kg | ~5 kg | very-common | ENGINE | -ish between number and unit; unit-matcher fails. |
| 5 kg or thereabouts | ~5 kg | common | grammar.trailingApproxPhrases | Data fix: add 'or thereabouts'. |
| 5 lbs give or take | ~5 lbs | very-common | grammar.trailingApproxPhrases | Data fix: add 'give or take'. |
| ten-ish | ~10 | very-common | grammar.trailingApproxWords | Works unitless; fails as '10-ish minutes'. |
| pushing 60 | approaching 60 | common | ENGINE | No 'approaching from below' concept. |

### range-bound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| north of 50 | >50 (exclusive lower) | common | grammar.boundPhrases | Data fix. |

### number-word

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| one eighty | 180 (colloquial) | very-common | ENGINE | Parser computes 1+80=81; ambiguous without context. |
| a score | 20 | occasional | numberWords.scales | Data fix: add 'score':20. |
| 5k | 5000 | very-common | numberWords.scales | Partially works with kind hint; standalone fails. |

### unit-alias (currency)

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| a grand | $1000 | very-common | ENGINE | Kind-scoped scale; cannot be in general scales. |
| five grand | $5000 | very-common | ENGINE | Same. |
| a buck fifty | $1.50 | common | numberWords | Works via typo-correction; 'buck' should be proper alias. |

### compound

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| a few dozen | ~36-60 | common | ENGINE | fuzzyAmounts and dozenWords don't compose. |
| a good ten minutes | at least 10 min | very-common | ENGINE | No emphatic prefix phrase concept. |
| the better part of an hour | ~45-55 min | common | ENGINE | Multi-word template idiom. |

### quantity-idiom

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| baker's dozen | 13 | occasional | ENGINE | Apostrophe-containing multi-word number. |
| couple-three | 2-3 (US regional) | occasional | ENGINE | Hyphenated number-word range. |

### duration

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| a couple hours | ~2 h | very-common | ENGINE | Fuzzy amount returns range; duration rejects ranges. |
| quarter hour | 15 min | common | ENGINE | Bare fraction + unit without article. |

### date-relative

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| tomorrow morning | tomorrow ~09:00 | very-common | ENGINE | dayOffset + time-part without 'at'. |
| yesterday evening | yesterday ~19:00 | very-common | ENGINE | Same compound issue. |
| Friday morning | Friday ~09:00 | very-common | ENGINE | Weekday + time-part compound. |
| next Monday morning | next Monday ~09:00 | very-common | ENGINE | Same. |
| this coming Friday | next Friday | very-common | date.modifiers | 'coming' as next synonym; 2-word modifier issue. |
| Monday week | Monday next week (UK) | common | ENGINE | Post-weekday 'week' offset; no field. |
| a week Monday | same (UK) | common | ENGINE | Duration + bare weekday without 'from'. |
| week on Tuesday | same (UK) | common | ENGINE | 'week on' + weekday. |
| Tuesday fortnight | Tuesday +14d (UK) | occasional | ENGINE | Same pattern with 'fortnight'. |
| the week after next | 2 weeks from now | common | ENGINE | Double-forward modifier. |
| the day after tomorrow | dayOffset +2 | very-common | date.dayOffsets | 'the' prefix not stripped; add to fillers. |
| early next week | Mon/Tue next week | very-common | ENGINE | No position qualifier for periods. |
| late July | ~July 25-31 | common | ENGINE | Same. |
| back end of the week | Thu/Fri (UK) | common | ENGINE | Colloquial position qualifier. |
| midweek | Wednesday | common | date.dayTimePhrases | Data fix or compound parse. |
| end of day | ~17:00 today | very-common | date.dayTimePhrases | Data fix. |
| close of business | ~17:00 | common | date.dayTimePhrases | Data fix. |
| first thing | ~08:00-09:00 | very-common | date.dayTimePhrases | Needs forward-date logic. |
| crack of dawn | ~05:30 | common | date.dayTimePhrases | Data fix. |
| this time next week | same time +7d | common | ENGINE | Time-preservation concept. |

### time-of-day

| input | meaning | freq | target | notes |
|-------|---------|------|--------|-------|
| quarter of five | 4:45 (US) | common | ENGINE | 'of' as 'to'; conflicts with 'quarter of an hour'. |
| five o'clock | 5:00 | very-common | ENGINE | Requires digit; doesn't resolve word numbers. |
| noon-ish | ~12:00 | common | ENGINE | -ish suffix on time alias not handled. |
| EOD | 17:00 | very-common | date.timeAliases | Data fix. |
| COB | 17:00 | very-common | date.timeAliases | Data fix. |
| half five | 5:30 (UK) | very-common | already works | No gap. |
| quarter past five | 5:15 | very-common | already works | No gap. |
| five till midnight | 23:55 | common | ENGINE | hourAmount() doesn't accept time aliases. |
| at 5 | 5:00 | very-common | ENGINE | Bare 'at' + digit; ambiguous meridiem. |
| Friday at five | Friday 5:00 | common | ENGINE | Word-number hour in time. |
| the fifteenth | 15th of this month | common | ENGINE | Bare ordinal without month. |

---

## Cross-language engine gaps

Evidence from `packages/lingo/src/` with file:line references.

### 1. CJK multi-character number composition broken by tokenizer

**Evidence:** `parse/tokenize.ts:97-100` (isCjkWord groups all adjacent CJK into
one token); `number/words.ts:143,150,171` (parser matches whole tokens against
ones/tens/scales)

**Impact:** zh/ja: ALL multi-character number-word expressions fail (三百, 二万,
十五, 三百五十万 all produce NO_VALUE). Only single-char numbers that happen to be
one token work. This is the #1 blocker for CJK quantity parsing.

**Proposal:** CJK number-word sub-parser that walks WITHIN a single CJK word
token, splitting it into (digit)(scale)(digit)(scale)... constituents. No new
pack field needed. Alternatively, tokenizer splits CJK runs at scale-word
boundaries using the loaded profile's scales keys.

### 2. Trailing-approx particles (左右/ぐらい/-ish/mas o menos) not pack-expressible in suffix position

**Evidence:** `parse/finish.ts:291-299` (only checks trailingApproxWords/
trailingApproxPhrases); `tokenize.ts:97-100` (CJK suffix particles merged into
unit token: '公斤左右' is one token)

**Impact:** zh/ja: 左右 and ぐらい are in approximateWords (prefix only) not
trailingApproxWords. Even if moved, tokenizer merges them with preceding unit.
es: 'mas o menos' as trailing phrase not expressible. All non-English trailing
approximation markers are blocked.

**Proposal:** (1) Data-only for romance: add trailingApproxPhrases entries. (2)
Engine for CJK: unit-matcher strips known trailing-approx suffixes from CJK
tokens, OR tokenizer splits at suffix-particle boundaries. New optional field:
`trailingApproxSuffixes`.

### 3. French vigesimal composition only works space-separated

**Evidence:** `number/words.ts:150-163` (tens+hyphen+ones requires ones value <
10); `parse/tokenize.ts` (hyphen produces sym token)

**Impact:** fr: 'soixante-dix' hyphenated fails because 'dix'=10 is not < 10.
quatre-vingt-dix (90) fails entirely (requires 4*20+10 multiplicative
composition). Currently misread as ranges.

**Proposal:** Either exhaustive entries in `numberWords.composed`
(soixante-dix:70 through quatre-vingt-dix-neuf:99) via CLDR RBNF, or a new
`numberWords.compounds` table for multiplicative patterns.

### 4. Spoken-clock-time grammar is hardcoded English

**Evidence:** `date/time.ts:177-199` (TIME_NUM_WORDS hardcoded);
`time.ts:229-258` (parseRelativeMinutes uses English regex:
'past|after|to|till|til|before')

**Impact:** All non-English: 'midi et quart' (fr), 'las tres menos cuarto' (es),
'duas e meia' (pt), 午後3時半 (zh/ja) all fail. The relative-minute grammar has
no locale extension point.

**Proposal:** New optional DateVocabPack fields: `clockPastWords`,
`clockToWords`, `clockMinuteWords` (quarter->15, half->30), `clockHalfBefore`
(boolean for German-style 'halb 3' = 2:30).

### 5. Adjacent-number ranges (三四个) not expressible for CJK

**Evidence:** `parse/range.ts:137-192` (rangeSeparator requires separator token);
`tokenize.ts:97-100` (三四个 is one CJK token)

**Impact:** zh/ja: idiomatic adjacent-number ranges cannot parse. Even spaced
forms need rangeAlternativeWords or separator mechanism.

**Proposal:** (1) Data: add CJK rangeAlternativeWords. (2) Engine: CJK number
sub-parser detects adjacent-numeral patterns and emits implicit range. New
optional field: `adjacentNumberRange` (boolean).

### 6. Unit-before-number order not supported

**Evidence:** `parse/quantity.ts:279-310` (parseQty always parses value first)

**Impact:** Minor: some informal Romance forms. Currency prefix is the only
exception and is already handled.

**Proposal:** No change needed. Document as intentional constraint.

### 7. 万/亿 scale grouping differs from Western composition

**Evidence:** `number/words.ts:171-178` (scale handling algorithm)

**Impact:** zh/ja: even if tokenizer gap is fixed, 三百五十万 (3,500,000) requires
(3*100 + 50) * 10000. The 十 in ones-table (value 10) conflicts with its
positional scale role.

**Proposal:** New optional `NumberWordTables.positionalScales` field for scales
that multiply the current accumulator (十: 10) rather than promoting to total.

---

## Field-coverage matrix

Fields where non-English packs are empty or inherit semantically-wrong English
values. Source: all 7 locale packs vs engine consumption points.

### Grammar fields (empty/inherits-en = needs locale data)

| field | es | fr | pt | zh | ja | consumed by |
|-------|----|----|----|----|----|----|
| compoundJoinWords | empty | empty | empty | empty | empty | quantity.ts:410 |
| compoundMinusWords | empty | empty | empty | empty | empty | quantity.ts:416 |
| compoundPlusWords | empty | empty | empty | empty | empty | quantity.ts:413 |
| globalFillers | empty | empty | empty | empty | empty | finish.ts:206 |
| qualifierArticleFollowers | empty | empty | empty | empty | empty | quantity.ts:98 |
| qualifierArticleWords | empty | empty | empty | empty | empty | quantity.ts:99 |
| qualifierFillers | empty | empty | empty | empty | empty | quantity.ts:88 |
| qualifierSkipAfterApprox | empty | empty | empty | empty | empty | quantity.ts:125 |
| qualifierSoftenerPhrases | empty | empty | empty | empty | empty | quantity.ts:109 |
| qualifierSoftenerWords | empty | empty | empty | empty | empty | quantity.ts:104 |
| rangeAlternativeWords | empty | empty | empty | empty | empty | range.ts:147 |
| trailingApproxPhrases | empty | empty | empty | empty | empty | finish.ts:291 |
| trailingApproxWords | empty | empty | empty | empty | empty | finish.ts:297 |
| trailingOkWords | empty | empty | empty | empty | empty | finish.ts:302 |

### Date vocab fields (empty/inherits-en or sparse)

| field | es | fr | pt | zh | ja | consumed by |
|-------|----|----|----|----|----|----|
| weekdays | filled | filled | filled | empty | empty | relative.ts:285 |
| weekdayNames | filled | filled | filled | empty | empty | relative.ts:319 |
| unitWords | filled/16 | filled/16 | filled/14 | empty | empty | relative.ts:508 |
| dayTimePhrases | filled/6 | filled/6 | filled/8 | filled/2 | filled/2 | relative.ts:91 |
| timePattern | empty | empty | empty | empty | empty | parse.ts:260 |
| timeCorePattern | empty | empty | empty | empty | empty | parse.ts:201 |
| subunit | empty | empty | empty | empty | empty | relative.ts:550 |

### Dead/unconsumed fields

| field | notes |
|-------|-------|
| FuzzyVocab.fillers | Declared in `core/registry.ts:83` but NO engine code reads it. globalFillers in grammar serves this role via `finish.ts:206`. |
| LocalePack.numerals | Consumed ONLY by `parseCompactNumber` in `date/relative.ts:740-746` for CJK compact offsets. NOT consumed by the main number-word parser (`words.ts`). |

---

## Prior art

### What chrono-node, Duckling, Recognizers-Text, and CLDR teach

**chrono-node** (MIT, 14 locales): imperative per-locale parsers + refiners
pipeline. Constants are flat dictionaries (string->number). LACKS data-driven
idiom coverage (no vigesimal French, no "en huit", no CJK scale composition).
Proves that imperative locale code does not scale. Japanese locale uses
normalizeTextToKanji() (hiragana -> kanji) before matching. The absence of these
idioms in a 14-locale library with active maintenance validates lingo's claim
that data-only packs done right can outperform hand-rolled parsers.

**facebook/duckling** (BSD-3-Clause, 49 languages, 15 dimensions): compositional
rule engine + per-language Rules.hs + Corpus.hs. French handles 'en huit/quinze'
via pattern-matching rules. CJK numerals use scale-suffix composition rules.
Corpus.hs files are gold-standard (input, expected_value) test pairs. The
combination of compositional rules + validation corpus is the architecture to
emulate in data form.

**Microsoft/Recognizers-Text** (MIT, 15 cultures): YAML-driven per-culture
pattern definitions. Most data-driven of the three. Key novel mechanisms:
**AmbiguityFiltersDict** (excludes '十足', '大陆' where numeral chars appear in
non-numeric words), **AllowListRegex** (200+ counter/classifier words for CJK),
gender-inflected number maps (doscientos/doscientas). Validates data-driven
design at scale.

**CLDR** (Unicode License, 100+ locales): the definitive source for generating
pack data. RBNF for number-word spellout rules (vigesimal, CJK, gender);
dateFields for relative-date vocabulary; units for localized unit aliases with
plural forms.

### Ranked data sources (with licenses)

1. **CLDR RBNF XML** (`unicode-org/cldr`, `common/rbnf/*.xml`) — Unicode License
   (ICU), MIT-compatible. Canonical number-word spellout rules for 100+ locales.
   Use to generate exhaustive numberWords entries.

2. **CLDR dateFields JSON** (`unicode-org/cldr-json`,
   `cldr-dates-full/main/*/dateFields.json`) — Unicode License. Structured
   relative-date vocabulary directly mappable to dayOffsets/calendarPeriodPhrases/
   relative fields.

3. **CLDR units JSON** (`unicode-org/cldr-json`,
   `cldr-units-full/main/*/units.json`) — Unicode License. Localized unit names
   with plural forms. Can generate unitAliases entries per locale.

4. **duckling Corpus.hs** (`facebook/duckling`,
   `Duckling/*/Lang/Corpus.hs`) — BSD-3-Clause (permissive, MIT-compatible for
   derived test data with copyright notice). Gold-standard test pairs across 49
   languages x 15 dimensions. Priority: ZH/JA Numeral, FR Time, EN/ZH Quantity.

5. **duckling Rules.hs** (same repo/license) — rule patterns as idiom inventory
   checklist. Useful for validation, not direct embedding.

6. **Recognizers-Text YAML** (`microsoft/Recognizers-Text`,
   `Patterns/*/[Lang]-Numbers.yaml`) — MIT License. AmbiguityFiltersDict, gender
   maps, AllowListRegex. Directly reusable.

7. **chrono-node constants** (`wanasit/chrono`, `src/locales/*/constants.ts`) —
   MIT License. Modest dictionaries for cross-reference only.

---

## Test infrastructure proposal

**Current state:** ~22 locale test cases total. Main corpus is English-only (~280
breadth + ~85 date rows). Existing locale tests do NOT exercise most grammar
fields for non-English.

**Proposed per-locale corpus shape:**

Each locale gets:
- `tests/corpus/locale-<id>-source.mjs` — exports `breadthRows`/`dateRows`/
  `dateRangeRows` with the same structure as the main corpus source.
- `tests/corpus/locale-<id>.json` — checked-in snapshot (contract).
- Gate script accepts `--update` flag to regenerate after intentional changes.

Row categories per locale:
1. Number-word cardinal/ordinal composition (ones, tens, hundreds, thousands,
   locale-specific scales)
2. All grammar paths: ranges (entre X y Y), bounds (al menos X), conversions
   (X a Y), compounds (dos metros y medio), trailing approx (mas o menos)
3. Date paths: day offsets, relative durations, weekday+modifier, calendar
   periods, time aliases, compact offsets (CJK)
4. Known-failing idioms marked with `xfail` flag and target issue code,
   graduating to pass as engine gaps are closed

The gate runs in `bun run check`. New rows are ADDITIVE; xfail documents gaps
without blocking CI.
