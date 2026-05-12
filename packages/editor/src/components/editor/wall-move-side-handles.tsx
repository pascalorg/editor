'use client'

import {
  type AnyNodeId,
  DEFAULT_WALL_HEIGHT,
  getWallThickness,
  sceneRegistry,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Object3D,
} from 'three'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'

const HANDLE_OFFSET = 0.42
const HANDLE_MIN_OFFSET = 0.5
const HANDLE_MIN_HEIGHT = 0.62
const HANDLE_TOP_INSET = 0.08
const ARROW_COLOR = '#8381ed'
const ARROW_HOVER_COLOR = '#a5b4fc'

type WallMoveHandle = {
  direction: [number, number]
  key: string
  position: [number, number, number]
  rotationY: number
}

function createArrowHandleGeometry() {
  const shaft = new CylinderGeometry(0.04, 0.064, 0.25, 36)
  const head = new ConeGeometry(0.13, 0.3, 48)
  shaft.rotateZ(-Math.PI / 2)
  shaft.translate(-0.085, 0, 0)
  head.rotateZ(-Math.PI / 2)
  head.translate(0.17, 0, 0)

  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []

  for (const sourceGeometry of [shaft, head]) {
    const geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')

    for (let index = 0; index < position.count; index += 1) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index))
      normals.push(normal.getX(index), normal.getY(index), normal.getZ(index))
      uvs.push(uv?.getX(index) ?? 0, uv?.getY(index) ?? 0)
    }

    if (geometry !== sourceGeometry) {
      geometry.dispose()
    }
    sourceGeometry.dispose()
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('uv2', new Float32BufferAttribute([...uvs], 2))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export function WallMoveSideHandles() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const mode = useEditor((state) => state.mode)
  const isFloorplanHovered = useEditor((state) => state.isFloorplanHovered)
  const movingNode = useEditor((state) => state.movingNode)
  const movingWallEndpoint = useEditor((state) => state.movingWallEndpoint)
  const movingFenceEndpoint = useEditor((state) => state.movingFenceEndpoint)
  const curvingWall = useEditor((state) => state.curvingWall)
  const curvingFence = useEditor((state) => state.curvingFence)

  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null
  const wall = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : null
    return node?.type === 'wall' ? node : null
  })

  const shouldRender =
    Boolean(wall) &&
    !isFloorplanHovered &&
    mode !== 'delete' &&
    !movingNode &&
    !movingWallEndpoint &&
    !movingFenceEndpoint &&
    !curvingWall &&
    !curvingFence

  if (!shouldRender || !wall) return null

  return <WallMoveSideHandlesForWall wall={wall} />
}

function WallMoveSideHandlesForWall({ wall }: { wall: WallNode }) {
  const [levelObject, setLevelObject] = useState<Object3D | null>(() =>
    wall.parentId ? (sceneRegistry.nodes.get(wall.parentId) ?? null) : null,
  )

  useEffect(() => {
    let frameId = 0

    const resolveLevelObject = () => {
      const nextLevelObject = wall.parentId
        ? (sceneRegistry.nodes.get(wall.parentId) ?? null)
        : null
      setLevelObject((currentLevelObject) => {
        if (currentLevelObject === nextLevelObject) {
          return currentLevelObject
        }
        return nextLevelObject
      })

      if (!nextLevelObject) {
        frameId = window.requestAnimationFrame(resolveLevelObject)
      }
    }

    resolveLevelObject()

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [wall.parentId])

  const handles = useMemo(() => getWallMoveHandles(wall), [wall])

  if (!levelObject || handles.length === 0) return null

  return createPortal(
    <group>
      {handles.map((handle) => (
        <WallMoveArrowHandle handle={handle} key={handle.key} wall={wall} />
      ))}
    </group>,
    levelObject,
  )
}

function WallMoveArrowHandle({ wall, handle }: { wall: WallNode; handle: WallMoveHandle }) {
  const [isHovered, setIsHovered] = useState(false)
  const arrowGeometry = useMemo(() => createArrowHandleGeometry(), [])

  useEffect(() => {
    return () => {
      if (document.body.style.cursor === 'grab' || document.body.style.cursor === 'grabbing') {
        document.body.style.cursor = ''
      }
    }
  }, [])

  useEffect(() => () => arrowGeometry.dispose(), [arrowGeometry])

  const activateWallMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    event.nativeEvent.preventDefault()
    document.body.style.cursor = 'grabbing'

    sfxEmitter.emit('sfx:item-pick')
    useEditor.getState().setMovingNode(wall)
    useEditor.getState().setMovingWallEndpoint(null)
    useEditor.getState().setMovingFenceEndpoint(null)
    useEditor.getState().setCurvingWall(null)
    useEditor.getState().setCurvingFence(null)
    useViewer.getState().setSelection({ selectedIds: [] })
  }

  return (
    <group
      position={handle.position}
      rotation={[0, handle.rotationY, 0]}
      scale={isHovered ? 1.12 : 1}
    >
      <mesh
        frustumCulled={false}
        onPointerDown={activateWallMove}
        onPointerEnter={(event) => {
          event.stopPropagation()
          setIsHovered(true)
          document.body.style.cursor = 'grab'
        }}
        onPointerLeave={(event) => {
          event.stopPropagation()
          setIsHovered(false)
          if (document.body.style.cursor === 'grab') {
            document.body.style.cursor = ''
          }
        }}
        renderOrder={1002}
      >
        <primitive attach="geometry" object={arrowGeometry} />
        <meshBasicMaterial
          color={isHovered ? ARROW_HOVER_COLOR : ARROW_COLOR}
          depthTest
          depthWrite
          opacity={1}
          side={DoubleSide}
          transparent={false}
        />
      </mesh>
    </group>
  )
}

function getWallMoveHandles(wall: WallNode): WallMoveHandle[] {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)

  if (length < 1e-6) {
    return []
  }

  const normal: [number, number] = [-dz / length, dx / length]
  const midpoint: [number, number] = [
    (wall.start[0] + wall.end[0]) / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ]
  const wallHeight = wall.height ?? DEFAULT_WALL_HEIGHT
  const handleHeight = Math.max(wallHeight - HANDLE_TOP_INSET, HANDLE_MIN_HEIGHT)
  const offset = Math.max(getWallThickness(wall) / 2 + HANDLE_OFFSET, HANDLE_MIN_OFFSET)

  return [
    buildWallMoveHandle('front', midpoint, normal, offset, handleHeight),
    buildWallMoveHandle('back', midpoint, [-normal[0], -normal[1]], offset, handleHeight),
  ]
}

function buildWallMoveHandle(
  key: string,
  midpoint: [number, number],
  direction: [number, number],
  offset: number,
  height: number,
): WallMoveHandle {
  return {
    direction,
    key,
    position: [midpoint[0] + direction[0] * offset, height, midpoint[1] + direction[1] * offset],
    rotationY: Math.atan2(-direction[1], direction[0]),
  }
}
