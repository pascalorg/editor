import { DataTexture, DoubleSide, RGBAFormat } from 'three'
import { normalViewGeometry, positionViewDirection, smoothstep, texture, uv } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { sharedTexture } from './turf-textures'

const TILE = 128
const SIZE = TILE * 2
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

// Use one small linear RGBA map for all the heads in a draw. The model supplies the
// species colour. The atlas contributes folds, pollen, and space between the florets.
function makeCorollas() {
  const data = new Uint8Array(SIZE * SIZE * 4).fill(255)
  function ink(x: number, y: number, r: number, g: number, b: number, a = 1) {
    const i = (y * SIZE + x) * 4
    data[i] = Math.round(255 * r)
    data[i + 1] = Math.round(255 * g)
    data[i + 2] = Math.round(255 * b)
    data[i + 3] = Math.round(255 * a)
  }
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      ink(x, y, 0.87, 0.74, 0.42)
      ink(TILE + x, y, 0.65, 0.42, 0.5, y < 92 ? 1 : 0)
      ink(x, TILE + y, 0.9, 0.87, 0.76, 0)
    }
  // Raised pollen grains in a spiral across the daisy eye.
  for (let i = 0; i < 145; i++) {
    const a = i * GOLDEN_ANGLE,
      r = 62 * Math.sqrt(i / 145)
    const cx = Math.round(64 + Math.cos(a) * r),
      cy = Math.round(64 + Math.sin(a) * r)
    for (let y = Math.max(0, cy - 4); y <= Math.min(127, cy + 4); y++)
      for (let x = Math.max(0, cx - 4); x <= Math.min(127, cx + 4); x++) {
        const d = Math.hypot(x - cx, y - cy) / 3.8
        if (d < 1) ink(x, y, 0.96 - d * 0.15, 0.98 - d * 0.38, 0.74 - d * 0.34)
      }
  }
  // Orient each tubular floret on the head with a Fibonacci spiral. The outermost
  // fold wins where neighbours overlap. Baking in spherical coordinates gives the
  // tiny throats and pale lips a continuous surface across the longitude seam.
  const florets = Array.from({ length: 82 }, (_, i) => {
    const up = ((i + 0.5) / 82) * 2 - 1,
      radial = Math.sqrt(1 - up * up)
    const angle = i * GOLDEN_ANGLE,
      ca = Math.cos(angle),
      sa = Math.sin(angle)
    return {
      up,
      radial,
      ca,
      sa,
      twist: 0.35 * Math.sin(angle * 3.7),
      tone: 0.92 + 0.08 * Math.sin(angle),
    }
  })
  for (let y = 0; y < TILE; y++) {
    const latitude = (y / (TILE - 1) - 0.5) * Math.PI,
      dy = Math.sin(latitude),
      radius = Math.cos(latitude)
    for (let x = 0; x < TILE; x++) {
      const longitude = (x / (TILE - 1)) * Math.PI * 2,
        dx = Math.cos(longitude) * radius,
        dz = Math.sin(longitude) * radius
      let outer = -1,
        r = 0.42,
        g = 0.23,
        b = 0.33
      for (const f of florets) {
        const axis = dx * f.ca + dz * f.sa
        if (axis * f.radial + dy * f.up < 0.9) continue
        const north = dy * f.radial - axis * f.up
        const t = (north + 0.26) / 0.53
        if (t <= 0 || t >= 1) continue
        const east = dz * f.ca - dx * f.sa
        const half = 0.075 + 0.094 * Math.sin(t * Math.PI * 0.88)
        const side = (east - north * f.twist) / half
        const rim = 1 - 0.2 * side * side - 0.09 * Math.exp(-side * side * 20)
        if (Math.abs(side) >= 1 || t > rim) continue
        const fold = Math.sqrt(1 - side * side)
        const height = t * 0.53 + fold * 0.25
        if (height <= outer) continue
        outer = height
        const keel = 0.15 * Math.exp(-((side - 0.16) ** 2) * 30)
        const lip = Math.max(0, 1 - Math.abs(t - rim + 0.065) * 9)
        const light = (0.27 + 0.4 * t + 0.23 * fold + 0.24 * lip - keel) * f.tone
        r = Math.min(1, 0.29 + 0.71 * light)
        g = Math.min(1, 0.09 + 0.9 * light * light)
        b = Math.min(1, 0.24 + 0.76 * light)
      }
      ink(TILE + x, y, r, g, b, Math.max(0, Math.min(1, outer * 1.5 - 0.22)))
    }
  }
  // Two narrow stamps round the daisy rays and mark the clover leaflets without spending
  // another ring of vertices per petal. The far corner remains white for stems.
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE - 6; x++) {
      const u = x / (TILE - 1),
        v = y / (TILE - 1)
      const ray = u < 0.48
      const lateral = Math.abs(((ray ? u / 0.45 : (u - 0.5) / 0.44) - 0.5) * 2)
      if (ray) {
        const end = 0.98 - 0.13 * lateral * lateral
        const alpha = Math.max(0, Math.min(1, Math.min(0.9 - lateral, end - v) * 42))
        const light = (0.9 + v * 0.09) * (1 - 0.1 * Math.exp(-lateral * lateral * 25))
        ink(TILE + x, TILE + y, light, light * 0.99, light, alpha)
      } else {
        const width = Math.sin(Math.PI * Math.min(1, v) * 0.89) ** 0.56
        const notch = 0.12 * Math.exp(-lateral * lateral * 18)
        const inside = lateral < width && v < 0.98 - 0.15 * lateral * lateral - notch
        const chevron = Math.max(0, 1 - Math.abs(v - 0.56 + lateral * 0.2) * 14)
        const green = 0.48 + chevron * 0.37 + v * 0.11
        ink(TILE + x, TILE + y, green, green + 0.025, green, inside ? 1 : 0)
      }
    }
  // A yarrow branch ends in a cluster of little five-lobed capitula, each with a warm eye.
  for (let i = 0; i < 22; i++) {
    const a = i * GOLDEN_ANGLE,
      r = 48 * Math.sqrt(i / 21),
      cx = 64 + r * Math.cos(a),
      cy = 64 + r * Math.sin(a)
    const radius = 13.0 + Math.cos(a * 2) * 2.1
    for (
      let y = Math.max(0, Math.floor(cy - radius));
      y <= Math.min(127, Math.ceil(cy + radius));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(cx - radius));
        x <= Math.min(127, Math.ceil(cx + radius));
        x++
      ) {
        const dx = x - cx,
          dy = y - cy,
          d = Math.hypot(dx, dy) / radius
        const edge = 0.89 + 0.11 * Math.cos(5 * Math.atan2(dy, dx) + a)
        if (d > edge) continue
        if (d < 0.27) ink(x, TILE + y, 0.95, 0.7 + d * 0.32, 0.38 + d * 0.4)
        else {
          const light = 0.87 + (0.08 * dx) / radius + 0.04 * Math.cos(5 * Math.atan2(dy, dx) + a)
          ink(x, TILE + y, light, light, light)
        }
      }
  }
  return new DataTexture(data, SIZE, SIZE, RGBAFormat)
}

const corollaMap = sharedTexture(makeCorollas)

export function lawnFlowerMaterial() {
  const material = new MeshStandardNodeMaterial({
    vertexColors: true,
    roughness: 0.95,
    side: DoubleSide,
    alphaTest: 0.28,
    alphaToCoverage: true,
  })
  material.name = 'lawn-flowers'
  const pigment = texture(corollaMap(material))
  const clover = uv().x.greaterThan(0.5).and(uv().y.lessThan(0.5))
  // On the rim of a clover head the raised lips project past their neighbours.
  const facing = normalViewGeometry.dot(positionViewDirection).abs()
  material.colorNode = pigment.rgb
  const coverage = clover.select(pigment.a.add(smoothstep(0.05, 0.38, facing)).min(1), pigment.a)
  material.opacityNode = coverage
  material.maskShadowNode = coverage.greaterThan(0.28)
  return material
}
