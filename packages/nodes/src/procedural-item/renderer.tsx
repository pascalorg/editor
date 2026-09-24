'use client'
import {
  type AnyNode,
  type AnyNodeId,
  useInteractive,
  useLiveNodeOverrides,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  type ProceduralItemNode,
  ProceduralMotionController,
  proceduralLocalPose,
} from '@pascal-app/core/procedural-items'
import {
  createSurfaceRoleMaterial,
  NodeRenderer,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
  useLibraryMaterialsVersion,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Group, Mesh } from 'three'
import { acquireProceduralGeometry, type BuiltItem, geometrySignature } from './geometry'
export default function ProceduralRenderer({ node }: { node: ProceduralItemNode }) {
  const ref = useRef<Group>(null!)
  const controller = useRef<ProceduralMotionController | null>(null)
  const lastCommand = useRef(0)
  const awake = useRef(false)
  const invalidate = useThree((state) => state.invalidate)
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
  useEffect(() => () => useInteractive.getState().removeProcedural(node.id), [node.id])
  useLayoutEffect(() => {
    controller.current = built ? new ProceduralMotionController(built.evaluation.motions) : null
    lastCommand.current = 0
    if (built)
      useInteractive
        .getState()
        .initProcedural(node.id, [
          ...new Set(built.evaluation.motions.map((motion) => motion.partId)),
        ])
    for (const motion of built?.evaluation.motions ?? []) {
      const group = ref.current?.getObjectByName(`${node.id}__motion__${motion.id}`)
      if (!group) continue
      group.position.set(...motion.pivot)
      group.quaternion.identity()
    }
    if (built?.evaluation.motions.length) {
      awake.current = true
      invalidate()
    }
  }, [built, node.id, invalidate])
  useEffect(
    () =>
      useInteractive.subscribe((state, previous) => {
        if (state.procedural[node.id] === previous.procedural[node.id]) return
        awake.current = true
        invalidate()
      }),
    [node.id, invalidate],
  )
  useFrame((_, delta) => {
    if (!awake.current || !built || !ref.current) return
    const state = useInteractive.getState().procedural[node.id]
    if (state?.motionCommand && state.motionCommand.sequence > lastCommand.current) {
      controller.current?.command(state.motionCommand)
      lastCommand.current = state.motionCommand.sequence
    }
    const frame = controller.current?.tick(delta)
    if (!frame) return
    for (const motion of built.evaluation.motions) {
      const group = ref.current.getObjectByName(`${node.id}__motion__${motion.id}`)
      if (!group) continue
      if (motion.kind === 'spin') {
        group.rotation[motion.axis] = frame.spins[motion.id]?.phase ?? 0
      } else {
        const fraction = frame.fractions[motion.id] ?? 0
        if (motion.kind === 'hinge') group.rotation[motion.axis] = motion.amount * fraction
        else
          group.position[motion.axis] =
            motion.pivot[{ x: 0, y: 1, z: 2 }[motion.axis]]! + motion.amount * fraction
      }
    }
    if (frame.pending) invalidate()
    else awake.current = false
  })
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
        const mesh = new Mesh(batch.motionGeometry ?? batch.geometry, materials.get(batch.slot))
        mesh.name = `slot_${batch.slot}`
        mesh.userData = { slotId: batch.slot, proceduralRanges: batch.ranges }
        mesh.castShadow = true
        mesh.receiveShadow = true
        return { mesh, motionGroup: batch.motionGroup }
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
      {meshes
        .filter((entry) => !entry.motionGroup)
        .map(({ mesh }) => (
          <primitive key={mesh.uuid} object={mesh} dispose={null} />
        ))}
      {built?.evaluation.motions.map((motion) => (
        <group
          key={motion.id}
          name={`${node.id}__motion__${motion.id}`}
          position={motion.pivot}
          userData={{
            proceduralMotion: {
              nodeId: node.id,
              partId: motion.partId,
              groupId: motion.id,
              kind: motion.kind,
            },
          }}
        >
          {meshes
            .filter((entry) => entry.motionGroup === motion.id)
            .map(({ mesh }) => (
              <primitive key={mesh.uuid} object={mesh} dispose={null} />
            ))}
        </group>
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
