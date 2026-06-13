'use client'

import {
  type AnyNodeId,
  DuctTerminalNode,
  emitter,
  resolveLevelId,
  sceneRegistry,
  useScene,
  type WallEvent,
} from '@pascal-app/core'
import { triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Matrix3, Matrix4, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { ductTerminalDefinition } from './definition'
import { buildDuctTerminalGeometry } from './geometry'

const PREVIEW_OPACITY = 0.55
/** R/T yaw step — 45°. */
const ROTATE_STEP_RAD = Math.PI / 4
/** Fallback ceiling height (meters) when no walls/ceilings inform one. */
const DEFAULT_CEILING_HEIGHT = 2.5

type Mount = DuctTerminalNode['mount']
const MOUNT_CYCLE: Mount[] = ['floor', 'ceiling', 'wall']

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/** The active building's mesh, or null when placing outside a building. */
function activeBuildingMesh() {
  const buildingId = useViewer.getState().selection.buildingId
  return buildingId ? (sceneRegistry.nodes.get(buildingId as AnyNodeId) ?? null) : null
}

/**
 * Ceiling height for the active level, in level-local meters: the tallest
 * ceiling node if any exist, else the tallest wall, else the default. Used
 * as the horizontal plane a ceiling-mounted terminal snaps onto when the
 * mount is `ceiling` (a "virtual ceiling" derived from the walls, so the
 * terminal lands at hang height even before a ceiling node is drawn).
 */
function resolveCeilingHeight(activeLevelId: string): number {
  const nodes = useScene.getState().nodes
  let ceilingMax = 0
  let wallMax = 0
  for (const node of Object.values(nodes)) {
    if (!node) continue
    if (node.type !== 'ceiling' && node.type !== 'wall') continue
    if (resolveLevelId(node, nodes) !== activeLevelId) continue
    const h = (node as { height?: number }).height ?? DEFAULT_CEILING_HEIGHT
    if (node.type === 'ceiling') ceilingMax = Math.max(ceilingMax, h)
    else wallMax = Math.max(wallMax, h)
  }
  if (ceilingMax > 0) return ceilingMax
  if (wallMax > 0) return wallMax
  return DEFAULT_CEILING_HEIGHT
}

type Placement = {
  position: [number, number, number]
  /** Yaw radians applied to the ghost / committed node. */
  yaw: number
}

/**
 * Click-place tool for duct terminals (registers / diffusers / grilles).
 *
 * **Mount drives the target surface** (cycle with **M**): a floor register
 * snaps to the floor grid, a ceiling diffuser snaps to a horizontal plane at
 * ceiling height (derived from the level's ceilings/walls), and a wall
 * register snaps flush onto whichever wall the cursor is over, its face
 * oriented along the wall's outward normal. **R / T** rotate the floor/ceiling
 * yaw ±45°; wall yaw is fixed by the wall it mates to.
 */
const DuctTerminalTool = () => {
  const { camera, gl } = useThree()
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const [mount, setMount] = useState<Mount>('floor')
  const [placement, setPlacement] = useState<Placement | null>(null)

  const mountRef = useRef<Mount>('floor')
  const yawRef = useRef(0)
  const raycaster = useRef(new Raycaster())
  const pointer = useRef(new Vector2())

  const previewNode = useMemo(
    () => DuctTerminalNode.parse({ ...ductTerminalDefinition.defaults(), name: 'Register', mount }),
    [mount],
  )
  const ghost = useMemo(() => {
    const group = buildDuctTerminalGeometry(previewNode)
    group.traverse((child) => {
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
    const canvas = gl.domElement

    /**
     * Intersect the cursor ray with a level-local horizontal plane at `y`.
     * The ray is transformed into building-local space first, so the hit is
     * already in the frame terminals are stored in (matching how the duct
     * draw tool stores `grid:move` local positions).
     */
    const hitLocalPlane = (nativeEvent: PointerEvent | MouseEvent, y: number): Vector3 | null => {
      const rect = canvas.getBoundingClientRect()
      pointer.current.x = ((nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
      pointer.current.y = -((nativeEvent.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.current.setFromCamera(pointer.current, camera)

      const building = activeBuildingMesh()
      const ray = raycaster.current.ray.clone()
      if (building) {
        const inv = new Matrix4().copy(building.matrixWorld).invert()
        ray.applyMatrix4(inv)
      }
      const plane = new Plane(new Vector3(0, 1, 0), -y)
      const hit = new Vector3()
      return ray.intersectPlane(plane, hit) ? hit : null
    }

    const resolvePlanar = (nativeEvent: PointerEvent | MouseEvent): Placement | null => {
      const y = mountRef.current === 'ceiling' ? resolveCeilingHeight(activeLevelId) : 0
      const hit = hitLocalPlane(nativeEvent, y)
      if (!hit) return null
      const step = nativeEvent.shiftKey ? 0 : useEditor.getState().gridSnapStep
      return {
        position: [snap(hit.x, step), y, snap(hit.z, step)],
        yaw: yawRef.current,
      }
    }

    const commit = (p: Placement) => {
      const terminal = DuctTerminalNode.parse({
        ...ductTerminalDefinition.defaults(),
        name: 'Register',
        mount: mountRef.current,
        position: p.position,
        rotation: p.yaw,
      })
      useScene.getState().createNode(terminal, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [terminal.id] })
      triggerSFX('sfx:item-place')
    }

    // ---- Floor / ceiling: own raycast against a horizontal plane ----
    const onPointerMove = (e: PointerEvent) => {
      if (mountRef.current === 'wall') return
      setPlacement(resolvePlanar(e))
    }

    const onCanvasClick = (e: MouseEvent) => {
      if (mountRef.current === 'wall') return
      if (useViewer.getState().cameraDragging) return
      if ((e as PointerEvent).button !== undefined && (e as PointerEvent).button !== 0) return
      const p = resolvePlanar(e)
      if (p) commit(p)
    }

    // ---- Wall: consume wall hover/click events, orient to the wall ----
    const resolveWall = (event: WallEvent): Placement | null => {
      if (!event.normal) return null
      // Wall faces are the ±Z faces in wall-local space; skip the thin
      // top / end caps so the terminal only mounts onto a real face.
      if (Math.abs(event.normal[2]) <= 0.7) return null
      const worldNormal = new Vector3(event.normal[0], event.normal[1], event.normal[2])
        .applyNormalMatrix(new Matrix3().getNormalMatrix(event.object.matrixWorld))
        .normalize()
      // Face normal after the wall mount + yaw is (sin yaw, 0, cos yaw);
      // align it with the wall's outward world normal.
      const yaw = Math.atan2(worldNormal.x, worldNormal.z)

      const world = new Vector3(event.position[0], event.position[1], event.position[2])
      const building = activeBuildingMesh()
      const local = building ? building.worldToLocal(world.clone()) : world
      return { position: [local.x, local.y, local.z], yaw }
    }

    const onWallMove = (event: WallEvent) => {
      if (mountRef.current !== 'wall') return
      const p = resolveWall(event)
      if (p) setPlacement(p)
    }

    const onWallClick = (event: WallEvent) => {
      if (mountRef.current !== 'wall') return
      if (useViewer.getState().cameraDragging) return
      const p = resolveWall(event)
      if (p) commit(p)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const key = e.key
      if (key === 'm' || key === 'M') {
        e.preventDefault()
        e.stopPropagation()
        const next = MOUNT_CYCLE[(MOUNT_CYCLE.indexOf(mountRef.current) + 1) % MOUNT_CYCLE.length]!
        mountRef.current = next
        setMount(next)
        // Wall placement only resolves over a wall; clear the stale ghost.
        if (next === 'wall') setPlacement(null)
        triggerSFX('sfx:item-rotate')
        return
      }
      if (key !== 'r' && key !== 'R' && key !== 't' && key !== 'T') return
      // Wall yaw is dictated by the wall, so R/T only apply to planar mounts.
      if (mountRef.current === 'wall') return
      e.preventDefault()
      e.stopPropagation()
      const steps = key === 't' || key === 'T' || e.shiftKey ? -1 : 1
      yawRef.current += steps * ROTATE_STEP_RAD
      setPlacement((prev) => (prev ? { ...prev, yaw: yawRef.current } : prev))
      triggerSFX('sfx:item-rotate')
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('click', onCanvasClick)
    emitter.on('wall:move', onWallMove)
    emitter.on('wall:click', onWallClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('click', onCanvasClick)
      emitter.off('wall:move', onWallMove)
      emitter.off('wall:click', onWallClick)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activeLevelId, camera, gl])

  if (!activeLevelId || !placement) return null

  const mountLabel = mount.charAt(0).toUpperCase() + mount.slice(1)

  return (
    <group>
      <group position={placement.position} rotation={[0, placement.yaw, 0]}>
        <primitive object={ghost} />
      </group>
      <Html
        center
        position={[placement.position[0], placement.position[1] + 0.45, placement.position[2]]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur">
          <span className="font-medium text-foreground">Mount {mountLabel}</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">M surface</span>
          {mount !== 'wall' && (
            <>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span className="text-muted-foreground">R/T rotate</span>
            </>
          )}
        </div>
      </Html>
    </group>
  )
}

export default DuctTerminalTool
