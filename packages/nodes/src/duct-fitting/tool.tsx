'use client'

import { DuctFittingNode, emitter, type GridEvent, useScene } from '@pascal-app/core'
import {
  CursorSphere,
  EDITOR_LAYER,
  isGridSnapActive,
  isMagneticSnapActive,
  triggerSFX,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Euler, type Material, Mesh, Quaternion, Vector3 } from 'three'
import { accessoryCursor } from '../shared/accessory-cursor'
import {
  accessoryMateQuaternion,
  inheritFittingProfile,
  placeAccessPanel,
} from '../shared/accessory-placement'
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
import { collectScenePorts, DUCT_PORT_SYSTEMS, type ScenePort } from '../shared/ports'
import { ductFittingDefinition } from './definition'
import { buildDuctFittingGeometry } from './geometry'
import { localFittingPorts } from './ports'

const PREVIEW_OPACITY = 0.55

type Placement = {
  position: [number, number, number]
  rotation: [number, number, number]
  snapPort: ScenePort | null
  node: DuctFittingNode
  valid: boolean
}

/**
 * Resolve where the fitting would land for a cursor at `raw`:
 *   - Near an existing port → mate: orientation aligns the inlet onto
 *     the port (plus the user's manual R/T rotation, pivoting around
 *     the inlet collar so it stays on the port while the body sweeps).
 *   - Otherwise → grid-snapped free placement on the floor, manual
 *     rotation only.
 */
export function resolvePlacement(
  raw: [number, number, number],
  previewNode: DuctFittingNode,
  gridStep: number,
  manualQuat: Quaternion,
  surfaceHit: boolean,
  surfaceNormal?: [number, number, number],
  support = createFittingSurfaceSupport(),
): Placement {
  const levelId = useViewer.getState().selection.levelId
  if (previewNode.fittingType === 'access-panel') {
    const enabled = isGridSnapActive() || isMagneticSnapActive()
    const mounted = enabled
      ? placeAccessPanel(raw, previewNode, useScene.getState().nodes, levelId, surfaceHit, gridStep)
      : null
    const normal = new Vector3(...(surfaceNormal ?? [0, 1, 0])).normalize()
    const orientation = manualQuat
      .clone()
      .multiply(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), normal))
    const euler = new Euler().setFromQuaternion(orientation)
    const rotation: [number, number, number] = [euler.x, euler.y, euler.z]
    return {
      ...(mounted ?? {
        position: support(
          previewNode,
          rotation,
          snapAccessoryPoint(raw, gridStep, surfaceNormal),
          raw,
          surfaceNormal,
        ),
        rotation,
      }),
      snapPort: null,
      node: previewNode,
      valid: true,
    }
  }
  const port = levelId
    ? findAccessoryPort(
        raw,
        collectScenePorts({ systems: DUCT_PORT_SYSTEMS, levelId }),
        isGridSnapActive() || isMagneticSnapActive(),
        surfaceHit,
      )
    : null
  if (port) {
    clearDrawAlignment()
    const fittedNode = inheritFittingProfile(previewNode, port, useScene.getState().nodes)
    // Local +X must map onto the port's outward direction so the inlet
    // (local -X) faces back into the run it's joining. Manual rotation
    // composes in the world frame on top of the mate orientation.
    const mate = accessoryMateQuaternion(fittedNode, port, useScene.getState().nodes)
    const final = manualQuat.clone().multiply(mate)
    const inlet = localFittingPorts(fittedNode)[0]!
    const inletWorldOffset = inlet.position.clone().applyQuaternion(final)
    const position = new Vector3(...port.position).sub(inletWorldOffset)
    const euler = new Euler().setFromQuaternion(final)
    return {
      position: [position.x, position.y, position.z],
      rotation: [euler.x, euler.y, euler.z],
      snapPort: port,
      node: fittedNode,
      valid: true,
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
    node: previewNode,
    valid: true,
  }
}

/**
 * Click-place tool for duct fittings (elbow / tee / reducer).
 *
 * A translucent ghost of the fitting follows the cursor. Within snap
 * range of any scene port (duct run ends, other fittings' collars) the
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
const DuctFittingTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const toolDefaults = useEditor((s) => s.toolDefaults['duct-fitting'])
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
    () => DuctFittingNode.parse({ ...ductFittingDefinition.defaults(), ...toolDefaults }),
    [toolDefaults],
  )
  const displayNode = placement?.node ?? previewNode
  const ghost = useMemo(() => {
    const group = buildDuctFittingGeometry({
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
  }, [displayNode, placement?.rotation])

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
    const draft = DuctFittingNode.parse({ ...previewNode, parentId: activeLevelId })
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
      )
      if (!resolved.valid) return
      const fitting = DuctFittingNode.parse({
        ...resolved.node,
        id: undefined,
        name: resolved.node.fittingType.replaceAll('-', ' ').replace(/^./, (c) => c.toUpperCase()),
        position: resolved.position,
        rotation: resolved.rotation,
      })
      useScene.getState().createNode(fitting, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [fitting.id] })
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
  }, [activeLevelId, previewNode, support])

  if (!activeLevelId || !placement) return null

  return (
    <LevelOffsetGroup>
      {previewNode.fittingType !== 'access-panel' && (
        <ConnectionFeedback
          point={placement.position}
          target={placement.snapPort}
          levelId={activeLevelId}
          profile={displayNode}
        />
      )}
      {/* Same ground ring + vertical line + tool-icon badge the duct draw
          tool shows in 3D (icon resolved from the active `duct-fitting`
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
          {previewNode.fittingType === 'access-panel' && (
            <span>
              {placement.valid ? 'Place access door' : 'Hover a duct face that fits the door'}
            </span>
          )}
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

export default DuctFittingTool
