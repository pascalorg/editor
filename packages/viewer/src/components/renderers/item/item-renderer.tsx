import {
  type AnimationEffect,
  type AnyNodeId,
  baseMaterial,
  glassMaterial,
  type Interactive,
  type ItemNode,
  type LightEffect,
  useInteractive,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useAnimations } from '@react-three/drei'
import { Clone } from '@react-three/drei/core/Clone'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import type { AnimationAction, Group, Material, Mesh, Object3D } from 'three'
import { Box3, MathUtils, Matrix4, Vector3 } from 'three'
import { positionLocal, smoothstep, time } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { resolveCdnUrl } from '../../../lib/asset-url'
import { useItemLightPool } from '../../../store/use-item-light-pool'
import { ErrorBoundary } from '../../error-boundary'
import { NodeRenderer } from '../node-renderer'

const getMaterialForOriginal = (original: Material): MeshStandardNodeMaterial => {
  if (original.name.toLowerCase() === 'glass') {
    return glassMaterial
  }
  return baseMaterial
}

const BrokenItemFallback = ({ node }: { node: ItemNode }) => {
  const handlers = useNodeEvents(node, 'item')
  const [w, h, d] = node.asset.dimensions
  return (
    <mesh position-y={h / 2} {...handlers}>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color="#ef4444" opacity={0.6} transparent wireframe />
    </mesh>
  )
}

