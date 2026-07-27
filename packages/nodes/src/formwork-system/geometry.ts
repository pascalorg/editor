import type { GeometryContext } from '@pascal-app/core/registry'
import type { WallNode } from '@pascal-app/core/schema'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { FormworkSystemNode } from './schema'

/**
 * Pure formwork geometry builder. Reads the host wall (`ctx.parent`) for
 * length/height/thickness and its construction fields
 * (`tieSpacing`/`walerSpacing`/`scaffoldRequired`) to build a real
 * leak-proof shutter assembly: panels + walers on BOTH faces (poured
 * concrete pushes on both sides), through-ties clamping the two faces
 * together, and — when `scaffoldRequired` — working scaffold (uprights,
 * ledgers, diagonal braces) standing off each face so the assembly
 * matches an actual site erection, not just a decorative front face.
 *
 * v1: plain colored boxes, no textures/slots — see
 * `wiki/formwork-system-plan.md` decision #2. Panels/ties/walers/scaffold
 * are named children (`panel-<side>-<i>`, `tie-<row>-<col>`,
 * `waler-<side>-<row>`, `scaffold-<side>-*`) so a future `inspect_formwork`
 * AI tool can count them without re-deriving the layout math.
 */
const PANEL_THICKNESS = 0.02
const PANEL_GAP = 0.005
const TIE_SIZE = 0.03
const WALER_HEIGHT = 0.08
const WALER_DEPTH = 0.1
const EDGE_MARGIN = 0.15

// Scaffold: uprights standing off beyond the walers, tied together with
// horizontal ledgers every lift and a diagonal brace per bay — the
// minimum assembly that actually holds a shutter face upright on site.
const SCAFFOLD_STANDOFF = 0.35 // gap beyond the waler face
const SCAFFOLD_BAY = 1.8 // upright spacing along the wall
const SCAFFOLD_LIFT = 2.0 // ledger row spacing up the wall
const SCAFFOLD_POST_SIZE = 0.05
const SCAFFOLD_LEDGER_SIZE = 0.045
const SCAFFOLD_BRACE_SIZE = 0.035

const tieMaterial = new MeshStandardMaterial({ color: '#4a4a4a' }) // steel tie
const walerMaterial = new MeshStandardMaterial({ color: '#6b4a2f' }) // timber waler
const scaffoldMaterial = new MeshStandardMaterial({ color: '#c77b1a' }) // galvanized/painted tube

type Side = 'front' | 'back'
const SIDES: Array<{ side: Side; sign: 1 | -1 }> = [
  { side: 'front', sign: 1 },
  { side: 'back', sign: -1 },
]

function panelColor(formworkType: WallNode['formworkType']): string {
  if (formworkType === 'steel-panel') return '#8a8f94'
  if (formworkType === 'aluminium') return '#c7ccd1'
  return '#c9b896' // plywood / default
}

/** Vertical post + horizontal ledgers + one diagonal brace per bay, standing off from `faceZ` along +/-Z by `sign`. */
function buildScaffoldSide(
  group: Group,
  side: Side,
  sign: 1 | -1,
  wallLength: number,
  height: number,
  scaffoldZ: number,
): void {
  const bayCount = Math.max(1, Math.ceil(wallLength / SCAFFOLD_BAY))
  const postXs: number[] = []
  for (let i = 0; i <= bayCount; i++) {
    postXs.push(Math.min(i * (wallLength / bayCount), wallLength))
  }

  for (let i = 0; i < postXs.length; i++) {
    const x = postXs[i] as number
    const post = new Mesh(
      new BoxGeometry(SCAFFOLD_POST_SIZE, height, SCAFFOLD_POST_SIZE),
      scaffoldMaterial,
    )
    post.name = `scaffold-post-${side}-${i}`
    post.position.set(x, height / 2, scaffoldZ)
    group.add(post)
  }

  const ledgerRows = Math.max(1, Math.floor(height / SCAFFOLD_LIFT))
  for (let row = 1; row <= ledgerRows; row++) {
    const y = Math.min(row * SCAFFOLD_LIFT, height - SCAFFOLD_POST_SIZE)
    for (let i = 0; i < postXs.length - 1; i++) {
      const xa = postXs[i] as number
      const xb = postXs[i + 1] as number
      const ledger = new Mesh(
        new BoxGeometry(xb - xa, SCAFFOLD_LEDGER_SIZE, SCAFFOLD_LEDGER_SIZE),
        scaffoldMaterial,
      )
      ledger.name = `scaffold-ledger-${side}-${row}-${i}`
      ledger.position.set((xa + xb) / 2, y, scaffoldZ)
      group.add(ledger)

      // One diagonal brace per bay, base-to-top, alternating direction so
      // adjacent bays cross-brace like a real erected frame.
      const topY = Math.min(SCAFFOLD_LIFT, height - SCAFFOLD_POST_SIZE)
      const dx = i % 2 === 0 ? xb - xa : xa - xb
      const braceLength = Math.hypot(dx, topY)
      const brace = new Mesh(
        new BoxGeometry(braceLength, SCAFFOLD_BRACE_SIZE, SCAFFOLD_BRACE_SIZE),
        scaffoldMaterial,
      )
      brace.name = `scaffold-brace-${side}-${i}`
      brace.position.set((xa + xb) / 2, topY / 2, scaffoldZ)
      brace.rotation.z = sign * Math.atan2(topY, dx)
      group.add(brace)
    }
  }
}

