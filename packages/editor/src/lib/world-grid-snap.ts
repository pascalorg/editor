/**
 * Grid snap and alignment frames for tools that consume `grid:move` /
 * `grid:click` inside a building.
 *
 * A building placed on a lot by the site planner is usually turned (yaw) and
 * offset. Everything drawn or placed in it — walls, slabs, rooms, furniture,
 * doors and windows — lives in the building's own frame, and so does the grid
 * both views draw for it: the floor plan's grid sits inside the rotated scene
 * group, and the 3D grid is laid on the building (`getActiveGridPose`). The
 * snaps here follow that lattice, so a wall drawn square to the house stays
 * square to it and lands on the lattice its neighbours were drawn on. A
 * world-XZ lattice sits at the building's yaw to the house and off it by the
 * building's offset, leaving drafted ends a fraction short of the walls they
 * meet. For an unturned building at the origin the two coincide; outside any
 * building the world grid is the lattice.
 */
import {
  type AlignmentAnchor,
  type AlignmentGuide,
  type AnyNodeId,
  type BuildingPose,
  type ResolveAlignmentInBuildingResult,
  resolveAlignmentInBuildingWorld,
  resolveBuildingForLevel,
  snapWorldXZToBuildingLocal,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import useEditor from '../store/use-editor'
import { getMovingNode } from '../store/use-interaction-scope'

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
export function getActiveBuildingId(): AnyNodeId | null {
  const sel = useViewer.getState().selection
  const nodes = useScene.getState().nodes
  // Match `use-floorplan-scene-data.ts`: prefer the active level's
  // owning building, fall back to selection.buildingId. If the user
  // has a stale building selected from another scope while editing a
  // different level, the level path is the authoritative one.
  let buildingId: AnyNodeId | null = null
  if (sel.levelId) {
    buildingId = resolveBuildingForLevel(sel.levelId as AnyNodeId, nodes)
  }
  if (!buildingId) buildingId = sel.buildingId ?? null
  return buildingId
}

export function getActiveBuildingPose(): BuildingPose | null {
  const buildingId = getActiveBuildingId()
  const nodes = useScene.getState().nodes
  const building = buildingId ? nodes[buildingId] : null
  if (building?.type !== 'building') return null
  const live = useLiveTransforms.getState().transforms.get(buildingId as string)
  return {
    position: live?.position ?? building.position,
    rotationY: live?.rotation ?? building.rotation[1] ?? 0,
  }
}

/**
 * The frame of the lattice the 3D grid is drawn on: the active building's pose
 * for everything drawn or placed in it, or null — the world XZ grid — for
 * site work (the site phase, which terrain sculpting also runs in), while a
 * building itself is being moved (it moves on the site), and with no building.
 */
export function getActiveGridPose(): BuildingPose | null {
  if (useEditor.getState().phase === 'site') return null
  if (getMovingNode()?.type === 'building') return null
  return getActiveBuildingPose()
}

/**
 * Resolve Figma-style alignment for 3D tools whose anchors are in the active
 * building's local frame, on the building's own axes (the axes its grid is
 * drawn on). Wraps `resolveAlignmentInBuildingWorld` with the active building
 * lookup so callers don't repeat the boilerplate.
 *
 * Returns:
 *   - `guides` with `from` / `to` in WORLD coords (callers bring them back
 *     with `projectAlignmentGuidesWorldToActiveBuildingLocal`),
 *   - `snap`   in BUILDING-LOCAL coords (ready to add to a local position).
 */
export function resolveAlignmentForActiveBuilding(args: {
  moving: readonly AlignmentAnchor[]
  candidates: readonly AlignmentAnchor[]
  threshold: number
}): ResolveAlignmentInBuildingResult {
  // Pose `null` resolves in the anchors' own (building-local) frame.
  const result = resolveAlignmentInBuildingWorld({ ...args, pose: null })
  const pose = getActiveBuildingPose()
  if (!pose) return result
  return {
    snap: result.snap,
    guides: result.guides.map((guide) => {
      const [fromX, fromZ] = poseLocalXZToWorld(guide.from.x, guide.from.z, pose)
      const [toX, toZ] = poseLocalXZToWorld(guide.to.x, guide.to.z, pose)
      return { ...guide, from: { x: fromX, z: fromZ }, to: { x: toX, z: toZ } }
    }),
  }
}

function poseLocalXZToWorld(x: number, z: number, pose: BuildingPose): [number, number] {
  const cos = Math.cos(pose.rotationY)
  const sin = Math.sin(pose.rotationY)
  return [pose.position[0] + x * cos + z * sin, pose.position[2] - x * sin + z * cos]
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
 * The 3D alignment layer is mounted inside the building-local tool group, so
 * tools that resolve through `resolveAlignmentForActiveBuilding` (item
 * placement, slab move) convert its guides before publishing to
 * `useAlignmentGuides`.
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
 * Resolve alignment for the 2D floor plan, on the active building's own axes.
 * Use this from EVERY 2D floor-plan path so alignment guides stay parallel to
 * the plan's grid.
 *
 * The floor plan rotates its scene `<g>` by the building's yaw (and the user's
 * view rotation) and draws both its grid and the alignment-guide layer inside
 * that group, in building-local metres. So the axes the user reads are the
 * building's local axes, and guides must come back in local coords: resolving
 * on world axes would align a turned building's corners on a diagonal to its
 * walls and draw each guide away from the anchors it matched.
 *
 * Returns guides and the snap delta in building-local coords (add the delta
 * to a local position as-is).
 */
export function resolveAlignmentForFloorplanView(args: {
  moving: readonly AlignmentAnchor[]
  candidates: readonly AlignmentAnchor[]
  threshold: number
}): ResolveAlignmentInBuildingResult {
  // Pose `null` resolves in the anchors' own (building-local) frame.
  return resolveAlignmentInBuildingWorld({ ...args, pose: null })
}

/**
 * Snap a world XZ position onto the active building's grid lattice (see
 * `snapBuildingLocalToWorldGrid`) and return the snapped point in both
 * frames. With no active building, world == local and the world grid is the
 * lattice.
 */
export function snapWorldXZForActiveBuilding(
  worldX: number,
  worldZ: number,
  step: number,
): { world: [number, number]; local: [number, number] } {
  const pose = getActiveBuildingPose()
  if (!pose) {
    const [x, z] = snapBuildingLocalToWorldGrid([worldX, worldZ], step)
    return { world: [x, z], local: [x, z] }
  }
  const { local } = snapWorldXZToBuildingLocal(worldX, worldZ, pose.position, pose.rotationY, 0)
  const [x, z] = snapBuildingLocalToWorldGrid(local, step)
  return { world: poseLocalXZToWorld(x, z, pose), local: [x, z] }
}

/**
 * Snap a plan point in the 3D tools' frame (a grid event's `localPosition`)
 * onto the lattice the grid is drawn on, one axis at a time with the caller's
 * per-axis snap (an item snaps its edges by its own size). Inside a building
 * the point is building-local and the lattice runs along the building's axes;
 * outside any building it is the world point and the world grid is the
 * lattice — so no pose is needed either way.
 */
export function snapPlanPointToActiveGrid(
  point: readonly [number, number],
  snap: (value: number, axis: 0 | 1) => number,
): [number, number] {
  return [snap(point[0], 0), snap(point[1], 1)]
}

/**
 * Snap a building-local plan point onto the building's own grid lattice:
 * multiples of `step` along its local axes from its origin, the lattice both
 * views draw and the wall tool drafts on. Coordinates in and out are
 * building-local, so it suits a `gridSnap` callback for snapWallDraftPoint /
 * snapFenceDraftPoint etc. (The name predates the building frame: it used to
 * snap onto the world XZ grid, at a turned building's yaw to the house.)
 */
export function snapBuildingLocalToWorldGrid(
  local: readonly [number, number],
  step: number,
): [number, number] {
  if (step <= 0) return [local[0], local[1]]
  return snapPlanPointToActiveGrid(local, (value) => Math.round(value / step) * step)
}
