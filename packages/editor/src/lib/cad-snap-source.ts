import {
  type AlignmentAnchor,
  type AnyNodeId,
  type CadUnderlayNode,
  useScene,
} from '@pascal-app/core'
import {
  buildCadSnapIndex,
  type CadSnapIndex,
  type CadSnapRadii,
  type CadSnapResult,
  findCadSnap,
} from './cad-snap-index'
import { getCadUnderlay } from './cad-underlay-cache'
import { resolveCadLayers } from './cad-underlay-layers'

/**
 * Snap indexes for the CAD underlays on a level, built on demand and reused
 * until something they depend on changes.
 *
 * Tools query this from pointer handlers, so it has to be cheap per call and
 * cannot be a React hook. Building an index for a real drawing means
 * transforming and bucketing a hundred thousand segments — far too much to
 * repeat per pointer move — so each underlay's index is cached behind a
 * signature covering everything that would change its contents: the asset, the
 * placement, and which layers are visible.
 */
type Entry = {
  signature: string
  index: CadSnapIndex
}

const entries = new Map<string, Entry>()

function signatureOf(node: CadUnderlayNode): string {
  return [
    node.url,
    node.scale,
    node.rotation[1],
    node.position[0],
    node.position[2],
    node.visible === false ? '0' : '1',
    JSON.stringify(node.layers),
  ].join('|')
}

function indexFor(node: CadUnderlayNode): CadSnapIndex | null {
  const loaded = getCadUnderlay(node.url)
  if (!loaded) return null

  const signature = signatureOf(node)
  const cached = entries.get(node.id)
  if (cached?.signature === signature) return cached.index

  // Exactly the layers the two views draw. Resolving this separately here
  // would let the snap pool drift from what is on screen, and snapping to an
  // invisible line is indistinguishable from a bug.
  const visible = resolveCadLayers(node, loaded)
  const visibleLayers = new Array<boolean>(loaded.underlay.layers.length).fill(false)
  for (const layer of visible) visibleLayers[layer.index] = true

  const index = buildCadSnapIndex({
    segments: loaded.underlay.segments,
    segmentLayers: loaded.underlay.segmentLayers,
    visibleLayers,
    placement: {
      scale: node.scale,
      rotation: node.rotation[1],
      position: [node.position[0], node.position[2]],
    },
  })

  entries.set(node.id, { signature, index })
  return index
}

/** Forget a node's index — call when its underlay is deleted or re-imported. */
export function releaseCadSnapIndex(nodeId: string): void {
  entries.delete(nodeId)
}

function underlaysOnLevel(levelId: string): CadUnderlayNode[] {
  const nodes = useScene.getState().nodes
  const found: CadUnderlayNode[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'cad-underlay') continue
    if (node.parentId !== levelId) continue
    // A hidden underlay is not there as far as the user is concerned, so it
    // must not pull the cursor either.
    if (node.visible === false) continue
    found.push(node as CadUnderlayNode)
  }
  return found
}

/**
 * Nearest CAD underlay feature to a plan point on a level, or null when the
 * level carries no underlay or nothing is in range.
 *
 * Returns level-local metres, ready to be used as a draft point.
 */
export function findCadSnapOnLevel(
  levelId: string | null | undefined,
  point: readonly [number, number],
  radii?: CadSnapRadii,
): CadSnapResult | null {
  if (!levelId) return null

  let best: CadSnapResult | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const node of underlaysOnLevel(levelId)) {
    const index = indexFor(node)
    if (!index) continue
    const hit = findCadSnap(index, point, radii)
    if (!hit) continue

    const distance = (hit.point[0] - point[0]) ** 2 + (hit.point[1] - point[1]) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = hit
    }
  }

  return best
}

/**
 * How far around the cursor underlay corners are offered as alignment anchors.
 *
 * Alignment guides are axis-aligned lines and in principle reach across the
 * whole plan, but a real drawing carries hundreds of thousands of corners and
 * the alignment resolver is linear in its candidates. A local window keeps the
 * per-pointer-move cost flat; the cost is that you cannot align to a corner
 * far off screen, which is not something anyone aims for anyway.
 *
 * These numbers are measured, not guessed. On the 146k-segment drawing we
 * test against, a 4 m / 120-anchor window cost 531 µs per pointer move — three
 * times the snap query itself, for a convenience feature. At 2 m / 64 it costs
 * 231 µs, on par with the snap, and still returns ~40 anchors: plenty to align
 * against something you can actually see.
 */
const CAD_ALIGNMENT_RADIUS_M = 2
const CAD_ALIGNMENT_MAX_ANCHORS = 64

/**
 * Underlay corners near a point, shaped as alignment anchors.
 *
 * Kept out of `collectAlignmentAnchors` in core: that walks the scene graph,
 * and underlay geometry deliberately is not in it. Callers merge these in on
 * the editor side, which is also what keeps core free of any CAD concept.
 */
export function collectCadAlignmentAnchors(
  levelId: string | null | undefined,
  point: readonly [number, number],
  radius = CAD_ALIGNMENT_RADIUS_M,
  max = CAD_ALIGNMENT_MAX_ANCHORS,
): AlignmentAnchor[] {
  if (!levelId) return []

  const anchors: AlignmentAnchor[] = []
  for (const node of underlaysOnLevel(levelId)) {
    const index = indexFor(node)
    if (!index) continue
    for (const [x, z] of index.endpointsWithin(point[0], point[1], radius, max - anchors.length)) {
      anchors.push({ nodeId: node.id, kind: 'corner', x, z })
    }
    if (anchors.length >= max) break
  }
  return anchors
}

/** True when the level has at least one visible underlay worth querying. */
export function hasCadUnderlay(levelId: string | null | undefined): boolean {
  return !!levelId && underlaysOnLevel(levelId).length > 0
}

/** Level a node belongs to, for tools that only hold a node id. */
export function resolveLevelIdForNode(nodeId: AnyNodeId): string | null {
  const nodes = useScene.getState().nodes
  let current = nodes[nodeId]
  while (current) {
    if (current.type === 'level') return current.id
    current = current.parentId ? nodes[current.parentId as AnyNodeId] : undefined
  }
  return null
}
