import {
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallThickness,
  sceneRegistry,
  type WallNode,
} from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { useEffect } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Vector3,
} from 'three'

export function useCurtainPanelHighlight(
  wall: WallNode,
  left: number,
  right: number,
  bottom: number,
  top: number,
  enabled: boolean,
) {
  const wallId = wall.id
  const startX = wall.start[0]
  const startZ = wall.start[1]
  const endX = wall.end[0]
  const endZ = wall.end[1]
  const curveOffset = wall.curveOffset
  const thickness = getWallThickness(wall)

  useEffect(() => {
    if (!enabled) return
    const curveWall: Pick<WallNode, 'start' | 'end' | 'curveOffset'> = {
      start: [startX, startZ],
      end: [endX, endZ],
      curveOffset,
    }
    const host = sceneRegistry.nodes.get(wallId) as Object3D | undefined
    if (!host) return
    const length = getWallCurveLength(curveWall)
    if (length <= 0) return
    const angle = Math.atan2(endZ - startZ, endX - startX)
    const cos = Math.cos(angle),
      sin = Math.sin(angle)
    const points: Vector3[] = []
    for (const y of [bottom, top]) {
      const edge: Vector3[] = []
      for (let i = 0; i <= 24; i++) {
        const frame = getWallCurveFrameAt(curveWall, (left + ((right - left) * i) / 24) / length)
        const offset = thickness / 2 + 0.005
        const x = frame.point.x + frame.normal.x * offset - startX
        const z = frame.point.y + frame.normal.y * offset - startZ
        edge.push(new Vector3(x * cos + z * sin, y, -x * sin + z * cos))
      }
      points.push(...(y === bottom ? edge : edge.reverse()))
    }
    points.push(points[0]!.clone())
    const geometry = new BufferGeometry().setFromPoints(points)
    const material = new LineBasicMaterial({
      color: '#fb923c',
      depthTest: false,
      depthWrite: false,
    })
    const outline = new Line(geometry, material)
    outline.layers.set(EDITOR_LAYER)
    outline.raycast = () => {}
    const vertices: number[] = []
    for (let i = 0; i < 24; i++) {
      for (const index of [i, i + 1, 49 - i, i + 1, 48 - i, 49 - i]) {
        vertices.push(...points[index]!.toArray())
      }
    }
    const fillGeometry = new BufferGeometry()
    fillGeometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    const fillMaterial = new MeshBasicMaterial({
      color: '#fb923c',
      transparent: true,
      opacity: 0.6,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
    const fill = new Mesh(fillGeometry, fillMaterial)
    fill.layers.set(EDITOR_LAYER)
    fill.raycast = () => {}
    let scene = host
    while (scene.parent) scene = scene.parent
    outline.matrixAutoUpdate = false
    fill.matrixAutoUpdate = false
    scene.add(outline, fill)
    let frameId = 0
    const sync = () => {
      const current = sceneRegistry.nodes.get(wallId) as Object3D | undefined
      outline.visible = fill.visible = Boolean(current?.visible)
      if (current) {
        current.updateWorldMatrix(true, false)
        outline.matrix.copy(current.matrixWorld)
        fill.matrix.copy(current.matrixWorld)
        outline.matrixWorld.copy(current.matrixWorld)
        fill.matrixWorld.copy(current.matrixWorld)
      }
      frameId = requestAnimationFrame(sync)
    }
    sync()
    return () => {
      cancelAnimationFrame(frameId)
      outline.removeFromParent()
      fill.removeFromParent()
      fillGeometry.dispose()
      fillMaterial.dispose()
      geometry.dispose()
      material.dispose()
    }
  }, [
    enabled,
    wallId,
    startX,
    startZ,
    endX,
    endZ,
    curveOffset,
    thickness,
    left,
    right,
    bottom,
    top,
  ])
}
