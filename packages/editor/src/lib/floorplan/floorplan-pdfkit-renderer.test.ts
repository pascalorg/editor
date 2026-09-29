import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import PDFDocument from 'pdfkit'
import { floorplanGeometryMetadata } from './floorplan-extension'
import { FloorplanPdfDocument, loadFloorplanPdfFonts } from './floorplan-pdfkit-document'
import { renderFloorplanGeometryToPdfKit } from './floorplan-pdfkit-renderer'

describe('renderFloorplanGeometryToPdfKit', () => {
  test('writes dimension values as native PDF text with fixed point line weights', async () => {
    const geometry = {
      kind: 'dimension',
      start: [0, 0],
      end: [13, 0],
      offsetNormal: [0, -1],
      offsetDistance: 1,
      extensionOvershoot: 0.1,
      text: '13m',
    } satisfies FloorplanGeometry

    const pdf = await renderTestPdf(geometry)

    expect(pdf).toContain('BT')
    expect(extractPdfText(pdf)).toBe('13m')
    expect(pdf).toMatch(/0\.1 w/)
    expect(pdf).toMatch(/0\.15 w/)
    expect(pdf).not.toMatch(/ c\n/)
  })

  test('writes rotated annotation labels through PDF text operators', async () => {
    const geometry = {
      kind: 'text',
      x: 4,
      y: 3,
      text: 'ROOM 101',
      fontSize: 0.15,
      fontWeight: 600,
      upright: true,
      metadata: floorplanGeometryMetadata({ annotationRole: 'room-label' }),
    } satisfies FloorplanGeometry

    const pdf = await renderTestPdf(geometry, 45)

    expect(extractPdfText(pdf)).toBe('ROOM 101')
    expect(pdf).toContain('BT')
  })

  test('uses one font face, weight, and point size for every dimension value path', async () => {
    const geometries = [
      {
        kind: 'dimension',
        start: [0, 0],
        end: [4, 0],
        offsetNormal: [0, -1],
        offsetDistance: 1,
        extensionOvershoot: 0.1,
        text: '4m',
      },
      {
        kind: 'dimension-label',
        appearance: 'outlined',
        cx: 2,
        cy: 2,
        text: '2m',
        angle: 0,
      },
      {
        kind: 'text',
        x: 1,
        y: 3,
        text: '1m',
        fontSize: 0.22,
        fontWeight: 700,
        metadata: floorplanGeometryMetadata({ annotationRole: 'automatic-dimension' }),
      },
    ] satisfies FloorplanGeometry[]

    const pdfs = await Promise.all(geometries.map((geometry) => renderTestPdf(geometry)))
    const baseFonts = pdfs.flatMap((pdf) =>
      [...pdf.matchAll(/\/BaseFont \/(?:[A-Z]{6}\+)?([^\n]+)/g)].map((match) => match[1]),
    )
    const fontSizes = pdfs.flatMap((pdf) =>
      [...pdf.matchAll(/\/F\d+ ([\d.]+) Tf/g)].map((match) => match[1]),
    )

    expect([...new Set(baseFonts)]).toEqual(['GeistMono-Regular'])
    expect([...new Set(fontSizes)]).toEqual(['1.6'])
  })
  test('uses even-odd fill for compound plugin paths', async () => {
    const geometry = {
      kind: 'path',
      d: 'M0,0H4V4H0ZM1,1H3V3H1Z',
      fill: '#3f6b2f',
      fillRule: 'evenodd',
    } satisfies FloorplanGeometry

    const pdf = await renderTestPdf(geometry)

    expect(pdf).toMatch(/f\*/)
  })

  test('writes a data-url PNG image without resolving it as an asset', async () => {
    const geometry = {
      kind: 'image',
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      center: [2, 2],
      width: 1,
      height: 1,
    } satisfies FloorplanGeometry

    const pdf = await renderTestPdf(geometry)

    expect(pdf).toContain('/Subtype /Image')
  })
})

