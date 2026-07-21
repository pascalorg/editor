import { describe, expect, test } from 'bun:test'
import type { FloorplanGeometry } from '@pascal-app/core'
import PDFDocument from 'pdfkit'
import { floorplanGeometryMetadata } from './floorplan-extension'
import { FloorplanPdfDocument } from './floorplan-pdfkit-document'
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
    expect(pdf).toContain(`[<${Buffer.from('13m').toString('hex')}> 0] TJ`)
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

    expect(pdf).toContain(`<${Buffer.from('OOM 101').toString('hex')}>`)
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
      [...pdf.matchAll(/\/BaseFont \/([^\n]+)/g)].map((match) => match[1]),
    )
    const fontSizes = pdfs.flatMap((pdf) =>
      [...pdf.matchAll(/\/F\d+ ([\d.]+) Tf/g)].map((match) => match[1]),
    )

    expect([...new Set(baseFonts)]).toEqual(['Courier'])
    expect([...new Set(fontSizes)]).toEqual(['1.6'])
  })
})

async function renderTestPdf(geometry: FloorplanGeometry, rotationDeg = 0): Promise<string> {
  const raw = new PDFDocument({ autoFirstPage: false, compress: false })
  const chunks: Buffer[] = []
  raw.on('data', (chunk: Buffer) => chunks.push(chunk))
  const completed = new Promise<string>((resolve) => {
    raw.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')))
  })
  const doc = new FloorplanPdfDocument(raw, [200, 200])
  doc.addPage()
  await renderFloorplanGeometryToPdfKit(doc, geometry, {
    annotationLayer: true,
    placement: { x: 20, y: 20, width: 100, height: 100 },
    rotationDeg,
    viewport: { x: 0, y: -2, width: 20, height: 20 },
  })
  raw.end()
  return completed
}
