import { columnFormSizeMm, type FormworkPartSpec } from '@pascal-app/core/formwork'
import type { ColumnNode } from '@pascal-app/core/schema'
import { BoxGeometry, Group, Mesh, type MeshStandardMaterial } from 'three'
import { type ColumnPourDesign, columnPourDesign } from './design'
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
import { type BuiltFormwork, collectParts } from './parts'
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
 * Which face a clamp arm closes against, so the four arms of one row get four
 * marks rather than one. A clamp is a part off the rack in its own right — the
 * schedule counts `clampCount` as well as `setCount` — so each arm is billed, and
 * an arm's only distinguishing position is the face it bears on.
 */
const CLAMP_FACES = {
  z: { 1: 'column-face-3', '-1': 'column-face-1' },
  x: { 1: 'column-face-2', '-1': 'column-face-4' },
} as const

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

/**
 * A catalog weight only where the list actually states one.
 *
 * Several column entries carry `weightKg: 0` because the published sheet gives a
 * range rather than a figure. Passing that through would put a `0` into the bill's
 * weight total, which reads as "weighs nothing" instead of "not stated" — and unlike
 * a missing weight it does not suppress the total, so the whole column of figures
 * comes out short with nothing on screen to say so.
 */
function statedWeight(weightKg: number): { weightKg?: number } {
  return weightKg > 0 ? { weightKg } : {}
}

/**
 * One arm of a clamp set at one row.
 *
 * The utilisation is the corner tension against the clamp's rated tension, while
 * `governingCheck` names what actually set the spacing — usually the arm's own
 * bending, which is the check that bites first past a few hundred millimetres of
 * section. So the ratio and the check deliberately describe different things: the
 * ratio is what this part carries, the check is why it is where it is. Reporting the
 * bending ratio instead would read as 1.0 on every row, since that is the limit the
 * schedule solved the spacing against.
 */
function clampSpec(
  schedule: ColumnPourDesign['schedule'],
  row: ColumnPourDesign['schedule']['rows'][number] | undefined,
  face: (typeof BOX_FACES)[number]['role'],
  elevationMm: number,
  spanM: number,
): FormworkPartSpec {
  const clamp = schedule.clamp
  return {
    kind: 'waler',
    member: 'clamp',
    locus: { on: 'elevation', face, elevationMm },
    ...(clamp ? { catalogId: clamp.id } : {}),
    description: clamp ? clamp.label : `Column clamp arm ${Math.round(spanM * 1000)} mm`,
    provenance: clamp ? 'standard' : 'bespoke',
    ...(clamp ? statedWeight(clamp.weightKg) : {}),
    lengthMm: spanM * 1000,
    ...(clamp && row
      ? {
          structure: {
            utilisation: row.forceKn / clamp.capacityKn,
            governingCheck: row.governedBy,
          },
        }
      : {}),
  }
}

