'use client'

import { emitter, type GridEvent, PipeFittingNode, useScene } from '@pascal-app/core'
import {
  CursorSphere,
  EDITOR_LAYER,
  isGridSnapActive,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Euler, Quaternion, Vector3 } from 'three'
import {
  AXIS_VECTORS,
  cycleRotationAxis,
  getRotationAxis,
  ROTATE_STEP_RAD,
} from '../shared/fitting-rotation'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import {
  collectScenePorts,
  DWV_PORT_SYSTEMS,
  findNearestPortXZ,
  type ScenePort,
} from '../shared/ports'
import { pipeFittingDefinition } from './definition'
import { buildPipeFittingGeometry } from './geometry'
import { localPipeFittingPorts } from './ports'

/** Snap radius (meters, XZ) for mating onto an existing DWV port. */
const PORT_SNAP_RADIUS_M = 0.5
const PREVIEW_OPACITY = 0.55

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

type Placement = {
  position: [number, number, number]
  rotation: [number, number, number]
  snapPort: ScenePort | null
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
function resolvePlacement(
  raw: [number, number, number],
  previewNode: PipeFittingNode,
  gridStep: number,
  manualQuat: Quaternion,
): Placement {
  const port = findNearestPortXZ(
    raw,
    collectScenePorts({ systems: DWV_PORT_SYSTEMS }),
    PORT_SNAP_RADIUS_M,
  )
  if (port) {
    const direction = new Vector3(...port.direction).normalize()
    // Local +X must map onto the port's outward direction so the inlet
    // (local -X) faces back into the run it's joining. Manual rotation
    // composes in the world frame on top of the mate orientation.
    const mate = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), direction)
    const final = manualQuat.clone().multiply(mate)
    const inlet = localPipeFittingPorts(previewNode)[0]!
    const inletWorldOffset = inlet.position.clone().applyQuaternion(final)
    const position = new Vector3(...port.position).sub(inletWorldOffset)
    const euler = new Euler().setFromQuaternion(final)
    return {
      position: [position.x, position.y, position.z],
      rotation: [euler.x, euler.y, euler.z],
      snapPort: port,
    }
  }
  const euler = new Euler().setFromQuaternion(manualQuat)
  return {
    position: [snap(raw[0], gridStep), 0, snap(raw[2], gridStep)],
    rotation: [euler.x, euler.y, euler.z],
    snapPort: null,
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
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const axis = useEditor((s) => s.rotationAxis)
  // Accumulated manual rotation from R/T presses. Ref (not state) so the
  // emitter callbacks always read the latest without re-subscribing; a
  // placement recompute is triggered explicitly after each change.
  const manualQuatRef = useRef(new Quaternion())
  // Last raw cursor position so a key press can recompute the placement
  // without waiting for the next mouse move.
  const lastRawRef = useRef<[number, number, number] | null>(null)

  // Ghost matches exactly what a click creates (the kind's defaults).
  const previewNode = useMemo(
    () => PipeFittingNode.parse({ ...pipeFittingDefinition.defaults(), name: 'Pipe fitting' }),
    [],
  )
  const ghost = useMemo(() => {
    const group = buildPipeFittingGeometry(previewNode)
    group.traverse((child) => {
      // Overlay layer keeps the placement ghost out of the ink / SSGI
      // buffers and the thumbnail export, like every other tool preview.
      child.layers.set(EDITOR_LAYER)
      const mesh = child as { material?: { transparent: boolean; opacity: number } }
      if (mesh.material) {
        mesh.material.transparent = true
        mesh.material.opacity = PREVIEW_OPACITY
      }
    })
    return group
  }, [previewNode])

  useEffect(() => {
    if (!activeLevelId) return

    const recompute = () => {
      const raw = lastRawRef.current
      if (!raw) return
      setPlacement(
        resolvePlacement(
          raw,
          previewNode,
          isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
          manualQuatRef.current,
        ),
      )
    }

    const onMove = (event: GridEvent) => {
      lastRawRef.current = [event.localPosition[0], 0, event.localPosition[2]]
      recompute()
    }

    const onClick = (event: GridEvent) => {
      lastRawRef.current = [event.localPosition[0], 0, event.localPosition[2]]
      const { position, rotation } = resolvePlacement(
        lastRawRef.current,
        previewNode,
        isGridSnapActive() ? useEditor.getState().gridSnapStep : 0,
        manualQuatRef.current,
      )
      const fitting = PipeFittingNode.parse({
        ...pipeFittingDefinition.defaults(),
        name: 'Pipe fitting',
        position,
        rotation,
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

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId || !placement) return null

  return (
    <LevelOffsetGroup>
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
