import {
  type AnyNode,
  type AnyNodeId,
  pointInPolygon2D,
  type ZoneNode,
} from '@pascal-app/core'

export type Point2D = readonly [number, number]

export type ZoneProjection = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  scale: number
  offsetX: number
  offsetY: number
}

export type ZoneRackFootprint = {
  id: string
  type: string
  points: [number, number][] // 4 projected SVG points [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
  label?: string
  worldCorners?: [number, number][]
  width?: number
  depth?: number
  rotation?: number
}

const FABRIC_NODE_TYPES = new Set([
  'wall',
  'slab',
  'ceiling',
  'zone',
  'level',
  'building',
  'site',
  'roof',
  'roof-segment',
  'door',
  'window',
  'stair',
  'stair-segment',
  'scan',
  'guide',
  'measurement',
  'construction-dimension',
  'structural-grid',
])

const POINT_TOLERANCE_METERS = 0.5

/**
 * Calculates Euclidean distance from a 2D point to a line segment.
 */
function getPointToSegmentDistance(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq === 0) return Math.hypot(point[0] - start[0], point[1] - start[1])

  const rawT = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSq
  const t = Math.max(0, Math.min(1, rawT))
  const projected: [number, number] = [start[0] + t * dx, start[1] + t * dz]
  return Math.hypot(point[0] - projected[0], point[1] - projected[1])
}

/**
 * Checks if a 2D point lies within or near the perimeter of a 2D polygon footprint.
 */
export function isPointInZoneFootprint(
  point: readonly [number, number],
  polygon: readonly (readonly [number, number])[],
  tolerance = POINT_TOLERANCE_METERS,
): boolean {
  if (!polygon || polygon.length < 3) return false
  const poly = polygon.map((p) => [p[0], p[1]] as [number, number])
  if (pointInPolygon2D(point as [number, number], poly, { includeBoundary: true })) return true

  return poly.some((start, index) => {
    const end = poly[(index + 1) % poly.length]
    return end ? getPointToSegmentDistance(point, start, end) <= tolerance : false
  })
}

/**
 * Derives the bounding dimensions (width W along local X, depth D along local Z)
 * for any warehouse rack or equipment node.
 */
