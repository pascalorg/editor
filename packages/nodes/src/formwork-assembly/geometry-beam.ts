import { packRiseRateLimit } from '@pascal-app/core/formwork'
import type { BeamNode } from '@pascal-app/core/schema'
import { BoxGeometry, Group, Mesh, type MeshStandardMaterial } from 'three'
import { beamPourDesign } from './design'
import {
  type FaceRun,
  type FormworkScope,
  PANEL_GAP,
  PANEL_THICKNESS,
  planFace,
  TIE_SIZE,
  tieMaterial,
  WALER_DEPTH,
  WALER_HEIGHT,
  walerMaterial,
} from './geometry-shared'
import { pieceSpec } from './geometry-wall'
import { collectParts, type PartCollector } from './parts'
import type { FormworkAssemblyNode } from './schema'

/**
 * One beam shutter: two side shutters tied across the width, a soffit under it
 * propped off the floor below, and a stop-end at each end.
 *
 * A beam is a short wall lying on its side with a slab underneath it, so the
 * shutter is the two machines those kinds already run, built in the beam's own
 * frame: the side shutters are the wall chain — pressure → sheathing → walers →
 * ties — with the beam's depth as the lift height and its width as the core the
 * ties span; the soffit is the falsework chain, loaded by the beam's own depth
 * of concrete and propped at the falsework's prop pitch. The beam's top is
 * screeded open — nothing forms it.
 *
 * Built in the beam's local frame, the same way the wall builds in its own:
 * X runs along the centreline from the start end, Z across the width, and Y is
 * the beam's own height — the soffit at `elevation` above the level plane, the
 * top at `elevation + depth`. The concrete body the user drew is a separate
 * mesh; this is the shutter that surrounds it.
 */

const SIDES = [
  { face: 'a' as const, sign: 1 as const, role: 'side-a' as const },
  { face: 'b' as const, sign: -1 as const, role: 'side-b' as const },
]

/**
 * Where a through-tie crosses the beam, at the design's solved grid.
 *
 * The tie rows are the wall chain's graded rows up the beam's depth, and each
 * row carries ties along the run divided into equal bays at the row's spacing —
 * the same set-out the wall's conventional shutter uses, and right here because
 * the carpenter drills the ply where the calculation asks. One tie per station,
 * spanning the beam's width plus both skins.
 */
function tieStations(
  design: ReturnType<typeof beamPourDesign>['side'],
  spanStart: number,
  spanEnd: number,
): Array<{ along: number; y: number }> {
  const span = spanEnd - spanStart
  const out: Array<{ along: number; y: number }> = []
  for (const row of design.rows) {
    const bays = Math.max(1, Math.ceil(span / (row.horizontalSpacingMm / 1000) - 1e-9))
    for (let col = 0; col <= bays; col++) {
      out.push({ along: spanStart + (col / bays) * span, y: row.elevationMm / 1000 })
    }
  }
  return out
}

/** One planned shutter piece as a billable part, in the beam's run frame. */
function emitSidePieces(
  parts: PartCollector,
  plan: NonNullable<ReturnType<typeof planFace>>,
  spanStart: number,
  sideSign: 1 | -1,
  face: 'side-a' | 'side-b',
  coreZ: number,
  material: MeshStandardMaterial,
): void {
  for (const [courseIndex, course] of plan.courses.entries()) {
    for (const [index, { lo, hi, piece }] of course.pieces.entries()) {
      const stem = `panel-${sideSign === 1 ? 'a' : 'b'}-c${courseIndex}-${index}`
      const board = new Mesh(
        new BoxGeometry(hi - lo - PANEL_GAP, course.topM - course.baseM, PANEL_THICKNESS),
        material,
      )
      // The skin stands proud of the core on its own side of the beam.
      board.name = stem
      board.position.set((lo + hi) / 2, (course.baseM + course.topM) / 2, coreZ)
      parts.emit(
        pieceSpec(
          piece,
          {
            on: 'run',
            face,
            courseIndex,
            stationMm: (lo - spanStart) * 1000,
          },
          (course.topM - course.baseM) * 1000,
        ),
        board,
      )
    }
  }
}

