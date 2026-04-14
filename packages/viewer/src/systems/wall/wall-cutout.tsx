import {
  type AnyNodeId,
  baseMaterial,
  emitter,
  getMaterialPresetByRef,
  sceneRegistry,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Material } from 'three'
import { Color } from 'three'
import { Fn, float, fract, length, mix, positionLocal, smoothstep, step, vec2 } from 'three/tsl'
import { type Mesh, MeshStandardNodeMaterial, Vector3 } from 'three/webgpu'
import useViewer from '../../store/use-viewer'
import { createMaterialFromPresetRef } from '../../lib/materials'

const tmpVec = new Vector3()
const u = new Vector3()
const v = new Vector3()
const DEFAULT_WALL_COLOR = '#f2f0ed'
const WALL_HIGHLIGHT_PROFILES = {
  delete: {
    color: new Color('#dc2626'),
    blend: 0.78,
    emissiveIntensity: 0.46,
  },
  selection: {
    color: new Color('#818cf8'),
    blend: 0.32,
    emissiveIntensity: 0.42,
  },
} as const

type WallHighlightKind = keyof typeof WALL_HIGHLIGHT_PROFILES

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
  deleteVisible: MeshStandardNodeMaterial
  deleteInvisible: MeshStandardNodeMaterial
  highlightedVisible: MeshStandardNodeMaterial
  highlightedInvisible: MeshStandardNodeMaterial
  materialHash: string
}

const wallMaterialCache = new Map<string, WallMaterials>()

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

function getMaterialHash(wallNode: WallNode): string {
  if (wallNode.materialPreset) return `preset-ref-${wallNode.materialPreset}`
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

function getPresetColor(preset: string): string {
  return presetColors[preset as keyof typeof presetColors] ?? '#ffffff'
}

function getHighlightedColor(color: string, kind: WallHighlightKind): Color {
  const profile = WALL_HIGHLIGHT_PROFILES[kind]
  return new Color(color).lerp(profile.color, profile.blend)
}

function createHighlightedWallMaterial(
  material: MeshStandardNodeMaterial,
  baseColor: string,
  kind: WallHighlightKind,
): MeshStandardNodeMaterial {
  const highlightedMaterial = material.clone()
  const highlightedColor = getHighlightedColor(baseColor, kind)
  const profile = WALL_HIGHLIGHT_PROFILES[kind]

  highlightedMaterial.color = highlightedColor
  highlightedMaterial.emissive = highlightedColor.clone()
  highlightedMaterial.emissiveIntensity = profile.emissiveIntensity

  return highlightedMaterial
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
    existing.deleteVisible.dispose()
    existing.deleteInvisible.dispose()
    existing.highlightedVisible.dispose()
    existing.highlightedInvisible.dispose()
  }

  let userColor = DEFAULT_WALL_COLOR
  const preset = getMaterialPresetByRef(wallNode.materialPreset)
  if (preset?.mapProperties?.color) {
    userColor = preset.mapProperties.color
  } else if (wallNode.material?.properties?.color) {
    userColor = wallNode.material.properties.color
  } else if (wallNode.material?.preset && wallNode.material.preset !== 'custom') {
    userColor = getPresetColor(wallNode.material.preset)
  }

  const visibleMat = wallNode.material
    ? new MeshStandardNodeMaterial({
        color: userColor,
        roughness: 1,
        metalness: 0,
      })
    : (baseMaterial.clone() as MeshStandardNodeMaterial)

  const invisibleMat = new MeshStandardNodeMaterial({
    transparent: true,
    opacityNode: mix(float(0.0), float(0.24), dotPattern()),
    color: userColor,
    depthWrite: false,
    emissive: userColor,
  })

  const highlightedVisible = createHighlightedWallMaterial(visibleMat, userColor, 'selection')
  const highlightedInvisible = createHighlightedWallMaterial(invisibleMat, userColor, 'selection')
  const deleteVisible = createHighlightedWallMaterial(visibleMat, userColor, 'delete')
  const deleteInvisible = createHighlightedWallMaterial(invisibleMat, userColor, 'delete')

  const result: WallMaterials = {
    visible: visibleMat,
    invisible: invisibleMat,
    deleteVisible,
    deleteInvisible,
    highlightedVisible,
    highlightedInvisible,
    materialHash,
  }
  wallMaterialCache.set(cacheKey, result)
  return result
}