export function buildColumnFormwork(
  column: ColumnNode,
  node: FormworkAssemblyNode,
  scope: FormworkScope,
  material: MeshStandardMaterial,
): BuiltFormwork {
  const group = new Group()
  const parts = collectParts(group, node)
  const { unit, isFormed, settings } = scope

  const height = column.height
  const baseY = unit?.baseElevation ?? 0
  const topY = unit?.topElevation ?? height
  if (topY - baseY <= 0) return parts.finish()

  // A column is formed right up to the beam or slab soffit above it, so there is
  // no margin at the top — only at the base, where the form lands on the kicker
  // cast to locate it. At a lift joint there is no kicker: the concrete below is
  // this same column, and the form stands on it.
  // Solved once and shared with the design report: a panel printing its own
  // schedule could disagree with the clamps on screen.
  const design = columnPourDesign(settings, column, unit)
  const { facets, form, kickerM, schedule } = design
  // A column is boxed rather than packed from a run, so there are no strip packs to
  // carry — the envelope is the whole of what an invariant can assert against here.
  parts.evidence({ envelope: design.envelope })
  const formBottom = baseY + kickerM
  const formHeight = topY - formBottom
  if (formHeight <= 0) return parts.finish()
  const centreY = formBottom + formHeight / 2

  const panelWidth = node.panelWidth || 0.6
  // The schedule sets out from the pour base; the meshes are placed in the
  // column's own space, which starts at the element base.
  const clampYs = schedule.rows.map((row) => baseY + row.elevationMm / 1000)

  if (facets !== undefined) {
    // Wrapped shaft — a tube or a bespoke n-sided form. One face role covers
    // the whole surface, so it is either wrapped or it is embedded in a wall.
    if (!isFormed('shaft')) return parts.finish()
    const radius = column.radius
    const formRadius = radius + PANEL_THICKNESS / 2
    const facetWidth = 2 * radius * Math.sin(Math.PI / facets)
    // A round column is wrapped in one form and drawn as many facets, so it is one
    // part carrying many meshes; a polygonal one is a carpenter's box and each flat
    // side is genuinely a separate board off the saw. Billing the round case per
    // facet would order twenty-four forms for one tube.
    const wrapped = column.crossSection === 'round'
    let wrapMark = ''
    if (wrapped) {
      wrapMark = parts.emit({
        kind: 'panel',
        locus: { on: 'facet', face: 'shaft', angleDeg: 0 },
        // The developed width is what gets ordered for a wrap — a 600 mm column
        // takes 1885 mm of form round it, not 600.
        widthMm: 2 * Math.PI * formRadius * 1000,
        heightMm: formHeight * 1000,
        description: `Circular column form ${Math.round(radius * 2000)} mm dia × ${Math.round(formHeight * 1000)} mm`,
        provenance: 'bespoke',
      })
    }
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
      if (wrapped) {
        parts.tag(wrapMark, panel)
      } else {
        parts.emit(
          {
            kind: 'ply-piece',
            use: 'cut-board',
            locus: { on: 'facet', face: 'shaft', angleDeg: (angle * 180) / Math.PI },
            widthMm: facetWidth * 1000,
            heightMm: formHeight * 1000,
            description: `Shaft side ${Math.round(facetWidth * 1000)} × ${Math.round(formHeight * 1000)} mm`,
            provenance: 'bespoke',
          },
          panel,
        )
      }
    }

    // Steel bands rather than clamps: a round form has no corners to yoke. One band
    // is one hoop, drawn as a segment per facet — so the row is the part and the
    // segments carry its mark, the same way the wrap does.
    const bandRadius = formRadius + PANEL_THICKNESS / 2 + TIE_SIZE / 2
    const bandWidth = 2 * bandRadius * Math.tan(Math.PI / facets)
    for (const [row, y] of clampYs.entries()) {
      const bandMark = parts.emit({
        kind: 'waler',
        member: 'band',
        locus: { on: 'elevation', face: 'shaft', elevationMm: (y - baseY) * 1000 },
        description: `Column band ${Math.round(2 * Math.PI * bandRadius * 1000)} mm`,
        provenance: 'bespoke',
        lengthMm: 2 * Math.PI * bandRadius * 1000,
      })
      for (let i = 0; i < facets; i++) {
        const angle = (2 * Math.PI * i) / facets
        const band = new Mesh(new BoxGeometry(bandWidth, TIE_SIZE, TIE_SIZE), tieMaterial)
        band.name = `clamp-${row}-${i}`
        band.position.set(bandRadius * Math.cos(angle), y, bandRadius * Math.sin(angle))
        band.rotation.y = -angle + Math.PI / 2
        parts.tag(bandMark, band)
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
        // Set out from the face's own centre, so the near edge of the one panel a
        // system form puts on a face is at half its set size and stays there when the
        // concrete dimension moves inside the increment.
        const locus = {
          on: 'run',
          face: boxFace.role,
          stationMm: (strip.centre - strip.width / 2) * 1000,
        } as const
        parts.emit(
          form && faceFormMm !== undefined
            ? {
                kind: 'panel',
                locus,
                catalogId: form.id,
                description: `${form.label}, set to ${Math.round(faceFormMm)} mm`,
                provenance: 'standard',
                ...statedWeight(form.weightKg),
                widthMm: faceFormMm,
                heightMm: formHeight * 1000,
              }
            : {
                kind: 'ply-piece',
                use: 'cut-board',
                locus,
                description: `Column side ${Math.round(strip.width * 1000)} × ${Math.round(formHeight * 1000)} mm`,
                provenance: 'bespoke',
                widthMm: strip.width * 1000,
                heightMm: formHeight * 1000,
              },
          panel,
        )
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
        const elevationMm = (y - baseY) * 1000
        const scheduled = schedule.rows[row]
        for (const sign of [1, -1] as const) {
          const alongX = new Mesh(new BoxGeometry(spanX, WALER_HEIGHT, WALER_DEPTH), walerMaterial)
          alongX.name = `clamp-${row}-${sign > 0 ? 'front' : 'back'}`
          alongX.position.set(0, y, sign * clampZ)
          parts.emit(
            clampSpec(schedule, scheduled, CLAMP_FACES.z[sign], elevationMm, spanX),
            alongX,
          )

          const alongZ = new Mesh(new BoxGeometry(WALER_DEPTH, WALER_HEIGHT, spanZ), walerMaterial)
          alongZ.name = `clamp-${row}-${sign > 0 ? 'right' : 'left'}`
          alongZ.position.set(sign * clampX, y, 0)
          parts.emit(
            clampSpec(schedule, scheduled, CLAMP_FACES.x[sign], elevationMm, spanZ),
            alongZ,
          )
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
    parts.emit(
      {
        kind: 'ply-piece',
        use: 'cut-board',
        locus: { on: 'elevation', face: 'top', elevationMm: (topY - baseY) * 1000 },
        description: `Column head lid ${Math.round(lidX * 1000)} × ${Math.round(lidZ * 1000)} mm`,
        provenance: 'bespoke',
        widthMm: lidX * 1000,
        heightMm: lidZ * 1000,
      },
      lid,
    )
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
      parts.add(post)
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
        parts.add(ledger)
      }
    }
  }

  return parts.finish()
}