export function buildBeamFormwork(
  beam: BeamNode,
  node: FormworkAssemblyNode,
  scope: FormworkScope,
  material: MeshStandardMaterial,
) {
  const group = new Group()
  const parts = collectParts(group, node)
  const { element, unit, isFormed, settings } = scope

  const length = Math.hypot(beam.end[0] - beam.start[0], beam.end[1] - beam.start[1])
  if (length <= 0) return parts.finish()
  const width = beam.width
  const depth = beam.depth
  const elevation = beam.elevation

  const spanStart = unit?.startAlong ?? 0
  const spanEnd = unit?.endAlong ?? length
  const baseY = (unit?.baseElevation ?? 0) + elevation
  const topY = (unit?.topElevation ?? depth) + elevation
  const spanLength = spanEnd - spanStart
  if (spanLength <= 0 || topY - baseY <= 0) return parts.finish()

  const { system, side, falsework } = beamPourDesign(settings, beam, unit, node.systemId)
  const runs: FaceRun[] = [{ lo: spanStart, hi: spanEnd }]

  // Both side shutters: a run of the beam's depth, packed off the catalog where a
  // system answers and cut to suit otherwise, exactly as a wall's skin is.
  const planByFace = new Map<'a' | 'b', NonNullable<ReturnType<typeof planFace>>>()
  for (const { face, role } of SIDES) {
    if (!isFormed(role)) continue
    const plan = planFace(runs, node, system, {
      baseM: baseY,
      heightM: topY - baseY,
      kickerM: 0,
    })
    if (plan) planByFace.set(face, plan)
  }

  parts.evidence({
    packs: planByFace.get('a')?.packs ?? planByFace.get('b')?.packs ?? [],
    gangs: planByFace.get('a')?.gangs ?? planByFace.get('b')?.gangs ?? [],
    envelope: side.envelope,
    system,
    ...(() => {
      const riseRate = packRiseRateLimit(
        settings,
        planByFace.get('a')?.packs ?? planByFace.get('b')?.packs ?? [],
        topY - baseY,
        [length, width],
        side.envelope,
      )
      return riseRate === undefined ? {} : { riseRate }
    })(),
  })

  // Side skins, one per formed side, standing proud of the core by the skin's
  // own thickness — the beam's concrete pushes outward on both, so a side left
  // unformed on a double-sided pour would blow out.
  for (const { face, sign, role } of SIDES) {
    if (!isFormed(role)) continue
    const plan = planByFace.get(face)
    if (!plan) continue
    const coreZ = sign * (width / 2 + PANEL_THICKNESS / 2)
    emitSidePieces(parts, plan, spanStart, sign, role, coreZ, material)
  }

  // Through-ties clamp the two skins across the concrete, one member spanning
  // the beam's width plus both skins — the same part a wall's tie is, shorter.
  const tieLengthMm = (width + PANEL_THICKNESS * 2) * 1000
  const stations = tieStations(side, spanStart, spanEnd)
  const rowYs = [...new Set(stations.map((s) => s.y))]
  for (const [index, station] of stations.entries()) {
    const tie = new Mesh(
      new BoxGeometry(TIE_SIZE, TIE_SIZE, width + PANEL_THICKNESS * 2),
      tieMaterial,
    )
    tie.name = `tie-${index}`
    tie.position.set(station.along, baseY + station.y, 0)
    const row = side.rows.find((r) => Math.abs(r.elevationMm / 1000 - station.y) < 1e-9)
    parts.emit(
      {
        kind: 'tie',
        locus: {
          on: 'elevation',
          elevationMm: station.y * 1000,
          stationMm: (station.along - spanStart) * 1000,
        },
        ...(side.tie ? { catalogId: side.tie.id, verification: side.tie.verification } : {}),
        description: side.tie
          ? `${side.tie.label}, ${Math.round(tieLengthMm)} mm`
          : `Through-tie ${Math.round(tieLengthMm)} mm`,
        provenance: side.tie ? 'standard' : 'bespoke',
        ...(side.tie ? { weightKg: side.tie.weightKg } : {}),
        lengthMm: tieLengthMm,
        forceKn: row?.forceKn ?? 0,
        capacityKn: side.tieCapacityKn,
        capacityComponent: side.tieCapacityComponent,
        ...(side.tieCapacityKn > 0
          ? {
              structure: {
                utilisation: (row?.forceKn ?? 0) / side.tieCapacityKn,
                governingCheck: side.tieCapacityComponent,
              },
            }
          : {}),
      },
      tie,
    )
  }

  // Walers on both skins at the tie rows — a tie has to bear on a waler, so the
  // tie rows are the waler rows, the same relationship a wall's shutter has.
  for (const { face, sign, role } of SIDES) {
    if (!isFormed(role)) continue
    const walerZ = sign * (width / 2 + PANEL_THICKNESS + WALER_DEPTH / 2)
    for (const [row, y] of rowYs.sort((a, b) => a - b).entries()) {
      const waler = new Mesh(new BoxGeometry(spanLength, WALER_HEIGHT, WALER_DEPTH), walerMaterial)
      waler.name = `waler-${face}-${row}`
      waler.position.set((spanStart + spanEnd) / 2, baseY + y, walerZ)
      parts.emit(
        {
          kind: 'waler',
          locus: {
            on: 'elevation',
            face: role,
            elevationMm: y * 1000,
            stationMm: spanStart * 1000,
          },
          ...(side.beam ? { catalogId: side.beam.id, verification: side.beam.verification } : {}),
          description: side.beam
            ? `${side.beam.label}, ${Math.round(spanLength * 1000)} mm`
            : `Waler ${Math.round(spanLength * 1000)} mm`,
          provenance: side.beam ? 'standard' : 'bespoke',
          ...(side.beam ? { weightKg: side.beam.kgPerM * spanLength } : {}),
          member: 'waler',
          lengthMm: spanLength * 1000,
          structure: {
            utilisation: side.waler.utilisation,
            governingCheck: side.waler.governedBy,
          },
        },
        waler,
      )
    }
  }

  // Stop-ends close the ends of the pour, exactly as a wall's do: a plate across
  // the beam's width, standing the full depth. A cut inside the beam is closed
  // the same way — the concrete beyond is this same beam, cast later.
  const STOP_ENDS = [
    { role: 'end-start' as const, name: 'stop-end-start' as const, along: spanStart },
    { role: 'end-end' as const, name: 'stop-end-end' as const, along: spanEnd },
  ]
  for (const stopEnd of STOP_ENDS) {
    if (!isFormed(stopEnd.role)) continue
    const plate = new Mesh(
      new BoxGeometry(PANEL_THICKNESS, topY - baseY, width + PANEL_THICKNESS * 2),
      material,
    )
    plate.name = stopEnd.name
    plate.position.set(stopEnd.along, (baseY + topY) / 2, 0)
    const penetrated = scope.faceOf(stopEnd.role)?.starterPenetrations === true
    parts.emit(
      {
        kind: 'stop-end',
        locus: { on: 'end', end: stopEnd.role === 'end-start' ? 'start' : 'end' },
        description: `Bulkhead ${Math.round(width * 1000)} mm wide`,
        provenance: 'bespoke',
        areaSqM: (topY - baseY) * width,
        ...(penetrated ? { starterPenetrations: true as const } : {}),
      },
      plate,
    )
  }

  // The soffit: a deck spanning the beam's width along the length, propped off
  // the floor below at the falsework's prop pitch. The deck is the beam's own
  // depth of concrete carried down — a narrow band, so there is no joist and
  // bearer grid to build: the boards span the width on the side shutters and the
  // props take them straight down, which is exactly how a beam is struck.
  if (isFormed('soffit')) {
    const deckY = baseY - PANEL_THICKNESS / 2
    const boardCount = Math.max(1, Math.ceil(spanLength / (node.panelWidth || 0.6)))
    const boardLength = spanLength / boardCount
    for (let i = 0; i < boardCount; i++) {
      const lo = spanStart + i * boardLength
      const board = new Mesh(
        new BoxGeometry(boardLength - PANEL_GAP, PANEL_THICKNESS, width - PANEL_GAP),
        material,
      )
      board.name = `panel-soffit-${i}`
      board.position.set(lo + boardLength / 2, deckY, 0)
      parts.emit(
        {
          kind: 'ply-piece',
          use: 'deck-sheet',
          locus: { on: 'run', face: 'soffit', stationMm: (lo - spanStart) * 1000 },
          widthMm: boardLength * 1000,
          heightMm: width * 1000,
          ...(falsework.sheathing
            ? { catalogId: falsework.sheathing.id, verification: falsework.sheathing.verification }
            : {}),
          description: falsework.sheathing
            ? `${falsework.sheathing.label}, ${Math.round(boardLength * 1000)} × ${Math.round(width * 1000)} mm`
            : `Deck sheet ${Math.round(boardLength * 1000)} × ${Math.round(width * 1000)} mm`,
          provenance: 'bespoke',
          structure: {
            utilisation: falsework.joist.utilisation,
            governingCheck: falsework.joist.governedBy,
          },
        },
        board,
      )
    }

    // Props down the centreline at the solved pitch, from the deck to the floor
    // the beam is erected off. A beam soffit is one board wide, so a single row
    // under the middle is the honest grid — two rows would stand under the same
    // tributary twice.
    const propTop = deckY - PANEL_THICKNESS / 2
    const propLength = Math.max(0, propTop - 0)
    const propCount = Math.max(1, Math.ceil(spanLength / (falsework.propSpacing.adoptedM || 1)))
    const propPitch = spanLength / propCount
    for (let i = 0; i <= propCount; i++) {
      const along = spanStart + i * propPitch
      const prop = new Mesh(new BoxGeometry(0.05, propLength, 0.05), walerMaterial)
      prop.name = `prop-${i}`
      prop.position.set(along, propTop - propLength / 2, 0)
      parts.emit(
        {
          kind: 'prop',
          locus: { on: 'run', face: 'soffit', stationMm: (along - spanStart) * 1000 },
          ...(falsework.props
            ? { catalogId: falsework.props.id, verification: falsework.props.verification }
            : {}),
          description: falsework.props
            ? `${falsework.props.label}, ${Math.round(propLength * 1000)} mm`
            : `Prop ${Math.round(propLength * 1000)} mm`,
          provenance: falsework.props ? 'standard' : 'bespoke',
          ...(falsework.props ? { weightKg: falsework.props.weightKg } : {}),
          extendedLengthMm: propLength * 1000,
          loadKn: falsework.propLoadKn,
          capacityKn: falsework.propCapacityKn ?? 0,
          ...(falsework.propCapacityKn && falsework.propCapacityKn > 0
            ? {
                structure: {
                  utilisation: falsework.propLoadKn / falsework.propCapacityKn,
                  governingCheck: 'capacity',
                },
              }
            : {}),
        },
        prop,
      )
    }
  }

  return parts.finish()
}