function getVisibleWallMaterial(wallNode: WallNode): Material {
  if (wallNode.materialPreset) {
    return createMaterialFromPresetRef(wallNode.materialPreset) ?? baseMaterial
  }

  if (wallNode.material) {
    return getMaterialsForWall(wallNode).visible
  }

  return baseMaterial
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
  const lastHighlightKey = useRef('')

  useFrame(({ camera, clock }) => {
    const wallMode = useViewer.getState().wallMode
    const selectedIds = useViewer.getState().selection.selectedIds
    const previewSelectedIds = useViewer.getState().previewSelectedIds
    const hoveredId = useViewer.getState().hoveredId
    const hoverHighlightMode = useViewer.getState().hoverHighlightMode
    const currentTime = clock.elapsedTime
    const currentCameraPosition = camera.position
    camera.getWorldDirection(tmpVec)
    tmpVec.add(currentCameraPosition)
    const highlightedWallIds = new Set(
      [...selectedIds, ...previewSelectedIds].filter(
        (id) => useScene.getState().nodes[id as AnyNodeId]?.type === 'wall',
      ),
    )
    const deleteHoveredWallId =
      hoverHighlightMode === 'delete' &&
      hoveredId &&
      useScene.getState().nodes[hoveredId as AnyNodeId]?.type === 'wall'
        ? hoveredId
        : null
    const highlightKey = `${Array.from(highlightedWallIds).sort().join('|')}::${deleteHoveredWallId ?? ''}`

    const distanceMoved = currentCameraPosition.distanceTo(lastCameraPosition.current)
    const directionChanged = tmpVec.distanceTo(lastCameraTarget.current)
    const timeSinceUpdate = currentTime - lastUpdateTime.current

    if (
      ((distanceMoved > 0.5 || directionChanged > 0.3) && timeSinceUpdate > 0.1) ||
      lastWallMode.current !== wallMode ||
      sceneRegistry.byType.wall.size !== lastNumberOfWalls.current ||
      lastHighlightKey.current !== highlightKey
    ) {
      lastCameraPosition.current.copy(currentCameraPosition)
      lastCameraTarget.current.copy(tmpVec)
      lastUpdateTime.current = currentTime
      camera.getWorldDirection(u)

      const walls = sceneRegistry.byType.wall
      walls.forEach((wallId) => {
        const wallMesh = sceneRegistry.nodes.get(wallId)
        if (!wallMesh) return
        const wallNode = useScene.getState().nodes[wallId as WallNode['id']]
        if (!wallNode || wallNode.type !== 'wall') return

        const hideWall = getWallHideState(wallNode, wallMesh as Mesh, wallMode, u)
        const isDeleteHighlighted = deleteHoveredWallId === wallId
        const isSelectionHighlighted = !isDeleteHighlighted && highlightedWallIds.has(wallId)
        const materials = getMaterialsForWall(wallNode)

        if (hideWall) {
          ;(wallMesh as Mesh).material = isDeleteHighlighted
            ? materials.deleteInvisible
            : isSelectionHighlighted
              ? materials.highlightedInvisible
              : materials.invisible
        } else {
          ;(wallMesh as Mesh).material = getVisibleWallMaterial(wallNode)
        }
      })
      lastWallMode.current = wallMode
      lastNumberOfWalls.current = sceneRegistry.byType.wall.size
      lastHighlightKey.current = highlightKey
    }
  })

  useEffect(() => {
    const snapshot = new Map<Mesh, Material>()

    const restoreForCapture = () => {
      sceneRegistry.byType.wall.forEach((wallId) => {
        const wallMesh = sceneRegistry.nodes.get(wallId) as Mesh | undefined
        if (!wallMesh) return
        const wallNode = useScene.getState().nodes[wallId as AnyNodeId] as WallNode | undefined
        if (!wallNode || wallNode.type !== 'wall') return
        const mats = getMaterialsForWall(wallNode)
        const current = wallMesh.material as Material
        snapshot.set(wallMesh, current)
        if (current === mats.highlightedVisible || current === mats.deleteVisible) {
          wallMesh.material = getVisibleWallMaterial(wallNode)
        } else if (current === mats.highlightedInvisible || current === mats.deleteInvisible) {
          wallMesh.material = mats.invisible
        }
      })
    }

    const reapplyAfterCapture = () => {
      snapshot.forEach((mat, mesh) => {
        mesh.material = mat
      })
      snapshot.clear()
    }

    emitter.on('thumbnail:before-capture', restoreForCapture)
    emitter.on('thumbnail:after-capture', reapplyAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', restoreForCapture)
      emitter.off('thumbnail:after-capture', reapplyAfterCapture)
    }
  }, [])

  return null
}
