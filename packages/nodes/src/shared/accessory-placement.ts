import type { AnyNode, AnyNodeId, DuctFittingNode, PipeFittingNode } from '@pascal-app/core'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { adapterShape } from '../duct-fitting/ports'
import { rectSectionAxes } from '../duct-segment/geometry'
import type { ScenePort } from './ports'
import { reducerOutletDiameter } from './reducer-size'

export function inheritFittingProfile<T extends DuctFittingNode | PipeFittingNode>(
  node: T,
  port: ScenePort,
  nodes: Record<AnyNodeId, AnyNode>,
): T {
  const host = nodes[port.nodeId]
  if (node.type === 'duct-fitting') {
    const branch = port.id.startsWith('branch')
    const shape = port.shape ?? (host?.type === 'duct-segment' ? host.shape : undefined)
    const width = port.width ?? (host?.type === 'duct-segment' ? host.width : undefined)
    const height = port.height ?? (host?.type === 'duct-segment' ? host.height : undefined)
    const transitionOutlet: Partial<DuctFittingNode> = {}
    if (node.fittingType === 'transition' && shape === adapterShape(node, true)) {
      const inletShape = adapterShape(node)
      transitionOutlet.outletShape =
        inletShape !== shape ? inletShape : shape === 'round' ? 'rect' : 'round'
      transitionOutlet.diameter2 = node.diameter
      transitionOutlet.width2 = node.width
      transitionOutlet.height2 = node.height
    }
    return {
      ...node,
      ...transitionOutlet,
      diameter: Math.min(48, Math.max(2, port.diameter)),
      ...(node.fittingType === 'reducer'
        ? {
            diameter2: reducerOutletDiameter(
              node.type,
              Math.min(48, Math.max(2, port.diameter)),
              node.diameter2,
            ),
          }
        : {}),
      system: port.system === 'return' ? 'return' : 'supply',
      ...(shape
        ? {
            shape,
            ...(['reducer', 'transition'].includes(node.fittingType) ? { inletShape: shape } : {}),
          }
        : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(host?.type === 'duct-fitting' && !shape
        ? {
            shape: branch ? host.shape2 : host.shape,
            width: branch ? host.width2 : host.width,
            height: branch ? host.height2 : host.height,
          }
        : {}),
    }
  }
  return {
    ...node,
    diameter: port.diameter,
    ...(node.fittingType === 'reducer'
      ? { diameter2: reducerOutletDiameter(node.type, port.diameter, node.diameter2) }
      : {}),
    system: port.system === 'vent' ? 'vent' : 'waste',
    ...(host?.type === 'pipe-segment' || host?.type === 'pipe-fitting'
      ? { pipeMaterial: host.pipeMaterial }
      : {}),
  }
}

export function placeAccessPanel(
  raw: [number, number, number],
  node: DuctFittingNode,
  nodes: Record<AnyNodeId, AnyNode>,
  levelId: AnyNodeId | null,
  in3D: boolean,
  gridStep: number,
): { position: [number, number, number]; rotation: [number, number, number] } | null {
  let best: ReturnType<typeof placeAccessPanel> = null
  let distance = 0.65
  const cursor = new Vector3(...raw)
  for (const host of Object.values(nodes)) {
    if (host.type !== 'duct-segment' || host.parentId !== levelId || !host.visible) continue
    for (let i = 0; i < host.path.length - 1; i++) {
      const a = new Vector3(...host.path[i]!)
      const delta = new Vector3(...host.path[i + 1]!).sub(a)
      const length = delta.length()
      if (length < node.panelWidth + 0.04) continue
      const tangent = delta.clone().normalize()
      const planar = new Vector3(delta.x, 0, delta.z)
      if (!in3D && planar.lengthSq() < 1e-9) continue
      let t = in3D
        ? cursor.clone().sub(a).dot(delta) / delta.lengthSq()
        : cursor.clone().sub(a).dot(planar) / planar.lengthSq()
      if (gridStep > 0) t = (Math.round((t * length) / gridStep) * gridStep) / length
      const pad = (node.panelWidth / 2 + 0.02) / length
      t = Math.max(pad, Math.min(1 - pad, t))
      const center = a.clone().addScaledVector(delta, t)
      const up = rectSectionAxes(tangent, host.roll).height
      const side = new Vector3().crossVectors(tangent, up).normalize()
      const offset = cursor.clone().sub(center)
      let normal = side.clone().multiplyScalar(offset.dot(side) >= 0 ? 1 : -1)
      let extent = ((host.shape === 'round' ? host.diameter : host.width) * 0.0254) / 2
      let faceHeight = (host.shape === 'round' ? host.diameter : host.height) * 0.0254
      if (in3D && Math.abs(offset.dot(up)) > Math.abs(offset.dot(side))) {
        normal = up.clone().multiplyScalar(offset.dot(up) >= 0 ? 1 : -1)
        extent = ((host.shape === 'round' ? host.diameter : host.height) * 0.0254) / 2
        faceHeight = (host.shape === 'round' ? host.diameter : host.width) * 0.0254
      }
      if (node.panelHeight + 0.04 > faceHeight) continue
      const position = center.addScaledVector(normal, extent + 0.001)
      const d = in3D
        ? cursor.distanceTo(position)
        : Math.hypot(cursor.x - position.x, cursor.z - position.z)
      if (d >= distance) continue
      distance = d
      const vertical = new Vector3().crossVectors(normal, tangent).normalize()
      const euler = new Euler().setFromRotationMatrix(
        new Matrix4().makeBasis(tangent, vertical, normal),
      )
      best = { position: position.toArray(), rotation: [euler.x, euler.y, euler.z] }
    }
  }
  return best
}

export function accessoryMateQuaternion(
  node: DuctFittingNode,
  port: ScenePort,
  nodes: Record<AnyNodeId, AnyNode>,
): Quaternion {
  const direction = new Vector3(...port.direction).normalize()
  const host = nodes[port.nodeId]
  if (
    host?.type === 'duct-segment' &&
    node.shape !== 'round' &&
    ['end-cap', 'damper', 'coupling', 'reducer', 'transition'].includes(node.fittingType)
  ) {
    const index = port.id === 'start' ? 0 : host.path.length - 2
    const a = host.path[index]!
    const b = host.path[index + 1]!
    const { width } = rectSectionAxes(new Vector3(...b).sub(new Vector3(...a)), host.roll)
    const height = new Vector3().crossVectors(width, direction).normalize()
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(direction, height, width))
  }
  return new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), direction)
}
