import { columnFormSizeMm } from '@pascal-app/core/formwork'
import type { ColumnNode } from '@pascal-app/core/schema'
import { BoxGeometry, Group, Mesh, type MeshStandardMaterial } from 'three'
import { columnPourDesign } from './design'
import {
  type FormworkScope,
  PANEL_GAP,
  PANEL_THICKNESS,
  SCAFFOLD_LEDGER_SIZE,
  SCAFFOLD_LIFT,
  SCAFFOLD_POST_SIZE,
  SCAFFOLD_STANDOFF,
  scaffoldMaterial,
  TIE_SIZE,
  tieMaterial,
  WALER_DEPTH,
  WALER_HEIGHT,
  walerMaterial,
} from './geometry-shared'
import type { FormworkAssemblyNode } from './schema'

/**
 * Column box form: four flat panels clamped by yokes, or — for a round or
 * many-sided column — a wrapped shaft banded at the same spacing.
 *
 * A column is not a short wall. Nothing passes through it: the panels are held
 * by clamps that close right around the outside, so the shutter is a self-
 * reacting box and the tie grid a wall needs has no analogue here. That is why
 * this is a separate builder rather than a wall with different extents.
 *
 * The clamps are not evenly spaced either. A column is short and filled fast, so
 * the pressure diagram is strongly triangular over its whole height and the
 * spacing a clamp can take goes as `1/h` — tight at the base, opening out going
 * up. `clampSchedule` derives that, and this builder places what it returns.
 *
 * Built in column-local unrotated space centred on the origin, with Y running
 * up from the column base — `ColumnRenderer`'s group already carries
 * `node.position` and `node.rotation`, so reusing the world-space `plan.outline`
 * the coverage solver computes would apply the rotation twice.
 */

/**
 * The four box-form faces, in the corner order `columnOutline` walks so an edge
 * index maps to the face role the solver classified. Edge `i` runs from outline
 * corner `i`, and local (x, z) is what the solver's `Vec2` (x, y) holds before
 * rotation.
 */
const BOX_FACES = [
  { role: 'column-face-1', axis: 'z', sign: -1 },
  { role: 'column-face-2', axis: 'x', sign: 1 },
  { role: 'column-face-3', axis: 'z', sign: 1 },
  { role: 'column-face-4', axis: 'x', sign: -1 },
] as const

/**
 * The panels across one face. A column form is *set* to a size rather than
 * divided into modules, so where one reaches this face it is a single panel at
 * the form's own size — which is what puts the compensation on screen: 337 mm of
 * concrete is formed at 350 and the box laps the extra at its corners. Where no
 * form reaches it the face is a carpenter's box, and the ply is cut into even
 * strips no wider than `panelWidth`.
 */
function strips(
  length: number,
  panelWidth: number,
  formSizeM: number | undefined,
): Array<{ centre: number; width: number }> {
  if (formSizeM !== undefined) return [{ centre: 0, width: formSizeM }]
  const count = Math.max(1, Math.ceil(length / panelWidth))
  const width = length / count
  const out: Array<{ centre: number; width: number }> = []
  for (let i = 0; i < count; i++) out.push({ centre: -length / 2 + (i + 0.5) * width, width })
  return out
}

/** Rows up the form, one at `spacing` from the base and always one at the top. */
function rows(bottom: number, top: number, spacing: number): number[] {
  const out: number[] = []
  for (let y = bottom; y < top - 1e-6; y += spacing) out.push(y)
  out.push(top)
  return out
}

