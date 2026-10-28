import {
  type AnyNode,
  type AnyNodeId,
  type BasementReport,
  type BuildingFoundationRecord,
  type BuildingNode,
  buildingFoundationDefaults,
  type DesignedFoundationReport,
  designedFoundationReport,
  type GroundSeatRule,
  getLevelElevations,
  groundLevelOf,
  levelGradeStanding,
  type SlabNode,
  upperFloorHeightControl,
  useScene,
} from '@pascal-app/core'
import { buildBuildingFoundationChanges } from '@pascal-app/core/building'

const IN = 0.0254

/**
 * The Foundation panel's edit: the record patched and, with it on, the building seated over the
 * high side of the ground (`buildBuildingFoundationChanges`), in one undo step. `false` for an id
 * that is no building.
 */
export function applyBuildingFoundation(buildingId: string, patch: BuildingFoundationRecord) {
  const scene = useScene.getState()
  const built = buildBuildingFoundationChanges({ nodes: scene.nodes, buildingId, patch })
  if (!built) return false
  scene.applyNodeChanges({ update: built.update })
  return true
}

/** The building a footprint's plate stands in. */
export function buildingOfPlate(
  nodes: Record<string, AnyNode>,
  plate: Pick<SlabNode, 'parentId'>,
): BuildingNode | null {
  const buildingId = plate.parentId
    ? getLevelElevations(nodes as Record<AnyNodeId, AnyNode>).get(plate.parentId as AnyNodeId)
        ?.buildingId
    : undefined
  const building = buildingId ? nodes[buildingId] : undefined
  return building?.type === 'building' ? building : null
}

/**
 * Whether a ground floor's height is the designed foundation's: it is drawn under this plate's
 * level, and its finish floor over grade (`ffAboveGradeIn`) seats the floor, so the plate's own
 * "raised on a foundation" height is no control of it. With the record on but nothing designed
 * (open outside walls, a basement under the house) the plate keeps its own controls.
 */
export function floorHeldByDesignedFoundation(
  nodes: Record<string, AnyNode>,
  plate: SlabNode,
): boolean {
  if (upperFloorHeightControl(nodes, plate) !== null) return false
  const building = buildingOfPlate(nodes, plate)
  if (!building) return false
  const report = designedFoundationReport(nodes as Record<AnyNodeId, AnyNode>, building.id)
  // A basement's floor keeps its own controls: the record seats the basement walls' top.
  return report?.levelId === plate.parentId && !report.basement
}

/**
 * Whether the building stands on a basement with walls: a level under its ground floor, all of it
 * below grade. Its walls are the foundation walls, standing on their footing.
 */
export function standsOnBasement(nodes: Record<string, AnyNode>, buildingId: string): boolean {
  const scene = nodes as Record<AnyNodeId, AnyNode>
  const ground = groundLevelOf(scene, buildingId)
  if (!ground) return false
  const elevations = getLevelElevations(scene)
  return Object.values(scene).some(
    (node) =>
      node.type === 'level' &&
      elevations.get(node.id)?.buildingId === buildingId &&
      node.level < ground.level.level &&
      node.children.some((id) => scene[id as AnyNodeId]?.type === 'wall') &&
      levelGradeStanding(scene, node.id) === 'below-grade',
  )
}

/**
 * What the level panel's ground line does when its click seats the building, by the rule that
 * seats it (`groundSeat`): the construction's floor height over grade, or the designed
 * foundation's own over the high side of the ground. `askedIn` in inches.
 */
export function groundSeatAction(rule: GroundSeatRule, askedIn: number): string {
  const asked = `${Math.round(askedIn * 100) / 100} in`
  switch (rule) {
    case 'basement':
      return `Seat the basement wall’s top ${asked} over the high side of the ground`
    case 'raised':
      return `Seat the raised floor’s top ${asked} over the high side of the ground`
    case 'piles':
      return `Seat the floor’s top ${asked} over the high side of the ground`
    case 'slab':
      return `Seat the slab’s top ${asked} over the high side of the ground`
    default:
      return `Seat the ground floor ${asked} over grade`
  }
}