export const ItemRenderer = ({ node }: { node: ItemNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, node.type, ref)

  return (
    <group position={node.position} ref={ref} rotation={node.rotation} visible={node.visible}>
      <ErrorBoundary fallback={<BrokenItemFallback node={node} />}>
        <Suspense fallback={<PreviewModel node={node} />}>
          <ModelRenderer node={node} />
        </Suspense>
      </ErrorBoundary>
      {node.children?.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </group>
  )
}

const previewMaterial = new MeshStandardNodeMaterial({
  color: '#cccccc',
  roughness: 1,
  metalness: 0,
  depthTest: false,
})

const previewOpacity = smoothstep(0.42, 0.55, positionLocal.y.add(time.mul(-0.2)).mul(10).fract())

previewMaterial.opacityNode = previewOpacity
previewMaterial.transparent = true

const PreviewModel = ({ node }: { node: ItemNode }) => {
  return (
    <mesh material={previewMaterial} position-y={node.asset.dimensions[1] / 2}>
      <boxGeometry
        args={[node.asset.dimensions[0], node.asset.dimensions[1], node.asset.dimensions[2]]}
      />
    </mesh>
  )
}

const multiplyScales = (
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] => [a[0] * b[0], a[1] * b[1], a[2] * b[2]]

type Point = {
  x: number
  y: number
}

type LocalBounds = {
  min: [number, number, number]
  max: [number, number, number]
}

function getLocalMeshFloorplanPolygon(object: Object3D): Point[] {
  object.updateWorldMatrix(true, true)

  const inverseRootMatrix = new Matrix4().copy(object.matrixWorld).invert()
  const localMatrix = new Matrix4()
  const scratchBounds = new Box3()
  const scratchPosition = new Vector3()
  const footprintPoints: Point[] = []

  const collectPoints = (child: Object3D) => {
    const mesh = child as Object3D & {
      isMesh?: boolean
      name?: string
      geometry?: {
        boundingBox: Box3 | null
        computeBoundingBox?: () => void
        attributes?: {
          position?: {
            count: number
            getX: (index: number) => number
            getY: (index: number) => number
            getZ: (index: number) => number
          }
        }
      }
      matrixWorld: Matrix4
    }

    if (mesh.isMesh && mesh.name !== 'cutout' && mesh.geometry) {
      if (!mesh.geometry.boundingBox && mesh.geometry.computeBoundingBox) {
        mesh.geometry.computeBoundingBox()
      }

      localMatrix.copy(inverseRootMatrix).multiply(mesh.matrixWorld)

      const vertexPositions = mesh.geometry.attributes?.position
      if (vertexPositions && vertexPositions.count > 0) {
        for (let index = 0; index < vertexPositions.count; index += 1) {
          scratchPosition
            .set(
              vertexPositions.getX(index),
              vertexPositions.getY(index),
              vertexPositions.getZ(index),
            )
            .applyMatrix4(localMatrix)

          if (Number.isFinite(scratchPosition.x) && Number.isFinite(scratchPosition.z)) {
            footprintPoints.push({ x: scratchPosition.x, y: scratchPosition.z })
          }
        }
      } else if (mesh.geometry.boundingBox) {
        scratchBounds.copy(mesh.geometry.boundingBox)
        scratchBounds.applyMatrix4(localMatrix)
        if (Number.isFinite(scratchBounds.min.x) && Number.isFinite(scratchBounds.max.x)) {
          footprintPoints.push(
            { x: scratchBounds.min.x, y: scratchBounds.min.z },
            { x: scratchBounds.max.x, y: scratchBounds.min.z },
            { x: scratchBounds.max.x, y: scratchBounds.max.z },
            { x: scratchBounds.min.x, y: scratchBounds.max.z },
          )
        }
      }
    }

    for (const grandchild of child.children) {
      collectPoints(grandchild)
    }
  }

  for (const child of object.children) {
    collectPoints(child)
  }

  return getMinimumAreaBoundingRect(footprintPoints) ?? []
}

function getLocalMeshBounds(object: Object3D): LocalBounds | null {
  object.updateWorldMatrix(true, true)

  const inverseRootMatrix = new Matrix4().copy(object.matrixWorld).invert()
  const localMatrix = new Matrix4()
  const localBounds = new Box3()
  const scratchBounds = new Box3()
  let hasBounds = false

  const expandBounds = (child: Object3D) => {
    const mesh = child as Object3D & {
      isMesh?: boolean
      name?: string
      geometry?: {
        boundingBox: Box3 | null
        computeBoundingBox?: () => void
      }
    }

    if (mesh.isMesh && mesh.name !== 'cutout' && mesh.geometry) {
      if (!mesh.geometry.boundingBox && mesh.geometry.computeBoundingBox) {
        mesh.geometry.computeBoundingBox()
      }

      if (mesh.geometry.boundingBox) {
        localMatrix.copy(inverseRootMatrix).multiply(mesh.matrixWorld)
        scratchBounds.copy(mesh.geometry.boundingBox).applyMatrix4(localMatrix)
        if (!hasBounds) {
          localBounds.copy(scratchBounds)
          hasBounds = true
        } else {
          localBounds.union(scratchBounds)
        }
      }
    }

    for (const grandchild of child.children) {
      expandBounds(grandchild)
    }
  }

  for (const child of object.children) {
    expandBounds(child)
  }

  if (!hasBounds) return null

  return {
    min: [localBounds.min.x, localBounds.min.y, localBounds.min.z],
    max: [localBounds.max.x, localBounds.max.y, localBounds.max.z],
  }
}

function getMinimumAreaBoundingRect(points: Point[]) {
  if (points.length === 0) return null
  if (points.length < 3) return points

  const hull = getConvexHull(points)
  if (hull.length < 3) return hull

  let bestArea = Number.POSITIVE_INFINITY
  let bestRect: Point[] | null = null

  for (let index = 0; index < hull.length; index += 1) {
    const nextIndex = (index + 1) % hull.length
    const current = hull[index]!
    const next = hull[nextIndex]!
    const angle = Math.atan2(next.y - current.y, next.x - current.x)
    const cos = Math.cos(-angle)
    const sin = Math.sin(-angle)

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const point of hull) {
      const rx = point.x * cos - point.y * sin
      const ry = point.x * sin + point.y * cos
      minX = Math.min(minX, rx)
      maxX = Math.max(maxX, rx)
      minY = Math.min(minY, ry)
      maxY = Math.max(maxY, ry)
    }

    const area = (maxX - minX) * (maxY - minY)
    if (area >= bestArea) continue
    bestArea = area

    const unrotate = (x: number, y: number): Point => ({
      x: x * Math.cos(angle) - y * Math.sin(angle),
      y: x * Math.sin(angle) + y * Math.cos(angle),
    })

    bestRect = [
      unrotate(minX, minY),
      unrotate(maxX, minY),
      unrotate(maxX, maxY),
      unrotate(minX, maxY),
    ]
  }

  return bestRect
}

