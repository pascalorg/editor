/**
 * World-grid snap for tools that consume `grid:move` / `grid:click`.
 *
 * Tools historically snapped on `event.localPosition` (the cursor in the
 * active building's local frame). After the floor-plan grid was pulled
 * out of the rotated scene group, snapping has to follow the WORLD XZ
 * grid — otherwise a rotated building drags every placement off the
 * visible grid lines. This helper resolves the active building's pose
 * and projects the world snap back into local coords for storage.
 */
import {
  type AlignmentAnchor,
  type AlignmentGuide,
  type AnyNodeId,
  type BuildingPose,
  type ResolveAlignmentInBuildingResult,
  resolveAlignmentInBuildingWorld,
  snapWorldXZToBuildingLocal,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'

/**
 * Look up the active building's pose, or null when we're at the site root.
 * Used by tools that need to resolve alignment in world coords.
 *
 * Falls back through the active level's `parentId` because the 2D floor-plan
 * often runs with `selection.buildingId === null` while still operating
 * inside a specific building (the user is editing a level, not the building
 * shell itself). Without the fallback, alignment in the floor plan saw a
 * `buildingRotY === 0` pose and emitted world-axis guides — which appeared
 * diagonal once the building was rotated.
 *
 * Honours `useLiveTransforms` overrides: while the building is being moved
 * or rotated, the floor-plan scene <g> is driven by the live transform
 * (see `use-floorplan-scene-data.ts`), so alignment has to read the same
 * pose or the rotated anchors fall out of sync with the SVG transform and
 * guides drift off the visible grid mid-drag (and through any post-drag
 * frame where the live override is still set).
 */
export function getActiveBuildingPose(): BuildingPose | null {
  const sel = useViewer.getState().selection
  const nodes = useScene.getState().nodes
  // Match `use-floorplan-scene-data.ts`: prefer the active level's
  // owning building, fall back to selection.buildingId. If the user
  // has a stale building selected from another scope while editing a
  // different level, the level path is the authoritative one.
  let buildingId: AnyNodeId | null = null
  if (sel.levelId) {
    const level = nodes[sel.levelId]
    if (level && level.type === 'level' && level.parentId) {
      buildingId = level.parentId as AnyNodeId
    }
  }
  if (!buildingId) buildingId = sel.buildingId ?? null
  const building = buildingId ? nodes[buildingId] : null
  if (building?.type !== 'building') return null
  const live = useLiveTransforms.getState().transforms.get(buildingId as string)
  return {
    position: live?.position ?? building.position,
    rotationY: live?.rotation ?? building.rotation[1] ?? 0,
  }
}

/**
 * Resolve Figma-style alignment for tools whose anchors are in the active
 * building's local frame, but where alignment must run on the WORLD axes
 * (the frame the user sees the grid in). Wraps `resolveAlignmentInBuildingWorld`
 * with the active building lookup so callers don't repeat the boilerplate.
 *
 * Returns:
 *   - `guides` in WORLD coords (renderer must live in a world-space group),
 *   - `snap`   in BUILDING-LOCAL coords (ready to add to a local position).
 */
export function resolveAlignmentForActiveBuilding(args: {
  moving: readonly AlignmentAnchor[]
  candidates: readonly AlignmentAnchor[]
  threshold: number
}): ResolveAlignmentInBuildingResult {
  return resolveAlignmentInBuildingWorld({ ...args, pose: getActiveBuildingPose() })
}

function worldXZToPoseLocal(x: number, z: number, pose: BuildingPose | null): [number, number] {
  if (!pose) return [x, z]
  const cos = Math.cos(pose.rotationY)
  const sin = Math.sin(pose.rotationY)
  const dx = x - pose.position[0]
  const dz = z - pose.position[2]
  return [dx * cos - dz * sin, dx * sin + dz * cos]
}

/**
 * Project WORLD-frame alignment guides into the active building's LOCAL frame.
 *
 * The 3D alignment layer is still mounted inside the building-local tool group,
 * so tools that resolve alignment on the world axes (item placement, slab move)
 * need their guides converted before publishing to `useAlignmentGuides`.
 */
export function projectAlignmentGuidesWorldToActiveBuildingLocal(
  guides: readonly AlignmentGuide[],
): AlignmentGuide[] {
  const pose = getActiveBuildingPose()
  return guides.map((guide) => {
    const [fromX, fromZ] = worldXZToPoseLocal(guide.from.x, guide.from.z, pose)
    const [toX, toZ] = worldXZToPoseLocal(guide.to.x, guide.to.z, pose)
    return {
      ...guide,
      from: { x: fromX, z: fromZ },
      to: { x: toX, z: toZ },
    }
  })
}

/**
 * Baseline rotation the floor-plan view applies on top of the building
 * rotation. Mirrors `FLOORPLAN_VIEW_ROTATION_DEG = 90` in floorplan-panel.tsx —
 * the scene group reads it via `floorplanSceneRotationDeg = FVR - buildingRot`.
 */
const FLOORPLAN_VIEW_ROTATION_RAD = Math.PI / 2

function rotateAnchorsBy(
  anchors: readonly AlignmentAnchor[],
  cos: number,
  sin: number,
): AlignmentAnchor[] {
  return anchors.map((a) => ({
    nodeId: a.nodeId,
    kind: a.kind,
    x: a.x * cos - a.z * sin,
    z: a.x * sin + a.z * cos,
  }))
}

/**
 * Resolve alignment in the 2D floor-plan view frame — the frame the user
 * sees the (always axis-aligned) grid lines in, regardless of how the
 * building has been rotated. Use this from EVERY 2D floor-plan path so
 * alignment guides stay parallel to the visible grid.
 *
 * Why it differs from `resolveAlignmentForActiveBuilding`: the 3D viewport
 * shows the world XZ grid, so world-frame alignment matches the visible
 * grid there. The 2D floor plan, however, rotates the scene `<g>` by
 * `floorplanSceneRotationDeg = FVR − buildingRot` and renders the grid
 * OUTSIDE that rotated group — so the visible axes are
 * `R(FVR − buildingRot) · local`. World-frame alignment would land on
 * world axes, which appear diagonal in this view; view-frame alignment
 * lands on the SVG axes the user actually reads.
 *
 * Returns guides in view-frame coords (correct input for the floor-plan
 * alignment-guide layer, which is mounted outside the rotated scene
 * group) and a snap delta projected back into building-local (so callers
 * can add it to a local position as-is).
 */
export function resolveAlignmentForFloorplanView(args: {
  moving: readonly AlignmentAnchor[]
  candidates: readonly AlignmentAnchor[]
  threshold: number
}): ResolveAlignmentInBuildingResult {
  const pose = getActiveBuildingPose()
  const buildingRotY = pose?.rotationY ?? 0
  const rot = FLOORPLAN_VIEW_ROTATION_RAD - buildingRotY
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const result = resolveAlignmentInBuildingWorld({
    moving: rotateAnchorsBy(args.moving, cos, sin),
    candidates: rotateAnchorsBy(args.candidates, cos, sin),
    threshold: args.threshold,
    // Pose `null` keeps `resolveAlignmentInBuildingWorld` in its no-op
    // path: it just runs `resolveAlignment` on the already-rotated
    // anchors and returns the snap delta in the same view frame.
    pose: null,
  })
  if (!result.snap) return result
  // View-frame delta → local-frame delta (transpose of R(rot)).
  const { dx, dz } = result.snap
  return {
    guides: result.guides,
    snap: { dx: dx * cos + dz * sin, dz: -dx * sin + dz * cos },
  }
}

/**
 * Snap a world XZ position to the grid, then express it in the active
 * building's local frame. When no building is active, world == local.
 */
export function snapWorldXZForActiveBuilding(
  worldX: number,
  worldZ: number,
  step: number,
): { world: [number, number]; local: [number, number] } {
  const buildingId = useViewer.getState().selection.buildingId
  const building = buildingId ? useScene.getState().nodes[buildingId] : null
  if (building?.type !== 'building') {
    if (step <= 0) return { world: [worldX, worldZ], local: [worldX, worldZ] }
    const sx = Math.round(worldX / step) * step
    const sz = Math.round(worldZ / step) * step
    return { world: [sx, sz], local: [sx, sz] }
  }
  return snapWorldXZToBuildingLocal(
    worldX,
    worldZ,
    building.position,
    building.rotation[1] ?? 0,
    step,
  )
}

/**
 * Snap a building-local plan point so the resulting position sits on the
 * world XZ grid. The returned point is still in building-local coords —
 * useful as a `gridSnap` callback for snapWallDraftPoint / snapFenceDraftPoint
 * etc., which operate entirely in the local frame.
 */
export function snapBuildingLocalToWorldGrid(
  local: readonly [number, number],
  step: number,
): [number, number] {
  const buildingId = useViewer.getState().selection.buildingId
  const building = buildingId ? useScene.getState().nodes[buildingId] : null
  if (building?.type !== 'building') {
    if (step <= 0) return [local[0], local[1]]
    return [Math.round(local[0] / step) * step, Math.round(local[1] / step) * step]
  }
  const rotY = building.rotation[1] ?? 0
  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)
  const worldX = building.position[0] + local[0] * cos + local[1] * sin
  const worldZ = building.position[2] - local[0] * sin + local[1] * cos
  return snapWorldXZToBuildingLocal(worldX, worldZ, building.position, rotY, step).local
}
