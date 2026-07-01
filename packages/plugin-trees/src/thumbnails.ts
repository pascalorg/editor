/**
 * Preset card thumbnails, inlined as SVG data URIs so the plugin needs no asset
 * hosting — the same trick ez-tree uses for its bark/leaf textures. These are
 * intentionally simple *placeholders*: swap any value for a real image URL (or a
 * bundler-imported asset) to ship production art. The panel just renders the
 * string as an `<img src>`, so anything an `<img>` accepts works.
 */

function dataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Stylised tree card: soft sky, ground band, trunk + layered canopy in the
 * preset colour. */
export function treeThumbnail(canopy: string): string {
  return dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="88" viewBox="0 0 120 88">` +
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#eef4f7"/><stop offset="1" stop-color="#d3e0e6"/>` +
      `</linearGradient></defs>` +
      `<rect width="120" height="88" fill="url(#s)"/>` +
      `<rect y="68" width="120" height="20" fill="#b9cbaa"/>` +
      `<rect x="56" y="44" width="8" height="30" rx="3" fill="#6b4f34"/>` +
      `<circle cx="44" cy="46" r="15" fill="${canopy}" opacity="0.85"/>` +
      `<circle cx="76" cy="46" r="15" fill="${canopy}" opacity="0.85"/>` +
      `<circle cx="60" cy="38" r="22" fill="${canopy}"/>` +
      `</svg>`,
  )
}

/** Stylised flower card: stem + 6 petals around a centre, in the preset colours. */
export function flowerThumbnail(petal: string, center: string, stem: string): string {
  const petals = [
    [75, 40],
    [67.5, 27],
    [52.5, 27],
    [45, 40],
    [52.5, 53],
    [67.5, 53],
  ]
    .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="9" fill="${petal}"/>`)
    .join('')
  return dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="88" viewBox="0 0 120 88">` +
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#eef4f7"/><stop offset="1" stop-color="#d3e0e6"/>` +
      `</linearGradient></defs>` +
      `<rect width="120" height="88" fill="url(#s)"/>` +
      `<rect y="68" width="120" height="20" fill="#b9cbaa"/>` +
      `<rect x="58" y="40" width="4" height="34" rx="2" fill="${stem}"/>` +
      `<ellipse cx="52" cy="58" rx="7" ry="3.5" fill="${stem}"/>` +
      `<ellipse cx="68" cy="52" rx="7" ry="3.5" fill="${stem}"/>` +
      petals +
      `<circle cx="60" cy="40" r="7" fill="${center}"/>` +
      `</svg>`,
  )
}

/** Stylised grass card: a tuft of leaning blades in the preset colour. */
export function grassThumbnail(blade: string): string {
  const spec: Array<[number, number]> = [
    [42, -18],
    [50, -8],
    [58, 2],
    [66, -6],
    [74, 12],
    [82, -14],
  ]
  const blades = spec
    .map(
      ([x, lean]) =>
        `<path d="M${x} 74 Q${x + lean} 52 ${x + lean * 1.4} 34" stroke="${blade}" stroke-width="4" stroke-linecap="round" fill="none"/>`,
    )
    .join('')
  return dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="88" viewBox="0 0 120 88">` +
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#eef4f7"/><stop offset="1" stop-color="#d3e0e6"/>` +
      `</linearGradient></defs>` +
      `<rect width="120" height="88" fill="url(#s)"/>` +
      `<rect y="70" width="120" height="18" fill="#b9cbaa"/>` +
      blades +
      `</svg>`,
  )
}