describe('embedded PDF fonts', () => {
  // what the permit set prints: code limits, dimension strings, schedule
  // callouts, revision deltas — none of them in pdfkit's WinAnsi standard fonts
  const PROBLEM_TEXT =
    'Vult ≤ 195 mph, runs ≥ 24" · VERIFY ≈ 3\'-2" × 6\'-10 ½" — 29.69°N ¼ ¾ ⅛ 5′ 6″ △ ΔT → √0.6'

  const textAt = (text: string, fontFamily?: string, fontWeight?: number) =>
    ({
      kind: 'text',
      x: 1,
      y: 1,
      text,
      fontSize: 0.5,
      fontFamily,
      fontWeight,
      dominantBaseline: 'alphabetic',
    }) satisfies FloorplanGeometry

  test('the problem glyphs round-trip through the text layer in the sans and mono families', async () => {
    for (const [family, weight] of [
      ['"IBM Plex Sans", Helvetica, Arial, sans-serif', 400],
      ['"IBM Plex Sans", Helvetica, Arial, sans-serif', 700],
      ['"IBM Plex Mono", Menlo, monospace', 400],
      ['"IBM Plex Mono", Menlo, monospace', 700],
    ] as const) {
      const pdf = await renderTestPdf(textAt(PROBLEM_TEXT, family, weight), 0, false)
      expect(extractPdfText(pdf)).toBe(PROBLEM_TEXT)
    }
  })

  test('embeds subset TrueType faces, never the unembedded standard 14', async () => {
    const pdf = await renderTestPdf(textAt(PROBLEM_TEXT), 0, false)
    const baseFonts = [...pdf.matchAll(/\/BaseFont \/([^\n]+)/g)].map((match) => match[1])
    expect(baseFonts.length).toBeGreaterThan(0)
    for (const name of baseFonts) expect(name).toMatch(/^[A-Z]{6}\+(LiberationSans|GeistMono)/)
    expect(pdf).toContain('/FontFile2')
    expect(pdf).not.toMatch(/\/BaseFont \/(Helvetica|Courier)/)
  })

  test('draws the symbols neither face carries — warning, pointer, angle — as linework', async () => {
    const pdf = await renderTestPdf(textAt('∠ 45° ⚠ open porch ▸ note'), 0, false)
    // the warning keeps a real "!" in the text layer; nothing falls to the .notdef glyph
    expect(extractPdfText(pdf)).toBe(' 45° ! open porch  note')
    expect(extractPdfText(pdf)).not.toContain('\u0000')
    // the triangle's ring is an even-odd fill; the pointer and the angle's strokes are plain fills
    expect(pdf).toMatch(/f\*/)
    expect(pdf.match(/\nf\n/g)?.length).toBeGreaterThanOrEqual(2)
  })

  test('collapses runs of white space the way SVG text does', async () => {
    const pdf = await renderTestPdf(
      { ...textAt('  APN  06075 \t  030\n062  '), textAnchor: 'end' },
      0,
      false,
    )
    expect(extractPdfText(pdf)).toBe('APN 06075 030 062')

    const raw = new PDFDocument({ autoFirstPage: false, compress: false })
    const doc = new FloorplanPdfDocument(raw, [200, 200], await loadFloorplanPdfFonts())
    const style = { fontFamily: 'sans-serif', fontSize: 10 }
    expect(doc.measureText(`RIDGE   20'-1"`, style)).toBe(doc.measureText(`RIDGE 20'-1"`, style))
    // a no-break space is content, not white space
    expect(doc.measureText('A\u00a0\u00a0B', style)).toBeGreaterThan(doc.measureText('A B', style))
    raw.end()
  })

  test('measures a mixed-face string as the sum of the runs it draws', async () => {
    const raw = new PDFDocument({ autoFirstPage: false, compress: false })
    const doc = new FloorplanPdfDocument(raw, [200, 200], await loadFloorplanPdfFonts())
    const style = { fontFamily: 'sans-serif', fontSize: 10 }
    const whole = doc.measureText('≤3△', style)
    const parts =
      doc.measureText('≤3', style) + doc.measureText('△', { ...style, fontFamily: 'monospace' })
    expect(whole).toBeCloseTo(parts, 6)
    // Liberation Sans keeps Helvetica's advance widths (the sheets were laid out against them)
    expect(doc.measureText('0', style)).toBeCloseTo(5.56, 2)
    raw.end()
  })
})

async function renderTestPdf(
  geometry: FloorplanGeometry,
  rotationDeg = 0,
  annotationLayer = true,
): Promise<string> {
  const raw = new PDFDocument({ autoFirstPage: false, compress: false })
  const chunks: Buffer[] = []
  raw.on('data', (chunk: Buffer) => chunks.push(chunk))
  const completed = new Promise<string>((resolve) => {
    raw.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')))
  })
  const doc = new FloorplanPdfDocument(raw, [200, 200], await loadFloorplanPdfFonts())
  doc.addPage()
  await renderFloorplanGeometryToPdfKit(doc, geometry, {
    annotationLayer,
    placement: { x: 20, y: 20, width: 100, height: 100 },
    rotationDeg,
    viewport: { x: 0, y: -2, width: 20, height: 20 },
  })
  raw.end()
  return completed
}

/**
 * The text an uncompressed pdfkit file carries, in drawing order: every TJ's
 * glyph ids decoded through its font's ToUnicode CMap — what a PDF reader's
 * text layer (search, copy, pdftotext) reads back.
 */
function extractPdfText(pdf: string): string {
  const objects = new Map<string, string>()
  for (const match of pdf.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) {
    objects.set(match[1]!, match[2]!)
  }
  const fontObjects = new Map<string, string>()
  for (const match of pdf.matchAll(/\/(F\d+) (\d+) 0 R/g)) fontObjects.set(match[1]!, match[2]!)
  const cmaps = new Map<string, Map<number, string>>()
  const cmapFor = (resource: string) => {
    let cmap = cmaps.get(resource)
    if (cmap) return cmap
    cmap = new Map()
    const font = objects.get(fontObjects.get(resource) ?? '') ?? ''
    const stream = objects.get(font.match(/\/ToUnicode (\d+) 0 R/)?.[1] ?? '') ?? ''
    for (const range of stream.matchAll(/<([0-9a-f]{4})> <[0-9a-f]{4}> \[([^\]]*)\]/g)) {
      let gid = Number.parseInt(range[1]!, 16)
      for (const entry of range[2]!.matchAll(/<([0-9a-f ]+)>/g)) {
        const units = entry[1]!.split(' ').map((hex) => Number.parseInt(hex, 16))
        cmap.set(gid++, String.fromCharCode(...units))
      }
    }
    cmaps.set(resource, cmap)
    return cmap
  }
  let text = ''
  let font = ''
  for (const op of pdf.matchAll(/\/(F\d+) [\d.]+ Tf|\[([^\]]*)\] TJ/g)) {
    if (op[1]) {
      font = op[1]
      continue
    }
    const cmap = cmapFor(font)
    for (const hex of op[2]!.matchAll(/<([0-9a-f]+)>/g)) {
      for (let i = 0; i < hex[1]!.length; i += 4) {
        text += cmap.get(Number.parseInt(hex[1]!.slice(i, i + 4), 16)) ?? '\uFFFD'
      }
    }
  }
  return text
}