function getConvexHull(points: Point[]) {
  if (points.length <= 1) return points

  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: Point[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: Point[] = []
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

const ModelRenderer = ({ node }: { node: ItemNode }) => {
  const { scene, nodes, animations } = useGLTF(resolveCdnUrl(node.asset.src) || '')
  const ref = useRef<Group>(null!)
  const { actions } = useAnimations(animations, ref)
  // Freeze the interactive definition at mount — asset schemas don't change at runtime
  const interactiveRef = useRef(node.asset.interactive)

  if (nodes.cutout) {
    nodes.cutout.visible = false
  }

  const handlers = useNodeEvents(node, 'item')

  useEffect(() => {
    if (!node.parentId) return
    useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
  }, [node.parentId])

  useEffect(() => {
    const cloneRoot = ref.current
    if (!cloneRoot) return

    const polygon = getLocalMeshFloorplanPolygon(cloneRoot)
    const bounds = getLocalMeshBounds(cloneRoot)
    if (polygon.length < 3 && !bounds) return

    const nextPolygon = polygon.length >= 3 ? polygon.map(({ x, y }) => [x, y] as [number, number]) : null
    const nextBounds = bounds ? { min: bounds.min, max: bounds.max } : null
    const metadata =
      typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
        ? (node.metadata as Record<string, unknown>)
        : {}
    const currentPolygon = metadata.floorplanLocalPolygon
    const currentBounds =
      typeof metadata.meshLocalBounds === 'object' &&
      metadata.meshLocalBounds !== null &&
      !Array.isArray(metadata.meshLocalBounds)
        ? (metadata.meshLocalBounds as { min?: unknown; max?: unknown })
        : null
    const unchanged =
      ((nextPolygon === null &&
        (currentPolygon === undefined || currentPolygon === null || currentPolygon === false)) ||
        (Array.isArray(currentPolygon) &&
          nextPolygon !== null &&
          currentPolygon.length === nextPolygon.length &&
          currentPolygon.every(
            (point, index) =>
              Array.isArray(point) &&
              point[0] === nextPolygon[index]?.[0] &&
              point[1] === nextPolygon[index]?.[1],
          ))) &&
      ((nextBounds === null &&
        (currentBounds === undefined || currentBounds === null)) ||
        (nextBounds !== null &&
          Array.isArray(currentBounds?.min) &&
          Array.isArray(currentBounds?.max) &&
          currentBounds.min[0] === nextBounds.min[0] &&
          currentBounds.min[1] === nextBounds.min[1] &&
          currentBounds.min[2] === nextBounds.min[2] &&
          currentBounds.max[0] === nextBounds.max[0] &&
          currentBounds.max[1] === nextBounds.max[1] &&
          currentBounds.max[2] === nextBounds.max[2]))

    if (unchanged) return

    useScene.getState().updateNode(node.id, {
      metadata: {
        ...metadata,
        ...(nextPolygon ? { floorplanLocalPolygon: nextPolygon } : {}),
        ...(nextBounds ? { meshLocalBounds: nextBounds } : {}),
      },
    })
  }, [node.id, node.metadata, scene])

  useEffect(() => {
    const interactive = interactiveRef.current
    if (!interactive) return
    useInteractive.getState().initItem(node.id, interactive)
    return () => useInteractive.getState().removeItem(node.id)
  }, [node.id])

  useMemo(() => {
    scene.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh
        if (mesh.name === 'cutout') {
          child.visible = false
          return
        }

        let hasGlass = false

        // Handle both single material and material array cases
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => getMaterialForOriginal(mat))
          hasGlass = mesh.material.some((mat) => mat.name === 'glass')

          // Fix geometry groups that reference materialIndex beyond the material
          // array length — this causes three-mesh-bvh to crash with
          // "Cannot read properties of undefined (reading 'side')"
          const matCount = mesh.material.length
          if (mesh.geometry.groups.length > 0) {
            for (const group of mesh.geometry.groups) {
              if (group.materialIndex !== undefined && group.materialIndex >= matCount) {
                group.materialIndex = 0
              }
            }
          }
        } else {
          mesh.material = getMaterialForOriginal(mesh.material)
          hasGlass = mesh.material.name === 'glass'
        }
        mesh.castShadow = !hasGlass
        mesh.receiveShadow = !hasGlass
      }
    })
  }, [scene])

  const interactive = interactiveRef.current
  const animEffect =
    interactive?.effects.find((e): e is AnimationEffect => e.kind === 'animation') ?? null
  const lightEffects =
    interactive?.effects.filter((e): e is LightEffect => e.kind === 'light') ?? []

  return (
    <>
      <Clone
        object={scene}
        position={node.asset.offset}
        ref={ref}
        rotation={node.asset.rotation}
        scale={multiplyScales(node.asset.scale || [1, 1, 1], node.scale || [1, 1, 1])}
        {...handlers}
      />
      {animations.length > 0 && (
        <ItemAnimation
          actions={actions}
          animations={animations}
          animEffect={animEffect}
          interactive={interactive ?? null}
          nodeId={node.id}
        />
      )}
      {lightEffects.map((effect, i) => (
        <ItemLightRegistrar
          effect={effect}
          index={i}
          interactive={interactive!}
          key={i}
          nodeId={node.id}
        />
      ))}
    </>
  )
}

