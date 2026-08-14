import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  cornerLegLength,
  coverageForElement,
  DEDUCTION_REASON_LABELS,
  DEFAULT_FORMWORK_SYSTEM_ID,
  DEFAULT_INSIDE_CORNER_LEG_M,
  DEFAULT_MEASUREMENT_STANDARD_ID,
  FACE_REASON_LABELS,
  faceMeasurementLabel,
  fitCorner,
  type MeasurementStandardId,
  measurementStandard,
  resolveCeilingHeight,
  seededFormworkSystem,
} from '@pascal-app/core'
import type { AnyNode, AnyNodeId } from '@pascal-app/core/schema'
import { z } from 'zod'
import type { SceneOperations } from '../operations'
import { ErrorCode, throwMcpError } from './errors'
import { nodesOnLevel, resolveReportedWallHeight } from './scene-query'
import { NodeIdSchema } from './schemas'

export const describeNodeInput = {
  id: NodeIdSchema,
  /**
   * Contract measurement rules for `formworkCoverage`. The same element yields
   * materially different quantities under each, so the choice belongs to the
   * caller, not to the engine.
   */
  measurementStandard: z
    .enum(['IS_1200_5', 'NRM2', 'HKSMM4', 'CESMM4', 'POMI'])
    .optional()
    .describe(
      'Measurement standard for formwork quantities. IS_1200_5 (India, no deduction ≤ 0.4 m²), NRM2 (RICS, openings counted extra-over never deducted, wall ends ≤ 500 mm by the metre, tops banded at 15°), HKSMM4 (default, no deduction ≤ 1.00 m², wall sides ≤ 300 mm by the metre in 100 mm stages, soffits staged by thickness and prop height), CESMM4 and POMI (unverified clause text). It sets both the deductions and the bill units, so the same element yields different items under each.',
    ),
}

const deductionOutput = z.object({
  reason: z.string(),
  explanation: z.string(),
  sourceId: z.string(),
  areaSqM: z.number(),
  physicalSqM: z.number(),
  measuredSqM: z.number(),
})

const measurementStageOutput = z.object({
  index: z.number(),
  lowerM: z.number(),
  upperM: z.number(),
  label: z.string(),
})

/**
 * How the standard bills one face. Separate from its areas because a narrow face
 * is not billed in the unit its area is measured in at all: a 150 mm nib is so
 * many metres of run, and answering "how many m²" about it is the wrong item.
 */
const faceMeasurementOutput = z.object({
  unit: z.enum(['m', 'm2']),
  /** In `unit` — the run in metres, or the measured area in m². */
  quantity: z.number(),
  surfaceClass: z.enum(['vertical', 'horizontal', 'sloping', 'curved']),
  widthM: z.number().optional(),
  /** `widthM` at the clause's stage — the width to state on the item. */
  statedWidthM: z.number().optional(),
  thicknessStage: measurementStageOutput.optional(),
  heightStage: measurementStageOutput.optional(),
  slopeBand: z.object({ boundaryDeg: z.number(), over: z.boolean() }).optional(),
  /** Every clause that shaped this line. */
  sourceRefs: z.array(z.string()),
  summary: z.string(),
})

const formworkFaceOutput = z.object({
  role: z.string(),
  formed: z.boolean(),
  reason: z.string(),
  explanation: z.string(),
  /** What you buy and cut — every void and buried corner is real. */
  physicalAreaSqM: z.number(),
  /** What the contract pays for, under the active measurement standard. */
  measuredAreaSqM: z.number(),
  /** How that area is billed. Absent on a face nothing was built on. */
  measurement: faceMeasurementOutput.optional(),
  deductions: z.array(deductionOutput),
  neighbourId: z.string().optional(),
  starterPenetrations: z.boolean().optional(),
  upliftLoaded: z.boolean().optional(),
})

/**
 * One corner unit as this element sees it. `owns` is the field that keeps a BOM
 * honest: both walls at an L report the same unit, and summing without it double
 * counts every junction in the building.
 *
 * `product` names the catalog part that turns it. Its absence is information: the
 * system sweeps no unit for that angle, so the corner is a bespoke timber one at a
 * carpenter's rate rather than a line off a hire list.
 */
const formworkCornerOutput = z.object({
  junctionKind: z.string(),
  side: z.enum(['inside', 'outside']),
  angleDeg: z.number(),
  /** Which of this element's faces the unit lands on. */
  face: z.enum(['a', 'b']),
  /** Where along the element it lands, m from the start. */
  alongM: z.number(),
  end: z.enum(['start', 'end']).optional(),
  /** The face run the unit consumes — an outside leg wraps the core, so it is longer. */
  legLengthM: z.number(),
  /** The catalog unit that turns this corner. Absent where no product sweeps the angle. */
  product: z.string().optional(),
  productItemNo: z.string().optional(),
  /** False where the legs are cast in sequence: the later one butts hardened concrete. */
  formed: z.boolean(),
  /** True on the element that bills it — exactly one of the two legs. */
  owns: z.boolean(),
  neighbourId: z.string().optional(),
})

