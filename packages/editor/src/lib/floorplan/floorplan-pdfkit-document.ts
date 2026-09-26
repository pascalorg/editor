import type PdfKitDocument from 'pdfkit'

type PdfKitDocumentInstance = InstanceType<typeof PdfKitDocument>

type PdfTextOptions = {
  align?: 'left' | 'center' | 'right'
  maxWidth?: number
}

type PdfShapeStyle = 'F' | 'S'

/**
 * The faces every exported PDF embeds. pdfkit's standard 14 fonts are
 * WinAnsi-only: the ≤ ≥ ≈ → △ Δ ⅛ ′ ″ the sheets print came out as byte
 * pairs of the code point ("≤ 195 mph" printed as `"d 195 mph`), and the
 * fonts were not embedded at all. Liberation Sans is metric-compatible with
 * Helvetica, so every width the sheets were laid out against is unchanged;
 * Geist Mono keeps Courier's 0.6 em advance. Both are SIL OFL 1.1 — the
 * licences sit beside the files.
 */
const PDF_FONT_FILES = {
  sans: new URL('./pdf-fonts/LiberationSans-Regular.ttf', import.meta.url),
  'sans-bold': new URL('./pdf-fonts/LiberationSans-Bold.ttf', import.meta.url),
  mono: new URL('./pdf-fonts/GeistMono-Regular.ttf', import.meta.url),
  'mono-bold': new URL('./pdf-fonts/GeistMono-Bold.ttf', import.meta.url),
} as const

export type FloorplanPdfFace = keyof typeof PDF_FONT_FILES
export type FloorplanPdfFonts = Record<FloorplanPdfFace, ArrayBuffer>

/** A glyph the face lacks is taken from the other family at the same weight. */
const OTHER_FAMILY: Record<FloorplanPdfFace, FloorplanPdfFace> = {
  sans: 'mono',
  'sans-bold': 'mono-bold',
  mono: 'sans',
  'mono-bold': 'sans-bold',
}

/**
 * Symbols the sheets print that neither face carries, drawn as linework in
 * the text's colour, with their advance in em. The warning triangle keeps a
 * real "!" inside it, so the text layer still reads as a warning.
 */
const DRAWN_SYMBOLS = {
  '⚠': { symbol: 'warning', advanceEm: 0.9 },
  '▸': { symbol: 'pointer', advanceEm: 0.5 },
  '∠': { symbol: 'angle', advanceEm: 0.8 },
} as const

type DrawnSymbol = (typeof DRAWN_SYMBOLS)[keyof typeof DRAWN_SYMBOLS]['symbol']

type TextRun =
  | { kind: 'text'; face: FloorplanPdfFace; text: string }
  | { kind: 'symbol'; symbol: DrawnSymbol; advanceEm: number }

/** The SVG `dominant-baseline` values the floor-plan geometry uses. */
export type FloorplanPdfBaseline = 'auto' | 'alphabetic' | 'middle' | 'central' | 'hanging'

export type FloorplanPdfTextStyle = {
  fontFamily?: string
  fontWeight?: number | string
  fontSize: number
}

/**
 * SVG text's white-space handling (`white-space: normal`; the geometry has no
 * way to ask for `pre`): runs of spaces, tabs and line breaks print as one
 * space and the ends are trimmed. `APN  06075` reads with one space on
 * screen, so it does on paper — and is measured that way for anchoring.
 */
function collapseSvgWhitespace(text: string): string {
  return text.replace(/[ \t\r\n]+/g, ' ').trim()
}

/** pdfkit keeps the current face's metrics and its fontkit font on `_font`; neither is public API. */
type EmbeddedFace = {
  ascender: number
  descender: number
  xHeight: number
  font: { hasGlyphForCodePoint: (codePoint: number) => boolean }
}

let pdfFonts: Promise<FloorplanPdfFonts> | null = null

/** The embedded faces' bytes, fetched once and shared by every export. */
export function loadFloorplanPdfFonts(): Promise<FloorplanPdfFonts> {
  if (pdfFonts) return pdfFonts
  const loading = Promise.all(
    Object.entries(PDF_FONT_FILES).map(async ([face, url]) => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(
          `[floorplan-export] Could not load the PDF font ${face} (HTTP ${response.status})`,
        )
      }
      return [face, await response.arrayBuffer()] as const
    }),
  ).then((entries) => Object.fromEntries(entries) as FloorplanPdfFonts)
  pdfFonts = loading
  // a failed fetch is retried by the next export rather than cached
  loading.catch(() => {
    if (pdfFonts === loading) pdfFonts = null
  })
  return loading
}