export function getRackDimensions(node: AnyNode): { width: number; depth: number } {
  const n = node as Record<string, unknown>

  // 1. Explicit width and depth properties
  if (typeof n.width === 'number' && typeof n.depth === 'number' && n.width > 0 && n.depth > 0) {
    return { width: n.width, depth: n.depth }
  }

  // 2. Explicit dimensions tuple [width, height, depth]
  if (Array.isArray(n.dimensions) && n.dimensions.length >= 3) {
    const w = typeof n.dimensions[0] === 'number' ? n.dimensions[0] : 0
    const d = typeof n.dimensions[2] === 'number' ? n.dimensions[2] : 0
    if (w > 0 && d > 0) return { width: w, depth: d }
  }

  // 3. Explicit size tuple [width, height, depth]
  if (Array.isArray(n.size) && n.size.length >= 3) {
    const w = typeof n.size[0] === 'number' ? n.size[0] : 0
    const d = typeof n.size[2] === 'number' ? n.size[2] : 0
    if (w > 0 && d > 0) return { width: w, depth: d }
  }

  const type = (node.type || '').toLowerCase()

  // 4. Selective Pallet Rack / Low Rack (warehouse:pallet-rack)
  if (type.includes('pallet-rack') || type === 'pallet-rack') {
    const bayClearWidth = typeof n.bayClearWidth === 'number' ? n.bayClearWidth : 2.7
    const uprightWidth = typeof n.uprightWidth === 'number' ? n.uprightWidth : 0.122
    const singleDepth = typeof n.depth === 'number' ? n.depth : 1.1
    const depthPositions = typeof n.depthPositions === 'number' ? n.depthPositions : 1
    const depthGap = typeof n.depthGap === 'number' ? n.depthGap : 0.05

    const width = bayClearWidth + 2 * uprightWidth
    const depth = depthPositions === 2 ? singleDepth * 2 + depthGap : singleDepth
    return { width, depth }
  }

  // 5. Drive-in Rack (warehouse:drive-in-rack)
  if (type.includes('drive-in') || type.includes('drivein')) {
    const laneClearWidth = typeof n.laneClearWidth === 'number' ? n.laneClearWidth : 1.35
    const uprightWidth = typeof n.uprightWidth === 'number' ? n.uprightWidth : 0.122
    const palletsDeep = typeof n.palletsDeep === 'number' ? n.palletsDeep : 4
    const depthClearance = typeof n.depthClearance === 'number' ? n.depthClearance : 0.025
    const palletRunDepth = typeof n.palletRunDepth === 'number' ? n.palletRunDepth : 1.2

    const width = laneClearWidth + 2 * uprightWidth
    const depth =
      typeof n.depth === 'number'
        ? n.depth
        : palletsDeep * (palletRunDepth + depthClearance)
    return { width, depth }
  }

  // 6. Live / Dynamic / Gravity Rack (warehouse:live-rack / warehouse:live-racking)
  if (
    type.includes('live-rack') ||
    type.includes('live-racking') ||
    type.includes('flow-rack') ||
    type.includes('gravity-rack')
  ) {
    const bayWidth =
      typeof n.bayWidth === 'number'
        ? n.bayWidth
        : typeof n.width === 'number'
          ? n.width
          : 1.5
    const channelDepth =
      typeof n.channelDepth === 'number'
        ? n.channelDepth
        : typeof n.depth === 'number'
          ? n.depth
          : 6.0
    return { width: bayWidth, depth: channelDepth }
  }

  // 7. Longspan Shelving (warehouse:longspan-rack / warehouse:longspan / warehouse:m7)
  if (type.includes('longspan') || type.includes('m7')) {
    const bayLength =
      typeof n.bayLength === 'number'
        ? n.bayLength
        : typeof n.bayClearWidth === 'number'
          ? n.bayClearWidth
          : 2.0
    const uprightWidth = typeof n.uprightWidth === 'number' ? n.uprightWidth : 0.06
    const frameDepth =
      typeof n.frameDepth === 'number'
        ? n.frameDepth
        : typeof n.depth === 'number'
          ? n.depth
          : 0.8

    const width = bayLength + 2 * uprightWidth
    return { width, depth: frameDepth }
  }

  // 8. M3 Shelving (warehouse:m3-rack / warehouse:m3)
  if (type.includes('m3')) {
    const shelfLength = typeof n.shelfLength === 'number' ? n.shelfLength : 1.0
    const uprightWidth = typeof n.uprightWidth === 'number' ? n.uprightWidth : 0.04
    const shelfDepth =
      typeof n.shelfDepth === 'number'
        ? n.shelfDepth
        : typeof n.depth === 'number'
          ? n.depth
          : 0.5

    const width = shelfLength + 2 * uprightWidth
    return { width, depth: shelfDepth }
  }

  // 9. Cantilever Rack (warehouse:cantilever)
  if (type.includes('cantilever')) {
    const width = typeof n.width === 'number' ? n.width : 2.0
    const depth = typeof n.depth === 'number' ? n.depth : 1.2
    return { width, depth }
  }

  // 10. Fallback for other warehouse objects or placed items
  const fallbackWidth = typeof n.width === 'number' ? n.width : 2.8
  const fallbackDepth = typeof n.depth === 'number' ? n.depth : 1.1
  return { width: fallbackWidth, depth: fallbackDepth }
}

/**
 * Checks whether a node represents warehouse storage equipment or rack fixture.
 */
export function isWarehouseEquipmentNode(node: AnyNode): boolean {
  if (!node || typeof node !== 'object') return false
  if (FABRIC_NODE_TYPES.has(node.type)) return false

  const type = (node.type || '').toLowerCase()
  if (type.startsWith('warehouse:')) return true
  if (
    type.includes('rack') ||
    type.includes('shelving') ||
    type.includes('cantilever') ||
    type.includes('pallet')
  ) {
    return true
  }

  const n = node as Record<string, unknown>
  if (
    typeof n.bayClearWidth === 'number' ||
    typeof n.laneClearWidth === 'number' ||
    typeof n.shelfLength === 'number' ||
    typeof n.bayLength === 'number' ||
    typeof n.palletPreset === 'string'
  ) {
    return true
  }

  return false
}

/**
 * Calculates SVG bounding projection for a zone polygon.
 */
