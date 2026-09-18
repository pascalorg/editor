'use client'
import {
  type AnyNode,
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { type ProceduralItemNode, proceduralLocalPose } from '@pascal-app/core/procedural-items'
import {
  createSurfaceRoleMaterial,
  NodeRenderer,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
  useLibraryMaterialsVersion,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Group, Mesh } from 'three'
import { acquireProceduralGeometry, type BuiltItem, geometrySignature } from './geometry'
export default function ProceduralRenderer({ node }: { node: ProceduralItemNode }) {
  const ref = useRef<Group>(null!)
  const overrides = useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const live = useLiveTransforms((s) => s.get(node.id as AnyNodeId))
  const effective = { ...node, ...overrides } as ProceduralItemNode
  const host = useScene((s) => (node.parentId ? s.nodes[node.parentId as AnyNodeId] : undefined))
  const hostOverride = useLiveNodeOverrides((s) =>
    node.parentId ? s.overrides.get(node.parentId) : undefined,
  )
  const pose = proceduralLocalPose(
    effective,
    host ? { [host.id]: { ...host, ...hostOverride } as AnyNode } : {},
  )
  const sceneMaterials = useScene((s) => s.materials)
  const shading = useViewer((s) => s.shading),
    textures = useViewer((s) => s.textures),
    colorPreset = useViewer((s) => s.colorPreset),
    sceneTheme = useViewer((s) => s.sceneTheme)
  const libraryVersion = useLibraryMaterialsVersion()
  const key = geometrySignature(effective)
  const [built, setBuilt] = useState<BuiltItem | null>(null)
  const handlers = useNodeEvents(node as unknown as AnyNode, 'procedural-item' as AnyNode['type'])
  useRegistry(node.id as AnyNodeId, 'procedural-item', ref)
  useLayoutEffect(() => {
    // React can restore base Y after the previous frame consumed the elevation mark.
    useScene.getState().markDirty(node.id as AnyNodeId)
  })
  useLayoutEffect(() => {
    const [recipe, parameters] = JSON.parse(key)
    const lease = acquireProceduralGeometry({ recipe, parameters } as ProceduralItemNode)
    setBuilt(lease.value)
    return lease.release
  }, [key])
  const materialKey = JSON.stringify([effective.recipe.slots, effective.slots, libraryVersion])
  const materials = useMemo(() => {
    const [slots, overrides] = JSON.parse(materialKey) as [
      ProceduralItemNode['recipe']['slots'],
      ProceduralItemNode['slots'],
    ]
    return new Map(
      slots.map((s) => {
        const ref = overrides[s.id]
        const material = textures
          ? (resolveMaterialRef(ref, sceneMaterials, shading) ??
            resolveSlotDefaultMaterial(ref?.startsWith('#') ? ref : s.color, shading, 0.75))
          : createSurfaceRoleMaterial('furnishing', colorPreset, undefined, sceneTheme)
        return [s.id, material] as const
      }),
    )
  }, [materialKey, sceneMaterials, shading, textures, colorPreset, sceneTheme])
  useLayoutEffect(
    () => () => {
      for (const material of materials.values())
        if (!material.userData.__pascalCachedMaterial) material.dispose()
    },
    [materials],
  )
  const meshes = useMemo(
    () =>
      built?.batches.map((batch) => {
        const mesh = new Mesh(batch.geometry, materials.get(batch.slot))
        mesh.name = `slot_${batch.slot}`
        mesh.userData = { slotId: batch.slot, proceduralRanges: batch.ranges }
        mesh.castShadow = true
        mesh.receiveShadow = true
        return mesh
      }) ?? [],
    [built, materials],
  )
  const rotation =
    live?.rotation === undefined
      ? pose.rotation
      : ([pose.rotation[0], live.rotation, pose.rotation[2]] as [number, number, number])
  return (
    <group
      ref={ref}
      position={live?.position ?? pose.position}
      rotation={rotation}
      visible={effective.visible}
      {...handlers}
    >
      {meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} dispose={null} />
      ))}
      {effective.children.map((id) => {
        const surface = built?.evaluation.surfaces.find((s) => s.id === effective.attachments[id])
        return (
          <group key={id} position={surface?.position ?? [0, 0, 0]} rotation={surface?.rotation}>
            <NodeRenderer nodeId={id as AnyNodeId} />
          </group>
        )
      })}
    </group>
  )
}