/** SVG font-family / font-weight → the embedded face that sets it. */
export function resolveFloorplanPdfFace(
  fontFamily: string | undefined,
  fontWeight: number | string | undefined,
): FloorplanPdfFace {
  const family = fontFamily?.toLocaleLowerCase() ?? ''
  const mono = family.includes('mono') || family.includes('courier')
  const numericWeight = Number.parseInt(String(fontWeight ?? 400), 10)
  const bold =
    String(fontWeight).toLocaleLowerCase() === 'bold' ||
    (Number.isFinite(numericWeight) && numericWeight >= 500)
  if (mono) return bold ? 'mono-bold' : 'mono'
  return bold ? 'sans-bold' : 'sans'
}

export class FloorplanPdfDocument {
  readonly raw: PdfKitDocumentInstance
  readonly internal: {
    pageSize: {
      getWidth: () => number
      getHeight: () => number
    }
  }

  private currentFontSize = 12
  private currentFace: FloorplanPdfFace = 'sans'
  private readonly defaultPageSize: readonly [number, number]
  private readonly faces = new Map<FloorplanPdfFace, EmbeddedFace>()

  constructor(
    raw: PdfKitDocumentInstance,
    defaultPageSize: readonly [number, number],
    fonts: FloorplanPdfFonts,
  ) {
    this.raw = raw
    this.defaultPageSize = defaultPageSize
    for (const [face, bytes] of Object.entries(fonts)) raw.registerFont(face, bytes)
    this.internal = {
      pageSize: {
        getWidth: () => this.raw.page?.width ?? this.defaultPageSize[0],
        getHeight: () => this.raw.page?.height ?? this.defaultPageSize[1],
      },
    }
  }

  addPage(
    size: readonly [number, number] = this.defaultPageSize,
    _orientation?: 'portrait' | 'landscape',
  ): this {
    this.raw.addPage({ size: [size[0], size[1]], margin: 0 })
    return this
  }

  setTextColor(color: string): this {
    this.raw.fillColor(color)
    return this
  }

  setDrawColor(color: string): this {
    this.raw.strokeColor(color)
    return this
  }

  setFillColor(color: string): this {
    this.raw.fillColor(color)
    return this
  }

  setLineWidth(width: number): this {
    this.raw.lineWidth(width)
    return this
  }

  setFont(family: string, weight: string = 'normal'): this {
    this.currentFace = resolveFloorplanPdfFace(family, weight)
    return this
  }

  setFontSize(size: number): this {
    this.currentFontSize = size
    return this
  }

  getTextWidth(value: string): number {
    return this.measureRuns(this.textRuns(value, this.currentFace), this.currentFontSize)
  }