export function buildFormworkGeometry(node: FormworkSystemNode, ctx: GeometryContext): Group {
  const group = new Group()
  const wall = ctx.parent as WallNode | null
  if (!wall || wall.type !== 'wall') return group
  if (!wall.formworkType || wall.formworkType === 'none') return group

  const [sx, sy] = wall.start
  const [ex, ey] = wall.end
  const dx = ex - sx
  const dy = ey - sy
  const wallLength = Math.hypot(dx, dy)
  if (wallLength <= 0) return group
  const height = wall.height ?? 2.4
  const thickness = wall.thickness ?? 0.15
  const faceOffset = thickness / 2 + PANEL_THICKNESS / 2

  const panelWidth = node.panelWidth || 0.6
  const panelCount = Math.max(1, Math.ceil(wallLength / panelWidth))
  const actualPanelWidth = wallLength / panelCount
  const panelHeight = height - EDGE_MARGIN * 2
  // Local space along the wall's own axis, [0, wallLength]. This node
  // renders as a child inside the wall's own <mesh>, which WallSystem
  // already positions at wall.start with rotation.y = wall heading —
  // see attach.ts. No transform applied here.

  const material = new MeshStandardMaterial({ color: panelColor(wall.formworkType) })

  // Shutter panels on BOTH faces — poured concrete pushes outward on both
  // sides, so a single-face shutter would blow out. This is what makes
  // the assembly leak-proof rather than a decorative front skin.
  for (const { side, sign } of SIDES) {
    for (let i = 0; i < panelCount; i++) {
      const centerAlongWall = (i + 0.5) * actualPanelWidth
      const panel = new Mesh(
        new BoxGeometry(actualPanelWidth - PANEL_GAP, panelHeight, PANEL_THICKNESS),
        material,
      )
      panel.name = `panel-${side}-${i}`
      panel.position.set(centerAlongWall, height / 2, sign * faceOffset)
      group.add(panel)
    }
  }

  // Through-ties clamp both faces together — one member spans the full
  // wall thickness plus both panel skins, so it doesn't need per-side
  // duplication.
  const tieSpacing = wall.tieSpacing ?? 0.6
  const tieRows = Math.max(1, Math.floor((height - EDGE_MARGIN * 2) / tieSpacing) + 1)
  const tieCols = Math.max(1, Math.round(wallLength / tieSpacing))
  for (let row = 0; row < tieRows; row++) {
    const y = EDGE_MARGIN + row * tieSpacing
    if (y > height - EDGE_MARGIN) continue
    for (let col = 0; col <= tieCols; col++) {
      const x = (col / tieCols) * wallLength
      const tie = new Mesh(new BoxGeometry(TIE_SIZE, TIE_SIZE, thickness + PANEL_THICKNESS * 2), tieMaterial)
      tie.name = `tie-${row}-${col}`
      tie.position.set(x, y, 0)
      group.add(tie)
    }
  }

  // Walers (waling beams) on both faces, backing the panels so ties bear
  // on a beam rather than the plywood/steel skin directly.
  const walerSpacing = wall.walerSpacing ?? 0.9
  const walerRows = Math.max(1, Math.floor((height - EDGE_MARGIN * 2) / walerSpacing) + 1)
  for (const { side, sign } of SIDES) {
    const walerZ = sign * (faceOffset + PANEL_THICKNESS / 2 + WALER_DEPTH / 2)
    for (let row = 0; row < walerRows; row++) {
      const y = EDGE_MARGIN + row * walerSpacing
      if (y > height - EDGE_MARGIN) continue
      const waler = new Mesh(new BoxGeometry(wallLength, WALER_HEIGHT, WALER_DEPTH), walerMaterial)
      waler.name = `waler-${side}-${row}`
      waler.position.set(wallLength / 2, y, walerZ)
      group.add(waler)
    }
  }

  // Working scaffold — uprights + ledgers + diagonal braces standing off
  // each face, only when the wall calls for it (tall pours / access).
  if (wall.scaffoldRequired) {
    for (const { side, sign } of SIDES) {
      const scaffoldZ = sign * (faceOffset + PANEL_THICKNESS / 2 + WALER_DEPTH + SCAFFOLD_STANDOFF)
      buildScaffoldSide(group, side, sign, wallLength, height, scaffoldZ)
    }
  }

  return group
}
