import type { GeometryContext } from '@pascal-app/core/registry'
import type { WallNode } from '@pascal-app/core/schema'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { FormworkSystemNode } from './schema'

/**
 * Pure formwork geometry builder. Reads the host wall (`ctx.parent`) for
 * length/height/thickness and its construction fields
 * (`tieSpacing`/`walerSpacing`) to tile shutter panels + tie markers +
 * waler beams along the wall's front face.
 *
 * v1: plain colored boxes, no textures/slots — see
 * `wiki/formwork-system-plan.md` decision #2. Panels/ties/walers are
 * named children (`panel-<i>`, `tie-<row>-<col>`, `waler-<row>`) so a
 * future `inspect_formwork` AI tool can count them without re-deriving
 * the layout math.
 */
const PANEL_THICKNESS = 0.02
const PANEL_GAP = 0.005
const TIE_SIZE = 0.03
const WALER_HEIGHT = 0.08
const WALER_DEPTH = 0.1
const EDGE_MARGIN = 0.15

const tieMaterial = new MeshStandardMaterial({ color: '#4a4a4a' }) // steel tie
const walerMaterial = new MeshStandardMaterial({ color: '#6b4a2f' }) // timber waler

function panelColor(formworkType: WallNode['formworkType']): string {
  if (formworkType === 'steel-panel') return '#8a8f94'
  if (formworkType === 'aluminium') return '#c7ccd1'
  return '#c9b896' // plywood / default
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

  for (let i = 0; i < panelCount; i++) {
    const centerAlongWall = (i + 0.5) * actualPanelWidth
    const panel = new Mesh(
      new BoxGeometry(actualPanelWidth - PANEL_GAP, panelHeight, PANEL_THICKNESS),
      material,
    )
    panel.name = `panel-${i}`
    panel.position.set(centerAlongWall, height / 2, faceOffset)
    group.add(panel)
  }

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

  const walerSpacing = wall.walerSpacing ?? 0.9
  const walerRows = Math.max(1, Math.floor((height - EDGE_MARGIN * 2) / walerSpacing) + 1)
  for (let row = 0; row < walerRows; row++) {
    const y = EDGE_MARGIN + row * walerSpacing
    if (y > height - EDGE_MARGIN) continue
    const waler = new Mesh(new BoxGeometry(wallLength, WALER_HEIGHT, WALER_DEPTH), walerMaterial)
    waler.name = `waler-${row}`
    waler.position.set(wallLength / 2, y, faceOffset + PANEL_THICKNESS / 2 + WALER_DEPTH / 2)
    group.add(waler)
  }

  return group
}
