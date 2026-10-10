import { type AssetInput, type GuideNode, ItemNode, type LevelNode } from '../schema'
import { groupSymbolShapes, SYMBOL_PART_GAP, type SymbolGrouping } from './reference-openings'
import { imagePointToLevel, type ReferencePoint as Point } from './reference-transform'

/**
 * A symbol's footprint as an item frame: centre, the yaw of its first axis and
 * its extent along that axis (local X) and across it (local Z). Same convention
 * as items: local (dx, dz) → level (cx + dx·cos + dz·sin, cz − dx·sin + dz·cos).
 */
export type SymbolFrame = { center: Point; yaw: number; size: [number, number] }

// Within this share of the tightest box, the plan's own axes win: axis-aligned
// symbols stay square to the plan and round ones (tables) don't spin at random.
const PREFER_PLAN_AXES = 1.03

function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const cross = (o: Point, a: Point, b: Point) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Point[]) => {
    const hull: Point[] = []
    for (const p of list) {
      while (hull.length >= 2 && cross(hull.at(-2)!, hull.at(-1)!, p) <= 0) hull.pop()
      hull.push(p)
    }
    hull.pop()
    return hull
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

function frameAt(points: readonly Point[], yaw: number): SymbolFrame & { area: number } {
  const x: Point = [Math.cos(yaw), -Math.sin(yaw)],
    z: Point = [Math.sin(yaw), Math.cos(yaw)]
  let minX = Number.POSITIVE_INFINITY,
    maxX = Number.NEGATIVE_INFINITY,
    minZ = Number.POSITIVE_INFINITY,
    maxZ = Number.NEGATIVE_INFINITY
  for (const p of points) {
    const u = p[0] * x[0] + p[1] * x[1],
      v = p[0] * z[0] + p[1] * z[1]
    minX = Math.min(minX, u)
    maxX = Math.max(maxX, u)
    minZ = Math.min(minZ, v)
    maxZ = Math.max(maxZ, v)
  }
  const u = (minX + maxX) / 2,
    v = (minZ + maxZ) / 2
  const size: [number, number] = [maxX - minX, maxZ - minZ]
  return {
    center: [x[0] * u + z[0] * v, x[1] * u + z[1] * v],
    yaw,
    size,
    area: size[0] * size[1],
  }
}

/** Tightest box around a symbol (level metres), leaning to the plan's axes. */
export function symbolFrame(points: readonly Point[], planYaw: number): SymbolFrame {
  if (!points.length || points.some((p) => !p.every(Number.isFinite)))
    throw Error('Select the shapes of a furniture symbol.')
  const hull = convexHull(points)
  const plan = frameAt(hull, planYaw)
  let best = plan
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!,
      b = hull[(i + 1) % hull.length]!
    if (a[0] === b[0] && a[1] === b[1]) continue
    // Rotating calipers: the tightest box has a side along some hull edge.
    const candidate = frameAt(hull, Math.atan2(-(b[1] - a[1]), b[0] - a[0]))
    if (candidate.area < best.area) best = candidate
  }
  const { area: _, ...frame } = plan.area <= best.area * PREFER_PLAN_AXES ? plan : best
  return frame
}

/** Item yaw laying the asset's long side along the symbol's, plus user quarter turns. */
export function propYaw(frame: SymbolFrame, footprint: [number, number], quarterTurns = 0) {
  const assetLongAlongX = footprint[0] >= footprint[1],
    symbolLongAlongX = frame.size[0] >= frame.size[1]
  const turns = (assetLongAlongX === symbolLongAlongX ? 0 : 1) + quarterTurns
  const yaw = frame.yaw + (((turns % 4) + 4) % 4) * (Math.PI / 2)
  return Math.atan2(Math.sin(yaw), Math.cos(yaw))
}

/** How far an asset footprint is from a symbol's, in either orientation (0 = same size). */
export function propFitError(frame: SymbolFrame, footprint: [number, number]) {
  const [a, b] = frame.size,
    [w, d] = footprint
  const error = (x: number, y: number) => Math.abs(Math.log(Math.max(x, 1e-6) / Math.max(y, 1e-6)))
  return Math.min(error(w, a) + error(d, b), error(w, b) + error(d, a))
}

type PropArgs = {
  guide: GuideNode
  level: LevelNode
  /** Selected shapes, in plan image pixels. */
  shapes: { id: string; points: Point[]; stroke?: boolean }[]
  grouping?: SymbolGrouping
}

function planFrame(guide: GuideNode, level: LevelNode) {
  const ref = guide.metadata.planReference as
    | { width: number; height: number; assetId?: string; sourceUrl?: string }
    | undefined
  if (
    !ref ||
    !(Number(ref.width) > 0 && Number(ref.height) > 0) ||
    guide.parentId !== level.id ||
    level.metadata.placeholderSource
  )
    throw Error('Select a reference with image dimensions on an editable floor.')
  if (!(guide.scale > 0)) throw Error('Set a positive reference scale.')
  const image = { width: Number(ref.width), height: Number(ref.height) }
  return {
    ref,
    image,
    transform: {
      metersPerPixel: (guide.scale * 10) / image.width,
      rotation: guide.rotation[1],
      position: [guide.position[0], guide.position[2]] as Point,
    },
  }
}

/** One frame per symbol: touching shapes form a symbol unless grouping is `separate`. */
export function propSymbolFrames({ guide, level, shapes, grouping = 'touching' }: PropArgs) {
  if (!shapes.length || shapes.length > 512) throw Error('Select between 1 and 512 shapes.')
  const { image, transform } = planFrame(guide, level)
  return groupSymbolShapes(shapes, grouping, SYMBOL_PART_GAP / transform.metersPerPixel).map(
    (group) => ({
      outlineId: group.map((s) => s.id).join('+'),
      frame: symbolFrame(
        group.flatMap((s) => s.points.map((p) => imagePointToLevel(p, image, transform))),
        transform.rotation,
      ),
    }),
  )
}

/**
 * Catalog props standing in for plan symbols, one per symbol, at the asset's
 * real size. Items hang off the level at y = 0; the floor system lifts them.
 */
export function propPlacementNodes({
  asset,
  quarterTurns = 0,
  name,
  ...args
}: PropArgs & { asset: AssetInput; quarterTurns?: number; name: string }): ItemNode[] {
  const [width, , depth] = asset.dimensions ?? [1, 1, 1]
  if (!(width! > 0 && depth! > 0)) throw Error('This catalog item has no floor footprint.')
  const { ref } = planFrame(args.guide, args.level)
  const symbols = propSymbolFrames(args)
  return symbols.map(({ outlineId, frame }, i) =>
    ItemNode.parse({
      name: symbols.length === 1 ? name : `${name} ${i + 1}`,
      asset,
      position: [frame.center[0], 0, frame.center[1]],
      rotation: [0, propYaw(frame, [width!, depth!], quarterTurns), 0],
      scale: [1, 1, 1],
      parentId: args.level.id,
      metadata: {
        // Items don't follow guide edits (reference links move walls, slabs
        // and zones only), so the provenance is recorded unlinked.
        referenceOutline: {
          guideId: args.guide.id,
          linked: false,
          assetId: ref.assetId,
          outlineId,
          sourceUrl: ref.sourceUrl,
          conversion: 'svg-symbol',
          reviewRequired: true,
        },
      },
    }),
  )
}