export function buildColumnFormwork(
  column: ColumnNode,
  node: FormworkAssemblyNode,
  scope: FormworkScope,
  material: MeshStandardMaterial,
): Group {
  const group = new Group()
  const { unit, isFormed } = scope

  const height = column.height
  const baseY = unit?.baseElevation ?? 0
  const topY = unit?.topElevation ?? height
  if (topY - baseY <= 0) return group

  // A column is formed right up to the beam or slab soffit above it, so there is
  // no margin at the top — only at the base, where the form lands on the kicker
  // cast to locate it. At a lift joint there is no kicker: the concrete below is
  // this same column, and the form stands on it.
  // Solved once and shared with the design report: a panel printing its own
  // schedule could disagree with the clamps on screen.
  const { facets, form, kickerM, schedule } = columnPourDesign(column, unit)
  const formBottom = baseY + kickerM
  const formHeight = topY - formBottom
  if (formHeight <= 0) return group
  const centreY = formBottom + formHeight / 2

  const panelWidth = node.panelWidth || 0.6
  // The schedule sets out from the pour base; the meshes are placed in the
  // column's own space, which starts at the element base.
  const clampYs = schedule.rows.map((row) => baseY + row.elevationMm / 1000)

  if (facets !== undefined) {
    // Wrapped shaft — a tube or a bespoke n-sided form. One face role covers
    // the whole surface, so it is either wrapped or it is embedded in a wall.
    if (!isFormed('shaft')) return group
    const radius = column.radius
    const formRadius = radius + PANEL_THICKNESS / 2
    const facetWidth = 2 * radius * Math.sin(Math.PI / facets)
    for (let i = 0; i < facets; i++) {
      const angle = (2 * Math.PI * i) / facets
      const panel = new Mesh(
        new BoxGeometry(facetWidth + PANEL_GAP, formHeight, PANEL_THICKNESS),
        material,
      )
      panel.name = `panel-shaft-${i}`
      // The solver's `toWorld` maps local (x, z) to Vec2 (x, y) with a −sin
      // term, so a facet at `angle` sits at (cos, sin) in local (x, z).
      panel.position.set(formRadius * Math.cos(angle), centreY, formRadius * Math.sin(angle))
      panel.rotation.y = -angle + Math.PI / 2
      group.add(panel)
    }

    // Steel bands rather than clamps: a round form has no corners to yoke.
    const bandRadius = formRadius + PANEL_THICKNESS / 2 + TIE_SIZE / 2
    const bandWidth = 2 * bandRadius * Math.tan(Math.PI / facets)
    for (const [row, y] of clampYs.entries()) {
      for (let i = 0; i < facets; i++) {
        const angle = (2 * Math.PI * i) / facets
        const band = new Mesh(new BoxGeometry(bandWidth, TIE_SIZE, TIE_SIZE), tieMaterial)
        band.name = `clamp-${row}-${i}`
        band.position.set(bandRadius * Math.cos(angle), y, bandRadius * Math.sin(angle))
        band.rotation.y = -angle + Math.PI / 2
        group.add(band)
      }
    }
  } else {
    const halfW = column.width / 2
    const halfD = column.depth / 2

    for (const boxFace of BOX_FACES) {
      if (!isFormed(boxFace.role)) continue
      const alongX = boxFace.axis === 'z'
      const faceWidth = alongX ? column.width : column.depth
      const offset = (alongX ? halfD : halfW) + PANEL_THICKNESS / 2
      // Each face is set to its own size: a 400 × 600 column is two 400 forms and
      // two 600 ones, not four of the widest.
      const faceFormMm = form ? columnFormSizeMm(form, faceWidth * 1000) : undefined
      const faceStrips = strips(
        faceWidth,
        panelWidth,
        faceFormMm === undefined ? undefined : faceFormMm / 1000,
      )
      for (const [i, strip] of faceStrips.entries()) {
        const panel = new Mesh(
          new BoxGeometry(
            alongX ? strip.width - PANEL_GAP : PANEL_THICKNESS,
            formHeight,
            alongX ? PANEL_THICKNESS : strip.width - PANEL_GAP,
          ),
          material,
        )
        panel.name = `panel-${boxFace.role}-${i}`
        panel.position.set(
          alongX ? strip.centre : boxFace.sign * offset,
          centreY,
          alongX ? boxFace.sign * offset : strip.centre,
        )
        group.add(panel)
      }
    }

    // Column clamps: two pairs of yokes closing right around the outside of
    // the panels. They react against each other, which is what lets a column
    // form stand without a single tie passing through the concrete. Emitted
    // only where all four panels are present — a pilaster with faces embedded
    // in a wall has nothing to close against and is strutted off the wall.
    const boxed = BOX_FACES.every((boxFace) => isFormed(boxFace.role))
    if (boxed) {
      const clampX = halfW + PANEL_THICKNESS + WALER_DEPTH / 2
      const clampZ = halfD + PANEL_THICKNESS + WALER_DEPTH / 2
      const spanX = column.width + 2 * (PANEL_THICKNESS + WALER_DEPTH)
      const spanZ = column.depth + 2 * (PANEL_THICKNESS + WALER_DEPTH)
      for (const [row, y] of clampYs.entries()) {
        for (const sign of [1, -1] as const) {
          const alongX = new Mesh(new BoxGeometry(spanX, WALER_HEIGHT, WALER_DEPTH), walerMaterial)
          alongX.name = `clamp-${row}-${sign > 0 ? 'front' : 'back'}`
          alongX.position.set(0, y, sign * clampZ)
          group.add(alongX)

          const alongZ = new Mesh(new BoxGeometry(WALER_DEPTH, WALER_HEIGHT, spanZ), walerMaterial)
          alongZ.name = `clamp-${row}-${sign > 0 ? 'right' : 'left'}`
          alongZ.position.set(sign * clampX, y, 0)
          group.add(alongZ)
        }
      }
    }
  }

  // A formed column top means a sloping or stepped head — the concrete would
  // otherwise run off it — so it takes a lid held down rather than propped up.
  if (isFormed('top')) {
    const lidX = (facets !== undefined ? column.radius * 2 : column.width) + PANEL_THICKNESS * 2
    const lidZ = (facets !== undefined ? column.radius * 2 : column.depth) + PANEL_THICKNESS * 2
    const lid = new Mesh(new BoxGeometry(lidX, PANEL_THICKNESS, lidZ), material)
    lid.name = 'panel-top'
    lid.position.set(0, topY + PANEL_THICKNESS / 2, 0)
    group.add(lid)
  }

  // Access scaffold: four uprights at the corners of the form, tied together
  // every lift. A column is reached from all sides, so this is a tower rather
  // than the standing frames a wall face takes.
  if (column.scaffoldRequired) {
    const standX =
      (facets !== undefined ? column.radius : column.width / 2) +
      PANEL_THICKNESS +
      SCAFFOLD_STANDOFF
    const standZ =
      (facets !== undefined ? column.radius : column.depth / 2) +
      PANEL_THICKNESS +
      SCAFFOLD_STANDOFF
    const corners = [
      [standX, standZ],
      [standX, -standZ],
      [-standX, -standZ],
      [-standX, standZ],
    ] as const
    for (const [i, [x, z]] of corners.entries()) {
      const post = new Mesh(
        new BoxGeometry(SCAFFOLD_POST_SIZE, topY - baseY, SCAFFOLD_POST_SIZE),
        scaffoldMaterial,
      )
      post.name = `scaffold-post-${i}`
      post.position.set(x, baseY + (topY - baseY) / 2, z)
      group.add(post)
    }
    for (const [row, y] of rows(baseY + SCAFFOLD_LIFT, topY, SCAFFOLD_LIFT).entries()) {
      if (y > topY - SCAFFOLD_POST_SIZE) continue
      for (const [i, [x, z]] of corners.entries()) {
        const next = corners[(i + 1) % corners.length] as readonly [number, number]
        const dx = next[0] - x
        const dz = next[1] - z
        const ledger = new Mesh(
          new BoxGeometry(Math.hypot(dx, dz), SCAFFOLD_LEDGER_SIZE, SCAFFOLD_LEDGER_SIZE),
          scaffoldMaterial,
        )
        ledger.name = `scaffold-ledger-${row}-${i}`
        ledger.position.set(x + dx / 2, y, z + dz / 2)
        ledger.rotation.y = Math.atan2(-dz, dx)
        group.add(ledger)
      }
    }
  }

  return group
}