  splitTextToSize(value: string, maxWidth: number): string[] {
    if (maxWidth <= 0 || this.getTextWidth(value) <= maxWidth) return [value]
    const words = value.trim().split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (!line || this.getTextWidth(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      lines.push(line)
      line = word
    }
    if (line) lines.push(line)
    return lines.length > 0 ? lines : ['']
  }

  text(
    value: string | readonly string[],
    x: number,
    baselineY: number,
    options: PdfTextOptions = {},
  ) {
    const given = typeof value === 'string' ? value.split('\n') : value
    const lines =
      options.maxWidth === undefined
        ? given
        : given.flatMap((line) => this.splitTextToSize(line, options.maxWidth ?? 0))
    const lineHeight = this.currentFontSize * 1.2
    lines.forEach((line, index) => {
      const runs = this.textRuns(line, this.currentFace)
      const width = this.measureRuns(runs, this.currentFontSize)
      const drawX =
        options.align === 'center' ? x - width / 2 : options.align === 'right' ? x - width : x
      this.drawRuns(runs, drawX, baselineY + index * lineHeight, this.currentFontSize)
    })
    return this
  }

  /** The width `drawText` sets `text` at — the same runs, face by face. */
  measureText(text: string, style: FloorplanPdfTextStyle): number {
    const face = resolveFloorplanPdfFace(style.fontFamily, style.fontWeight)
    return this.measureRuns(this.textRuns(collapseSvgWhitespace(text), face), style.fontSize)
  }

  /**
   * Native (selectable, searchable) text in the current fill colour, anchored
   * at (x, y) the way SVG anchors it: `anchor` is `text-anchor`, `baseline`
   * is `dominant-baseline`, resolved against the embedded face's metrics.
   */
  drawText(
    text: string,
    x: number,
    y: number,
    style: FloorplanPdfTextStyle,
    placement: { anchor: 'start' | 'middle' | 'end'; baseline: FloorplanPdfBaseline },
  ): void {
    const face = resolveFloorplanPdfFace(style.fontFamily, style.fontWeight)
    const runs = this.textRuns(collapseSvgWhitespace(text), face)
    const width = this.measureRuns(runs, style.fontSize)
    const startX =
      placement.anchor === 'middle' ? x - width / 2 : placement.anchor === 'end' ? x - width : x
    const metrics = this.face(face)
    const em = style.fontSize / 1000
    const baselineShift =
      placement.baseline === 'middle'
        ? (metrics.xHeight / 2) * em
        : placement.baseline === 'central'
          ? ((metrics.ascender + metrics.descender) / 2) * em
          : placement.baseline === 'hanging'
            ? 0.8 * metrics.ascender * em
            : 0
    this.drawRuns(runs, startX, y + baselineShift, style.fontSize)
  }

  line(x1: number, y1: number, x2: number, y2: number): this {
    this.raw.moveTo(x1, y1).lineTo(x2, y2).stroke()
    return this
  }

  rect(x: number, y: number, width: number, height: number, style: PdfShapeStyle = 'S'): this {
    this.raw.rect(x, y, width, height)
    if (style === 'F') this.raw.fill()
    else this.raw.stroke()
    return this
  }

  roundedRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radiusX: number,
    _radiusY: number,
    style: PdfShapeStyle = 'S',
  ): this {
    this.raw.roundedRect(x, y, width, height, radiusX)
    if (style === 'F') this.raw.fill()
    else this.raw.stroke()
    return this
  }

  circle(x: number, y: number, radius: number, style: PdfShapeStyle = 'S'): this {
    this.raw.circle(x, y, radius)
    if (style === 'F') this.raw.fill()
    else this.raw.stroke()
    return this
  }

  triangle(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    style: PdfShapeStyle = 'S',
  ): this {
    this.raw.polygon([x1, y1], [x2, y2], [x3, y3])
    if (style === 'F') this.raw.fill()
    else this.raw.stroke()
    return this
  }

  private face(face: FloorplanPdfFace): EmbeddedFace {
    let embedded = this.faces.get(face)
    if (!embedded) {
      this.raw.font(face)
      embedded = (this.raw as unknown as { _font: EmbeddedFace })._font
      this.faces.set(face, embedded)
    }
    return embedded
  }

  /** Splits `text` into runs each face can set, plus the symbols drawn as linework. */
  private textRuns(text: string, face: FloorplanPdfFace): TextRun[] {
    // printable ASCII is in every face
    if (/^[\x20-\x7e]*$/.test(text)) return [{ kind: 'text', face, text }]
    const runs: TextRun[] = []
    for (const char of text) {
      const codePoint = char.codePointAt(0) ?? 0
      let runFace = face
      if (!this.face(face).font.hasGlyphForCodePoint(codePoint)) {
        const drawn = DRAWN_SYMBOLS[char as keyof typeof DRAWN_SYMBOLS]
        if (this.face(OTHER_FAMILY[face]).font.hasGlyphForCodePoint(codePoint)) {
          runFace = OTHER_FAMILY[face]
        } else if (drawn) {
          runs.push({ kind: 'symbol', symbol: drawn.symbol, advanceEm: drawn.advanceEm })
          continue
        }
        // anything else prints as the face's .notdef box — visibly missing, never garbage
      }
      const last = runs[runs.length - 1]
      if (last?.kind === 'text' && last.face === runFace) last.text += char
      else runs.push({ kind: 'text', face: runFace, text: char })
    }
    return runs
  }

  private measureRuns(runs: readonly TextRun[], fontSize: number): number {
    let width = 0
    for (const run of runs) {
      width +=
        run.kind === 'text'
          ? this.raw.font(run.face).fontSize(fontSize).widthOfString(run.text)
          : run.advanceEm * fontSize
    }
    return width
  }