export function calculateZoneProjection(
  polygon: readonly (readonly [number, number])[],
  viewWidth = 276,
  viewHeight = 176,
  padding = 34,
): ZoneProjection {
  if (!polygon || polygon.length === 0) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }
  }

  const xs = polygon.map((point) => point[0])
  const ys = polygon.map((point) => point[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = Math.max(maxX - minX, 1e-6)
  const height = Math.max(maxY - minY, 1e-6)
  const scale = Math.min((viewWidth - padding * 2) / width, (viewHeight - padding * 2) / height)
  const offsetX = (viewWidth - width * scale) / 2
  const offsetY = (viewHeight - height * scale) / 2

  return { minX, maxX, minY, maxY, scale, offsetX, offsetY }
}

/**
 * Extracts and projects all warehouse racks located within a zone into 2D SVG polygon footprints.
 *
 * Each rack's 3D position [posX, posY, posZ], yaw rotation rotY, and bounding footprint (width W, depth D)
 * are rotated in 3D world space and projected to 2D minimap SVG coordinates matching the zone sketch.
 */
export function deriveZoneRackFootprints(
  nodes: Readonly<Record<string, AnyNode>> | undefined,
  zone: ZoneNode | undefined,
  projection?: ZoneProjection,
): ZoneRackFootprint[] {
  if (!nodes || !zone || !zone.polygon || zone.polygon.length < 3) {
    return []
  }

  const zonePolygon = zone.polygon
  const proj = projection ?? calculateZoneProjection(zonePolygon)
  const levelId = zone.parentId

  const results: ZoneRackFootprint[] = []

  for (const node of Object.values(nodes)) {
    if (!node || typeof node !== 'object') continue

    // Level containment check: if both levelIds exist, they must match
    if (levelId && node.parentId && node.parentId !== levelId) {
      continue
    }

    // Filter out architectural fabric
    if (FABRIC_NODE_TYPES.has(node.type)) {
      continue
    }

    // Validate 3D position
    const pos = (node as { position?: unknown }).position
    if (!Array.isArray(pos) || pos.length < 3) {
      continue
    }
    const [posX, , posZ] = pos as number[]
    if (typeof posX !== 'number' || typeof posZ !== 'number' || !Number.isFinite(posX) || !Number.isFinite(posZ)) {
      continue
    }

    // Verify warehouse equipment / rack type
    if (!isWarehouseEquipmentNode(node)) {
      continue
    }

    // Spatial containment in zone boundary
    if (!isPointInZoneFootprint([posX, posZ], zonePolygon)) {
      continue
    }

    // Extract rotation (yaw angle rotY around vertical +Y axis in radians)
    const rot = (node as { rotation?: unknown }).rotation
    const rotY =
      Array.isArray(rot) && rot.length >= 2 && typeof rot[1] === 'number' && Number.isFinite(rot[1])
        ? rot[1]
        : 0

    // Extract width (local X) and depth (local Z)
    const { width: W, depth: D } = getRackDimensions(node)
    if (W <= 0 || D <= 0) continue

    const halfW = W / 2
    const halfD = D / 2

    // 4 local corners centered at (0, 0): [-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]
    const localCorners: [number, number][] = [
      [-halfW, -halfD],
      [halfW, -halfD],
      [halfW, halfD],
      [-halfW, halfD],
    ]

    const cosY = Math.cos(rotY)
    const sinY = Math.sin(rotY)

    // Rotate 3D world corners around +Y axis:
    // wx = posX + dx * cos(rotY) + dz * sin(rotY)
    // wz = posZ - dx * sin(rotY) + dz * cos(rotY)
    const worldCorners = localCorners.map(([dx, dz]) => [
      posX + dx * cosY + dz * sinY,
      posZ - dx * sinY + dz * cosY,
    ] as [number, number])

    // Project world coordinates (wx, wz) into SVG viewport space:
    // sx = offsetX + (wx - minX) * scale
    // sy = offsetY + (maxY - wz) * scale
    const projectedPoints = worldCorners.map(([wx, wz]) => [
      proj.offsetX + (wx - proj.minX) * proj.scale,
      proj.offsetY + (proj.maxY - wz) * proj.scale,
    ] as [number, number])

    const label = (node as { name?: string }).name

    results.push({
      id: node.id,
      type: node.type,
      points: projectedPoints,
      label,
      worldCorners,
      width: W,
      depth: D,
      rotation: rotY,
    })
  }

  return results
}
