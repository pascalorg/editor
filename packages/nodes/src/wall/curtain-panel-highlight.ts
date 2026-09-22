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
) {
  useEffect(() => {
    const host = sceneRegistry.nodes.get(wall.id) as Object3D | undefined
    if (!host) return
    const length = getWallCurveLength(wall)
    if (length <= 0) return
    const angle = Math.atan2(wall.end[1] - wall.start[1], wall.end[0] - wall.start[0])
    const cos = Math.cos(angle),
      sin = Math.sin(angle)
    const points: Vector3[] = []
    for (const y of [bottom, top]) {
      const edge: Vector3[] = []
      for (let i = 0; i <= 24; i++) {
        const frame = getWallCurveFrameAt(wall, (left + ((right - left) * i) / 24) / length)
        const offset = getWallThickness(wall) / 2 + 0.005
        const x = frame.point.x + frame.normal.x * offset - wall.start[0]
        const z = frame.point.y + frame.normal.y * offset - wall.start[1]
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
      const current = sceneRegistry.nodes.get(wall.id) as Object3D | undefined
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
  }, [wall, left, right, bottom, top])
}
