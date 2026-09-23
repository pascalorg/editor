import {
  type AnyNodeId,
  type FenceFeatureNode,
  fenceFeatureData,
  type GeometryContext,
  getFenceCenterlineFrameAt,
  getFenceCenterlineLength,
  getFenceGateLeaves,
} from '@pascal-app/core'
import type { ColorPreset, RenderShading } from '@pascal-app/viewer'
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three'
import { buildFenceGeometry } from '../fence/geometry'

export function buildFenceFeatureGeometry(
  node: FenceFeatureNode,
  ctx?: GeometryContext,
  shading: RenderShading = 'rendered',
  textures = true,
  colorPreset: ColorPreset = 'clay',
  sceneTheme?: string,
): Group {
  const host = ctx?.parent
  if (host?.type !== 'fence') return new Group()
  const group = buildFenceGeometry(
    { ...host, features: [fenceFeatureData(node)] },
    ctx,
    shading,
    textures,
    colorPreset,
    sceneTheme,
    'features',
  )
  const length = Math.max(getFenceCenterlineLength(host), 0.001)
  const feature = {
    ...fenceFeatureData(node),
    startT: (node.center - node.width / 2) / length,
    endT: (node.center + node.width / 2) / length,
    centerT: node.center / length,
  }
  const a = getFenceCenterlineFrameAt(host, feature.startT).point
  const b = getFenceCenterlineFrameAt(host, feature.endT).point
  const followsSurface = (host.path?.length ?? 0) >= 2 || Math.abs(host.curveOffset ?? 0) > 1e-4
  const selectedHost =
    host.surfaceMode === 'selected'
      ? ((host.supportSurfaceNodeId ?? host.supportSlabId) as AnyNodeId | undefined)
      : undefined
  const relativeHeight = (x: number, z: number) =>
    followsSurface && host.surfaceMode !== 'level'
      ? (ctx?.supportHeightAt?.(x, z, selectedHost) ?? 0) -
        (ctx?.supportHeightAt?.(...host.start, selectedHost) ?? 0)
      : 0
  const support = Math.max(relativeHeight(a.x, a.y), relativeHeight(b.x, b.y))
  const height =
    node.type === 'fence-gate'
      ? (node.height ??
        Math.max(0.3, host.height - (node.clearance ?? host.groundClearance) - 0.08))
      : host.height
  const bottom = node.type === 'fence-gate' ? (node.clearance ?? host.groundClearance) : 0
  const spans =
    node.type === 'fence-gate'
      ? getFenceGateLeaves(host, feature).map((leaf) => ({ a: leaf.hinge, b: leaf.end }))
      : [{ a, b }]
  for (const span of spans) {
    const pick = new Mesh(
      new BoxGeometry(
        Math.hypot(span.b.x - span.a.x, span.b.y - span.a.y),
        height,
        Math.max(host.thickness, 0.12),
      ),
      new MeshBasicMaterial({ visible: false, side: DoubleSide }),
    )
    pick.position.set(
      (span.a.x + span.b.x) / 2,
      support + bottom + height / 2,
      (span.a.y + span.b.y) / 2,
    )
    pick.rotation.y = -Math.atan2(span.b.y - span.a.y, span.b.x - span.a.x)
    pick.userData.pascalExport = 'strip'
    group.children[0]?.add(pick)
  }
  return group
}
