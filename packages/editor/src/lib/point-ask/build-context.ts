import type {
  AnyNode,
  LevelNode,
  PointCamera,
  PointContext,
  PointTarget as PointContextTarget,
} from '@pascal-app/core'
import { sceneViewBounds } from '@pascal-app/core/agent-operations'
import { describeTarget } from './describe-target'

// What the agent receives when the person points (point-and-ask-spec.md section 5): ids first, in
// metres, from the camera the person saw. The words stay the person's; this is metadata.

export type BuildPointContextInput = {
  /** The pin, the chat chip and the turn share it. */
  askId: string
  /** The moment of pointing (pointer-down); now when absent. */
  capturedAt?: Date | string
  gesture: PointContext['gesture']
  nodes: Readonly<Record<string, AnyNode>>
  /** The level in view. */
  levelId: string
  /** What the finger is on, each by id, with where it landed. */
  targets: { id: string; hit?: PointContextTarget['hit'] }[]
  camera: PointCamera
  inRegion?: PointContext['inRegion']
  region?: PointContext['region']
  image?: PointContext['image']
  suggestion?: string
}

type Box = PointContextTarget['box']

/** The element's box as view_scene frames it; a point at its position when that cannot say. */
function boxOf(nodes: Readonly<Record<string, AnyNode>>, node: AnyNode): Box {
  try {
    return sceneViewBounds(nodes, node.id)
  } catch {
    const at = (node as { position?: number[] }).position ?? [0, 0, 0]
    const point: [number, number, number] = [at[0] ?? 0, at[1] ?? 0, at[2] ?? 0]
    return { min: point, max: point }
  }
}

export function buildPointContext(input: BuildPointContextInput): PointContext {
  const { nodes } = input
  const level = nodes[input.levelId] as LevelNode | undefined
  const camera: PointCamera = {
    position: input.camera.position,
    target: input.camera.target,
    fov: input.camera.fov,
    aspect: input.camera.aspect,
    projection: input.camera.projection,
    ...(input.camera.projection === 'orthographic' && input.camera.viewWidth !== undefined
      ? { viewWidth: input.camera.viewWidth }
      : {}),
  }

  const targets: PointContextTarget[] = []
  for (const { id, hit } of input.targets) {
    const node = nodes[id]
    // An element deleted between the pointing and the send is not a target any more.
    if (!node) continue
    const described = describeTarget(node, nodes, { unit: 'metric' })
    targets.push({
      id: node.id,
      type: node.type,
      name: described.name,
      levelId: described.levelId,
      ...(described.zoneId ? { zoneId: described.zoneId } : {}),
      ...(described.parentId ? { parentId: described.parentId } : {}),
      ...(hit ? { hit } : {}),
      box: boxOf(nodes, node),
      size: described.sizes,
    })
  }

  const capturedAt = input.capturedAt ?? new Date()
  return {
    kind: 'scene-point',
    version: 1,
    askId: input.askId,
    capturedAt: typeof capturedAt === 'string' ? capturedAt : capturedAt.toISOString(),
    source: 'editor',
    gesture: input.gesture,
    level: { id: input.levelId, name: level?.name?.trim() || `Level ${level?.level ?? 0}` },
    targets,
    camera,
    ...(input.inRegion ? { inRegion: input.inRegion } : {}),
    ...(input.region ? { region: input.region } : {}),
    ...(input.image ? { image: input.image } : {}),
    ...(input.suggestion ? { suggestion: input.suggestion } : {}),
  }
}
