import type { WallNode } from '../../schema'

const AXIS_EPSILON = 1e-6

export type WallPlanPoint = [number, number]
export type WallMoveAxis = 'x' | 'z'
export type WallMoveEndpoint = 'start' | 'end'

export type WallMoveBridgePlan<TWall extends Pick<WallNode, 'id' | 'start' | 'end'>> = {
  wall: TWall
  originalPoint: WallPlanPoint
  movedEndpoint: WallMoveEndpoint
}

export type WallMoveLinkedWallTargetPlan<
  TWall extends Pick<WallNode, 'id' | 'start' | 'end'>,
> = {
  wall: TWall
  originalPoint: WallPlanPoint
  targetPoint: WallPlanPoint
}

export type WallMoveJunctionPlan<TWall extends Pick<WallNode, 'id' | 'start' | 'end'>> = {
  linkedWallsToMove: TWall[]
  linkedWallTargetPlans: Array<WallMoveLinkedWallTargetPlan<TWall>>
  bridgePlans: Array<WallMoveBridgePlan<TWall>>
  wallsToDelete: TWall[]
}

export function getPerpendicularWallMoveAxis(
  start: WallPlanPoint,
  end: WallPlanPoint,
): WallMoveAxis | null {
  const wallDeltaX = Math.abs(end[0] - start[0])
  const wallDeltaZ = Math.abs(end[1] - start[1])

  if (wallDeltaX < AXIS_EPSILON && wallDeltaZ < AXIS_EPSILON) return null

  return wallDeltaX >= wallDeltaZ ? 'z' : 'x'
}

export function constrainWallMoveDeltaToAxis(
  deltaX: number,
  deltaZ: number,
  axis: WallMoveAxis | null,
): WallPlanPoint {
  if (axis === 'x') return [deltaX, 0]
  if (axis === 'z') return [0, deltaZ]
  return [deltaX, deltaZ]
}

function pointsEqual(a: WallPlanPoint, b: WallPlanPoint) {
  return Math.abs(a[0] - b[0]) <= AXIS_EPSILON && Math.abs(a[1] - b[1]) <= AXIS_EPSILON
}

function wallTouchesPoint(wall: Pick<WallNode, 'start' | 'end'>, point: WallPlanPoint) {
  return pointsEqual(wall.start, point) || pointsEqual(wall.end, point)
}

function otherWallEndpoint(wall: Pick<WallNode, 'start' | 'end'>, point: WallPlanPoint) {
  return pointsEqual(wall.start, point) ? wall.end : wall.start
}

type MoveWallRelation = 'same-direction' | 'opposite-direction' | 'off-axis' | 'stationary'
type RelatedWallEntry<TWall extends Pick<WallNode, 'id' | 'start' | 'end'>> = {
  wall: TWall
  relation: MoveWallRelation
}

function wallLengthFromPoint(wall: Pick<WallNode, 'start' | 'end'>, point: WallPlanPoint) {
  const freeEndpoint = otherWallEndpoint(wall, point)
  return Math.hypot(freeEndpoint[0] - point[0], freeEndpoint[1] - point[1])
}

function getMoveWallRelation(
  wall: Pick<WallNode, 'start' | 'end'>,
  sharedPoint: WallPlanPoint,
  nextPoint: WallPlanPoint,
): MoveWallRelation {
  const moveX = nextPoint[0] - sharedPoint[0]
  const moveZ = nextPoint[1] - sharedPoint[1]
  const moveLength = Math.hypot(moveX, moveZ)

  if (moveLength < AXIS_EPSILON) return 'stationary'

  const freeEndpoint = otherWallEndpoint(wall, sharedPoint)
  const wallX = freeEndpoint[0] - sharedPoint[0]
  const wallZ = freeEndpoint[1] - sharedPoint[1]
  const wallLength = Math.hypot(wallX, wallZ)

  if (wallLength < AXIS_EPSILON) return 'stationary'

  const normalizedCross = Math.abs(moveX * wallZ - moveZ * wallX) / (moveLength * wallLength)
  if (normalizedCross > 1e-4) return 'off-axis'

  const normalizedDot = (moveX * wallX + moveZ * wallZ) / (moveLength * wallLength)
  return normalizedDot >= 0 ? 'same-direction' : 'opposite-direction'
}

