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
  type PascalI18n,
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
export function groundSeatAction(rule: GroundSeatRule, askedIn: number, i18n: PascalI18n): string {
  const values = { asked: `${Math.round(askedIn * 100) / 100} in` }
  switch (rule) {
    case 'basement':
      return i18n._({
        id: 'editor.lib.buildingFoundation.seatBasementWallTop',
        message: 'Seat the basement wall’s top {asked} over the high side of the ground',
        values,
      })
    case 'raised':
      return i18n._({
        id: 'editor.lib.buildingFoundation.seatRaisedFloorTop',
        message: 'Seat the raised floor’s top {asked} over the high side of the ground',
        values,
      })
    case 'piles':
      return i18n._({
        id: 'editor.lib.buildingFoundation.seatFloorTop',
        message: 'Seat the floor’s top {asked} over the high side of the ground',
        values,
      })
    case 'slab':
      return i18n._({
        id: 'editor.lib.buildingFoundation.seatSlabTop',
        message: 'Seat the slab’s top {asked} over the high side of the ground',
        values,
      })
    default:
      return i18n._({
        id: 'editor.lib.buildingFoundation.seatGroundFloor',
        message: 'Seat the ground floor {asked} over grade',
        values,
      })
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
  i18n: PascalI18n,
): FoundationAdvice[] {
  if (report.basement) return basementAdvice(report, report.basement, length, i18n)
  const { foundation } = report
  const advice: FoundationAdvice[] = []
  const floorOver = report.floorTopY - report.highestGradeY
  const asked = foundation.ffAboveGradeIn * IN
  if (Math.abs(floorOver - asked) > 0.5 * IN) {
    const values = { distance: length(Math.abs(floorOver)), asked: length(asked) }
    advice.push({
      key: 'seat',
      tone: 'warning',
      text:
        floorOver < 0
          ? i18n._({
              id: 'editor.lib.buildingFoundation.floorUnderTheGround',
              message:
                'The floor stands {distance} under the high side of the ground; the foundation is set for {asked} over it.',
              values,
            })
          : i18n._({
              id: 'editor.lib.buildingFoundation.floorOverTheGround',
              message:
                'The floor stands {distance} over the high side of the ground; the foundation is set for {asked} over it.',
              values,
            }),
      fix: {
        label: i18n._({
          id: 'editor.lib.buildingFoundation.seatItAt',
          message: 'Seat it at {asked}',
          values,
        }),
        patch: {},
      },
    })
  }
  const least = foundation.topAboveGradeIn * IN
  // The ground is cut down round the stem wall's top (a slab's, filled and cut, below).
  const cutOver = report.stemTopY === null ? 0 : report.highestGradeY - (report.stemTopY - least)
  if (cutOver > 0.5 * IN)
    advice.push({
      key: 'top',
      tone: 'note',
      text: i18n._({
        id: 'editor.lib.buildingFoundation.groundCutRoundTheStem',
        message:
          'The ground is cut {cut} on the high side to hold the stem wall’s top {least} over it (IRC R317.1). Raising the floor cuts less.',
        values: { cut: length(cutOver), least: length(least) },
      }),
      fix: {
        label: i18n._({
          id: 'editor.lib.buildingFoundation.raiseTheFloor',
          message: 'Raise the floor',
        }),
        patch: { ffAboveGradeIn: foundation.ffMinIn },
      },
    })
  const footingWidthIn = buildingFoundationDefaults(foundation.storeys).footingWidthIn
  const piles = foundation.support === 'piles'
  const raised = foundation.type === 'raised'
  const depth = raised ? foundation.footingDepthIn : foundation.edgeDepthIn
  if (!piles && depth < 12) {
    const values = { depth: length(depth * IN), least: length(12 * IN) }
    advice.push({
      key: 'depth',
      tone: 'warning',
      text: raised
        ? i18n._({
            id: 'editor.lib.buildingFoundation.footingTooShallow',
            message:
              'The footing’s bottom is {depth} under grade: keep it {least} at least, or the frost line (IRC R403.1.4).',
            values,
          })
        : i18n._({
            id: 'editor.lib.buildingFoundation.slabEdgeTooShallow',
            message:
              'The slab edge’s bottom is {depth} under grade: keep it {least} at least, or the frost line (IRC R403.1.4).',
            values,
          }),
      fix: {
        label: i18n._({
          id: 'editor.lib.buildingFoundation.setItDeep',
          message: 'Set it {depth} deep',
          values: { depth: length(12 * IN) },
        }),
        patch: raised ? { footingDepthIn: 12 } : { edgeDepthIn: 12 },
      },
    })
  }
  if (raised && !piles && foundation.footingWidthIn < footingWidthIn)
    advice.push({
      key: 'footing-width',
      tone: 'warning',
      text: i18n._({
        id: 'editor.lib.buildingFoundation.footingTooNarrow',
        message:
          'The footing is {width} wide: {storeys, plural, one {one storey asks} other {# storeys ask}} {asked} on 1500 psf soil (IRC Table R403.1(1)).',
        values: {
          width: length(foundation.footingWidthIn * IN),
          storeys: foundation.storeys,
          asked: length(footingWidthIn * IN),
        },
      }),
      fix: {
        label: i18n._({
          id: 'editor.lib.buildingFoundation.widenItTo',
          message: 'Widen it to {width}',
          values: { width: length(footingWidthIn * IN) },
        }),
        patch: { footingWidthIn },
      },
    })
  if (report.stemTopY !== null && report.crawlY !== null) {
    // The crawl space is dug out to its clearance under the joists, where the ground stands higher.
    const dug = report.highestGradeY - report.crawlY
    const clearance = foundation.crawlClearanceIn * IN
    if (dug > 0.5 * IN)
      advice.push({
        key: 'crawl',
        tone: 'note',
        text: i18n._({
          id: 'editor.lib.buildingFoundation.crawlSpaceDugOut',
          message:
            'Crawl space: dug out up to {dug} for {clearance} under the joists (IRC R317.1).',
          values: { dug: length(dug), clearance: length(clearance) },
        }),
      })
  }
  if (report.cripples > 0)
    advice.push({
      key: 'cripple',
      tone: 'note',
      text: i18n._({
        id: 'editor.lib.buildingFoundation.crippleWalls',
        message:
          'Past {stem} of stem out of the ground the stem drops to {least} over grade: {cripples, plural, one {# cripple wall} other {# cripple walls}} over it, up to {tallest} tall.',
        values: {
          stem: length(foundation.maxStemIn * IN),
          least: length(least),
          cripples: report.cripples,
          tallest: length(report.tallestCripple),
        },
      }),
    })
  if (report.steps > 0) {
    const step = foundation.stepHeightIn * IN
    const upTo = report.tallestStep > step + 0.25 * IN
    const values = {
      fall: length(report.highestGradeY - report.lowestGradeY),
      steps: report.steps,
      riser: length(upTo ? report.tallestStep : step),
    }
    advice.push({
      key: 'steps',
      tone: 'note',
      text:
        report.stemTopY === null
          ? upTo
            ? i18n._({
                id: 'editor.lib.buildingFoundation.slabEdgeStepsUpTo',
                message:
                  'The ground falls {fall} across the house: the slab edge steps {steps, plural, one {# time} other {# times}} along its steepest side, up to {riser} a step.',
                values,
              })
            : i18n._({
                id: 'editor.lib.buildingFoundation.slabEdgeSteps',
                message:
                  'The ground falls {fall} across the house: the slab edge steps {steps, plural, one {# time} other {# times}} along its steepest side, {riser} a step.',
                values,
              })
          : upTo
            ? i18n._({
                id: 'editor.lib.buildingFoundation.footingStepsUpTo',
                message:
                  'The ground falls {fall} across the house: the footing steps {steps, plural, one {# time} other {# times}} along its steepest side, up to {riser} a step.',
                values,
              })
            : i18n._({
                id: 'editor.lib.buildingFoundation.footingSteps',
                message:
                  'The ground falls {fall} across the house: the footing steps {steps, plural, one {# time} other {# times}} along its steepest side, {riser} a step.',
                values,
              }),
    })
  }
  if (report.stemTopY === null) {
    // The ground round a slab is graded to its edge, `least` under its top, on every side.
    const pad = report.floorTopY - least
    const fill = pad - report.lowestGradeY
    const cut = report.highestGradeY - pad
    const sloped = report.highestGradeY - report.lowestGradeY > 0.5 * IN
    const grading = slabGrading(fill > 0.5 * IN, cut > 0.5 * IN, sloped, i18n, {
      least: length(least),
      fill: length(fill),
      cut: length(cut),
    })
    if (grading)
      advice.push({
        key: 'grading',
        tone: 'note',
        text: grading,
      })
    if (fill > 24 * IN)
      advice.push({
        key: 'exposed',
        tone: 'warning',
        text: sloped
          ? i18n._({
              id: 'editor.lib.buildingFoundation.deepFillOnASlope',
              message:
                'That is {fill} of fill on the low side. A raised floor on a stem wall suits this slope.',
              values: { fill: length(fill) },
            })
          : i18n._({
              id: 'editor.lib.buildingFoundation.deepFill',
              message:
                'That is {fill} of fill. A raised floor on a stem wall suits a floor this high.',
              values: { fill: length(fill) },
            }),
        fix: {
          label: i18n._({
            id: 'editor.lib.buildingFoundation.raiseItOnAStemWall',
            message: 'Raise it on a stem wall',
          }),
          patch: { type: 'raised' },
        },
      })
  }
  return advice
}

/**
 * How the ground round a slab is graded to hold it `least` under its top: filled on the low side,
 * cut on the high side, or both (on flat ground, by how much only). `null` when it is neither.
 */
function slabGrading(
  filled: boolean,
  cut: boolean,
  sloped: boolean,
  i18n: PascalI18n,
  values: { least: string; fill: string; cut: string },
): string | null {
  if (filled && cut)
    return sloped
      ? i18n._({
          id: 'editor.lib.buildingFoundation.gradingFilledAndCutOnASlope',
          message:
            'The ground is held {least} under the slab’s top on every side: filled up to {fill} on the low side, cut {cut} on the high side.',
          values,
        })
      : i18n._({
          id: 'editor.lib.buildingFoundation.gradingFilledAndCut',
          message:
            'The ground is held {least} under the slab’s top on every side: filled {fill}, cut {cut}.',
          values,
        })
  if (filled)
    return sloped
      ? i18n._({
          id: 'editor.lib.buildingFoundation.gradingFilledOnASlope',
          message:
            'The ground is held {least} under the slab’s top on every side: filled up to {fill} on the low side.',
          values,
        })
      : i18n._({
          id: 'editor.lib.buildingFoundation.gradingFilled',
          message: 'The ground is held {least} under the slab’s top on every side: filled {fill}.',
          values,
        })
  if (cut)
    return sloped
      ? i18n._({
          id: 'editor.lib.buildingFoundation.gradingCutOnASlope',
          message:
            'The ground is held {least} under the slab’s top on every side: cut {cut} on the high side.',
          values,
        })
      : i18n._({
          id: 'editor.lib.buildingFoundation.gradingCut',
          message: 'The ground is held {least} under the slab’s top on every side: cut {cut}.',
          values,
        })
  return null
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
  i18n: PascalI18n,
): FoundationAdvice[] {
  const { foundation } = report
  const advice: FoundationAdvice[] = []
  const over = basement.wallTopY - report.highestGradeY
  const asked = foundation.basementTopAboveGradeIn * IN
  if (Math.abs(over - asked) > 0.5 * IN) {
    const values = { distance: length(Math.abs(over)), asked: length(asked) }
    advice.push({
      key: 'seat',
      tone: 'warning',
      text:
        over < 0
          ? i18n._({
              id: 'editor.lib.buildingFoundation.basementTopUnderTheGround',
              message:
                'The basement wall’s top stands {distance} under the high side of the ground; the foundation is set for {asked} over it.',
              values,
            })
          : i18n._({
              id: 'editor.lib.buildingFoundation.basementTopOverTheGround',
              message:
                'The basement wall’s top stands {distance} over the high side of the ground; the foundation is set for {asked} over it.',
              values,
            }),
      fix: {
        label: i18n._({
          id: 'editor.lib.buildingFoundation.seatItAt',
          message: 'Seat it at {asked}',
          values,
        }),
        patch: {},
      },
    })
  }
  if (foundation.basementTopAboveGradeIn < 8)
    advice.push({
      key: 'basement-top',
      tone: 'warning',
      text: i18n._({
        id: 'editor.lib.buildingFoundation.sillTooNearTheGround',
        message:
          'The sill and the floor framing sit {height} over the ground: keep them {least} off it at least (IRC R317.1).',
        values: { height: length(asked), least: length(8 * IN) },
      }),
      fix: {
        label: i18n._({
          id: 'editor.lib.buildingFoundation.setIt',
          message: 'Set it {height}',
          values: { height: length(8 * IN) },
        }),
        patch: { basementTopAboveGradeIn: 8 },
      },
    })
  advice.push({
    key: 'excavation',
    tone: 'note',
    text: i18n._({
      id: 'editor.lib.buildingFoundation.basementExcavation',
      message:
        'Cut {depth} into the ground on the high side, dug out inside the walls’ outside faces; the ground round the house is left as it lies.',
      values: { depth: length(report.highestGradeY - basement.excavationY) },
    }),
  })
  const fall = report.highestGradeY - report.lowestGradeY
  const exposed = basement.wallTopY - report.lowestGradeY
  if (fall > 0.5 * IN && exposed > 0.5 * IN)
    advice.push({
      key: 'daylight',
      tone: 'note',
      text: i18n._({
        id: 'editor.lib.buildingFoundation.daylightWalls',
        message:
          'The ground falls {fall} across the house: the downhill walls stand up to {exposed} out of it.',
        values: { fall: length(fall), exposed: length(exposed) },
      }),
    })
  return advice
}