/** One line under the foundation's settings: a rule it misses (with the fix) or a note on how it stands. */
export type FoundationAdvice = {
  key: string
  tone: 'warning' | 'note'
  text: string
  fix?: { label: string; patch: BuildingFoundationRecord }
}

/**
 * What the panel says about the designed foundation as it stands: the floor off the height the
 * record seats it at (the ground or the house moved since), the ground cut round a stem wall to
 * hold it 8 in out, sizes under the code's least, the crawl space dug out under the joists, the
 * steps down a slope and the cripple walls over them, how much the ground round a slab is filled
 * and cut to hold it 8 in under the slab's top.
 */
export function foundationAdvice(
  report: DesignedFoundationReport,
  length: (meters: number) => string,
): FoundationAdvice[] {
  if (report.basement) return basementAdvice(report, report.basement, length)
  const { foundation } = report
  const advice: FoundationAdvice[] = []
  const floorOver = report.floorTopY - report.highestGradeY
  const asked = foundation.ffAboveGradeIn * IN
  if (Math.abs(floorOver - asked) > 0.5 * IN)
    advice.push({
      key: 'seat',
      tone: 'warning',
      text: `The floor stands ${length(Math.abs(floorOver))} ${floorOver < 0 ? 'under' : 'over'} the high side of the ground; the foundation is set for ${length(asked)} over it.`,
      fix: { label: `Seat it at ${length(asked)}`, patch: {} },
    })
  const least = foundation.topAboveGradeIn * IN
  // The ground is cut down round the stem wall's top (a slab's, filled and cut, below).
  const cutOver = report.stemTopY === null ? 0 : report.highestGradeY - (report.stemTopY - least)
  if (cutOver > 0.5 * IN)
    advice.push({
      key: 'top',
      tone: 'note',
      text: `The ground is cut ${length(cutOver)} on the high side to hold the stem wall’s top ${length(least)} over it (IRC R317.1). Raising the floor cuts less.`,
      fix: { label: 'Raise the floor', patch: { ffAboveGradeIn: foundation.ffMinIn } },
    })
  const footingWidthIn = buildingFoundationDefaults(foundation.storeys).footingWidthIn
  const piles = foundation.support === 'piles'
  const raised = foundation.type === 'raised'
  const depth = raised ? foundation.footingDepthIn : foundation.edgeDepthIn
  if (!piles && depth < 12)
    advice.push({
      key: 'depth',
      tone: 'warning',
      text: `The ${raised ? 'footing' : 'slab edge'}’s bottom is ${length(depth * IN)} under grade: keep it ${length(12 * IN)} at least, or the frost line (IRC R403.1.4).`,
      fix: {
        label: `Set it ${length(12 * IN)} deep`,
        patch: raised ? { footingDepthIn: 12 } : { edgeDepthIn: 12 },
      },
    })
  if (raised && !piles && foundation.footingWidthIn < footingWidthIn)
    advice.push({
      key: 'footing-width',
      tone: 'warning',
      text: `The footing is ${length(foundation.footingWidthIn * IN)} wide: ${foundation.storeys === 1 ? 'one storey asks' : `${foundation.storeys} storeys ask`} ${length(footingWidthIn * IN)} on 1500 psf soil (IRC Table R403.1(1)).`,
      fix: { label: `Widen it to ${length(footingWidthIn * IN)}`, patch: { footingWidthIn } },
    })
  if (report.stemTopY !== null && report.crawlY !== null) {
    // The crawl space is dug out to its clearance under the joists, where the ground stands higher.
    const dug = report.highestGradeY - report.crawlY
    const clearance = foundation.crawlClearanceIn * IN
    if (dug > 0.5 * IN)
      advice.push({
        key: 'crawl',
        tone: 'note',
        text: `Crawl space: dug out up to ${length(dug)} for ${length(clearance)} under the joists (IRC R317.1).`,
      })
  }
  if (report.cripples > 0)
    advice.push({
      key: 'cripple',
      tone: 'note',
      text: `Past ${length(foundation.maxStemIn * IN)} of stem out of the ground the stem drops to ${length(least)} over grade: ${report.cripples} ${report.cripples === 1 ? 'cripple wall' : 'cripple walls'} over it, up to ${length(report.tallestCripple)} tall.`,
    })
  if (report.steps > 0) {
    const step = foundation.stepHeightIn * IN
    const riser =
      report.tallestStep > step + 0.25 * IN
        ? `up to ${length(report.tallestStep)} a step`
        : `${length(step)} a step`
    advice.push({
      key: 'steps',
      tone: 'note',
      text: `The ground falls ${length(report.highestGradeY - report.lowestGradeY)} across the house: the ${report.stemTopY === null ? 'slab edge' : 'footing'} steps ${report.steps} ${report.steps === 1 ? 'time' : 'times'} along its steepest side, ${riser}.`,
    })
  }
  if (report.stemTopY === null) {
    // The ground round a slab is graded to its edge, `least` under its top, on every side.
    const pad = report.floorTopY - least
    const fill = pad - report.lowestGradeY
    const cut = report.highestGradeY - pad
    const sloped = report.highestGradeY - report.lowestGradeY > 0.5 * IN
    const works = [
      fill > 0.5 * IN &&
        (sloped ? `filled up to ${length(fill)} on the low side` : `filled ${length(fill)}`),
      cut > 0.5 * IN && (sloped ? `cut ${length(cut)} on the high side` : `cut ${length(cut)}`),
    ].filter(Boolean)
    if (works.length > 0)
      advice.push({
        key: 'grading',
        tone: 'note',
        text: `The ground is held ${length(least)} under the slab’s top on every side: ${works.join(', ')}.`,
      })
    if (fill > 24 * IN)
      advice.push({
        key: 'exposed',
        tone: 'warning',
        text: `That is ${length(fill)} of fill${sloped ? ' on the low side' : ''}. A raised floor on a stem wall suits ${sloped ? 'this slope' : 'a floor this high'}.`,
        fix: { label: 'Raise it on a stem wall', patch: { type: 'raised' } },
      })
  }
  return advice
}

