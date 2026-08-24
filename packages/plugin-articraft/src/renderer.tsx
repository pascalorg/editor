'use client'

import {
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import {
  createDefaultMaterial,
  resolveSurfaceColor,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Group, type Material, type Mesh, type Object3D, Quaternion, Vector3 } from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js'
import URDFLoader from 'urdf-loader'
import { markArticraftJointTarget } from './animation'
import { createArticraftAppearanceController } from './appearance'
import { motionValueAtTime, usePrefersReducedMotion } from './motion'
import type { ArticraftAssetNode } from './schema'
import { resolveArticraftRootTransform } from './transform'
import type { ArticraftJoint } from './types'

type LoadedArticulationSource = {
  root: Object3D
  setJointValue: (name: string, value: number) => void
}

type LoadedArticulation = LoadedArticulationSource & {
  appearance: ReturnType<typeof createArticraftAppearanceController>
}

export default function ArticraftRenderer({ node }: { node: ArticraftAssetNode }) {
  const ref = useRef<Group>(null)
  const handlers = useNodeEvents(node as never, node.type as never)
  const liveTransform = useLiveTransforms((state) => state.get(node.id as AnyNodeId))
  const liveOverride = useLiveNodeOverrides((state) => state.overrides.get(node.id))
  const transform = resolveArticraftRootTransform(node, liveTransform, liveOverride)
  useRegistry(node.id, node.type, ref as React.RefObject<Object3D>)

  return (
    <group
      {...handlers}
      position={transform.position}
      ref={ref}
      rotation={transform.rotation}
      scale={transform.scale}
      visible={node.visible}
    >
      <ArticraftVisual node={node} />
    </group>
  )
}

export function ArticraftVisual({
  ghost = false,
  motionEnabled,
  node,
}: {
  ghost?: boolean
  motionEnabled?: boolean
  node: ArticraftAssetNode
}) {
  const [loaded, setLoaded] = useState<LoadedArticulation | null>(null)
  const [failed, setFailed] = useState(false)
  const invalidate = useThree((state) => state.invalidate)
  const reducedMotion = usePrefersReducedMotion()
  const shading = useViewer((state) => state.shading)
  const textures = useViewer((state) => state.textures)
  const colorPreset = useViewer((state) => state.colorPreset)
  const sceneTheme = useViewer((state) => state.sceneTheme)
  const shouldAnimate =
    (motionEnabled ?? node.motionEnabled) &&
    !reducedMotion &&
    node.joints.some((joint) => joint.type !== 'fixed')

  useEffect(() => {
    let cancelled = false
    let owned: Object3D | null = null
    let ownedAppearance: ReturnType<typeof createArticraftAppearanceController> | null = null
    setLoaded(null)
    setFailed(false)

    const load = async () => {
      const next =
        node.artifact.format === 'urdf'
          ? await loadUrdf(node.artifact.url, node.joints)
          : await loadUsdz(node.artifact.url, node.parts, node.joints)
      if (ghost) configureGhost(next.root)
      const appearance = createArticraftAppearanceController(next.root)
      const currentAppearance = useViewer.getState()
      appearance.apply({
        colorPreset: currentAppearance.colorPreset,
        ghost,
        sceneTheme: currentAppearance.sceneTheme,
        shading: currentAppearance.shading,
        textures: currentAppearance.textures,
      })
      if (cancelled) {
        appearance.dispose()
        disposeObject(next.root)
        return
      }
      owned = next.root
      ownedAppearance = appearance
      setLoaded({ ...next, appearance })
      invalidate()
    }

    void load().catch((error) => {
      if (cancelled) return
      console.error('[articraft] asset load failed', error)
      setFailed(true)
      invalidate()
    })

    return () => {
      cancelled = true
      if (owned) {
        ownedAppearance?.dispose()
        disposeObject(owned)
      }
    }
  }, [ghost, invalidate, node.artifact.format, node.artifact.url, node.joints, node.parts])

  useLayoutEffect(() => {
    if (!loaded) return
    loaded.appearance.apply({ colorPreset, ghost, sceneTheme, shading, textures })
    invalidate()
  }, [colorPreset, ghost, invalidate, loaded, sceneTheme, shading, textures])

  useEffect(() => {
    if (!loaded) return
    for (const [name, value] of Object.entries(node.jointValues)) {
      loaded.setJointValue(name, value)
    }
    invalidate()
  }, [invalidate, loaded, node.jointValues, shouldAnimate])

  useFrame((state) => {
    if (!(loaded && shouldAnimate)) return
    let motionIndex = 0
    for (const joint of node.joints) {
      if (joint.type === 'fixed') continue
      loaded.setJointValue(
        joint.name,
        motionValueAtTime(joint, motionIndex, state.clock.elapsedTime),
      )
      motionIndex += 1
    }
    invalidate()
  })

  const fallbackMaterial = useMemo(() => {
    const color = failed
      ? '#ef4444'
      : textures
        ? '#8b5cf6'
        : resolveSurfaceColor('furnishing', colorPreset, sceneTheme)
    const material = createDefaultMaterial(color, 1, textures ? shading : 'solid')
    material.depthWrite = !ghost
    material.opacity = failed ? 0.3 : 0.2
    material.transparent = true
    if ('wireframe' in material) material.wireframe = true
    material.needsUpdate = true
    return material
  }, [colorPreset, failed, ghost, sceneTheme, shading, textures])

  useEffect(() => () => fallbackMaterial.dispose(), [fallbackMaterial])

  if (loaded) return <primitive object={loaded.root} />

  return (
    <mesh
      layers={ghost ? EDITOR_LAYER : undefined}
      position={[0, node.dimensions[1] / 2, 0]}
      raycast={ghost ? () => undefined : undefined}
    >
      <boxGeometry args={node.dimensions} />
      <primitive attach="material" object={fallbackMaterial} />
    </mesh>
  )
}

async function loadUrdf(
  url: string,
  joints: ArticraftAssetNode['joints'],
): Promise<LoadedArticulationSource> {
  const loader = new URDFLoader()
  loader.parseCollision = false
  loader.loadMeshCb = (meshUrl, manager, material, done) => {
    new OBJLoader(manager).load(
      meshUrl,
      (object) => {
        object.traverse((child) => {
          const mesh = child as Mesh
          if (!mesh.isMesh) return
          mesh.material = material
          mesh.castShadow = true
          mesh.receiveShadow = true
        })
        done(object)
      },
      undefined,
      (error) => done(new Group(), error instanceof Error ? error : new Error(String(error))),
    )
  }
  const robot = await loader.loadAsync(url)
  for (const joint of joints) {
    if (joint.type === 'fixed') continue
    robot.setJointValue(joint.name, 0)
    const target = robot.joints[joint.name]
    if (target) markArticraftJointTarget(target, joint.name)
  }
  robot.rotation.x = -Math.PI / 2
  markShadows(robot)
  return {
    root: robot,
    setJointValue: (name, value) => robot.setJointValue(name, value),
  }
}

async function loadUsdz(
  url: string,
  parts: ArticraftAssetNode['parts'],
  joints: ArticraftAssetNode['joints'],
): Promise<LoadedArticulationSource> {
  const source = await new USDLoader().loadAsync(url)
  const root = buildUsdHierarchy(source, parts, joints)
  markShadows(root.root)
  return root
}

function buildUsdHierarchy(
  source: Group,
  parts: ArticraftAssetNode['parts'],
  joints: ArticraftAssetNode['joints'],
): LoadedArticulationSource {
  if (parts.length === 0) {
    return { root: source, setJointValue: () => undefined }
  }

  const scope = source.getObjectByName('parts') ?? source
  const partObjects = new Map<string, Object3D>()
  for (const part of parts) {
    const object = scope.getObjectByName(part.objectName ?? part.name)
    if (!object) continue
    object.removeFromParent()
    object.position.set(0, 0, 0)
    object.quaternion.identity()
    object.scale.set(1, 1, 1)
    partObjects.set(part.name, object)
  }

  if (partObjects.size === 0) {
    return { root: source, setJointValue: () => undefined }
  }

  const root = new Group()
  const motionGroups = new Map<string, { group: Group; joint: ArticraftJoint }>()
  const children = new Set<string>()

  for (const joint of joints) {
    const parent = partObjects.get(joint.parent)
    const child = partObjects.get(joint.child)
    if (!(parent && child)) continue
    const frame = new Group()
    frame.position.fromArray(joint.origin.xyz)
    frame.rotation.set(...joint.origin.rpy, 'XYZ')
    const motion = new Group()
    if (joint.type !== 'fixed') markArticraftJointTarget(motion, joint.name)
    frame.add(motion)
    motion.add(child)
    parent.add(frame)
    motionGroups.set(joint.name, { group: motion, joint })
    children.add(joint.child)
  }

  for (const [name, object] of partObjects) {
    if (!children.has(name)) root.add(object)
  }

  return {
    root,
    setJointValue: (name, value) => {
      const entry = motionGroups.get(name)
      if (!entry || entry.joint.type === 'fixed') return
      entry.group.position.set(0, 0, 0)
      entry.group.quaternion.identity()
      const axis = new Vector3(...entry.joint.axis).normalize()
      if (entry.joint.type === 'prismatic') {
        entry.group.position.copy(axis.multiplyScalar(value))
      } else {
        entry.group.quaternion.copy(new Quaternion().setFromAxisAngle(axis, value))
      }
    },
  }
}

function markShadows(root: Object3D) {
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
}

function configureGhost(root: Object3D) {
  root.traverse((object) => {
    object.layers.set(EDITOR_LAYER)
    object.raycast = () => undefined
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = false
    mesh.receiveShadow = false
  })
}

function disposeObject(root: Object3D) {
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials as Material[]) material.dispose()
  })
}