export function planWallMoveJunctions<TWall extends Pick<WallNode, 'id' | 'start' | 'end'>>(
  linkedWalls: TWall[],
  originalStart: WallPlanPoint,
  originalEnd: WallPlanPoint,
  nextStart: WallPlanPoint,
  nextEnd: WallPlanPoint,
): WallMoveJunctionPlan<TWall> {
  const linkedWallsToMove = new Map<TWall['id'], TWall>()
  const linkedWallTargetPlans = new Map<TWall['id'], WallMoveLinkedWallTargetPlan<TWall>>()
  const bridgePlans = new Map<string, WallMoveBridgePlan<TWall>>()
  const wallsToDelete = new Map<TWall['id'], TWall>()

  const addStandardEndpointPlan = (
    endpoint: WallMoveEndpoint,
    point: WallPlanPoint,
    nextPoint: WallPlanPoint,
    relatedWalls: Array<RelatedWallEntry<TWall>>,
    keySuffix = '',
    useTargetPlans = false,
  ) => {
    const hasSideBranch = relatedWalls.some((entry) => entry.relation === 'off-axis')
    const hasOppositeBridge = relatedWalls.some(
      (entry) => entry.relation === 'opposite-direction' && hasSideBranch,
    )

    for (const { wall, relation } of relatedWalls) {
      if (
        relation === 'stationary' ||
        relation === 'same-direction' ||
        (relation === 'opposite-direction' && !hasSideBranch)
      ) {
        if (useTargetPlans) {
          linkedWallTargetPlans.set(wall.id, {
            wall,
            originalPoint: point,
            targetPoint: nextPoint,
          })
        } else {
          linkedWallsToMove.set(wall.id, wall)
        }
        continue
      }

      if (relation === 'off-axis' && hasOppositeBridge) {
        continue
      }

      bridgePlans.set(`${wall.id}:${endpoint}${keySuffix}`, {
        wall,
        originalPoint: point,
        movedEndpoint: endpoint,
      })
    }
  }

  const addEndpointPlan = (
    endpoint: WallMoveEndpoint,
    point: WallPlanPoint,
    nextPoint: WallPlanPoint,
  ) => {
    const moveLength = Math.hypot(nextPoint[0] - point[0], nextPoint[1] - point[1])
    const linkedAtEndpoint = linkedWalls
      .filter((wall) => wallTouchesPoint(wall, point))
      .map((wall) => ({
        wall,
        relation: getMoveWallRelation(wall, point, nextPoint),
      }))
    const consumedSameDirectionWall = linkedAtEndpoint
      .filter((entry) => entry.relation === 'same-direction')
      .map((entry) => ({
        ...entry,
        distance: wallLengthFromPoint(entry.wall, point),
      }))
      .filter((entry) => moveLength + AXIS_EPSILON >= entry.distance)
      .sort((a, b) => a.distance - b.distance)[0]

    if (consumedSameDirectionWall) {
      const pivotPoint = [...otherWallEndpoint(consumedSameDirectionWall.wall, point)] as WallPlanPoint
      const bridgeSource = linkedAtEndpoint.find((entry) => entry.relation === 'opposite-direction')

      wallsToDelete.set(consumedSameDirectionWall.wall.id, consumedSameDirectionWall.wall)
      linkedWallTargetPlans.set(consumedSameDirectionWall.wall.id, {
        wall: consumedSameDirectionWall.wall,
        originalPoint: point,
        targetPoint: pivotPoint,
      })

      if (bridgeSource) {
        linkedWallTargetPlans.set(bridgeSource.wall.id, {
          wall: bridgeSource.wall,
          originalPoint: point,
          targetPoint: pivotPoint,
        })

        bridgePlans.set(`${bridgeSource.wall.id}:${endpoint}:through`, {
          wall: bridgeSource.wall,
          originalPoint: pivotPoint,
          movedEndpoint: endpoint,
        })
        return
      }

      const linkedAtPivot = linkedWalls
        .filter(
          (wall) => wall.id !== consumedSameDirectionWall.wall.id && wallTouchesPoint(wall, pivotPoint),
        )
        .map((wall) => ({
          wall,
          relation: getMoveWallRelation(wall, pivotPoint, nextPoint),
        }))

      addStandardEndpointPlan(endpoint, pivotPoint, nextPoint, linkedAtPivot, ':through-pivot', true)
      return
    }

    addStandardEndpointPlan(endpoint, point, nextPoint, linkedAtEndpoint)
  }

  addEndpointPlan('start', originalStart, nextStart)
  addEndpointPlan('end', originalEnd, nextEnd)

  return {
    linkedWallsToMove: Array.from(linkedWallsToMove.values()),
    linkedWallTargetPlans: Array.from(linkedWallTargetPlans.values()),
    bridgePlans: Array.from(bridgePlans.values()),
    wallsToDelete: Array.from(wallsToDelete.values()),
  }
}
