'use client'
import {
  type AnyNode,
  type AnyNodeId,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
} from '@pascal-app/core'
import type { ProceduralItemNode } from '@pascal-app/core/procedural-items'
import { NodeRenderer, useNodeEvents } from '@pascal-app/viewer'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Group, Mesh, MeshStandardMaterial } from 'three'
import { acquireProceduralGeometry, type BuiltItem, geometrySignature } from './geometry'
export default function ProceduralRenderer({ node }: { node: ProceduralItemNode }) {
  const ref = useRef<Group>(null!)
  const overrides = useLiveNodeOverrides((s) => s.overrides.get(node.id))
  const live = useLiveTransforms((s) => s.get(node.id as AnyNodeId))
  const effective = { ...node, ...overrides } as ProceduralItemNode
  const key = geometrySignature(effective)
  const [built, setBuilt] = useState<BuiltItem | null>(null)
  const handlers = useNodeEvents(node as unknown as AnyNode, 'procedural-item' as AnyNode['type'])
  useRegistry(node.id as AnyNodeId, 'procedural-item', ref)
  useLayoutEffect(() => {
    const [recipe, parameters] = JSON.parse(key)
    const lease = acquireProceduralGeometry({ recipe, parameters } as ProceduralItemNode)
    setBuilt(lease.value)
    return lease.release
  }, [key])
  const materialKey = JSON.stringify(
    effective.recipe.slots.map((s) => ({ ...s, color: effective.slots[s.id] ?? s.color })),
  )
  const materials = useMemo(
    () =>
      new Map(
        (JSON.parse(materialKey) as { id: string; color: string }[]).map((s) => [
          s.id,
          new MeshStandardMaterial({
            name: `slot_${s.id}`,
            color: s.color,
            roughness: 0.75,
          }),
        ]),
      ),
    [materialKey],
  )
  useLayoutEffect(
    () => () => {
      for (const m of materials.values()) m.dispose()
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
      ? effective.rotation
      : ([effective.rotation[0], live.rotation, effective.rotation[2]] as [number, number, number])
  return (
    <group
      ref={ref}
      position={live?.position ?? effective.position}
      rotation={rotation}
      visible={node.visible}
      {...handlers}
    >
      {meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} dispose={null} />
      ))}
      {effective.children.map((id) => {
        const surface = built?.evaluation.surfaces.find((s) => s.id === effective.attachments[id])
        return (
          <group key={id} position={surface?.position ?? [0, 0, 0]}>
            <NodeRenderer nodeId={id as AnyNodeId} />
          </group>
        )
      })}
    </group>
  )
}
