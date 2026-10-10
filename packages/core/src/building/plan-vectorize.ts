const round = (value: number) => Math.round(value * 10_000) / 10_000

/**
 * A vectoriser's SVG of a raster plan, framed as the raster (L42): its root sized in the raster's
 * pixels, its viewBox the image's box inside the vectoriser's own. A vectoriser fits the image in
 * its box and centres it, as SVG fits a picture by default (xMidYMid meet): QuiverAI draws the
 * 290's 508 × 768 PNG inside an 80 × 80 viewBox, the plan from x 14.2 to 64.4. Read in its own box,
 * every shape would stretch and shift; framed, the plan shows on its guide and reads in the pixels
 * it was calibrated in.
 */
export function rasterFramedSvg(svg: string, raster: { width: number; height: number }): string {
  const root = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(svg)
  if (!root) throw Error('no <svg> element')
  const tag = root[0]
  const attribute = (name: string) => {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)
    return match ? (match[1] ?? match[2]) : undefined
  }
  const box = (attribute('viewBox') ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
  const [x, y, width, height] =
    box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0
      ? box
      : [
          0,
          0,
          Number.parseFloat(attribute('width') ?? ''),
          Number.parseFloat(attribute('height') ?? ''),
        ]
  if (!(width! > 0 && height! > 0)) throw Error('the SVG has no size (width, height or viewBox)')
  const scale = Math.min(width! / raster.width, height! / raster.height)
  const [w, h] = [raster.width * scale, raster.height * scale]
  const view = [x! + (width! - w) / 2, y! + (height! - h) / 2, w, h].map(round)
  const framed = tag
    .replace(/\s(?:width|height|viewBox|preserveAspectRatio)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(
      /^<svg\b/i,
      `<svg width="${raster.width}" height="${raster.height}" viewBox="${view.join(' ')}"`,
    )
  return svg.slice(0, root.index) + framed + svg.slice(root.index + tag.length)
}
