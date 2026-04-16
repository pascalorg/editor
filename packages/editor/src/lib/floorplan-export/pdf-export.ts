/**
 * SVG → PDF export using jsPDF + svg2pdf.js.
 * Both libraries are dynamically imported so they are code-split into an async
 * chunk and do not bloat the main bundle.
 */

export async function exportFloorplanAsPdf(
  svgString: string,
  filename: string,
): Promise<void> {
  // Dynamic imports — only loaded when user clicks "Export PDF"
  const [{ jsPDF }, { default: svg2pdf }] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
  ])

  // Parse SVG string into a DOM element
  const container = document.createElement('div')
  container.style.position = 'absolute'
  container.style.visibility = 'hidden'
  document.body.appendChild(container)
  container.innerHTML = svgString
  const svgEl = container.querySelector('svg')

  if (!svgEl) {
    document.body.removeChild(container)
    throw new Error('Failed to parse SVG for PDF export')
  }

  // Read physical size from SVG width/height attributes (expect "297mm", "210mm", etc.)
  const parseSize = (attr: string | null, fallback: number): number => {
    if (!attr) return fallback
    const n = parseFloat(attr)
    return Number.isFinite(n) ? n : fallback
  }

  const widthMm = parseSize(svgEl.getAttribute('width'), 297)
  const heightMm = parseSize(svgEl.getAttribute('height'), 210)

  const pdf = new jsPDF({
    orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [widthMm, heightMm],
    compress: true,
  })

  await svg2pdf(svgEl, pdf, {
    x: 0,
    y: 0,
    width: widthMm,
    height: heightMm,
  })

  document.body.removeChild(container)
  pdf.save(filename)
}