  private drawRuns(runs: readonly TextRun[], x: number, baselineY: number, fontSize: number) {
    let cursor = x
    for (const run of runs) {
      if (run.kind === 'text') {
        this.raw.font(run.face).fontSize(fontSize)
        this.raw.text(run.text, cursor, baselineY, { baseline: 'alphabetic', lineBreak: false })
        cursor += this.raw.widthOfString(run.text)
      } else {
        this.drawSymbol(run.symbol, cursor, baselineY, fontSize)
        cursor += run.advanceEm * fontSize
      }
    }
  }

  private drawSymbol(symbol: DrawnSymbol, x: number, baselineY: number, fontSize: number) {
    const raw = this.raw
    if (symbol === 'angle') {
      // two strokes from a vertex on the baseline: the base, and a leg rising
      // to the cap height — filled bands, so the text's own colour paints them
      const vertex: [number, number] = [x + 0.08 * fontSize, baselineY]
      const tip: [number, number] = [x + 0.56 * fontSize, baselineY - 0.7 * fontSize]
      const width = 0.07 * fontSize
      raw
        .save()
        // the base starts a little behind the vertex so the corner is closed
        .polygon(
          ...strokeBand([x + 0.05 * fontSize, baselineY], [x + 0.72 * fontSize, baselineY], width),
        )
        .polygon(...strokeBand(vertex, tip, width))
        .fill('non-zero')
        .restore()
      return
    }
    if (symbol === 'pointer') {
      // a small solid triangle on the x-height, like a list pointer
      const midY = baselineY - 0.26 * fontSize
      const half = 0.17 * fontSize
      raw
        .save()
        .polygon(
          [x + 0.1 * fontSize, midY - half],
          [x + 0.4 * fontSize, midY],
          [x + 0.1 * fontSize, midY + half],
        )
        .fill('non-zero')
        .restore()
      return
    }
    // warning: an outlined triangle from just under the baseline to the cap
    // height, its "!" standing on the text's own baseline (so text extraction
    // keeps it on the line it warns about)
    const left = x + 0.04 * fontSize
    const width = 0.82 * fontSize
    const base = baselineY + 0.1 * fontSize
    const height = 0.82 * fontSize
    const stroke = 0.07 * fontSize
    const apex: [number, number] = [left + width / 2, base - height]
    const outer: [number, number][] = [[left, base], [left + width, base], apex]
    const leg = Math.hypot(width / 2, height)
    const inradius = (width * height) / (width + 2 * leg)
    const centre: [number, number] = [left + width / 2, base - inradius]
    const k = (inradius - stroke) / inradius
    const inner = outer.map(
      ([px, py]) =>
        [centre[0] + (px - centre[0]) * k, centre[1] + (py - centre[1]) * k] as [number, number],
    )
    raw
      .save()
      .polygon(...outer)
      .polygon(...inner)
      .fill('even-odd')
      .restore()
    raw.font('sans-bold').fontSize(0.55 * fontSize)
    raw.text('!', centre[0] - raw.widthOfString('!') / 2, baselineY, {
      baseline: 'alphabetic',
      lineBreak: false,
    })
  }
}

export async function createFloorplanPdfDocument(
  defaultPageSize: readonly [number, number],
  options: { title?: string } = {},
) {
  const [{ default: PDFDocument }, { default: blobStream }, fonts] = await Promise.all([
    import('pdfkit/js/pdfkit.standalone'),
    import('blob-stream'),
    loadFloorplanPdfFonts(),
  ])
  const raw = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    margin: 0,
    // the viewer's title bar shows the document title, not the file name
    ...(options.title ? { info: { Title: options.title }, displayTitle: true } : {}),
  })
  const stream = raw.pipe(blobStream())
  return {
    doc: new FloorplanPdfDocument(raw, defaultPageSize, fonts),
    save: async (filename: string) => {
      const blob = await new Promise<Blob>((resolve, reject) => {
        stream.on('finish', () => resolve(stream.toBlob('application/pdf')))
        stream.on('error', reject)
        raw.on('error', reject)
        raw.end()
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    },
  }
}

/** The quad a straight stroke of `width` from `a` to `b` covers (same winding for any direction). */
function strokeBand(
  a: readonly [number, number],
  b: readonly [number, number],
  width: number,
): [number, number][] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  const nx = (-(b[1] - a[1]) / length) * (width / 2)
  const ny = ((b[0] - a[0]) / length) * (width / 2)
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
  ]
}
