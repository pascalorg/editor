---
id: 006
title: Fuzzy language
status: approved
created: 2026-07-03
updated: 2026-07-03
---

# Fuzzy language

Fuzzy inputs are words that denote a *region* of a scale, not a point. We resolve them
to ranges with `approximate: true`, low confidence, and a `fuzzy` source tag — and we
map values back to words (`describe*`), making fuzzy language two-way like everything
else.

## Temperature vocabulary (profiles)

`parse("it's hot", { kind: 'temperature' })` → range. Leading fillers stripped:
`it's|its|it is|feels|feeling|kind of|kinda|pretty|really|very|so` (intensifiers
shift the band: "very hot" = upper half of hot ∪ next band).

Profiles (°C, `[min, max)`; data lives in `src/fuzzy/temperature.ts`, overridable):

| term | weather (default) | water | oven |
|------|-------------------|-------|------|
| freezing | [-90, 0) | [0, 4) | — |
| ice cold | [-90, 4) | [0, 8) | — |
| cold | [0, 10) | [8, 18) | [0, 90) |
| chilly | [3, 12) | — | — |
| cool | [10, 17) | [18, 24) | [90, 140) |
| mild | [15, 22) | — | — |
| lukewarm | — | [30, 37) | — |
| warm | [20, 28) | [37, 42) | [140, 170) |
| hot | [27, 35) | [42, 50) | [170, 220) |
| very hot | [33, 42) | [50, 60) | [220, 250) |
| scorching / boiling | [40, 55) | [95, 100] | [250, 300) |

`describeTemperature(q, { profile = 'weather' })` → nearest term whose band contains
the value (ties → narrower band). Round-trip: `parse(describeTemperature(q))` returns
a range containing q (tested).

## Size/amount adjectives — deliberately NOT parsed

"big", "heavy", "tall" have no defensible universal bands (a big dog ≠ a big planet).
Instead: the registry accepts *user-supplied* fuzzy vocabularies per kind:

```ts
defineFuzzyVocab(registry, 'mass', { light: [0, 5], heavy: [20, 1e9] }, { unit: 'kg' })
```

so product teams encode domain meaning ("heavy parcel" for a carrier) without us
inventing pseudo-science. Fuzzy amounts ("a few") are the number layer's job (plan 002).

## Result shape

Fuzzy parses return `type: 'range'` with `fuzzy: { term, profile }`, `approximate:
true`, confidence 0.5 base. DOM layer surfaces them as valid-but-imprecise (field
state `ambiguous`) so forms can ask "hot — around 30°C?" via the hint slot.
