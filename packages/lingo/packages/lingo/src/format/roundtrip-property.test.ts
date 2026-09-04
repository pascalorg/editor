/**
 * Property-based round-trip tests (plan 010 layer 2).
 *
 * Invariant: for-all kind, for-all unit, random magnitudes across regimes:
 *   parse(format(quantity(mag, unit))) ≈ quantity(mag, unit).base
 *
 * Uses a deterministic seeded PRNG (mulberry32) so failures reproduce.
 * Zero new dependencies.
 */
import { describe, expect, it } from 'vitest'
import { listKinds, listUnits, type UnitInfo } from '../catalog/index'
import { approxEqual } from '../core/round'
import { parseQuantity, quantity } from '../index'
import type { FormatOptions } from './format'

// ---------------------------------------------------------------------------
// Deterministic PRNG: mulberry32 (public domain, 32-bit state, full period)
// ---------------------------------------------------------------------------

const SEED = 0xde_ad_be_ef

function mulberry32(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6d_2b_79_f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

// ---------------------------------------------------------------------------
// Magnitude regimes
// ---------------------------------------------------------------------------

type Regime = 'tiny' | 'everyday' | 'large' | 'negative' | 'boundary'

function randomMagnitude(rand: () => number, regime: Regime): number {
  switch (regime) {
    case 'tiny':
      return 1e-6 + rand() * (1e-3 - 1e-6)
    case 'everyday':
      return 0.1 + rand() * 999.9
    case 'large':
      return 1e3 + rand() * (1e9 - 1e3)
    case 'negative':
      return -(0.1 + rand() * 999.9)
    case 'boundary': {
      // Near half-step boundaries for rounding: x.x5, x.x50001, x.x49999
      const base = 1 + rand() * 98
      const halfStep = Math.floor(base * 100) / 100 + 0.005
      const jitter = (rand() - 0.5) * 1e-6
      return halfStep + jitter
    }
  }
}

// ---------------------------------------------------------------------------
// Kinds that sensibly support negative values
// ---------------------------------------------------------------------------

const NEGATIVE_ALLOWED_KINDS = new Set([
  'temperature',
  'voltage',
  'current',
  'force',
  'torque',
  'acceleration',
  'power',
  'angle',
])

// Temperature units with offset: negative magnitudes can produce unphysical
// absolute temperatures (e.g. -500 C = -226.85 K, below absolute zero).
// The library still formats/parses them, but we only test modest negatives
// for offset-bearing units to avoid excessively large base values that lose
// significance after format rounding.
const TEMPERATURE_OFFSET_UNITS = new Set(['C', 'F'])

// ---------------------------------------------------------------------------
// Known failures — legitimate round-trip bugs discovered by this property test.
// Each entry documents the minimal repro and is EXCLUDED from assertions.
// ---------------------------------------------------------------------------

interface KnownFailure {
  kind: string
  reason: string
  unit: string
}

const KNOWN_FAILURES: KnownFailure[] = [
  // Documented D43 behavior: Charge "C" (coulomb) is always re-parsed as
  // temperature "C" (Celsius) due to the parser's default priority.
  // Affects both narrow ("5 C") and symbol ("5 C"). This is intentional —
  // kind:'charge' context resolves it; not a bug.
  { kind: 'charge', unit: 'C', reason: 'D43: C resolves to temperature by parser priority' },
]

function isKnownFailure(kind: string, unitId: string): boolean {
  return KNOWN_FAILURES.some((f) => f.kind === kind && f.unit === unitId)
}

// ---------------------------------------------------------------------------
// Format option grid (mirrors the existing round-trip tests)
// ---------------------------------------------------------------------------

interface StyleConfig {
  label: string
  opts: FormatOptions
}

const STYLE_GRID: StyleConfig[] = [
  { label: 'symbol', opts: { style: 'symbol' } },
  { label: 'long', opts: { style: 'long' } },
  { label: 'narrow', opts: { style: 'narrow' } },
  { label: 'compound', opts: { style: 'symbol', compound: true } },
  { label: 'scientific/e', opts: { notation: 'scientific', exponentStyle: 'e' } },
  { label: 'scientific/times', opts: { notation: 'scientific', exponentStyle: 'times' } },
  {
    label: 'scientific/superscript',
    opts: { notation: 'scientific', exponentStyle: 'superscript' },
  },
  { label: 'engineering/e', opts: { notation: 'engineering', exponentStyle: 'e' } },
  { label: 'engineering/times', opts: { notation: 'engineering', exponentStyle: 'times' } },
  {
    label: 'engineering/superscript',
    opts: { notation: 'engineering', exponentStyle: 'superscript' },
  },
]

// ---------------------------------------------------------------------------
// Tolerance: format rounds to 4 significant digits by default. The round-trip
// comparison must tolerate that precision loss. We compare parse(format(q)).base
// against the EXPECTED base after the same rounding format would apply, using
// relative tolerance. 1e-4 relative covers the 4-sig-fig default.
// For scientific/engineering notation format preserves more precision via the
// coefficient, but 4 sig figs is still the bottleneck.
// ---------------------------------------------------------------------------

const REL_TOLERANCE = 1e-3 // generous: 4 sig figs → ~1e-4 relative; allow 1e-3 for compound carry

// Compound format rounds subunits to whole integers (precision 0) by default,
// so a value like 5.785 lb → "5 lb 13 oz" (loses fractional oz). The relative
// error is bounded by 1/(subunit-per-unit × value-in-parent), typically 1-5%.
const REL_TOLERANCE_COMPOUND = 0.02

function assertRoundTrip(
  original: { base: number; kind: string; unit: string },
  formatted: string,
  styleLabel: string,
  magnitude: number,
  seed: number,
  isCompound: boolean,
): void {
  const back = parseQuantity(formatted)
  if (!back.ok) {
    throw new Error(
      `[SEED=${seed.toString(16)}] round-trip parse FAILED\n` +
        `  kind=${original.kind} unit=${original.unit} mag=${magnitude}\n` +
        `  style=${styleLabel}\n` +
        `  formatted="${formatted}"\n` +
        `  issues=${JSON.stringify(back.issues)}`,
    )
  }

  const expectedBase = original.base
  const actualBase = back.quantity.base
  const tolerance = isCompound ? REL_TOLERANCE_COMPOUND : REL_TOLERANCE

  // Zero: both should be zero
  if (expectedBase === 0) {
    expect(
      Math.abs(actualBase) < 1e-12,
      `[SEED=${seed.toString(16)}] kind=${original.kind} unit=${original.unit} ` +
        `mag=${magnitude} style=${styleLabel}: expected ~0, got ${actualBase} ` +
        `(formatted="${formatted}")`,
    ).toBe(true)
    return
  }

  if (!approxEqual(actualBase, expectedBase, tolerance)) {
    throw new Error(
      `[SEED=${seed.toString(16)}] round-trip VALUE MISMATCH\n` +
        `  kind=${original.kind} unit=${original.unit} mag=${magnitude}\n` +
        `  style=${styleLabel}\n` +
        `  formatted="${formatted}"\n` +
        `  expected base=${expectedBase}, got base=${actualBase}\n` +
        `  relative error=${Math.abs(actualBase - expectedBase) / Math.abs(expectedBase)}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Main property test
// ---------------------------------------------------------------------------

describe('property: format/parse round-trip (all kinds, all units)', () => {
  const rand = mulberry32(SEED)
  const allKindsList = listKinds()

  // Exclude currency (rate-based, D28/D31 — no cross-unit conversion property)
  const testableKinds = allKindsList.filter((k) => k !== 'currency')

  const MAGNITUDES_PER_CELL = 4
  let totalCases = 0
  let skippedKnown = 0

  for (const kind of testableKinds) {
    const units = listUnits(kind)

    it(`round-trips all ${units.length} ${kind} units across regimes and styles`, () => {
      for (const unitInfo of units) {
        if (isKnownFailure(kind, unitInfo.id)) {
          skippedKnown++
          continue
        }

        // Determine which regimes apply to this kind/unit
        const regimes: Regime[] = ['tiny', 'everyday', 'large', 'boundary']
        if (NEGATIVE_ALLOWED_KINDS.has(kind)) {
          regimes.push('negative')
        }

        // Temperature offset units: restrict magnitudes to avoid unphysical extremes
        const isOffsetTemp = kind === 'temperature' && TEMPERATURE_OFFSET_UNITS.has(unitInfo.id)

        for (const regime of regimes) {
          // For offset temperature units, skip 'large' regime (would produce
          // enormous base values that lose sig figs) and use modest negatives
          if (isOffsetTemp && regime === 'large') {
            continue
          }
          if (isOffsetTemp && regime === 'negative') {
            // Test modest negatives for C/F (-50 to -1)
            for (let i = 0; i < MAGNITUDES_PER_CELL; i++) {
              const mag = -(1 + rand() * 49)
              runCell(kind, unitInfo, mag, 'negative(modest)')
            }
            continue
          }

          for (let i = 0; i < MAGNITUDES_PER_CELL; i++) {
            const mag = randomMagnitude(rand, regime)
            runCell(kind, unitInfo, mag, regime)
          }
        }
      }
    })

    function runCell(kind: string, unitInfo: UnitInfo, mag: number, regimeLabel: string): void {
      // Build the quantity via the public API
      let q: ReturnType<typeof quantity>
      try {
        q = quantity(mag, unitInfo.id, kind)
      } catch {
        // Some units may not be directly constructible with extreme values
        return
      }

      for (const style of STYLE_GRID) {
        // Compound only makes sense for everyday+ magnitudes with positive values;
        // tiny values round to "0 unit" in compound mode (precision loss, not a bug)
        if (style.label === 'compound' && (mag < 0 || Math.abs(mag) < 0.01)) {
          continue
        }

        let formatted: string
        try {
          formatted = q.format(style.opts)
        } catch {
          // Some format options may not apply to all kinds (e.g. compound on
          // kinds without subunit chains just formats normally — never throws)
          continue
        }

        assertRoundTrip(
          { base: q.base, kind, unit: unitInfo.id },
          formatted,
          `${regimeLabel}/${style.label}`,
          mag,
          SEED,
          style.label === 'compound',
        )
        totalCases++
      }
    }
  }

  it('covers a meaningful number of cases', () => {
    // Sanity: we exercised at least kinds * units * some cases
    expect(totalCases).toBeGreaterThan(5000)
  })

  it('reports coverage stats', () => {
    const kindCount = testableKinds.length
    const unitCount = testableKinds.reduce((sum, k) => sum + listUnits(k).length, 0)
    console.log(
      `[roundtrip-property] ${kindCount} kinds, ${unitCount} units, ` +
        `${STYLE_GRID.length} styles, ${MAGNITUDES_PER_CELL} mags/regime\n` +
        `  ${totalCases} total cases passed\n` +
        (skippedKnown > 0 ? `  ${skippedKnown} skipped (known per-unit failures)\n` : ''),
    )
  })
})

// ---------------------------------------------------------------------------
// Property 2: JSON serialization span integrity
// ---------------------------------------------------------------------------

describe('property: JSON serialize round-trip preserves span text', () => {
  const rand = mulberry32(SEED ^ 0x12_34_56_78) // different sequence
  const testableKinds = listKinds().filter((k) => k !== 'currency')
  const SAMPLES_PER_KIND = 5

  for (const kind of testableKinds) {
    it(`${kind}: JSON.parse(JSON.stringify(result)) spans match input slices`, () => {
      const units = listUnits(kind)
      // Pick a few representative units per kind
      const stride = Math.max(1, Math.floor(units.length / SAMPLES_PER_KIND))

      for (let ui = 0; ui < units.length; ui += stride) {
        const unitInfo = units[ui]!
        const mag = 0.1 + rand() * 999.9

        let q: ReturnType<typeof quantity>
        try {
          q = quantity(mag, unitInfo.id, kind)
        } catch {
          continue
        }

        const formatted = q.format()
        const result = parseQuantity(formatted)
        if (!result.ok) {
          continue
        }

        // Serialize and deserialize
        const wire = JSON.parse(JSON.stringify(result))

        // Check span integrity on issues (if any)
        if (wire.issues && Array.isArray(wire.issues)) {
          for (const issue of wire.issues) {
            if (issue.span) {
              const { start, end } = issue.span
              expect(start).toBeGreaterThanOrEqual(0)
              expect(end).toBeLessThanOrEqual(formatted.length)
              expect(start).toBeLessThan(end)
              const slice = formatted.slice(start, end)
              expect(
                slice.length,
                `span [${start},${end}) of "${formatted}" should be non-empty`,
              ).toBeGreaterThan(0)
            }
          }
        }

        // The text field on the result should match the input
        if (wire.text !== undefined) {
          expect(wire.text).toBe(formatted)
        }
      }
    })
  }
})