const formworkOpeningOutput = z.object({
  openingId: z.string(),
  kind: z.string(),
  areaSqM: z.number(),
  measuredDeductionPerFace: z.number(),
  reason: z.string(),
  explanation: z.string(),
  revealSides: z.number(),
  revealAreaSqM: z.number(),
  revealsMeasured: z.boolean(),
  extraOverBand: z.string().optional(),
})

export const describeNodeOutput = {
  id: z.string(),
  type: z.string(),
  parentId: z.string().nullable(),
  ancestryIds: z.array(z.string()),
  childrenIds: z.array(z.string()),
  properties: z.record(z.string(), z.unknown()),
  description: z.string(),
  /** Walls, columns and slabs with formwork: which faces need shuttering, and why. */
  formworkCoverage: z
    .object({
      faces: z.array(formworkFaceOutput),
      corners: z.array(formworkCornerOutput),
      openings: z.array(formworkOpeningOutput),
      physicalAreaSqM: z.number(),
      measuredAreaSqM: z.number(),
      measurementStandard: z.string(),
      measurementStandardRef: z.string(),
    })
    .optional(),
}

/**
 * Per-face coverage for a castable element, so the AI can explain and correct a
 * layout rather than only write to it. Classified against the whole level because
 * cast order is relative — an element judged alone always looks freestanding.
 *
 * The face set is per kind: a wall's two sides and two ends, a column's four
 * faces or one wrapped shaft, a slab's soffit and rim.
 *
 * Both areas are returned, always. `physical` is what you buy and cut and
 * `measured` is what the contract pays for; they only agree on an element with no
 * openings and no junctions, and conflating them is the complaint estimators
 * make about existing tools.
 */
function formworkCoverage(
  host: Extract<AnyNode, { type: 'wall' | 'column' | 'slab' }>,
  bridge: SceneOperations,
  standardId: MeasurementStandardId,
) {
  if (!host.formworkType || host.formworkType === 'none') return undefined
  const levelId = bridge.resolveLevelId(host.id as AnyNodeId)
  const siblings = levelId ? nodesOnLevel(bridge, levelId) : [host as AnyNode]
  const standard = measurementStandard(standardId)
  const coverage = coverageForElement(host.id as AnyNodeId, siblings, { standard })
  if (!coverage) return undefined
  const system = seededFormworkSystem(DEFAULT_FORMWORK_SYSTEM_ID)

  return {
    faces: coverage.faces.map((face) => ({
      role: face.role,
      formed: face.formed,
      reason: face.reason,
      explanation: FACE_REASON_LABELS[face.reason],
      physicalAreaSqM: face.physicalArea,
      measuredAreaSqM: face.measuredArea,
      measurement: face.measurement
        ? { ...face.measurement, summary: faceMeasurementLabel(face.measurement) }
        : undefined,
      deductions: face.deductions.map((deduction) => ({
        reason: deduction.reason,
        explanation: DEDUCTION_REASON_LABELS[deduction.reason],
        sourceId: deduction.sourceId as string,
        areaSqM: deduction.areaSqM,
        physicalSqM: deduction.physicalSqM,
        measuredSqM: deduction.measuredSqM,
      })),
      neighbourId: face.neighbourId as string | undefined,
      starterPenetrations: face.starterPenetrations,
      upliftLoaded: face.upliftLoaded,
    })),
    corners: coverage.corners.map((corner) => {
      const other = corner.corner.legs.find((leg) => leg.elementId !== corner.leg.elementId)
      // Naming the product turns "a corner unit lands here" into something
      // orderable, and an angle no unit in the system sweeps is worth saying out
      // loud — it is a bespoke timber corner at a carpenter's rate, not a
      // catalog line.
      const fit = system ? fitCorner(system, corner.corner) : undefined
      const legIndex = corner.corner.legs.indexOf(corner.leg)
      return {
        junctionKind: corner.junctionKind,
        side: corner.corner.side,
        angleDeg: corner.corner.angleDeg,
        face: corner.leg.face,
        alongM: corner.leg.alongM,
        end: corner.leg.end,
        legLengthM:
          fit?.legLengthsM[legIndex === 1 ? 1 : 0] ??
          cornerLegLength(corner.corner, corner.leg, DEFAULT_INSIDE_CORNER_LEG_M),
        product: fit?.corner.label,
        productItemNo: fit?.corner.itemNo,
        formed: corner.formed,
        owns: corner.owns,
        neighbourId: other?.elementId as string | undefined,
      }
    }),
    openings: coverage.openings.map((opening) => ({
      openingId: opening.openingId as string,
      kind: opening.kind,
      areaSqM: opening.areaSqM,
      measuredDeductionPerFace: opening.measuredDeductionPerFace,
      reason: opening.reason,
      explanation: DEDUCTION_REASON_LABELS[opening.reason],
      revealSides: opening.revealSides,
      revealAreaSqM: opening.revealAreaSqM,
      revealsMeasured: opening.revealsMeasured,
      extraOverBand: opening.extraOverBand,
    })),
    physicalAreaSqM: coverage.physicalArea,
    measuredAreaSqM: coverage.measuredArea,
    measurementStandard: standard.label,
    measurementStandardRef: standard.sourceRef,
  }
}