/**
 * What the panel says about a house over a basement: its walls' top off the height the record
 * seats it at (the house not moved since the basement went in, or the ground since), a top under
 * the 8 in that keeps the floor framing off the ground, how deep the basement is cut in, and how
 * far a downhill wall stands out of the ground (a daylight basement).
 */
function basementAdvice(
  report: DesignedFoundationReport,
  basement: BasementReport,
  length: (meters: number) => string,
): FoundationAdvice[] {
  const { foundation } = report
  const advice: FoundationAdvice[] = []
  const over = basement.wallTopY - report.highestGradeY
  const asked = foundation.basementTopAboveGradeIn * IN
  if (Math.abs(over - asked) > 0.5 * IN)
    advice.push({
      key: 'seat',
      tone: 'warning',
      text: `The basement wall’s top stands ${length(Math.abs(over))} ${over < 0 ? 'under' : 'over'} the high side of the ground; the foundation is set for ${length(asked)} over it.`,
      fix: { label: `Seat it at ${length(asked)}`, patch: {} },
    })
  if (foundation.basementTopAboveGradeIn < 8)
    advice.push({
      key: 'basement-top',
      tone: 'warning',
      text: `The sill and the floor framing sit ${length(asked)} over the ground: keep them ${length(8 * IN)} off it at least (IRC R317.1).`,
      fix: { label: `Set it ${length(8 * IN)}`, patch: { basementTopAboveGradeIn: 8 } },
    })
  advice.push({
    key: 'excavation',
    tone: 'note',
    text: `Cut ${length(report.highestGradeY - basement.excavationY)} into the ground on the high side, dug out inside the walls’ outside faces; the ground round the house is left as it lies.`,
  })
  const fall = report.highestGradeY - report.lowestGradeY
  const exposed = basement.wallTopY - report.lowestGradeY
  if (fall > 0.5 * IN && exposed > 0.5 * IN)
    advice.push({
      key: 'daylight',
      tone: 'note',
      text: `The ground falls ${length(fall)} across the house: the downhill walls stand up to ${length(exposed)} out of it.`,
    })
  return advice
}
