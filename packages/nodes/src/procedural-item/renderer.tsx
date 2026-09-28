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
  type EvaluatedMotion,
  motionAxis,
  motionRestOffset,
  type ProceduralItemNode,
  ProceduralMotionController,
  proceduralLocalPose,
} from '@pascal-app/core/procedural-items'
import { usePlacementPreview } from '@pascal-app/editor'
import {
  cloneWithProceduralEmission,
  createSurfaceRoleMaterial,
  NodeRenderer,
  proceduralSlotMeshes,
  resolveMaterialRef,
  resolveSlotDefaultMaterial,
  setProceduralEmission,
  useItemLightPool,
  useLibraryMaterialsVersion,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useFrame, useThree } from '@react-three/fiber'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type Group, Mesh, Vector3 } from 'three'
import { canRegisterItemLight } from '../shared/item-light-placement'
import { releaseFromBatch } from '../shared/node-batch/release'
import { setProceduralMotionPlaying } from './animation'
import { acquireProceduralGeometry, type BuiltItem, geometrySignature } from './geometry'

const axis = new Vector3()
const noRaycast = () => {}
// Hidden mesh sets are skipped by raycasts too (three raycasts invisible objects).
function setDrawn(container: Group, drawn: boolean) {
  container.visible = drawn
  container.traverse((child) => {
    if (child instanceof Mesh) child.raycast = drawn ? Mesh.prototype.raycast : noRaycast
  })
}
export default function ProceduralRenderer({ node }: { node: ProceduralItemNode }) {
  const ref = useRef<Group>(null!)
  // Part-tree designs draw their merged rest pose while idle and their joint groups while moving.
  const restRef = useRef<Group>(null)
  const splitRef = useRef<Group>(null)
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
  const lightsOn = useInteractive(
    (state) => state.procedural[node.id]?.lightsOn ?? state.lampDefault,
  )
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
  useEffect(
    () => () => {
      useInteractive.getState().removeProcedural(node.id)
      setProceduralMotionPlaying(node.id, false)
    },
    [node.id],
  )
  // A recessed design's host ceiling re-cuts whenever its cut can move, live values included.
  const cutKey = effective.recipe.cuts
    ? JSON.stringify([
        node.parentId,
        effective.position,
        effective.rotation,
        effective.parameters,
        effective.visible,
        effective.recipe.cuts,
        effective.recipe.surfaces,
        effective.recipe.mounting?.reference,
      ])
    : ''
  useEffect(() => {
    const parentId = node.parentId as AnyNodeId | null
    if (!(cutKey && parentId)) return
    const recut = () => {
      if (useScene.getState().nodes[parentId]) useScene.getState().markDirty(parentId)
    }
    recut()
    // A move preview of this design re-cuts its ceiling on every step.
    const unsubscribe = usePlacementPreview.subscribe((state, previous) => {
      if (state.node?.id === node.id || previous.node?.id === node.id) recut()
    })
    return () => {
      unsubscribe()
      recut()
    }
  }, [cutKey, node.parentId, node.id])
  useLayoutEffect(() => {
    // Continuous joints start running, as in the baked viewer; flat spins keep #930's default.
    const running = new Set(
      (node.recipe.joints ?? [])
        .filter((joint) => joint.kind === 'continuous')
        .map((joint) => joint.child),
    )
    controller.current = built
      ? new ProceduralMotionController(
          built.evaluation.motions,
          Object.fromEntries([...running].map((partId) => [partId, true])),
        )
      : null
    lastCommand.current = 0
    if (built)
      useInteractive
        .getState()
        .initProcedural(
          node.id,
          [...new Set(built.evaluation.motions.map((motion) => motion.partId))],
          [...running],
        )
    for (const motion of built?.evaluation.motions ?? []) {
      const group = ref.current?.getObjectByName(`${node.id}__motion__${motion.id}`)
      if (!group) continue
      group.position.set(...motionRestOffset(motion, built!.evaluation.motions))
      group.quaternion.identity()
    }
    if (restRef.current) setDrawn(restRef.current, true)
    if (splitRef.current) setDrawn(splitRef.current, false)
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
      const angle =
        motion.kind === 'spin'
          ? (frame.spins[motion.id]?.phase ?? 0)
          : motion.amount * (frame.fractions[motion.id] ?? 0)
      if (motion.kind === 'slide')
        group.position
          .set(...motionRestOffset(motion, built.evaluation.motions))
          .addScaledVector(axis.set(...motionAxis(motion)), angle)
      else if (motion.direction)
        group.quaternion.setFromAxisAngle(axis.set(...motion.direction), angle)
      else group.rotation[motion.axis] = angle
    }
    if (restRef.current && splitRef.current) {
      const moving =
        frame.pending ||
        Object.values(frame.fractions).some((fraction) => fraction > 0) ||
        Object.values(frame.spins).some((spin) => spin.speed > 0)
      if (restRef.current.visible === moving) {
        setDrawn(restRef.current, !moving)
        setDrawn(splitRef.current, moving)
      }
    }
    // A playing motion draws its own meshes; it rejoins the node batch at the settled pose.
    if (setProceduralMotionPlaying(node.id, frame.pending)) releaseFromBatch(node.id)
    if (frame.pending) invalidate()
    else awake.current = false
  }, -1)
  useLayoutEffect(() => {
    if (!built || !ref.current || !canRegisterItemLight(effective.metadata)) return
    const pool = useItemLightPool.getState()
    const keys: string[] = []
    for (const light of built.evaluation.lights) {
      const key = `${node.id}:procedural:${light.id}`
      keys.push(key)
      const local = new Vector3(...light.position)
      const motion = built.evaluation.motions.find((entry) => entry.id === light.motionGroup)
      if (motion) local.sub(new Vector3(...motion.pivot))
      pool.register({
        key,
        nodeId: node.id,
        color: light.color,
        distance: light.distance,
        getWorldPosition: (out) => {
          const root = ref.current
          if (!root) return false
          const object = light.motionGroup
            ? root.getObjectByName(`${node.id}__motion__${light.motionGroup}`)
            : root
          if (!object) return false
          object.updateWorldMatrix(true, false)
          out.copy(local).applyMatrix4(object.matrixWorld)
          return true
        },
        getIntensity: () => light.intensity,
        isEligible: () =>
          effective.visible !== false &&
          (useInteractive.getState().procedural[node.id]?.lightsOn ??
            useInteractive.getState().lampDefault),
      })
    }
    return () => {
      for (const key of keys) useItemLightPool.getState().unregister(key)
    }
  }, [built, node.id, effective.visible, effective.metadata?.isNew])
  const materialKey = JSON.stringify([effective.recipe.slots, effective.slots, libraryVersion])
  const materials = useMemo(() => {
    const [slots, overrides] = JSON.parse(materialKey) as [
      ProceduralItemNode['recipe']['slots'],
      ProceduralItemNode['slots'],
    ]
    const emission = new Map(
      built?.evaluation.lights
        .filter((light) => light.emissiveSlot)
        .map((light) => [light.emissiveSlot, light.color]) ?? [],
    )
    return new Map(
      slots.map((s) => {
        const ref = overrides[s.id]
        const material = textures
          ? (resolveMaterialRef(ref, sceneMaterials, shading) ??
            resolveSlotDefaultMaterial(ref?.startsWith('#') ? ref : s.color, shading, 0.75))
          : createSurfaceRoleMaterial('furnishing', colorPreset, undefined, sceneTheme)
        return [
          s.id,
          emission.has(s.id)
            ? cloneWithProceduralEmission(material, emission.get(s.id)!, true)
            : material,
        ] as const
      }),
    )
  }, [materialKey, sceneMaterials, shading, textures, colorPreset, sceneTheme, built])
  useLayoutEffect(() => {
    const slots = new Set<string>()
    for (const light of built?.evaluation.lights ?? []) {
      if (light.emissiveSlot) {
        slots.add(light.emissiveSlot)
        const material = materials.get(light.emissiveSlot)
        if (material) setProceduralEmission(material, lightsOn)
      }
    }
    for (const mesh of ref.current ? proceduralSlotMeshes(ref.current, slots) : []) {
      const active = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of active) setProceduralEmission(material, lightsOn)
    }
  }, [built, materials, lightsOn])
  useLayoutEffect(
    () => () => {
      for (const material of materials.values())
        if (!material.userData.__pascalCachedMaterial) material.dispose()
    },
    [materials],
  )
  const meshes = useMemo(() => {
    const make = (batch: NonNullable<BuiltItem['rest']>[number], geometry = batch.geometry) => {
      const mesh = new Mesh(geometry, materials.get(batch.slot))
      mesh.name = `slot_${batch.slot}`
      mesh.userData = { slotId: batch.slot, proceduralRanges: batch.ranges }
      mesh.castShadow = true
      mesh.receiveShadow = true
      return { mesh, motionGroup: batch.motionGroup }
    }
    return {
      split:
        built?.batches.map((batch) => make(batch, batch.motionGeometry ?? batch.geometry)) ?? [],
      rest: built?.rest?.map((batch) => make(batch)) ?? [],
    }
  }, [built, materials])
  const motions = built?.evaluation.motions ?? []
  const motionGroup = (motion: EvaluatedMotion): ReactNode => (
    <group
      key={motion.id}
      name={`${node.id}__motion__${motion.id}`}
      position={motionRestOffset(motion, motions)}
      userData={{
        proceduralMotion: {
          nodeId: node.id,
          partId: motion.partId,
          groupId: motion.id,
          kind: motion.kind,
        },
      }}
    >
      {meshes.split
        .filter((entry) => entry.motionGroup === motion.id)
        .map(({ mesh }) => (
          <primitive key={mesh.uuid} object={mesh} dispose={null} />
        ))}
      {motions.filter((child) => child.parent === motion.id).map(motionGroup)}
    </group>
  )
  const split = (
    <>
      {meshes.split
        .filter((entry) => !entry.motionGroup)
        .map(({ mesh }) => (
          <primitive key={mesh.uuid} object={mesh} dispose={null} />
        ))}
      {motions.filter((motion) => !motion.parent).map(motionGroup)}
    </>
  )
  const rotation =
    live?.rotation === undefined
      ? pose.rotation
      : ([pose.rotation[0], live.rotation, pose.rotation[2]] as [number, number, number])
  return (
    <group
      ref={ref}
      userData={{ pascalId: node.id }}
      position={live?.position ?? pose.position}
      rotation={rotation}
      visible={effective.visible}
      {...handlers}
    >
      {meshes.rest.length ? (
        <>
          <group ref={restRef} userData={{ pascalProceduralRest: true }}>
            {meshes.rest.map(({ mesh }) => (
              <primitive key={mesh.uuid} object={mesh} dispose={null} />
            ))}
          </group>
          <group ref={splitRef} userData={{ pascalProceduralSplit: true }} visible={false}>
            {split}
          </group>
        </>
      ) : (
        split
      )}
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
