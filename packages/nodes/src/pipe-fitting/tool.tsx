'use client'

import {
  type AnyNode,
  type AnyNodeId,
  emitter,
  type GridEvent,
  PipeFittingNode,
  PipeSegmentNode,
} from '@pascal-app/core'
import {
  CursorSphere,
  EDITOR_LAYER,
  isGridSnapActive,
  isMagneticSnapActive,
  triggerSFX,
  useEditor,
  useInteractionScope,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Euler, type Material, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import { accessoryCursor } from '../shared/accessory-cursor'
import { inheritFittingProfile } from '../shared/accessory-placement'
import {
  findAccessoryPort,
  snapAccessoryPoint,
  subscribeAccessorySnapping,
} from '../shared/accessory-snapping'
import { ConnectionFeedback } from '../shared/connection-feedback'
import { alignDrawPoint, clearDrawAlignment } from '../shared/draw-alignment'
import {
  AXIS_VECTORS,
  cycleRotationAxis,
  getRotationAxis,
  ROTATE_STEP_RAD,
} from '../shared/fitting-rotation'
import { createFittingSurfaceSupport } from '../shared/fitting-surface-support'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import {
  collectScenePorts,
  DWV_PORT_SYSTEMS,
  findNearestRunBody3D,
  findNearestRunBodyXZ,
  type ScenePort,
} from '../shared/ports'
import { pipeFittingDefinition } from './definition'
import { buildPipeFittingGeometry } from './geometry'
import {
  isInlinePipeFitting,
  type PipeInlineInsertionPlan,
  planPipeInlineInsertion,
} from './inline-insertion'
import { localPipeFittingPorts } from './ports'

const PREVIEW_OPACITY = 0.55

type Placement = {
  position: [number, number, number]
  rotation: [number, number, number]
  snapPort: ScenePort | null
  insertion: PipeInlineInsertionPlan | null
  node: PipeFittingNode
  valid: boolean
}

type PlacementContext = {
  levelId: AnyNodeId | null
  nodes: Readonly<Record<AnyNodeId, AnyNode>>
}

/**
 * Resolve where the fitting would land for a cursor at `raw`:
 *   - Near an existing DWV port → mate: orientation aligns the inlet
 *     onto the port (plus the user's manual R/T rotation, pivoting
 *     around the inlet collar so it stays on the port while the body
 *     sweeps).
 *   - Otherwise → grid-snapped free placement on the floor, manual
 *     rotation only.
 */
export function resolvePlacement(
  raw: [number, number, number],
  previewNode: PipeFittingNode,
  gridStep: number,
  manualQuat: Quaternion,
  surfaceHit: boolean,
  surfaceNormal?: [number, number, number],
  support = createFittingSurfaceSupport(),
  context: PlacementContext = { levelId: null, nodes: {} },
): Placement {
  const { levelId, nodes } = context
  const port = levelId
    ? findAccessoryPort(
        raw,
        collectScenePorts({ systems: DWV_PORT_SYSTEMS, levelId }, nodes),
        isGridSnapActive() || isMagneticSnapActive(),
        surfaceHit,
      )
    : null
  if (port) {
    clearDrawAlignment()
    const fittedNode = inheritFittingProfile(previewNode, port, nodes)
    const direction = new Vector3(...port.direction).normalize()
    // Local +X must map onto the port's outward direction so the inlet
    // (local -X) faces back into the run it's joining. Manual rotation
    // composes in the world frame on top of the mate orientation.
    const mate = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), direction)
    const final = manualQuat.clone().multiply(mate)
    const inlet = localPipeFittingPorts(fittedNode)[0]!
    const inletWorldOffset = inlet.position.clone().applyQuaternion(final)
    const position = new Vector3(...port.position).sub(inletWorldOffset)
    const euler = new Euler().setFromQuaternion(final)
    return {
      position: [position.x, position.y, position.z],
      rotation: [euler.x, euler.y, euler.z],
      snapPort: port,
      insertion: null,
      node: fittedNode,
      valid: true,
    }
  }
  const snappingEnabled = isGridSnapActive() || isMagneticSnapActive()
  if (levelId && snappingEnabled && isInlinePipeFitting(previewNode)) {
    const filter = {
      kinds: ['pipe-segment'],
      levelId,
    } as const
    const hit = surfaceHit
      ? findNearestRunBody3D(raw, 0.5, filter, undefined, nodes)
      : findNearestRunBodyXZ(raw, 0.5, filter, nodes)
    const run = hit ? nodes[hit.nodeId] : null
    if (hit && run?.type === 'pipe-segment') {
      const insertion = planPipeInlineInsertion(run, hit, previewNode)
      const axis = new Vector3(...run.path[hit.segmentIndex + 1]!)
        .sub(new Vector3(...run.path[hit.segmentIndex]!))
        .normalize()
      const target: ScenePort = {
        id: 'body',
        nodeId: run.id,
        position: hit.point,
        direction: [axis.x, axis.y, axis.z],
        diameter: run.diameter,
        system: run.system,
      }
      if (insertion) {
        clearDrawAlignment()
        return {
          position: insertion.fitting.position,
          rotation: insertion.fitting.rotation,
          snapPort: target,
          insertion,
          node: insertion.fitting,
          valid: true,
        }
      }
      const orientation = new Euler().setFromQuaternion(
        new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), axis),
      )
      return {
        position: hit.point,
        rotation: [orientation.x, orientation.y, orientation.z],
        snapPort: target,
        insertion: null,
        node: PipeFittingNode.parse({
          ...previewNode,
          diameter: run.diameter,
          pipeMaterial: run.pipeMaterial,
          system: run.system,
        }),
        valid: false,
      }
    }
  }
  const euler = new Euler().setFromQuaternion(manualQuat)
  const rotation: [number, number, number] = [euler.x, euler.y, euler.z]
  const snapped = alignDrawPoint(snapAccessoryPoint(raw, gridStep, surfaceNormal), {
    applySnap: !surfaceHit && isMagneticSnapActive(),
    bypass: surfaceHit || !isMagneticSnapActive(),
  })
  return {
    position: support(previewNode, rotation, snapped, raw, surfaceNormal),
    rotation,
    snapPort: null,
    insertion: null,
    node: previewNode,
    valid: true,
  }
}

