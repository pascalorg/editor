import type { AnyNode, AnyNodeId } from '../schema/types'

export const SCENE_IMAGE_FIELD = 'source.images'

type NodeRecord = Record<string, unknown>
const sourceOf = (node: NodeRecord): NodeRecord | undefined =>
  node.source && typeof node.source === 'object' ? (node.source as NodeRecord) : undefined

export function readSceneNodeField(node: NodeRecord, field: string): unknown {
  if (field === SCENE_IMAGE_FIELD) {
    const source = sourceOf(node)
    return source?.kind === 'script' ? source.images : undefined
  }
  if (field === 'source') {
    const source = sourceOf(node)
    if (source?.kind !== 'script') return node.source
    const { images: _images, ...authored } = source
    return authored
  }
  return node[field]
}

const imagesOfBuild = (images: unknown, artifact: unknown) =>
  images && typeof images === 'object' && (images as NodeRecord).artifact === artifact
    ? images
    : undefined

/**
 * The one rule for images a write or an undo brings along: a node keeps only images
 * of the GLB it shows, its live ones first, else those history carries.
 */
const imagesForBuild = (artifact: unknown, live: unknown, carried: unknown) =>
  imagesOfBuild(live, artifact) ?? imagesOfBuild(carried, artifact)

/** Annotation writes are refused off their build; authored source writes follow `imagesForBuild`. */
export function writeSceneNodeField(
  node: NodeRecord,
  field: string,
  value: unknown,
  present: boolean,
): NodeRecord | null {
  const next = { ...node }
  if (field === SCENE_IMAGE_FIELD) {
    const source = sourceOf(node)
    if (source?.kind !== 'script') return null
    if (!present) {
      const images = source.images as NodeRecord | undefined
      if (images && images.artifact !== source.artifact) return null
      const { images: _images, ...authored } = source
      next.source = authored
      return next
    }
    if (!value || typeof value !== 'object' || (value as NodeRecord).artifact !== source.artifact)
      return null
    next.source = { ...source, images: value }
  } else if (
    field === 'source' &&
    present &&
    value &&
    typeof value === 'object' &&
    (value as NodeRecord).kind === 'script'
  ) {
    const { images: carried, ...authored } = value as NodeRecord
    const images = imagesForBuild(
      authored.artifact,
      readSceneNodeField(node, SCENE_IMAGE_FIELD),
      carried,
    )
    next.source = { ...authored, ...(images ? { images } : {}) }
  } else if (present) next[field] = value
  else delete next[field]
  return next
}

export function withoutSceneNodeAnnotations<T extends NodeRecord>(node: T): T {
  return readSceneNodeField(node, SCENE_IMAGE_FIELD) === undefined
    ? node
    : { ...node, source: readSceneNodeField(node, 'source') }
}

/** A node as history may restore it: images of another build are dropped. */
export function withSceneNodeBuildImages<T extends NodeRecord>(node: T): T {
  const images = readSceneNodeField(node, SCENE_IMAGE_FIELD)
  return images === undefined || imagesForBuild(sourceOf(node)?.artifact, undefined, images)
    ? node
    : withoutSceneNodeAnnotations(node)
}

const annotationFreeNodes = new WeakMap<object, Record<AnyNodeId, AnyNode>>()

/** A change to derived images alone is never an undo step. */
export function withoutSceneAnnotations(nodes: Record<AnyNodeId, AnyNode>) {
  const cached = annotationFreeNodes.get(nodes)
  if (cached) return cached
  let result = nodes
  for (const [id, node] of Object.entries(nodes)) {
    if (readSceneNodeField(node as NodeRecord, SCENE_IMAGE_FIELD) === undefined) continue
    if (result === nodes) result = { ...nodes }
    result[id as AnyNodeId] = withoutSceneNodeAnnotations(node as NodeRecord) as AnyNode
  }
  annotationFreeNodes.set(nodes, result)
  return result
}

/** Undo and redo land each node with `imagesForBuild` of its live and snapshot images. */
export function retainSceneAnnotations(
  before: Record<AnyNodeId, AnyNode>,
  after: Record<AnyNodeId, AnyNode>,
) {
  let nodes = after
  for (const [id, node] of Object.entries(after)) {
    const previous = before[id as AnyNodeId]
    if (previous === node) continue
    const own = readSceneNodeField(node as NodeRecord, SCENE_IMAGE_FIELD)
    const kept = imagesForBuild(
      sourceOf(node as NodeRecord)?.artifact,
      previous && readSceneNodeField(previous as NodeRecord, SCENE_IMAGE_FIELD),
      own,
    )
    if (kept === own) continue
    const restored = kept
      ? writeSceneNodeField(node as NodeRecord, SCENE_IMAGE_FIELD, kept, true)
      : withoutSceneNodeAnnotations(node as NodeRecord)
    if (nodes === after) nodes = { ...after }
    nodes[id as AnyNodeId] = restored as AnyNode
  }
  return nodes
}
