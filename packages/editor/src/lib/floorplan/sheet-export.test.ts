import { afterEach, describe, expect, test } from 'bun:test'
import { exportSheetsToPdf, type SheetPdfPage } from './sheet-export'

const sheet = (number: string, title: string): SheetPdfPage => ({
  number,
  title,
  widthIn: 36,
  heightIn: 24,
  plate: [],
  windows: [],
  overlay: [],
})

const globals = globalThis as unknown as Record<string, unknown>
const originalDocument = globals.document
const originalCreateObjectURL = URL.createObjectURL

afterEach(() => {
  globals.document = originalDocument
  URL.createObjectURL = originalCreateObjectURL
})

/** Runs the export with the browser download stubbed, returning the file and its name. */
async function exportToBytes(pages: SheetPdfPage[], documentTitle: string) {
  let blob: Blob | null = null
  let filename = ''
  URL.createObjectURL = (object: Blob | MediaSource) => {
    blob = object as Blob
    return 'blob:sheet-export-test'
  }
  globals.document = {
    createElement: () => {
      const anchor = {
        href: '',
        download: '',
        click: () => {
          filename = anchor.download
        },
      }
      return anchor
    },
  }
  await exportSheetsToPdf(pages, 'qa-hip-ranch_2026-09-23.pdf', documentTitle)
  if (!blob) throw new Error('the export produced no file')
  const pdf = Buffer.from(await (blob as Blob).arrayBuffer()).toString('latin1')
  return { pdf, filename }
}

/** The PDF literal string opening at `start` ("(…)"), decoded — UTF-16BE when it carries the BOM. */
function readLiteral(pdf: string, start: number): string {
  const escaped: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }
  let bytes = ''
  for (let i = start + 1; pdf[i] !== ')'; i += 1) {
    if (pdf[i] === '\\') {
      i += 1
      bytes += escaped[pdf[i]!] ?? pdf[i]
    } else bytes += pdf[i]
  }
  if (!bytes.startsWith('\xfe\xff')) return bytes
  let text = ''
  for (let k = 2; k < bytes.length; k += 2) {
    text += String.fromCharCode((bytes.charCodeAt(k) << 8) | bytes.charCodeAt(k + 1))
  }
  return text
}

/** Every `/Title` in the file — outline entries inline, the document info's by reference. */
function titles(pdf: string): string[] {
  return [...pdf.matchAll(/\/Title (?:\(|(\d+) 0 R)/g)].map((match) =>
    match[1]
      ? readLiteral(pdf, pdf.indexOf(`\n${match[1]} 0 obj\n(`) + `\n${match[1]} 0 obj\n`.length)
      : readLiteral(pdf, match.index + '/Title '.length),
  )
}

describe('exportSheetsToPdf', () => {
  test('bookmarks every sheet by its number and title and titles the document', async () => {
    const { pdf, filename } = await exportToBytes(
      [
        sheet('A0.0', 'Cover sheet'),
        sheet('A2.0', 'Ground floor floor plan'),
        sheet('S2.0', 'Floor framing plan — Ground floor'),
      ],
      'QA Hip Ranch',
    )

    expect(filename).toBe('qa-hip-ranch_2026-09-23.pdf')
    expect(titles(pdf).sort()).toEqual([
      'A0.0 Cover sheet',
      'A2.0 Ground floor floor plan',
      'QA Hip Ranch',
      'S2.0 Floor framing plan — Ground floor',
    ])
    // the bookmarks pane opens with the file, each entry fits its whole sheet
    expect(pdf).toContain('/PageMode /UseOutlines')
    expect(pdf.match(/\/Dest \[\d+ 0 R \/Fit\]/g)).toHaveLength(3)
    // the viewer's title bar shows the project, not the file name
    expect(pdf).toContain('/DisplayDocTitle true')
  })
})