/**
 * Click-place tool for DWV pipe fittings (elbow / wye / sanitary tee) —
 * the plumbing sibling of the duct-fitting tool.
 *
 * A translucent ghost of the fitting follows the cursor. Within snap
 * range of any DWV port (pipe run ends, other fittings' collars) the
 * ghost jumps onto the port — position AND orientation — so one click
 * mates the fitting onto the run.
 *
 * Rotation while placing: **R / T** turn the ghost ±45° around the
 * active world axis; **Alt** cycles the axis (Y → X → Z). The HUD badge
 * above the ghost shows the current axis. When snapped to a port the
 * rotation pivots around the inlet collar so the joint stays mated.
 * Handlers run in the capture phase so R doesn't also spin whatever
 * node happens to be selected.
 */
const PipeFittingTool = () => {
  const { activeLevelId, sceneApi, selectNode } = useRegistryToolContext()
  const [placement, setPlacement] = useState<Placement | null>(null)
  const toolDefaults = useEditor((s) => s.toolDefaults['pipe-fitting'])
  const axis = useEditor((s) => s.rotationAxis)
  // Accumulated manual rotation from R/T presses. Ref (not state) so the
  // emitter callbacks always read the latest without re-subscribing; a
  // placement recompute is triggered explicitly after each change.
  const support = useMemo(createFittingSurfaceSupport, [])
  const manualQuatRef = useRef(new Quaternion())
  // Last raw cursor position so a key press can recompute the placement
  // without waiting for the next mouse move.
  const surfaceNormalRef = useRef<[number, number, number] | undefined>(undefined)
  const surfaceHitRef = useRef(false)
  const lastRawRef = useRef<[number, number, number] | null>(null)

  // Ghost matches exactly what a click creates (the kind's defaults).
  const previewNode = useMemo(
    () => PipeFittingNode.parse({ ...pipeFittingDefinition.defaults(), ...toolDefaults }),
    [toolDefaults],
  )
  const displayNode = placement?.node ?? previewNode
  const ghost = useMemo(() => {
    const group = buildPipeFittingGeometry({
      ...displayNode,
      rotation: placement?.rotation ?? displayNode.rotation,
    })
    group.traverse((child) => {
      // Overlay layer keeps the placement ghost out of the ink / SSGI
      // buffers and the thumbnail export, like every other tool preview.
      child.layers.set(EDITOR_LAYER)
      child.raycast = () => {}
      if (child instanceof Mesh) {
        const clone = (material: Material) => {
          const copy = material.clone()
          if (placement?.valid === false && copy instanceof MeshStandardMaterial) {
            copy.color.set('#dc2626')
          }
          copy.transparent = true
          copy.opacity = PREVIEW_OPACITY
          return copy
        }
        child.material = Array.isArray(child.material)
          ? child.material.map(clone)
          : clone(child.material)
      }
    })
    return group
  }, [displayNode, placement?.rotation, placement?.valid])

  useEffect(
    () => () => {
      ghost.traverse((object) => {
        if (!(object instanceof Mesh)) return
        object.geometry.dispose()
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dispose()
      })
    },
    [ghost],
  )

  useEffect(() => {
    if (!activeLevelId) return
    const draft = PipeFittingNode.parse({ ...previewNode, parentId: activeLevelId })
    useInteractionScope.getState().begin({
      kind: 'placing',
      node: draft,
      nodeId: draft.id,
      nodeType: draft.type,
      view: '3d',
      pressDrag: false,
      driver: 'registry-tool',
    })

    const recompute = () => {
      const raw = lastRawRef.current
      if (!raw) return
      const next = resolvePlacement(
        raw,
        previewNode,
        isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        manualQuatRef.current,
        surfaceHitRef.current,
        surfaceNormalRef.current,
        support,
        { levelId: activeLevelId, nodes: sceneApi.nodes() },
      )
      setPlacement((previous) => ({
        ...next,
        node:
          previous && JSON.stringify(previous.node) === JSON.stringify(next.node)
            ? previous.node
            : next.node,
        rotation: previous?.rotation.every((v, i) => v === next.rotation[i])
          ? previous.rotation
          : next.rotation,
      }))
    }

    const onMove = (event: GridEvent) => {
      const cursor = accessoryCursor(event, activeLevelId)
      surfaceNormalRef.current = cursor.normal
      surfaceHitRef.current = cursor.surface
      lastRawRef.current = cursor.point
      recompute()
    }

    const onClick = (event: GridEvent) => {
      const cursor = accessoryCursor(event, activeLevelId)
      surfaceNormalRef.current = cursor.normal
      surfaceHitRef.current = cursor.surface
      lastRawRef.current = cursor.point
      const resolved = resolvePlacement(
        lastRawRef.current,
        previewNode,
        isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        manualQuatRef.current,
        surfaceHitRef.current,
        surfaceNormalRef.current,
        support,
        { levelId: activeLevelId, nodes: sceneApi.nodes() },
      )
      if (!resolved.valid) return
      const fitting = PipeFittingNode.parse({
        ...resolved.node,
        id: undefined,
        name: resolved.node.fittingType.replaceAll('-', ' ').replace(/^./, (c) => c.toUpperCase()),
        position: resolved.position,
        rotation: resolved.rotation,
      })
      if (resolved.insertion) {
        const parentId = (resolved.insertion.runTail.parentId as AnyNodeId | null) ?? activeLevelId
        const runTail = PipeSegmentNode.parse({
          ...resolved.insertion.runTail,
          id: undefined,
        })
        if (!sceneApi.applyChanges) throw new Error('Registry SceneApi must support atomic changes')
        sceneApi.applyChanges({
          update: [resolved.insertion.runUpdate],
          create: [
            { node: fitting, parentId },
            { node: runTail, parentId },
          ],
        })
      } else {
        sceneApi.upsert(fitting, activeLevelId)
      }
      selectNode(fitting.id)
      triggerSFX('sfx:item-place')
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const key = e.key
      if (key === 'r' || key === 'R' || key === 't' || key === 'T') {
        // Capture-phase + stopPropagation so the editor's selection-rotate
        // R handler doesn't also fire while the placement tool owns R.
        e.preventDefault()
        e.stopPropagation()
        const steps = key === 't' || key === 'T' || e.shiftKey ? -1 : 1
        const turn = new Quaternion().setFromAxisAngle(
          AXIS_VECTORS[getRotationAxis()],
          steps * ROTATE_STEP_RAD,
        )
        manualQuatRef.current = turn.multiply(manualQuatRef.current)
        triggerSFX('sfx:item-rotate')
        recompute()
      } else if (key === 'Alt' && !e.repeat) {
        e.preventDefault()
        e.stopPropagation()
        cycleRotationAxis()
      }
    }

    recompute()
    const unsubscribeSnapping = subscribeAccessorySnapping(recompute)
    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'placing' && scope.nodeId === draft.id)
      unsubscribeSnapping()
      clearDrawAlignment()
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activeLevelId, previewNode, sceneApi, selectNode, support])

  if (!activeLevelId || !placement) return null

  return (
    <LevelOffsetGroup>
      <ConnectionFeedback
        point={placement.position}
        target={placement.snapPort}
        levelId={activeLevelId}
        profile={displayNode}
      />
      {/* Same ground ring + vertical line + tool-icon badge the duct draw
          tool shows in 3D (icon resolved from the active `pipe-fitting`
          structure-tools entry). In 2D the floorplan overlay draws this for
          every tool; in 3D each tool renders its own. */}
      <CursorSphere position={placement.position} />
      <group position={placement.position} rotation={placement.rotation}>
        <primitive object={ghost} />
      </group>
      {/* Rotation HUD — active axis + key hints, pinned above the ghost. */}
      <Html
        center
        position={[placement.position[0], placement.position[1] + 1.45, placement.position[2]]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        {/* Same pill shell as DimensionPill so the placement HUD matches
            the drawing / dragging readouts. */}
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur">
          <span className="font-medium text-foreground">Axis {axis.toUpperCase()}</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">R/T rotate</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">⌥ axis</span>
        </div>
      </Html>
      {/* Port-snap halo so the user sees the click will mate, not free-place. */}
      {placement.snapPort && (
        <mesh
          layers={EDITOR_LAYER}
          position={placement.snapPort.position as [number, number, number]}
        >
          <sphereGeometry args={[0.18, 24, 16]} />
          <meshBasicMaterial color="#818cf8" depthTest={false} opacity={0.35} transparent />
        </mesh>
      )}
    </LevelOffsetGroup>
  )
}

export default PipeFittingTool
