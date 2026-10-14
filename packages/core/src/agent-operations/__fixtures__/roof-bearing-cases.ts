import {
  type AnyNode,
  BuildingNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SlabNode,
  WallNode,
  ZoneNode,
} from '../../schema'

/**
 * Houses for the roof-level rule's tables: which roofs stand on the walls of the storey holding
 * them (the seat moves them to the level above, the repair too, verify_scene reports them) and
 * which bear on beams and posts (a porch, a portico: they stay on their storey). A storey is 3 m
 * tall; its room is walled round, its walls 2.7 m tall on a 0.05 m slab, so they top out at 2.75 m.
 * The house's front wall runs along z = 0, the porches stand in front of it, at negative z.
 */

type Pt = [number, number]
type Rect = [number, number, number, number]
type Nodes = Record<string, AnyNode>

export const SLAB = 0.05
/** Where a storey's 2.7 m walls top out, on the slab. */
export const TOP = 2.75
const FT = 0.3048
/** An 8 ft house's walls on the slab: its plate. */
export const TOP_8FT = 8 * FT + SLAB
/** A porch cover's beam band, as the generator draws it (plugin-generate `PORCH_BAND`). */
const BAND = 0.222
/** A generated porch's beam: 9 ft over its floor, never under the house plate. */
const PORCH_PLATE = Math.max(9 * FT, TOP_8FT)

/** The nodes, each parent listing the children that name it, in order. */
export function scene(...nodes: AnyNode[]): Nodes {
  const byId: Nodes = Object.fromEntries(nodes.map((node) => [node.id, node]))
  for (const node of nodes) {
    const parent = node.parentId ? byId[node.parentId] : undefined
    const children = (parent as { children?: string[] } | undefined)?.children
    if (parent && children && !children.includes(node.id))
      byId[parent.id] = { ...parent, children: [...children, node.id] } as AnyNode
  }
  return byId
}

export const building = () => BuildingNode.parse({ id: 'building_h' })

export const level = (id: string, index: number, metadata?: Record<string, unknown>) =>
  LevelNode.parse({
    id,
    parentId: 'building_h',
    level: index,
    height: 3,
    ...(metadata ? { metadata } : {}),
  })

/** A room on `levelId` over `rect`, [x0, z0, x1, z1], walled round with walls `height` tall on the slab. */
export function room(
  levelId: string,
  tag: string,
  [x0, z0, x1, z1]: Rect = [0, 0, 10, 8],
  height = 2.7,
): AnyNode[] {
  const corners: Pt[] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  return [
    ...corners.map((start, i) =>
      WallNode.parse({
        id: `wall_${tag}${i}`,
        parentId: levelId,
        start,
        end: corners[(i + 1) % 4],
        height,
      }),
    ),
    ZoneNode.parse({ id: `zone_${tag}`, parentId: levelId, name: 'Room', polygon: corners }),
    SlabNode.parse({ id: `slab_${tag}`, parentId: levelId, polygon: corners, elevation: SLAB }),
  ]
}

type Segment = Partial<Omit<RoofSegmentNode, 'id'>> & { id: string }

/** A roof container on `levelId` and its segments. */
export function roof(
  id: string,
  levelId: string,
  at: { position?: [number, number, number]; rotation?: number; support?: 'walls' | 'level' },
  ...segments: Segment[]
): AnyNode[] {
  return [
    RoofNode.parse({
      id,
      parentId: levelId,
      position: at.position ?? [0, 0, 0],
      rotation: at.rotation ?? 0,
      support: { kind: at.support ?? 'level' },
    }),
    ...segments.map((segment) => RoofSegmentNode.parse({ wallHeight: 0, ...segment, parentId: id })),
  ]
}

/** A gable over the 10 × 8 m room, its container at `y`, eaves along the front and back walls. */
export const mainRoof = (levelId = 'level_g', y = TOP, support: 'walls' | 'level' = 'level') =>
  roof('roof_main', levelId, { position: [5, y, 4], support }, {
    id: 'rseg_main',
    width: 10,
    depth: 8,
  })

/**
 * A generated gable or hip porch cover in front of the house across x0–x1 (plugin-generate
 * `porchFor`): the ridge square to the wall, the box reaching `into` metres into the house past
 * the front wall's centre line and `out` metres out to its beam, its eave on the beam band at the
 * porch plate, the band hung under it.
 */
export function gablePorch(levelId: string, [x0, x1]: [number, number], into: number, out = 2.4) {
  return roof(
    'roof_porch',
    levelId,
    // segment +x turned onto the outward direction, -z
    { position: [(x0 + x1) / 2, 0, (into - out) / 2], rotation: Math.PI / 2 },
    {
      id: 'rseg_porch',
      roofType: 'gable',
      position: [0, PORCH_PLATE - BAND, 0],
      width: out + into,
      depth: x1 - x0,
      wallHeight: BAND,
      wallThickness: 0.14,
      pitch: 26.57,
    },
  )
}

/** A shed porch on a ledger: it rises from its beam to its high edge at the front wall's face. */
export const shedPorch = (levelId: string) =>
  roof(
    'roof_porch',
    levelId,
    // segment +z, its low eave, turned onto the outward direction, -z
    { position: [5, 0, -0.05 - 1.2], rotation: Math.PI },
    {
      id: 'rseg_porch',
      roofType: 'shed',
      position: [0, 2.3, 0],
      width: 4,
      depth: 2.4,
      pitch: 18.43,
    },
  )

/** A portico from the front wall's centre line, its eave at the plate (on columns). */
export const portico = (levelId: string) =>
  roof(
    'roof_porch',
    levelId,
    { position: [5, 0, -0.9], rotation: Math.PI / 2 },
    { id: 'rseg_porch', roofType: 'gable', position: [0, TOP, 0], width: 1.8, depth: 2.4 },
  )

/** One storey: the 10 × 8 m room and `extra` on level_g. */
export const bungalow = (...extra: AnyNode[]) =>
  scene(building(), level('level_g', 0), ...room('level_g', 'g'), ...extra)

/** The bungalow at 8 ft, its walls 2.438 m tall on the slab. */
export const bungalow8ft = (...extra: AnyNode[]) =>
  scene(building(), level('level_g', 0), ...room('level_g', 'g', [0, 0, 10, 8], 8 * FT), ...extra)
