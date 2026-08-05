import {
  type AnyNode,
  type AnyNodeId,
  type ElementCoverage,
  FACE_REASON_LABELS,
  type FormworkFace,
  type PourUnit,
  pourCoverageForElement,
} from '@pascal-app/core'
import { type FloorplanSchedule, formatAreaLabel, formatVolumeLabel } from '@pascal-app/editor'
import { FACE_ORDER, FACE_ROLE_LABELS } from './face-labels'
import type { FormworkAssemblyNode } from './schema'

/**
 * The formwork schedule: one row per pour, with the shuttered area that pour
 * needs and which faces make it up.
 *
 * A row is a *pour unit* rather than an assembly node, because that is the unit a
 * shutter is erected, struck and paid as. It is also why the row carries the
 * unformed faces explicitly instead of only totalling the formed ones: the
 * difference between the physical surface and the measured area is where the money
 * and the arguments are, and a schedule that silently omits a face nobody is
 * forming reads as an arithmetic error rather than as a decision. So an
 * abutment or an earth face appears in the row's notes with the engine's reason.
 *
 * Fed by `collectFloorplanSchedules`, which passes every visible assembly on the
 * level. Grouping back to hosts happens here: one host may carry several
 * assemblies (one per segment × lift), and the schedule wants them adjacent and in
 * pour order, not in scene-graph order.
 */

/** m² of shutter below which a face is a detail rather than a line on a schedule. */
const NEGLIGIBLE_AREA_SQM = 0.01

function nodeLabel(node: AnyNode): string {
  return (node as { name?: string }).name?.trim() || node.type
}

function formedFaces(coverage: ElementCoverage): FormworkFace[] {
  const rank = (face: FormworkFace) => {
    const index = FACE_ORDER.indexOf(face.role)
    return index < 0 ? FACE_ORDER.length : index
  }
  return coverage.faces
    .filter((face) => face.formed && face.measuredArea > NEGLIGIBLE_AREA_SQM)
    .sort((a, b) => rank(a) - rank(b))
}

/**
 * Faces deliberately not shuttered, and why — the row's audit trail.
 *
 * Filtered by reason rather than by area: an unformed face is built with
 * `physicalArea: 0` whatever its real size, so an area threshold here would
 * suppress every omission and leave the column permanently empty. What is worth
 * dropping is the pair of reasons that are true of every element and so say
 * nothing — a top that gets screeded and a base that bears on its kicker are not
 * decisions anybody made about this pour.
 */
const UNREMARKABLE_UNFORMED: ReadonlySet<string> = new Set([
  'FORMWORK_DISABLED',
  'SCREEDED_OPEN',
  'BEARS_ON_KICKER_OR_SUBSTRATE',
])

function omissions(coverage: ElementCoverage): string[] {
  const out: string[] = []
  for (const face of coverage.faces) {
    if (face.formed || UNREMARKABLE_UNFORMED.has(face.reason)) continue
    out.push(`${FACE_ROLE_LABELS[face.role]}: ${FACE_REASON_LABELS[face.reason]}`)
  }
  return out
}

function faceList(faces: readonly FormworkFace[], unit: 'metric' | 'imperial'): string {
  if (faces.length === 0) return '—'
  return faces
    .map((face) => `${FACE_ROLE_LABELS[face.role]} ${formatAreaLabel(face.measuredArea, unit)}`)
    .join(', ')
}

/**
 * How a pour is named on the schedule. The host's name carries the location, and
 * the segment/lift indices carry which piece of it this is — 1-based, because a
 * drawing that calls the first lift "lift 0" is a drawing written for a
 * programmer.
 */
function pourMark(host: AnyNode, unit: PourUnit | undefined, index: number): string {
  const base = nodeLabel(host)
  if (!unit) return base
  return `${base} / S${unit.segmentIndex + 1}-L${unit.liftIndex + 1}`.concat(
    index > 0 && unit.segmentIndex === 0 && unit.liftIndex === 0 ? ` (${index + 1})` : '',
  )
}

export function buildFormworkFloorplanSchedule(args: {
  siblings: ReadonlyArray<FormworkAssemblyNode>
  nodes: Readonly<Record<string, AnyNode>>
  levelId: AnyNodeId
  unit: 'metric' | 'imperial'
}): FloorplanSchedule | null {
  if (args.siblings.length === 0) return null

  // Hosts in the order their assemblies appear, so the schedule follows the scene
  // rather than an id sort. Several assemblies share a host; it is listed once and
  // its pour units are expanded below.
  const hostIds: AnyNodeId[] = []
  const seen = new Set<string>()
  for (const assembly of args.siblings) {
    const hostId = assembly.parentId
    if (!hostId || seen.has(hostId)) continue
    seen.add(hostId)
    hostIds.push(hostId as AnyNodeId)
  }

  const levelNodes = Object.values(args.nodes as Record<string, AnyNode>)
  const rows: Array<{ id: string; cells: Record<string, string> }> = []
  const issues: string[] = []
  let totalSqM = 0

  for (const hostId of hostIds) {
    const host = args.nodes[hostId]
    if (!host) continue
    const units = pourCoverageForElement(hostId, levelNodes)
    if (units.length === 0) {
      // An assembly whose host the coverage engine does not recognise as castable
      // — its shuttering was switched off, or the host was changed to a kind that
      // is not cast. The shutter is still in the scene, so the schedule says so
      // rather than dropping the row and appearing complete.
      issues.push(`${nodeLabel(host)} carries formwork but no longer resolves to a castable pour.`)
      continue
    }

    for (const [index, { unit, coverage }] of units.entries()) {
      const faces = formedFaces(coverage)
      const area = faces.reduce((sum, face) => sum + face.measuredArea, 0)
      if (faces.length === 0 && area <= NEGLIGIBLE_AREA_SQM) continue
      totalSqM += area
      const notes = omissions(coverage)
      rows.push({
        id: `${hostId}:${unit?.segmentIndex ?? 0}:${unit?.liftIndex ?? 0}`,
        cells: {
          mark: pourMark(host, unit, index),
          element: host.type,
          area: formatAreaLabel(area, args.unit),
          volume: unit ? formatVolumeLabel(unit.volumeCuM, args.unit) : '—',
          lift: unit ? `${unit.baseElevation.toFixed(2)}–${unit.topElevation.toFixed(2)} m` : '—',
          faces: faceList(faces, args.unit),
          notes: notes.length > 0 ? notes.join('; ') : '—',
        },
      })
    }
  }

  if (rows.length === 0) return null

  rows.push({
    id: 'formwork-total',
    cells: {
      mark: 'TOTAL',
      element: '',
      area: formatAreaLabel(totalSqM, args.unit),
      volume: '',
      lift: '',
      faces: '',
      notes: '',
    },
  })

  return {
    id: 'formwork',
    title: 'FORMWORK SCHEDULE',
    columns: [
      { key: 'mark', label: 'POUR', weight: 1.3 },
      { key: 'element', label: 'ELEMENT', weight: 0.7 },
      { key: 'area', label: 'SHUTTER AREA', weight: 0.95 },
      { key: 'volume', label: 'CONCRETE', weight: 0.85 },
      { key: 'lift', label: 'LIFT', weight: 1.0 },
      { key: 'faces', label: 'FACES FORMED', weight: 2.0 },
      { key: 'notes', label: 'NOT FORMED', weight: 1.7 },
    ],
    rows,
    ...(issues.length > 0 ? { issues } : {}),
  }
}