const ItemAnimation = ({
  nodeId,
  animEffect,
  interactive,
  actions,
  animations,
}: {
  nodeId: AnyNodeId
  animEffect: AnimationEffect | null
  interactive: Interactive | null
  actions: Record<string, AnimationAction | null>
  animations: { name: string }[]
}) => {
  const activeClipRef = useRef<string | null>(null)
  const fadingOutRef = useRef<AnimationAction | null>(null)

  // Reactive: derive target clip name — only re-renders when the clip name itself changes
  const targetClip = useInteractive((s) => {
    const values = s.items[nodeId]?.controlValues
    if (!animEffect) return animations[0]?.name ?? null
    const toggleIndex = interactive!.controls.findIndex((c) => c.kind === 'toggle')
    const isOn = toggleIndex >= 0 ? Boolean(values?.[toggleIndex]) : false
    return isOn
      ? (animEffect.clips.on ?? null)
      : (animEffect.clips.off ?? animEffect.clips.loop ?? null)
  })

  // When target clip changes: kick off the transition
  useEffect(() => {
    // Cancel any ongoing fade-out immediately
    if (fadingOutRef.current) {
      fadingOutRef.current.timeScale = 0
      fadingOutRef.current = null
    }
    // Move current clip to fade-out
    if (activeClipRef.current && activeClipRef.current !== targetClip) {
      const old = actions[activeClipRef.current]
      if (old?.isRunning()) fadingOutRef.current = old
    }
    // Start new clip at timeScale 0.01 (as 0 would cause isRunning to be false and thus not play at all), then fade in to 1
    activeClipRef.current = targetClip
    if (targetClip) {
      const next = actions[targetClip]
      if (next) {
        next.timeScale = 0.01
        next.play()
      }
    }
  }, [targetClip, actions])

  // useFrame: only lerping — no logic
  useFrame((_, delta) => {
    if (fadingOutRef.current) {
      const action = fadingOutRef.current
      action.timeScale = MathUtils.lerp(action.timeScale, 0, Math.min(delta * 5, 1))
      if (action.timeScale < 0.01) {
        action.timeScale = 0
        fadingOutRef.current = null
      }
    }
    if (activeClipRef.current) {
      const action = actions[activeClipRef.current]
      if (action?.isRunning() && action.timeScale < 1) {
        action.timeScale = MathUtils.lerp(action.timeScale, 1, Math.min(delta * 5, 1))
        if (1 - action.timeScale < 0.01) action.timeScale = 1
      }
    }
  })

  return null
}

const ItemLightRegistrar = ({
  nodeId,
  effect,
  interactive,
  index,
}: {
  nodeId: AnyNodeId
  effect: LightEffect
  interactive: Interactive
  index: number
}) => {
  useEffect(() => {
    const key = `${nodeId}:${index}`
    useItemLightPool.getState().register(key, nodeId, effect, interactive)
    return () => useItemLightPool.getState().unregister(key)
  }, [nodeId, index, effect, interactive])

  return null
}
