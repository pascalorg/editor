import {
  type AnyNode,
  containsPoint,
  detectSpacesForLevel,
  getBlockFaceFrame,
  getFloorPlacedFootprints,
  getWallBodyCenterOffset,
  getWallCurveFrameAt,
  getWallCurveLength,
  measurementCentroid,
  nodeRegistry,
  polygonInteriorPoint,
  type SeparatorNode,
  type WallNode,
} from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

type Nodes = Readonly<Record<string, AnyNode>>
type Point = [number, number]
type Frame = { nodeId: string; levelId: string; matrix: Matrix4 }
type Shape = { polygon: Point[]; holes: Point[][] }

function fields(node: AnyNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>
}

function vector(value: unknown): [number, number, number] | null {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? (value as [number, number, number])
    : null
}

function ring(value: unknown): Point[] {
  return Array.isArray(value)
    ? value.filter(
        (point): point is Point =>
          Array.isArray(point) && point.length === 2 && point.every(Number.isFinite),
      )
    : []
}

function centroid(polygon: Point[]): Point | null {
  const centre = measurementCentroid(polygon.map(([x, z]) => [x, 0, z]))
  return centre ? [centre[0], centre[2]] : null
}

function covers(shape: Shape, point: Point): boolean {
  return containsPoint([{ outer: shape.polygon, holes: shape.holes }], point)
}

