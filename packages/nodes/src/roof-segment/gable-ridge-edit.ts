import {
  type GableRidge,
  getGableRidge,
  getGableWallInsets,
  type RoofSegmentNode,
} from '@pascal-app/core'

/**
 * Which values of a gable stay put while another one is edited. `pitches`:
 * both slope angles; `ridge`: the ridge's place and height. With neither
 * locked the ridge still stays put for an angle or an attic wall edit.
 */
export type GableRidgeLocks = { pitches: boolean; ridge: boolean }

export type GableSide = 'front' | 'back'

export type GableRidgeEdit =
  /** Plan distance from that side's house wall to the ridge. */
  | { kind: 'position'; side: GableSide; value: number }
  /**
   * Ridge height above the segment base: of that side's slope only (the other
   * keeps its own, a step wall closes the gap), or without a side the whole
   * ridge, step and all.
   */
  | { kind: 'height'; side?: GableSide; value: number }
  | { kind: 'pitch'; side: GableSide; value: number }
  /** Attic wall height on that side, at the house wall. */
  | { kind: 'wall'; side: GableSide; value: number }

const MIN_PITCH = 1
const MAX_PITCH = 85
const MIN_RUN = 0.05
/** A ridge step smaller than this is one ridge. */
const MIN_STEP = 0.005

const tan = (deg: number) => Math.tan((deg * Math.PI) / 180)
const pitchFrom = (rise: number, run: number) =>
  Math.min(MAX_PITCH, Math.max(MIN_PITCH, (Math.atan2(rise, run) * 180) / Math.PI))

const stepOf = (step: number) => (Math.abs(step) < MIN_STEP ? 0 : step)

export function readGableRidgeLocks(metadata: unknown): GableRidgeLocks {
  const record =
    typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).gableLocks
      : undefined
  const locks =
    typeof record === 'object' && record !== null ? (record as Record<string, unknown>) : {}
  return { pitches: locks.pitches === true, ridge: locks.ridge === true }
}

type GableRidgeNode = Pick<
  RoofSegmentNode,
  | 'roofType'
  | 'pitch'
  | 'depth'
  | 'width'
  | 'wallHeight'
  | 'wallThickness'
  | 'backPitch'
  | 'ridgeOffset'
  | 'ridgeStep'
  | 'footprint'
  | 'coverFootprint'
>

/**
 * A gable's ridge group read against the house walls rather than the roof's
 * own rectangle, which reaches past them where a canopy was pulled out: how
 * far the ridge stands from each wall and how tall the attic wall is there.
 */
export type GableRidgeAtWalls = GableRidge & {
  toFrontWall: number
  toBackWall: number
  frontAtticWall: number
  backAtticWall: number
}

export function readGableRidgeAtWalls(node: GableRidgeNode): GableRidgeAtWalls | null {
  const ridge = getGableRidge(node)
  if (!ridge) return null
  const insets = getGableWallInsets(node)
  return {
    ...ridge,
    toFrontWall: ridge.offset - insets.front,
    toBackWall: node.depth - ridge.offset - insets.back,
    frontAtticWall: ridge.frontWallHeight + insets.front * tan(ridge.frontPitch),
    backAtticWall: ridge.backWallHeight + insets.back * tan(ridge.backPitch),
  }
}

/**
 * The node fields one edit of a gable's ridge group writes, or null when the
 * locks forbid it. Distances and attic walls are read at the house walls (see
 * readGableRidgeAtWalls). The ridge's place and the back pitch are always
 * written, so the roof stops deriving them and keeps them through later edits.
 */
export function applyGableRidgeEdit(
  node: GableRidgeNode,
  edit: GableRidgeEdit,
  locks: GableRidgeLocks,
): Partial<RoofSegmentNode> | null {
  const ridge = readGableRidgeAtWalls(node)
  if (!ridge) return null
  const depth = node.depth
  const frontRun = ridge.offset
  const insets = getGableWallInsets(node)
  const pinned = { ridgeOffset: ridge.offset, backPitch: ridge.backPitch }

  switch (edit.kind) {
    case 'position': {
      if (locks.ridge) return null
      const offset = Math.min(
        depth - MIN_RUN,
        Math.max(
          MIN_RUN,
          edit.side === 'front' ? edit.value + insets.front : depth - edit.value - insets.back,
        ),
      )
      // the ridge keeps its height and the slopes their angles: the attic walls move
      return {
        ...pinned,
        ridgeOffset: offset,
        wallHeight: ridge.height - offset * tan(ridge.frontPitch),
      }
    }
    case 'height': {
      if (locks.ridge) return null
      if (edit.side === 'back') {
        // the +z ridge stays; only the step to the −z one changes
        return { ...pinned, ridgeStep: stepOf(edit.value - ridge.height) }
      }
      const wallHeight = edit.value - frontRun * tan(ridge.frontPitch)
      if (edit.side === 'front') {
        // the −z ridge keeps its height
        return { ...pinned, wallHeight, ridgeStep: stepOf(ridge.backHeight - edit.value) }
      }
      return { ...pinned, wallHeight }
    }
    case 'pitch': {
      if (locks.pitches) return null
      const pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, edit.value))
      if (edit.side === 'back') return { ...pinned, backPitch: pitch }
      return { ...pinned, pitch, wallHeight: ridge.height - frontRun * tan(pitch) }
    }
    case 'wall': {
      if (locks.pitches && locks.ridge) return null
      if (locks.pitches) {
        // the angles hold, so the whole roof rides up or down with the wall
        const height =
          edit.side === 'front'
            ? edit.value + ridge.toFrontWall * tan(ridge.frontPitch)
            : edit.value + ridge.toBackWall * tan(ridge.backPitch) - ridge.step
        return { ...pinned, wallHeight: height - frontRun * tan(ridge.frontPitch) }
      }
      // the ridge holds, so that side's slope turns
      if (edit.side === 'back') {
        return { ...pinned, backPitch: pitchFrom(ridge.backHeight - edit.value, ridge.toBackWall) }
      }
      const pitch = pitchFrom(ridge.height - edit.value, ridge.toFrontWall)
      return { ...pinned, pitch, wallHeight: ridge.height - frontRun * tan(pitch) }
    }
  }
}
