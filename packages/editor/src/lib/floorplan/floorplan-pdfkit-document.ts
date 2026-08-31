import type PdfKitDocument from 'pdfkit'

type PdfKitDocumentInstance = InstanceType<typeof PdfKitDocument>

type PdfTextOptions = {
  align?: 'left' | 'center' | 'right'
  maxWidth?: number
}

type PdfShapeStyle = 'F' | 'S'

export class FloorplanPdfDocument {
  readonly raw: PdfKitDocumentInstance
  readonly internal: {
    pageSize: {
      getWidth: () => number
      getHeight: () => number
    }
  }

  private currentFontSize = 12
  private readonly defaultPageSize: readonly [number, number]

  constructor(raw: PdfKitDocumentInstance, defaultPageSize: readonly [number, number]) {
    this.raw = raw
    this.defaultPageSize = defaultPageSize
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
    const normalizedFamily = family.toLocaleLowerCase()
    const normalizedWeight = weight.toLocaleLowerCase()
    const bold = normalizedWeight === 'bold' || Number.parseInt(normalizedWeight, 10) >= 500
    const base = normalizedFamily.includes('courier') ? 'Courier' : 'Helvetica'
    this.raw.font(bold ? `${base}-Bold` : base)
    return this
  }

  setFontSize(size: number): this {
    this.currentFontSize = size
    this.raw.fontSize(size)
    return this
  }

  getTextWidth(value: string): number {
    return this.raw.widthOfString(value, { lineBreak: false })
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
    const lines = typeof value === 'string' ? value.split('\n') : value
    const lineHeight = this.currentFontSize * 1.2
    lines.forEach((line, index) => {
      const width = this.getTextWidth(line)
      const drawX =
        options.align === 'center' ? x - width / 2 : options.align === 'right' ? x - width : x
      this.raw.text(line, drawX, baselineY - this.currentFontSize * 0.78 + index * lineHeight, {
        lineBreak: false,
        width: options.maxWidth,
      })
    })
    return this
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
}

export async function createFloorplanPdfDocument(defaultPageSize: readonly [number, number]) {
  const [{ default: PDFDocument }, { default: blobStream }] = await Promise.all([
    import('pdfkit/js/pdfkit.standalone'),
    import('blob-stream'),
  ])
  const raw = new PDFDocument({ autoFirstPage: false, compress: true, margin: 0 })
  const stream = raw.pipe(blobStream())
  return {
    doc: new FloorplanPdfDocument(raw, defaultPageSize),
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