function snapshotScope(nodes: Nodes, targetIds: readonly string[], roomContentsOnly = false) {
  const children = new Map<string, Set<string>>()
  const listedParents = new Map<string, string>()
  const addChild = (parent: string, child: string) => {
    const ids = children.get(parent) ?? new Set<string>()
    ids.add(child)
    children.set(parent, ids)
  }
  for (const node of Object.values(nodes)) {
    if (node.parentId) addChild(node.parentId, node.id)
    for (const child of 'children' in node ? (node.children ?? []) : []) {
      addChild(node.id, child)
      if (!listedParents.has(child)) listedParents.set(child, node.id)
    }
    const wallId = fields(node).wallId
    if (typeof wallId === 'string') addChild(wallId, node.id)
  }
  const parentId = (node: AnyNode): string | undefined => {
    const wallId = fields(node).wallId
    if (typeof wallId === 'string' && nodes[wallId]?.type === 'wall') return wallId
    return node.parentId ?? listedParents.get(node.id)
  }
  const frames = new Map<string, Frame | null>()
  const resolving = new Set<string>()
  const attachmentFrame = (node: AnyNode, host: Frame): Frame => {
    const hostNode = nodes[host.nodeId]
    if (node.type !== 'item' || hostNode?.type !== 'block' || !node.blockFaceId) return host
    const face = getBlockFaceFrame(hostNode.topology, node.blockFaceId)
    if (!face) return host
    // Stored item coordinates are in the face basis, as in BlockFaceHostFrame.
    const local = new Matrix4()
      .makeBasis(
        new Vector3(...face.xAxis),
        new Vector3(...face.yAxis),
        new Vector3(...face.normal),
      )
      .setPosition(...face.origin)
    return { ...host, matrix: host.matrix.clone().multiply(local) }
  }
  const wallPose = (wall: WallNode, position: [number, number, number]) => {
    const curve = getWallCurveFrameAt(wall, position[0] / (getWallCurveLength(wall) || 1))
    const across = getWallBodyCenterOffset(wall) + position[2]
    return {
      position: [
        curve.point.x + curve.normal.x * across,
        position[1],
        curve.point.y + curve.normal.y * across,
      ] as [number, number, number],
      yaw: -Math.atan2(curve.tangent.y, curve.tangent.x),
    }
  }
  const frame = (id: string): Frame | null => {
    if (frames.has(id)) return frames.get(id) ?? null
    const node = nodes[id]
    if (!node || resolving.has(id)) return null
    if (node.type === 'level') {
      const result = { nodeId: id, levelId: id, matrix: new Matrix4() }
      frames.set(id, result)
      return result
    }
    resolving.add(id)
    const parent = parentId(node)
    const host = parent ? frame(parent) : null
    let result: Frame | null = null
    if (host) {
      const data = fields(node)
      let position: [number, number, number] = vector(data.position) ?? [0, 0, 0]
      let rotation: [number, number, number] = vector(data.rotation) ?? [
        0,
        typeof data.rotation === 'number' ? data.rotation : 0,
        0,
      ]
      if (node.type === 'wall') {
        const [dx, dz] = [node.end[0] - node.start[0], node.end[1] - node.start[1]]
        position = [node.start[0], 0, node.start[1]]
        rotation = [0, -Math.atan2(dz, dx), 0]
      }
      // Item scale belongs to its model, not the group that hosts its children.
      const scale: [number, number, number] =
        node.type === 'item' ? [1, 1, 1] : (vector(data.scale) ?? [1, 1, 1])
      let basis = attachmentFrame(node, host).matrix
      const hostNode = nodes[host.nodeId]
      let orientation = new Quaternion().setFromEuler(new Euler(...rotation))
      if (hostNode?.type === 'wall') {
        const wallParent = parentId(hostNode)
        const wallHost = wallParent ? frame(wallParent) : null
        if (wallHost) {
          const pose = wallPose(hostNode, position)
          position = pose.position
          basis = wallHost.matrix
          orientation = new Quaternion()
            .setFromEuler(new Euler(0, pose.yaw, 0))
            .multiply(orientation)
        }
      }
      const local = new Matrix4().compose(
        new Vector3(...position),
        orientation,
        new Vector3(...scale),
      )
      result = { nodeId: id, levelId: host.levelId, matrix: basis.clone().multiply(local) }
    }
    resolving.delete(id)
    frames.set(id, result)
    return result
  }
  const parentFrame = (node: AnyNode): Frame | null => {
    const parent = parentId(node)
    return parent ? frame(parent) : null
  }
  const transform = (point: [number, number, number], host: Frame): Point => {
    const hostNode = nodes[host.nodeId]
    if (hostNode?.type === 'wall') {
      const wallHost = parentFrame(hostNode)
      if (wallHost) return transform(wallPose(hostNode, point).position, wallHost)
    }
    const transformed = new Vector3(...point).applyMatrix4(host.matrix)
    return [transformed.x, transformed.z]
  }
  const shape = (node: AnyNode, host: Frame): Shape => {
    const data = fields(node)
    const transformRing = (points: Point[]) => points.map(([x, z]) => transform([x, 0, z], host))
    return {
      polygon: transformRing(ring(data.polygon)),
      holes: Array.isArray(data.holes) ? data.holes.map((hole) => transformRing(ring(hole))) : [],
    }
  }
  const centres = (node: AnyNode, host: Frame): Point[] => {
    host = attachmentFrame(node, host)
    const data = fields(node)
    const position = vector(data.position)
    const floorPlaced = nodeRegistry.get(node.type)?.capabilities?.floorPlaced
    if (
      floorPlaced &&
      (!floorPlaced.applies || floorPlaced.applies(node)) &&
      (floorPlaced.footprint || floorPlaced.footprints)
    ) {
      // Resolvers read this snapshot, never the current scene store. Their positions,
      // like node.position, are in the parent's frame rather than offsets from it.
      return getFloorPlacedFootprints(floorPlaced, node, { nodes }).flatMap((footprint) => {
        const centre = vector(footprint.position) ?? position
        return centre ? [transform(centre, host)] : []
      })
    }
    if (position) return [transform(position, host)]
    const polygonCentre = centroid(ring(data.polygon))
    if (polygonCentre) return [transform([polygonCentre[0], 0, polygonCentre[1]], host)]
    const start = ring([data.start])[0]
    const end = ring([data.end])[0]
    return start && end
      ? [transform([(start[0] + end[0]) / 2, 0, (start[1] + end[1]) / 2], host)]
      : []
  }

  const nodesByLevel = new Map<string, AnyNode[]>()
  for (const node of Object.values(nodes)) {
    const host = parentFrame(node)
    if (!host) continue
    const members = nodesByLevel.get(host.levelId) ?? []
    members.push(node)
    nodesByLevel.set(host.levelId, members)
  }
  const topology = new Map<string, ReturnType<typeof detectSpacesForLevel>>()
  const rooms = (levelId: string) => {
    let result = topology.get(levelId)
    if (!result) {
      const boundaries = (nodesByLevel.get(levelId) ?? []).flatMap<WallNode | SeparatorNode>(
        (node) => {
          if (node.type !== 'wall' && node.type !== 'separator') return []
          const host = parentFrame(node)
          if (!host) return []
          return [
            {
              ...node,
              start: transform([node.start[0], 0, node.start[1]], host),
              end: transform([node.end[0], 0, node.end[1]], host),
            },
          ]
        },
      )
      result = detectSpacesForLevel(levelId, boundaries)
      topology.set(levelId, result)
    }
    return result
  }
  const seeds = new Set<string>(roomContentsOnly ? [] : targetIds)
  const roomExcluded = (node: AnyNode) =>
    node.type === 'zone' ||
    node.type === 'level' ||
    node.type === 'building' ||
    node.type === 'site' ||
    node.type === 'unit'
  for (const id of targetIds) {
    const zone = nodes[id]
    if (zone?.type !== 'zone') continue
    const data = fields(zone)
    const host = parentFrame(zone)
    if (!host) continue
    for (const key of roomContentsOnly ? [] : ['boundaryWallIds', 'boundarySeparatorIds']) {
      const ids = data[key]
      if (Array.isArray(ids))
        for (const boundaryId of ids) {
          if (typeof boundaryId !== 'string') continue
          const boundary = nodes[boundaryId]
          if (
            boundary &&
            parentFrame(boundary)?.levelId === host.levelId &&
            ((key === 'boundaryWallIds' && boundary.type === 'wall') ||
              (key === 'boundarySeparatorIds' && boundary.type === 'separator'))
          )
            seeds.add(boundaryId)
        }
    }
    const outline = shape(zone, host)
    if (outline.polygon.length < 3) continue
    const levelNodes = nodesByLevel.get(host.levelId) ?? []
    const inRoom = (node: AnyNode) => {
      const nodeHost = parentFrame(node)
      return nodeHost && centres(node, nodeHost).some((point) => covers(outline, point))
    }
    if (roomContentsOnly) {
      for (const node of levelNodes) {
        if (nodeRegistry.get(node.type)?.category === 'furnish' && inRoom(node)) seeds.add(node.id)
      }
      continue
    }
    const needsWalls = !Array.isArray(data.boundaryWallIds) || data.boundaryWallIds.length === 0
    const needsSeparators =
      !Array.isArray(data.boundarySeparatorIds) || data.boundarySeparatorIds.length === 0
    if (
      levelNodes.some(
        (node) =>
          (node.type === 'wall' && needsWalls) || (node.type === 'separator' && needsSeparators),
      )
    ) {
      const interior = polygonInteriorPoint(outline, true)
      for (const room of rooms(host.levelId).rooms) {
        const roomShape = {
          polygon: room.polygon.map(({ x, y }): Point => [x, y]),
          holes: room.holes,
        }
        if (!covers(roomShape, interior) && !covers(outline, polygonInteriorPoint(roomShape, true)))
          continue
        for (const span of room.spans) {
          const boundary = nodes[span.boundaryId]
          if (
            (boundary?.type === 'wall' && needsWalls) ||
            (boundary?.type === 'separator' && needsSeparators)
          )
            seeds.add(span.boundaryId)
        }
      }
    }
    for (const node of levelNodes) {
      if (roomExcluded(node)) continue
      if (!inRoom(node)) continue
      seeds.add(node.id)
      // A member hosted on a wall brings the geometry host, not its level ancestors.
      const geometryHost = nodes[parentId(node) ?? '']
      if (geometryHost?.type === 'wall') seeds.add(geometryHost.id)
    }
  }
  // Contents are spatial members, not every descendant of a room or shared boundary wall.
  if (roomContentsOnly) return seeds
  const scope = new Set<string>()
  const pending = [...seeds]
  while (pending.length) {
    const id = pending.pop()!
    if (scope.has(id)) continue
    scope.add(id)
    for (const child of children.get(id) ?? []) pending.push(child)
  }
  return scope
}

/** Current furnishings use the same footprint centres and hosting frames as the pin's scope. */
export function pointRoomHasContents(roomId: string, nodes: Nodes): boolean {
  return snapshotScope(nodes, [roomId], true).size > 0
}

/** Target ancestry and room membership are evaluated independently in each snapshot. */
export function pointTargetScope(
  targetIds: readonly string[],
  before: Nodes,
  current: Nodes,
): ReadonlySet<string> {
  return new Set([...snapshotScope(before, targetIds), ...snapshotScope(current, targetIds)])
}
