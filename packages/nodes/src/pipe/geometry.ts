import { getWallCurveLength, isPipeNearlyVertical, samplePipeCenterline3D } from '@pascal-app/core'
import {
  CatmullRomCurve3,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three'
import type { PipeNode } from './schema'

function createPipeMaterial(color: string, opacity = 1) {
  return new MeshStandardMaterial({
    color,
    metalness: 0.45,
    roughness: 0.42,
    transparent: opacity < 1,
    opacity,
  })
}

function createInsulationMaterial(color: string) {
  return new MeshStandardMaterial({
    color,
    metalness: 0.05,
    roughness: 0.85,
    transparent: true,
    opacity: 0.72,
  })
}

function addInsulationShell(
  group: Group,
  node: PipeNode,
  innerRadius: number,
  buildInner: (outerRadius: number) => Mesh | null,
) {
  if (!node.insulated || node.insulationThickness <= 0) {
    const inner = buildInner(innerRadius)
    if (inner) group.add(inner)
    return
  }

  const outerRadius = innerRadius + node.insulationThickness
  const outer = buildInner(outerRadius)
  if (outer) {
    outer.material = createInsulationMaterial(node.color)
    group.add(outer)
  }

  const inner = buildInner(innerRadius)
  if (inner) group.add(inner)
}

function buildPipeMeshes(node: PipeNode, group: Group) {
  const samples = samplePipeCenterline3D(node, 32)
  if (samples.length < 2) return

  const points = samples.map((point) => new Vector3(point.x, point.y, point.z))
  const curve = new CatmullRomCurve3(points)
  const tubularSegments = Math.max(12, Math.ceil(getWallCurveLength(node) / 0.2))
  const radius = node.diameter / 2

  addInsulationShell(group, node, radius, (pipeRadius) => {
    const geometry = new TubeGeometry(curve, tubularSegments, pipeRadius, 16, false)
    const mesh = new Mesh(geometry, createPipeMaterial(node.color, node.opacity))
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  })

  if (!node.showHangers || node.hangerSpacing <= 0 || isPipeNearlyVertical(node)) return

  const length = getWallCurveLength(node)
  const hangerCount = Math.max(1, Math.floor(length / node.hangerSpacing))
  const hangerMaterial = createPipeMaterial('#8a9098', node.opacity)

  for (let index = 0; index <= hangerCount; index += 1) {
    const t = index / hangerCount
    const point = points[Math.min(points.length - 1, Math.round(t * (points.length - 1)))]!
    const hanger = new Mesh(
      new TorusGeometry(radius * 1.35, Math.max(radius * 0.06, 0.008), 8, 20),
      hangerMaterial,
    )
    hanger.position.copy(point)
    hanger.rotation.x = Math.PI / 2
    group.add(hanger)
  }
}

/** Tube along the tilted 3D centerline — rotate 0° horizontal, 90° vertical. */
export function buildPipeGeometry(node: PipeNode): Group {
  const group = new Group()
  buildPipeMeshes(node, group)
  return group
}
