import {
  CubicBezierCurve3,
  CylinderGeometry,
  Group,
  LineCurve3,
  Mesh,
  type MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three'
import { INCHES_TO_METERS } from '../duct-segment/geometry'
import { createPipeMaterial } from '../pipe-segment/geometry'
import { addPlug, addProfile } from '../shared/accessory-geometry'
import { localPipeFittingPorts } from './ports'
import type { PipeFittingNode } from './schema'

const RADIAL_SEGMENTS = 28
const SWEEP_SEGMENTS = 32
const Y_AXIS = new Vector3(0, 1, 0)
const Z_AXIS = new Vector3(0, 0, 1)

type LocalPort = ReturnType<typeof localPipeFittingPorts>[number]

type SocketResult = {
  bodyPoint: Vector3
  bodyRadius: number
}

function pipeRadius(diameterInches: number): number {
  return (diameterInches * INCHES_TO_METERS) / 2
}

function addSocket(
  group: Group,
  port: LocalPort,
  material: MeshStandardMaterial,
  pipeMaterial: PipeFittingNode['pipeMaterial'],
): SocketResult {
  const radius = pipeRadius(port.diameter)
  const bodyRadius = radius * 1.08
  const socketRadius = radius * (pipeMaterial === 'cast-iron' ? 1.18 : 1.3)
  const portLength = port.position.length()
  const socketDepth = Math.min(portLength * 0.42, Math.max(0.022, radius * 1.05))
  const shoulderDepth = Math.min(portLength * 0.16, Math.max(0.006, radius * 0.32))
  const direction = port.direction.clone().normalize()
  const axisRotation = new Quaternion().setFromUnitVectors(Y_AXIS, direction)

  const socket = new Mesh(
    new CylinderGeometry(socketRadius, socketRadius, socketDepth, RADIAL_SEGMENTS, 1, true),
    material,
  )
  socket.name = `pipe-fitting-socket-${port.id}`
  socket.position.copy(port.position).addScaledVector(direction, -socketDepth / 2)
  socket.quaternion.copy(axisRotation)
  group.add(socket)

  const shoulder = new Mesh(
    new CylinderGeometry(socketRadius, bodyRadius, shoulderDepth, RADIAL_SEGMENTS, 1, true),
    material,
  )
  shoulder.name = `pipe-fitting-shoulder-${port.id}`
  shoulder.position
    .copy(port.position)
    .addScaledVector(direction, -(socketDepth + shoulderDepth / 2))
  shoulder.quaternion.copy(axisRotation)
  group.add(shoulder)

  const rim = new Mesh(new RingGeometry(radius * 0.82, socketRadius, RADIAL_SEGMENTS), material)
  rim.name = `pipe-fitting-rim-${port.id}`
  rim.position.copy(port.position).addScaledVector(direction, 0.0005)
  rim.quaternion.setFromUnitVectors(Z_AXIS, direction)
  group.add(rim)

  if (pipeMaterial === 'cast-iron') {
    for (const offset of [0.22, 0.72]) {
      const band = new Mesh(
        new CylinderGeometry(socketRadius * 1.035, socketRadius * 1.035, 0.006, RADIAL_SEGMENTS),
        material,
      )
      band.name = `pipe-fitting-band-${port.id}-${offset}`
      band.position.copy(port.position).addScaledVector(direction, -socketDepth * offset)
      band.quaternion.copy(axisRotation)
      group.add(band)
    }
  } else {
    const stopRing = new Mesh(
      new CylinderGeometry(socketRadius * 1.035, socketRadius * 1.035, 0.006, RADIAL_SEGMENTS),
      material,
    )
    stopRing.name = `pipe-fitting-stop-${port.id}`
    stopRing.position.copy(port.position).addScaledVector(direction, -socketDepth * 0.88)
    stopRing.quaternion.copy(axisRotation)
    group.add(stopRing)
  }

  return {
    bodyPoint: port.position.clone().addScaledVector(direction, -(socketDepth + shoulderDepth)),
    bodyRadius,
  }
}

function addStraight(
  group: Group,
  start: Vector3,
  end: Vector3,
  radius: number,
  material: MeshStandardMaterial,
  name: string,
) {
  if (start.distanceToSquared(end) < 1e-8) return
  const body = new Mesh(
    new TubeGeometry(new LineCurve3(start, end), 1, radius, RADIAL_SEGMENTS, false),
    material,
  )
  body.name = name
  group.add(body)
}

function addSweep(
  group: Group,
  start: Vector3,
  startTangent: Vector3,
  end: Vector3,
  endTangent: Vector3,
  radius: number,
  material: MeshStandardMaterial,
  name: string,
) {
  const distance = start.distanceTo(end)
  if (distance < 1e-5) return
  const handle = Math.max(distance * 0.48, radius * 1.6)
  const curve = new CubicBezierCurve3(
    start,
    start.clone().addScaledVector(startTangent.clone().normalize(), handle),
    end.clone().addScaledVector(endTangent.clone().normalize(), -handle),
    end,
  )
  const body = new Mesh(
    new TubeGeometry(curve, SWEEP_SEGMENTS, radius, RADIAL_SEGMENTS, false),
    material,
  )
  body.name = name
  group.add(body)
}

function addJunctionBlend(
  group: Group,
  position: Vector3,
  radius: number,
  material: MeshStandardMaterial,
  name: string,
) {
  const blend = new Mesh(new SphereGeometry(radius * 1.03, RADIAL_SEGMENTS, 18), material)
  blend.name = name
  blend.position.copy(position)
  group.add(blend)
}

function buildElbow(
  group: Group,
  ports: LocalPort[],
  sockets: Map<string, SocketResult>,
  material: MeshStandardMaterial,
) {
  const inlet = ports.find((port) => port.id === 'inlet')
  const outlet = ports.find((port) => port.id === 'outlet')
  if (!(inlet && outlet)) return
  const inletSocket = sockets.get(inlet.id)
  const outletSocket = sockets.get(outlet.id)
  if (!(inletSocket && outletSocket)) return
  addSweep(
    group,
    inletSocket.bodyPoint,
    inlet.direction.clone().negate(),
    outletSocket.bodyPoint,
    outlet.direction,
    inletSocket.bodyRadius,
    material,
    'pipe-fitting-elbow-sweep',
  )
}

function buildBranchFitting(
  group: Group,
  node: PipeFittingNode,
  ports: LocalPort[],
  sockets: Map<string, SocketResult>,
  material: MeshStandardMaterial,
) {
  const inlet = ports.find((port) => port.id === 'inlet')
  const outlet = ports.find((port) => port.id === 'outlet')
  const inletSocket = inlet ? sockets.get(inlet.id) : null
  const outletSocket = outlet ? sockets.get(outlet.id) : null
  if (!(inlet && outlet && inletSocket && outletSocket)) return

  addStraight(
    group,
    inletSocket.bodyPoint,
    outletSocket.bodyPoint,
    inletSocket.bodyRadius,
    material,
    `pipe-fitting-${node.fittingType}-run`,
  )

  const runSpan = inletSocket.bodyPoint.distanceTo(outletSocket.bodyPoint)
  const merge = new Vector3(runSpan * 0.1, 0, 0)
  for (const branchId of node.fittingType === 'cross' ? ['branch', 'branch2'] : ['branch']) {
    const branch = ports.find((port) => port.id === branchId)
    const branchSocket = branch ? sockets.get(branch.id) : null
    if (!(branch && branchSocket)) continue
    addSweep(
      group,
      branchSocket.bodyPoint,
      branch.direction.clone().negate(),
      merge,
      new Vector3(1, 0, 0),
      branchSocket.bodyRadius,
      material,
      `pipe-fitting-${node.fittingType}-${branchId}-sweep`,
    )
  }
  addJunctionBlend(
    group,
    merge,
    Math.max(inletSocket.bodyRadius, pipeRadius(node.diameter2) * 1.08),
    material,
    `pipe-fitting-${node.fittingType}-blend`,
  )
}

/**
 * Pure local-frame DWV fitting geometry. Ports remain the network contract;
 * the model grows inward from each collar so replacing the old primitives does
 * not move any connected pipe endpoint.
 */
export function buildPipeFittingGeometry(node: PipeFittingNode): Group {
  const group = new Group()
  const material = createPipeMaterial(node)
  const ports = localPipeFittingPorts(node)
  const sockets = new Map<string, SocketResult>()

  for (const port of ports) {
    sockets.set(port.id, addSocket(group, port, material, node.pipeMaterial))
  }

  if (
    node.fittingType === 'end-cap' ||
    node.fittingType === 'cleanout' ||
    node.fittingType === 'coupling' ||
    node.fittingType === 'reducer'
  ) {
    const inlet = sockets.get('inlet')!
    const outlet = sockets.get('outlet')
    const radius = inlet.bodyRadius
    if (node.fittingType === 'reducer' && outlet) {
      const taper = new Mesh(
        new CylinderGeometry(
          outlet.bodyRadius,
          radius,
          outlet.bodyPoint.x - inlet.bodyPoint.x,
          RADIAL_SEGMENTS,
          1,
          true,
        ),
        material,
      )
      taper.name = 'pipe-reducer-taper'
      taper.quaternion.setFromUnitVectors(Y_AXIS, new Vector3(1, 0, 0))
      taper.position.x = (outlet.bodyPoint.x + inlet.bodyPoint.x) / 2
      group.add(taper)
    } else {
      const end = outlet?.bodyPoint.x ?? 0.025
      addProfile(
        group,
        'pipe-accessory-body',
        'round',
        radius * 2,
        radius * 2,
        inlet.bodyPoint.x,
        end,
        material,
        radius * 0.16,
      )
      if (node.fittingType === 'end-cap')
        addProfile(
          group,
          'pipe-end-cap-closure',
          'round',
          radius * 2,
          radius * 2,
          end - 0.004,
          end,
          material,
        )
      if (node.fittingType === 'cleanout') {
        if (outlet) {
          const service = new Group()
          service.name = 'cleanout-service-branch'
          addProfile(
            service,
            'cleanout-neck',
            'round',
            radius * 2,
            radius * 2,
            0,
            radius * 2,
            material,
            radius * 0.16,
          )
          addPlug(service, radius, radius * 2, material)
          service.rotation.z = Math.PI / 2
          group.add(service)
        } else addPlug(group, radius, end, material)
      }
    }
  } else if (node.fittingType === 'elbow') buildElbow(group, ports, sockets, material)
  else buildBranchFitting(group, node, ports, sockets, material)

  return group
}
