import { describe, expect, test } from 'bun:test'
import miami from './__fixtures__/map-dossier-miami-shores.json'
import stpete from './__fixtures__/map-dossier-stpete.json'
import {
  answered,
  contourLinesFromDossier,
  describeDossier,
  detectFrontEdgeFromFrontage,
  type Dossier,
  frontageSegmentsMetres,
  type ParcelData,
  parcelRingMetres,
  planPointFromLngLat,
  setbacksFromZoning,
  siteFactsFromDossier,
  type ZoningData,
} from './dossier'
import { cleanLotRing } from './clean-ring'
import { DEFAULT_SETBACKS_M, type ParcelResolveData, sitePatchFromParcel } from './lot-patch'

/**
 * Two RECORDED Pascal Map dossiers (2026-09-07, docs/reference/map-dossiers):
 * St Petersburg — every section answers, a 13-acre block with three
 * frontage segments, zone AE, wind 150 mph, DC-3 form-based zoning;
 * Miami Shores — no parcel plane, but flood / utilities / soils answer.
 */
const STPETE = stpete as unknown as Dossier
const MIAMI = miami as unknown as Dossier

describe('projection', () => {
  test('a point east and south of the origin reads +x, +z in metres', () => {
    const p = planPointFromLngLat([-82.6, 27.7], [-82.599, 27.699])
    expect(p[0]).toBeGreaterThan(0)
    expect(p[1]).toBeGreaterThan(0)
    // 0.001° of latitude ≈ 364 ft ≈ 111 m
    expect(p[1]).toBeCloseTo(0.001 * 364000 * 0.3048, 3)
  })
})

describe('the St Petersburg dossier', () => {
  const parcel = answered<ParcelData>(STPETE, 'parcel')!
  const origin: [number, number] = [STPETE.point.lng, STPETE.point.lat]

  test('the parcel ring: the largest polygon, in plan metres, about 13 acres', () => {
    const ring = parcelRingMetres(parcel, origin)
    expect(ring.length).toBeGreaterThanOrEqual(4)
    let a = 0
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!
      const q = ring[(i + 1) % ring.length]!
      a += p[0] * q[1] - q[0] * p[1]
    }
    expect(Math.abs(a) / 2).toBeCloseTo(53022, -3) // area_m2 on the record, within a few hundred m²
  })

  test('the frontage: three street edges of the fabric become segments; the longest fronting edge of the cleaned ring is the front', () => {
    const segments = frontageSegmentsMetres(parcel, origin)
    expect(segments.length).toBeGreaterThanOrEqual(3)
    const ring = cleanLotRing(parcelRingMetres(parcel, origin)).points
    const match = detectFrontEdgeFromFrontage(ring, segments)
    expect(match).not.toBeNull()
    expect(match!.frontingEdges).toBeGreaterThanOrEqual(2) // a block: streets on more than one side
    // the front is the longest fronting edge
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % ring.length]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (i !== match!.index && len > match!.lengthM + 1e-6) {
        const other = detectFrontEdgeFromFrontage([a, b, [b[0] + 1, b[1] + 1]], segments)
        // a longer edge exists only if it does not front
        expect(other === null || other.index !== 0).toBe(true)
      }
    }
  })

  test('DC-3 form-based zoning: null setbacks stay null, the note is the code text', () => {
    const zoning = answered<ZoningData>(STPETE, 'zoning')!
    expect(zoning.district).toBe('DC-3')
    expect(setbacksFromZoning(zoning)).toBeNull()
    expect(zoning.dimensional_note).toContain('FAR')
    expect(setbacksFromZoning({ setbacks: { front_ft: 25, side_ft: 7.5, rear_ft: 20 } })).toEqual({
      front: 25 * 0.3048,
      side: 7.5 * 0.3048,
      rear: 20 * 0.3048,
    })
  })

  test('the facts the site keeps: every section status, the flood / code basis / zoning / utilities data, no geometry, no neighbours', () => {
    const facts = siteFactsFromDossier(STPETE)
    expect(facts.provider).toBe('Pascal Map')
    expect(facts.sections.parcel?.status).toBe('available')
    expect(facts.sections.permits?.status).toBe('not_covered')
    expect((facts.flood as { zone_at_point?: { zone?: string } }).zone_at_point?.zone).toBe('AE')
    expect((facts.codeBasis as { wind_speed_mph?: number }).wind_speed_mph).toBe(150)
    expect((facts.zoning as { district?: string }).district).toBe('DC-3')
    expect((facts.utilities as { wastewater?: string }).wastewater).toBe('sewer')
    expect(JSON.stringify(facts)).not.toContain('"geometry"')
    expect((facts.parcel as Record<string, unknown>).adjacent_parcels).toBeUndefined()
    expect(describeDossier(STPETE)).toContain('sections answered')
  })

  test('the lot patch: the frontage edge beats the road match; the facts ride the site', () => {
    const ring = parcelRingMetres(parcel, origin)
    const data: ParcelResolveData = {
      ok: true,
      polygonM: ring.map((p) => [p[0], p[1]]),
      originLngLat: origin,
      state: 'FL',
      geocodedBy: 'pascal-map',
    }
    const segments = frontageSegmentsMetres(parcel, origin)
    const facts = siteFactsFromDossier(STPETE)
    const out = sitePatchFromParcel(null, { address: '501 5th Ave N' }, data, null, '2026-09-07T00:00:00Z', {
      frontageSegmentsM: segments,
      setbacks: null,
      dimensionalNote: 'No minimum lot area',
      zone: 'DC-3',
      facts,
      line: 'Pascal Map: 12 sections answered',
    })!
    expect(out.summary.frontEdgeSource).toBe('frontage')
    expect(out.summary.frontEdge).not.toBeNull()
    expect(out.patch.frontEdge).toBe(out.summary.frontEdge!)
    expect(out.patch.zone).toBe('DC-3')
    // a conditional rule: the default stands and the code text is noted
    expect(out.patch.setbacks).toEqual(DEFAULT_SETBACKS_M)
    expect(out.summary.notes.some((n) => n.includes('Zoning condition'))).toBe(true)
    expect(out.patch.dossier?.provider).toBe('Pascal Map')
    // numbers from the code win over the default
    const zoned = sitePatchFromParcel(null, { address: 'x' }, data, null, '2026-09-07T00:00:00Z', {
      setbacks: { front: 7.62, side: 2.286, rear: 6.096 },
      setbacksSource: 'Zoning R-1 — Section 17.212 — via Pascal Map',
      facts,
      line: '',
    })!
    expect(zoned.patch.setbacks).toEqual({ front: 7.62, side: 2.286, rear: 6.096 })
    expect(zoned.patch.setbacksSource).toContain('Section 17.212')
    expect(zoned.summary.setbacksDefaulted).toBe(false)
  })
})

