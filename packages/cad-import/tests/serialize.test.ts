import { describe, expect, it } from 'bun:test'
import { parseDxf } from '../src/parse'
import { fromUnderlayBuffer, toUnderlayBuffer } from '../src/serialize'
import { dxf, entities, header, layerTable, line, segmentAt } from './fixtures'

const drawing = parseDxf(
  dxf(
    header({ $INSUNITS: [70, 4] }),
    layerTable([
      { name: 'DUVAR', color: 7 },
      { name: 'KAPI', color: -3 },
    ]),
    entities(line('DUVAR', 0, 0, 1000, 0) + line('KAPI', 1000, 0, 1000, 2000)),
  ),
)

describe('underlay buffer', () => {
  it('round-trips layers, units and stats', () => {
    const underlay = fromUnderlayBuffer(toUnderlayBuffer(drawing))

    expect(underlay.layers.map((l) => l.name)).toEqual(['DUVAR', 'KAPI'])
    expect(underlay.layers[1]?.visible).toBe(false)
    expect(underlay.metersPerUnit).toBe(0.001)
    expect(underlay.stats.segmentCount).toBe(2)
    expect([...underlay.segmentLayers]).toEqual([...drawing.segmentLayers])
  })

  it('recentres coordinates on the drawing origin', () => {
    const underlay = fromUnderlayBuffer(toUnderlayBuffer(drawing))

    // Drawing spans x 0..1000, y 0..2000 → centre (500, 1000).
    expect(underlay.origin).toEqual([500, 1000])
    expect(segmentAt(underlay.segments, 0)).toEqual([-500, -1000, 500, -1000])
    expect(underlay.bounds).toEqual({ minX: -500, minY: -1000, maxX: 500, maxY: 1000 })
  })

  it('keeps sub-millimetre accuracy on survey-referenced coordinates', () => {
    // A drawing placed on a national grid: ~500 km east in millimetres. Storing
    // these raw as float32 would quantise to ~30 mm; recentring first is what
    // makes the float32 buffer safe.
    const far = parseDxf(
      dxf(entities(line('0', 500_000_000, 4_500_000_000, 500_000_100, 4_500_000_000))),
    )
    const underlay = fromUnderlayBuffer(toUnderlayBuffer(far))

    const [x1, , x2] = segmentAt(underlay.segments, 0)
    expect(Math.abs(x2 - x1 - 100)).toBeLessThan(0.001)
  })

  it('centres on the content, not on a stray entity parked off-canvas', () => {
    // The shape of a real production file: a compact building, plus one
    // symbol someone dragged far to the left and forgot. Centring on the raw
    // bounding box would put the scene origin between the two — nowhere near
    // the building the user came to trace.
    let body = ''
    for (let i = 0; i < 400; i++) {
      body += line('DUVAR', 64_000 + i, 15_000, 64_000 + i, 34_000)
    }
    body += line('ARK_İnsan', -65_000, 27_000, -64_900, 27_000)

    const parsed = parseDxf(dxf(header({ $INSUNITS: [70, 4] }), entities(body)))
    const underlay = fromUnderlayBuffer(toUnderlayBuffer(parsed))

    // Raw bbox centre would be ≈ 0 (halfway between -65,000 and 64,400).
    expect(underlay.origin[0]).toBeGreaterThan(60_000)

    // The building straddles the origin; the stray is still present, just far
    // away and no longer in charge of the framing.
    expect(underlay.contentBounds.minX).toBeGreaterThan(-1000)
    expect(underlay.contentBounds.maxX).toBeLessThan(1000)
    expect(underlay.bounds.minX).toBeLessThan(-100_000)
  })

  it('keeps the stray geometry it declines to centre on', () => {
    let body = ''
    for (let i = 0; i < 400; i++) body += line('DUVAR', 1000 + i, 0, 1000 + i, 500)
    body += line('STRAY', -900_000, 0, -899_000, 0)

    const parsed = parseDxf(dxf(entities(body)))
    const underlay = fromUnderlayBuffer(toUnderlayBuffer(parsed))

    expect(underlay.segmentLayers.length).toBe(401)
    let lowest = Number.POSITIVE_INFINITY
    for (let i = 0; i < underlay.segmentLayers.length; i++) {
      lowest = Math.min(lowest, segmentAt(underlay.segments, i)[0])
    }
    expect(lowest).toBeLessThan(-500_000)
  })

  it('falls back to the full extent when there is nothing to trim', () => {
    const square = parseDxf(dxf(entities(line('0', 0, 0, 100, 100))))
    const underlay = fromUnderlayBuffer(toUnderlayBuffer(square))
    expect(underlay.contentBounds).toEqual(underlay.bounds)
  })

  it('trims a modest drawing too, not only a huge one', () => {
    // 60 segments — far too few for a 0.5% trim to round to anything, so this
    // exercises the segment floor rather than the percentage.
    let body = ''
    for (let i = 0; i < 60; i++) body += line('DUVAR', i * 10, 0, i * 10, 200)
    body += line('STRAY', -50_000, 0, -49_000, 0)

    const underlay = fromUnderlayBuffer(toUnderlayBuffer(parseDxf(dxf(entities(body)))))

    expect(underlay.contentBounds.minX).toBeGreaterThan(underlay.bounds.minX + 40_000)
  })

  it('picks the busier sheet when a drawing is a layout of several', () => {
    // The shape a real production file turns out to have: model space holding
    // more than one drawing side by side. A percentile trim cannot help —
    // both sides are real geometry — and centring between them would put the
    // scene origin in the empty gap.
    let body = ''
    for (let i = 0; i < 400; i++) body += line('DUVAR', 60_000 + i * 10, 0, 60_000 + i * 10, 5000)
    for (let i = 0; i < 80; i++) body += line('DUVAR', -40_000 + i * 10, 0, -40_000 + i * 10, 5000)

    const underlay = fromUnderlayBuffer(
      toUnderlayBuffer(parseDxf(dxf(header({ $INSUNITS: [70, 4] }), entities(body)))),
    )

    // Origin lands on the big sheet, not between the two.
    expect(underlay.origin[0]).toBeGreaterThan(55_000)
    // …and the content extent describes that sheet, not the pair.
    expect(underlay.contentBounds.maxX - underlay.contentBounds.minX).toBeLessThan(10_000)
    // The smaller sheet is still drawn, just not in charge.
    expect(underlay.bounds.minX).toBeLessThan(-90_000)
  })

  it('does not mistake the two ends of parallel lines for two drawings', () => {
    // A rectangle drawn as vertical lines has exactly two distinct endpoint Y
    // values. Clustering on endpoints reads that as two far-apart drawings and
    // discards half the building — which is most buildings.
    let body = ''
    for (let i = 0; i < 120; i++) body += line('DUVAR', i * 250, 0, i * 250, 20_000)

    const underlay = fromUnderlayBuffer(
      toUnderlayBuffer(parseDxf(dxf(header({ $INSUNITS: [70, 4] }), entities(body)))),
    )

    expect(underlay.contentBounds.maxY - underlay.contentBounds.minY).toBeGreaterThan(19_000)
    expect(underlay.contentBounds.maxX - underlay.contentBounds.minX).toBeGreaterThan(28_000)
  })

  it('measures surviving walls end to end, not from their middles', () => {
    let body = ''
    for (let i = 0; i < 120; i++) body += line('DUVAR', i * 250, 0, i * 250, 20_000)

    const underlay = fromUnderlayBuffer(
      toUnderlayBuffer(parseDxf(dxf(header({ $INSUNITS: [70, 4] }), entities(body)))),
    )

    // Half of 20,000 would be the answer if the extent came from midpoints.
    expect(underlay.contentBounds.maxY - underlay.contentBounds.minY).toBeCloseTo(20_000, -1)
  })

  it('does not split a drawing that merely has a courtyard in it', () => {
    // A gap has to be large relative to the whole span before it reads as
    // separate sheets; an internal void must not fool it.
    let body = ''
    for (let i = 0; i < 200; i++) body += line('DUVAR', i * 10, 0, i * 10, 5000)
    for (let i = 0; i < 200; i++) body += line('DUVAR', 2400 + i * 10, 0, 2400 + i * 10, 5000)

    const underlay = fromUnderlayBuffer(
      toUnderlayBuffer(parseDxf(dxf(header({ $INSUNITS: [70, 4] }), entities(body)))),
    )

    expect(underlay.contentBounds.maxX - underlay.contentBounds.minX).toBeGreaterThan(3500)
  })

  it('reports an unrecognised buffer instead of decoding garbage', () => {
    const junk = new ArrayBuffer(64)
    expect(() => fromUnderlayBuffer(junk)).toThrow(/Pascal CAD underlay/)
  })

  it('handles an empty drawing', () => {
    const empty = fromUnderlayBuffer(toUnderlayBuffer(parseDxf(dxf(entities('')))))

    expect(empty.segments.length).toBe(0)
    expect(empty.segmentLayers.length).toBe(0)
    expect(empty.origin).toEqual([0, 0])
  })

  it('leaves an unitless drawing marked for calibration', () => {
    const unitless = parseDxf(dxf(entities(line('0', 0, 0, 10, 0))))
    expect(fromUnderlayBuffer(toUnderlayBuffer(unitless)).metersPerUnit).toBeNull()
  })
})
