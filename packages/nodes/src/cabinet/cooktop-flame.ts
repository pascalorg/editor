import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Sphere, Vector3 } from 'three'

// Real gas-burner flames are a ring of small jets: each one leaves its port,
// sweeps outward as it rises, then bends back up at the tip. Most of the body
// is blue/cyan; only the top ~25% picks up the orange-yellow nip. Each flame
// is a tapered tube along a CatmullRom spine, vertex-coloured along its
// length; per frame the spine control points wobble + breathe so the flame
// licks and flickers without shaders.

export const COOKTOP_FLAME_COUNT = 22
export const COOKTOP_FLAME_SEG = 12
export const COOKTOP_FLAME_RAD = 5

export type CooktopFlameSeed = {
  phase: number
  speed: number
  height: number
  reach: number
}

export function cooktopFlameSeed(index: number): CooktopFlameSeed {
  return {
    phase: (index * 1.37) % (Math.PI * 2),
    speed: 0.45 + ((index * 7) % 5) * 0.06,
    height: 0.85 + ((index * 3) % 5) * 0.07 + (index % 2) * 0.12,
    reach: 0.92 + ((index * 11) % 4) * 0.05,
  }
}

const C_DEEP_BLUE = [0.15, 0.45, 1.7] as const
const C_BRIGHT_CYAN = [0.55, 1.1, 1.95] as const
const C_ORANGE = [1.85, 0.7, 0.18] as const
const C_YELLOW = [2.05, 1.65, 0.4] as const

function lerpRGB(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  k: number,
  out: Float32Array,
  offset: number,
) {
  out[offset] = a[0] + (b[0] - a[0]) * k
  out[offset + 1] = a[1] + (b[1] - a[1]) * k
  out[offset + 2] = a[2] + (b[2] - a[2]) * k
}

// Colour at curve parameter u (0 = port, 1 = tip): blue body, narrow swing
// to orange, yellow only at the very tip.
function flameColourAt(u: number, out: Float32Array, offset: number) {
  if (u < 0.45) lerpRGB(C_DEEP_BLUE, C_BRIGHT_CYAN, u / 0.45, out, offset)
  else if (u < 0.75) lerpRGB(C_BRIGHT_CYAN, C_ORANGE, (u - 0.45) / 0.3, out, offset)
  else lerpRGB(C_ORANGE, C_YELLOW, (u - 0.75) / 0.25, out, offset)
}

// Pre-allocated tube geometry — positions are mutated in place every frame;
// colours depend only on u so they are written once here.
export function createCooktopFlameGeometry(): BufferGeometry {
  const vCount = (COOKTOP_FLAME_SEG + 1) * (COOKTOP_FLAME_RAD + 1)
  const positions = new Float32Array(vCount * 3)
  const colors = new Float32Array(vCount * 3)
  for (let i = 0; i <= COOKTOP_FLAME_SEG; i += 1) {
    const u = i / COOKTOP_FLAME_SEG
    for (let j = 0; j <= COOKTOP_FLAME_RAD; j += 1) {
      flameColourAt(u, colors, ((COOKTOP_FLAME_RAD + 1) * i + j) * 3)
    }
  }
  const indices: number[] = []
  for (let i = 1; i <= COOKTOP_FLAME_SEG; i += 1) {
    for (let j = 1; j <= COOKTOP_FLAME_RAD; j += 1) {
      const a = (COOKTOP_FLAME_RAD + 1) * (i - 1) + (j - 1)
      const b = (COOKTOP_FLAME_RAD + 1) * i + (j - 1)
      const c = (COOKTOP_FLAME_RAD + 1) * i + j
      const d = (COOKTOP_FLAME_RAD + 1) * (i - 1) + j
      indices.push(a, b, d, b, c, d)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  // Static generous bound — flames are a few cm; skips per-frame recompute.
  geometry.boundingSphere = new Sphere(new Vector3(0.02, 0.03, 0), 0.12)
  return geometry
}

// Scratch objects reused across calls so the per-frame allocator stays quiet.
const _spineVecs = [new Vector3(), new Vector3(), new Vector3(), new Vector3(), new Vector3()]
const _curve = new CatmullRomCurve3(_spineVecs, false, 'catmullrom', 0.5)
const _pt = new Vector3()

// Rebuild a flame tube's vertices for time `t`. Built in the flame's LOCAL
// frame — the parent group sits at the port and is rotated so local +X
// points outward from the burner centre.
export function updateCooktopFlameTube(
  positions: Float32Array,
  t: number,
  seed: CooktopFlameSeed,
  burnerR: number,
) {
  const tt = t * seed.speed + seed.phase

  // Compact gas jet (3-4 cm): the dominant motion is this breathing factor —
  // the tongue bobs like a real burner flame rather than strobing.
  const breathe = 0.93 + 0.09 * Math.sin(tt * 2.6) + 0.03 * Math.sin(tt * 5.1)
  const length = 0.038 * seed.height * breathe
  const reach = length * 0.4 * seed.reach

  // Tiny spine perturbations so the hook shape holds and just trembles.
  const wobX = Math.sin(tt * 2.1) * 0.0008
  const wobY = Math.cos(tt * 2.4 + 0.7) * 0.0015
  const sway = Math.sin(tt * 1.9) * 0.0022

  _spineVecs[0]!.set(0, 0, 0)
  _spineVecs[1]!.set(reach * 0.28 + wobX, length * 0.2, sway * 0.25)
  _spineVecs[2]!.set(reach * 0.62, length * 0.45 + wobY, sway * 0.55)
  _spineVecs[3]!.set(reach * 0.55 - wobX, length * 0.75, sway * 0.35)
  _spineVecs[4]!.set(reach * 0.35, length * 0.98 + wobY, sway * 0.08)

  _curve.points = _spineVecs
  _curve.updateArcLengths()
  const frames = _curve.computeFrenetFrames(COOKTOP_FLAME_SEG, false)

  // Slim at the port, slight mid-body bulge, sharp tip — the teardrop
  // silhouette of a real gas jet. Scales with the burner head.
  const baseR = burnerR * 0.11
  const tipR = burnerR * 0.018

  for (let i = 0; i <= COOKTOP_FLAME_SEG; i += 1) {
    const u = i / COOKTOP_FLAME_SEG
    _curve.getPointAt(u, _pt)
    const N = frames.normals[i]!
    const B = frames.binormals[i]!
    const taper = baseR * (1 - u) + tipR * u + Math.sin(u * Math.PI) * burnerR * 0.018
    const baseV = (COOKTOP_FLAME_RAD + 1) * i
    for (let j = 0; j <= COOKTOP_FLAME_RAD; j += 1) {
      const ang = (j / COOKTOP_FLAME_RAD) * Math.PI * 2
      const sn = Math.sin(ang)
      const cs = -Math.cos(ang)
      const vIdx = (baseV + j) * 3
      positions[vIdx] = _pt.x + taper * (cs * N.x + sn * B.x)
      positions[vIdx + 1] = _pt.y + taper * (cs * N.y + sn * B.y)
      positions[vIdx + 2] = _pt.z + taper * (cs * N.z + sn * B.z)
    }
  }
}