describe('the Miami Shores dossier (no parcel plane)', () => {
  test('parcel not covered, flood and utilities answer; the ring is empty', () => {
    expect(answered(MIAMI, 'parcel')).toBeNull()
    expect(MIAMI.layers.parcel?.status).toBe('not_covered')
    expect(parcelRingMetres(answered<ParcelData>(MIAMI, 'parcel'), [MIAMI.point.lng, MIAMI.point.lat])).toEqual([])
    const facts = siteFactsFromDossier(MIAMI)
    expect(facts.parcel).toBeUndefined()
    expect((facts.flood as { zone_at_point?: { zone?: string } }).zone_at_point?.zone).toBe('X')
    expect(((facts.utilities as { electric_providers?: { name: string }[] }).electric_providers ?? [])[0]?.name).toContain('FLORIDA POWER')
    expect(describeDossier(MIAMI)).toContain('parcel')
  })
})

describe('the 3DEP contour lines', () => {
  test('St Petersburg: 129 one-foot lines projected into the site frame, thinned, NAVD88', () => {
    const origin: [number, number] = [STPETE.point.lng, STPETE.point.lat]
    const lines = contourLinesFromDossier(STPETE, origin)
    expect(lines).not.toBeNull()
    expect(lines!.datum).toBe('NAVD88')
    expect(lines!.intervalFt).toBe(1)
    expect(lines!.source).toContain('3DEP')
    expect(lines!.lines.length).toBe(129)
    const elevations = new Set(lines!.lines.map((l) => l.elevationFt))
    expect(Math.min(...elevations)).toBe(0)
    expect(Math.max(...elevations)).toBeCloseTo(20, 0)
    // every point within the parcel bbox's reach of the origin (a 13-acre block: a few hundred metres)
    let n = 0
    for (const l of lines!.lines) {
      expect(l.points.length).toBeGreaterThanOrEqual(2)
      for (const p of l.points) {
        expect(Math.hypot(p[0], p[1])).toBeLessThan(600)
        n++
      }
      for (let i = 1; i < l.points.length; i++) {
        const a = l.points[i - 1]!
        const b = l.points[i]!
        expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThanOrEqual(0.3 - 1e-9)
      }
    }
    // thinned below the 3501 recorded vertices
    expect(n).toBeLessThan(3501)
    expect(n).toBeGreaterThan(1000)
  })

  test('Miami Shores: the section answers without lines → null', () => {
    const origin: [number, number] = [MIAMI.point.lng, MIAMI.point.lat]
    expect(contourLinesFromDossier(MIAMI, origin)).toBeNull()
  })
})
