import {
  emitter,
  type FenceNode,
  type GridEvent,
  type LevelNode,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { DoubleSide, type Group, type Mesh, Shape, ShapeGeometry, Vector3 } from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sfxEmitter } from '../../../lib/sfx-bus'
import { CursorSphere } from '../shared/cursor-sphere'
import {
  createFenceOnCurrentLevel,
  snapFenceDraftPoint,
  type FencePlanPoint,
} from './fence-drafting'

const FENCE_PREVIEW_HEIGHT = 1.8

const updateFencePreview = (mesh: Mesh, start: Vector3, end: Vector3) => {
  const direction = new Vector3(end.x - start.x, 0, end.z - start.z)
  const length = direction.length()

  if (length < 0.01) {
    mesh.visible = false
    return
  }

  mesh.visible = true
  direction.normalize()

  const shape = new Shape()
  shape.moveTo(0, 0)
  shape.lineTo(length, 0)
  shape.lineTo(length, FENCE_PREVIEW_HEIGHT)
  shape.lineTo(0, FENCE_PREVIEW_HEIGHT)
  shape.closePath()

  const geometry = new ShapeGeometry(shape)
  const angle = -Math.atan2(direction.z, direction.x)

  mesh.position.set(start.x, start.y, start.z)
  mesh.rotation.y = angle

  if (mesh.geometry) {
    mesh.geometry.dispose()
  }
  mesh.geometry = geometry
}

const getCurrentLevelElements = (): { walls: WallNode[]; fences: FenceNode[] } => {
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()

  if (!currentLevelId) return { walls: [], fences: [] }

  const levelNode = nodes[currentLevelId]
  if (!levelNode || levelNode.type !== 'level') return { walls: [], fences: [] }

  const children = (levelNode as LevelNode).children.map((childId) => nodes[childId])

  return {
    walls: children.filter((node): node is WallNode => node?.type === 'wall'),
    fences: children.filter((node): node is FenceNode => node?.type === 'fence'),
  }
}

export const FenceTool: React.FC = () => {
  const cursorRef = useRef<Group>(null)
  const previewRef = useRef<Mesh>(null!)
  const startingPoint = useRef(new Vector3(0, 0, 0))
  const endingPoint = useRef(new Vector3(0, 0, 0))
  const buildingState = useRef(0)
  const shiftPressed = useRef(false)

  useEffect(() => {
    let previousFenceEnd: [number, number] | null = null

    const onGridMove = (event: GridEvent) => {
      if (!(cursorRef.current && previewRef.current)) return

      const { walls, fences } = getCurrentLevelElements()
      const localPoint: FencePlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 1) {
        const snappedLocal = snapFenceDraftPoint({
          point: localPoint,
          walls,
          fences,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        endingPoint.current.set(snappedLocal[0], event.localPosition[1], snappedLocal[1])
        cursorRef.current.position.copy(endingPoint.current)

        const currentFenceEnd: [number, number] = [snappedLocal[0], snappedLocal[1]]
        if (
          previousFenceEnd &&
          (currentFenceEnd[0] !== previousFenceEnd[0] || currentFenceEnd[1] !== previousFenceEnd[1])
        ) {
          sfxEmitter.emit('sfx:grid-snap')
        }
        previousFenceEnd = currentFenceEnd

        updateFencePreview(previewRef.current, startingPoint.current, endingPoint.current)
      } else {
        const snappedPoint = snapFenceDraftPoint({ point: localPoint, walls, fences })
        cursorRef.current.position.set(snappedPoint[0], event.localPosition[1], snappedPoint[1])
      }
    }

    const onGridClick = (event: GridEvent) => {
      const { walls, fences } = getCurrentLevelElements()
      const localClick: FencePlanPoint = [event.localPosition[0], event.localPosition[2]]

      if (buildingState.current === 0) {
        const snappedStart = snapFenceDraftPoint({ point: localClick, walls, fences })
        startingPoint.current.set(snappedStart[0], event.localPosition[1], snappedStart[1])
        endingPoint.current.copy(startingPoint.current)
        buildingState.current = 1
        previewRef.current.visible = true
      } else {
        const snappedEnd = snapFenceDraftPoint({
          point: localClick,
          walls,
          fences,
          start: [startingPoint.current.x, startingPoint.current.z],
          angleSnap: !shiftPressed.current,
        })
        const dx = snappedEnd[0] - startingPoint.current.x
        const dz = snappedEnd[1] - startingPoint.current.z
        if (dx * dx + dz * dz < 0.01 * 0.01) return
        createFenceOnCurrentLevel([startingPoint.current.x, startingPoint.current.z], snappedEnd)
        previewRef.current.visible = false
        buildingState.current = 0
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed.current = true
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') shiftPressed.current = false
    }

    const onCancel = () => {
      if (buildingState.current === 1) {
        markToolCancelConsumed()
        buildingState.current = 0
        previewRef.current.visible = false
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  return (
    <group>
      <CursorSphere ref={cursorRef} height={FENCE_PREVIEW_HEIGHT} />
      <mesh layers={EDITOR_LAYER} ref={previewRef} renderOrder={1} visible={false}>
        <shapeGeometry />
        <meshBasicMaterial
          color="#ffffff"
          depthTest={false}
          depthWrite={false}
          opacity={0.45}
          side={DoubleSide}
          transparent
        />
      </mesh>
    </group>
  )
}