/**
 * Build a short, human-readable one-liner describing the node.
 * Covers the common shapes; falls back to a generic sentence otherwise.
 */
function describe(node: AnyNode, bridge: SceneOperations): string {
  switch (node.type) {
    case 'wall': {
      const [x1, z1] = node.start
      const [x2, z2] = node.end
      const t = node.thickness ?? 0.1
      const h = resolveReportedWallHeight(bridge, node)
      return `Wall from (${x1},${z1}) to (${x2},${z2}), thickness ${t.toFixed(2)}m, height ${h.toFixed(2)}m`
    }
    case 'level':
      return `Level ${node.level}`
    case 'building': {
      const [x, y, z] = node.position
      return `Building at (${x},${y},${z})`
    }
    case 'site':
      return `Site with ${node.polygon?.points.length ?? 0}-sided property line`
    case 'zone':
      return `Zone "${node.name}" with ${node.polygon.length} vertices`
    case 'slab':
      return `Slab with ${node.polygon.length} vertices`
    case 'ceiling':
      return `Ceiling with ${node.polygon.length} vertices, height ${resolveCeilingHeight(node, bridge.getNodes()).toFixed(2)}m`
    case 'door':
      return `Door (${node.width.toFixed(2)}m x ${node.height.toFixed(2)}m)`
    case 'window':
      return `Window (${node.width.toFixed(2)}m x ${node.height.toFixed(2)}m)`
    case 'item': {
      const [x, y, z] = node.position
      return `Item "${node.asset.name}" at (${x},${y},${z})`
    }
    default:
      return `${node.type} node`
  }
}

export function registerDescribeNode(server: McpServer, bridge: SceneOperations): void {
  server.registerTool(
    'describe_node',
    {
      title: 'Describe node',
      description:
        "Return a structured summary of a node including its ancestry, children IDs, key properties, and a short human description. For walls, columns, slabs and beams with a formworkType, also returns formworkCoverage: which of that kind's faces need shuttering (a wall's two sides and two ends, a column's four faces or one wrapped shaft, a slab's soffit and rim, a beam's two tied side shutters over a propped soffit), the reason for each, how each opening was treated under the active measurement standard, the inside/outside corner units the element's faces turn onto (with `owns` saying which of the two walls at a junction bills each one, so summing across a level does not double count), and both the physical area (what you buy and cut) and the measured area (what the contract pays for).",
      inputSchema: describeNodeInput,
      outputSchema: describeNodeOutput,
    },
    async ({ id, measurementStandard: standardId }) => {
      const node = bridge.getNode(id as AnyNodeId)
      if (!node) {
        throwMcpError(ErrorCode.InvalidParams, `Node not found: ${id}`)
      }

      // Ancestry minus self.
      const ancestry = bridge.getAncestry(id as AnyNodeId)
      const ancestryIds = ancestry.slice(1).map((n) => n.id as string)

      const children = bridge.getChildren(id as AnyNodeId)
      const childrenIds = children.map((n) => n.id as string)

      const n = node as AnyNode
      const properties =
        n.type === 'wall'
          ? {
              ...n,
              resolvedHeight: resolveReportedWallHeight(bridge, n),
              heightIsExplicit: n.height !== undefined,
            }
          : n
      const payload = {
        id: n.id as string,
        type: n.type as string,
        parentId: (n.parentId ?? null) as string | null,
        ancestryIds,
        childrenIds,
        properties: properties as unknown as Record<string, unknown>,
        description: describe(n, bridge),
        formworkCoverage:
          n.type === 'wall' || n.type === 'column' || n.type === 'slab'
            ? formworkCoverage(n, bridge, standardId ?? DEFAULT_MEASUREMENT_STANDARD_ID)
            : undefined,
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      }
    },
  )
}
