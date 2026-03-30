import { sceneRegistry, useScene, type WallNode } from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { Fn, float, fract, length, mix, positionLocal, smoothstep, step, vec2 } from 'three/tsl'

import { type Mesh, MeshStandardNodeMaterial, Vector3 } from 'three/webgpu'
import useViewer from '../../store/use-viewer'

const tmpVec = new Vector3()
const u = new Vector3()
const v = new Vector3()

const dotPattern = Fn(() => {
  const scale = float(0.1)
  const dotSize = float(0.3)

  const uv = vec2(positionLocal.x, positionLocal.y).div(scale)
  const gridUV = fract(uv)

  const dist = length(gridUV.sub(0.5))

  const dots = step(dist, dotSize.mul(0.5))

  const fadeHeight = float(2.5)
  const yFade = float(1).sub(smoothstep(float(0), fadeHeight, positionLocal.y))

  return dots.mul(yFade)
})

interface WallMaterials {
  visible: MeshStandardNodeMaterial
  invisible: MeshStandardNodeMaterial
  materialHash: string
}

const wallMaterialCache = new Map<string, WallMaterials>()

function getMaterialHash(wallNode: WallNode): string {
  if (!wallNode.material) return 'none'
  const mat = wallNode.material
  if (mat.preset && mat.preset !== 'custom') {
    return `preset-${mat.preset}`
  }
  if (mat.properties) {
    return `props-${mat.properties.color}-${mat.properties.roughness}-${mat.properties.metalness}`
  }
  return 'default'
}

const presetColors = {
  white: '#ffffff',
  brick: '#8b4513',
  concrete: '#808080',
  wood: '#deb887',
  glass: '#87ceeb',
  metal: '#c0c0c0',
  plaster: '#f5f5dc',
  tile: '#dcdcdc',
  marble: '#f5f5f5',
} as const

function getPresetColor(preset: string): string {
  return presetColors[preset as keyof typeof presetColors] ?? '#ffffff'
}

function getMaterialsForWall(wallNode: WallNode): WallMaterials {
  const cacheKey = wallNode.id
  const materialHash = getMaterialHash(wallNode)

  const existing = wallMaterialCache.get(cacheKey)
  if (existing && existing.materialHash === materialHash) {
    return existing
  }

  if (existing) {
    existing.visible.dispose()
    existing.invisible.dispose()
  }

  let userColor = '#ffffff'
  if (wallNode.material?.properties?.color) {
    userColor = wallNode.material.properties.color
  } else if (wallNode.material?.preset && wallNode.material.preset !== 'custom') {
    userColor = getPresetColor(wallNode.material.preset)
  }

  const visibleMat = new MeshStandardNodeMaterial({
    color: userColor,
    roughness: 1,
    metalness: 0,
  })

  const invisibleMat = new MeshStandardNodeMaterial({
    transparent: true,
    opacityNode: mix(float(0.0), float(0.24), dotPattern()),
    color: userColor,
    depthWrite: false,
    emissive: userColor,
  })

  const result: WallMaterials = { visible: visibleMat, invisible: invisibleMat, materialHash }
  wallMaterialCache.set(cacheKey, result)
  return result
}

function getWallHideState(
  wallNode: WallNode,
  wallMesh: Mesh,
  wallMode: string,
  cameraDir: Vector3,
): boolean {
  let hideWall = wallNode.frontSide === 'interior' && wallNode.backSide === 'interior'

  if (wallMode === 'up') {
    hideWall = false
  } else if (wallMode === 'down') {
    hideWall = true
  } else {
    wallMesh.getWorldDirection(v)
    if (v.dot(cameraDir) < 0) {
      if (wallNode.frontSide === 'exterior' && wallNode.backSide !== 'exterior') {
        hideWall = true
      }
    } else if (wallNode.backSide === 'exterior' && wallNode.frontSide !== 'exterior') {
      hideWall = true
    }
  }

  return hideWall
}

export const WallCutout = () => {
  const lastCameraPosition = useRef(new Vector3())
  const lastCameraTarget = useRef(new Vector3())
  const lastUpdateTime = useRef(0)
  const lastWallMode = useRef<string>(useViewer.getState().wallMode)
  const lastNumberOfWalls = useRef(0)
  const lastWallMaterials = useRef<Map<string, WallMaterials>>(new Map())

  useFrame(({ camera, clock }) => {
    const wallMode = useViewer.getState().wallMode
    const currentTime = clock.elapsedTime
    const currentCameraPosition = camera.position
    camera.getWorldDirection(tmpVec)
    tmpVec.add(currentCameraPosition)

    const distanceMoved = currentCameraPosition.distanceTo(lastCameraPosition.current)
    const directionChanged = tmpVec.distanceTo(lastCameraTarget.current)
    const timeSinceUpdate = currentTime - lastUpdateTime.current

    const shouldUpdate =
      ((distanceMoved > 0.5 || directionChanged > 0.3) && timeSinceUpdate > 0.1) ||
      lastWallMode.current !== wallMode ||
      sceneRegistry.byType.wall.size !== lastNumberOfWalls.current

    const walls = sceneRegistry.byType.wall
    const currentWallIds = new Set<string>()

    walls.forEach((wallId) => {
      const wallMesh = sceneRegistry.nodes.get(wallId)
      if (!wallMesh) return
      const wallNode = useScene.getState().nodes[wallId as WallNode['id']]
      if (!wallNode || wallNode.type !== 'wall') return

      currentWallIds.add(wallId)

      const hideWall = getWallHideState(wallNode, wallMesh as Mesh, wallMode, u)

      if (shouldUpdate) {
        const materials = getMaterialsForWall(wallNode)
        ;(wallMesh as Mesh).material = hideWall ? materials.invisible : materials.visible
      } else {
        const currentMaterial = (wallMesh as Mesh).material
        const materials = wallMaterialCache.get(wallId)
        if (
          !materials ||
          currentMaterial !== (hideWall ? materials.invisible : materials.visible)
        ) {
          const newMaterials = getMaterialsForWall(wallNode)
          ;(wallMesh as Mesh).material = hideWall ? newMaterials.invisible : newMaterials.visible
        }
      }
    })

    if (shouldUpdate) {
      lastCameraPosition.current.copy(currentCameraPosition)
      lastCameraTarget.current.copy(tmpVec)
      lastUpdateTime.current = currentTime
      camera.getWorldDirection(u)

      if (lastWallMode.current !== wallMode) {
        wallMaterialCache.clear()
      }

      for (const [wallId, mats] of lastWallMaterials.current) {
        if (!currentWallIds.has(wallId)) {
          mats.visible.dispose()
          mats.invisible.dispose()
          wallMaterialCache.delete(wallId)
        }
      }

      lastWallMaterials.current.clear()
      for (const [wallId, mats] of wallMaterialCache) {
        lastWallMaterials.current.set(wallId, mats)
      }

      lastWallMode.current = wallMode
      lastNumberOfWalls.current = sceneRegistry.byType.wall.size
    }
  })
  return null
}
