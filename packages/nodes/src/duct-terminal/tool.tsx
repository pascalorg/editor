'use client'

import {
  type AnyNodeId,
  DuctTerminalNode,
  emitter,
  pointInPolygon,
  resolveLevelId,
  sceneRegistry,
  useScene,
  type WallEvent,
} from '@pascal-app/core'
import {
  CursorSphere,
  getFloorStackPreviewPosition,
  isGridSnapActive,
  isMagneticSnapActive,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Euler, Matrix3, Matrix4, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import { alignDrawPoint, clearDrawAlignment } from '../shared/draw-alignment'
import { LevelOffsetGroup } from '../shared/level-offset-group'
import { collectScenePorts, DUCT_PORT_SYSTEMS, findNearestPortXZ } from '../shared/ports'
import { ductTerminalDefinition } from './definition'
import { buildDuctTerminalGeometry } from './geometry'
import { COLLAR_LENGTH, mountQuaternion } from './ports'

const PREVIEW_OPACITY = 0.55
/** R/T yaw step — 45°. */
const ROTATE_STEP_RAD = Math.PI / 4
/** Fallback height (meters) for a ceiling node that carries no `height`. */
const DEFAULT_CEILING_HEIGHT = 2.5
/** Snap radius (meters) for mating the collar onto a nearby duct port. */
const PORT_SNAP_RADIUS_M = 0.5

type Mount = DuctTerminalNode['mount']
const MOUNT_CYCLE: Mount[] = ['floor', 'ceiling', 'wall']

function snap(value: number, step: number): number {
  if (step <= 0) return value
  return Math.round(value / step) * step
}

/**
 * Collar-port offset from the node origin for a given mount + yaw, in
 * level-local meters — the same transform `def.ports` applies, so the
 * placement tool can predict where the collar lands and shift the whole
 * terminal to mate it onto a duct port.
 */
function collarOffset(mount: Mount, yaw: number): Vector3 {
  const transform = new Quaternion()
    .setFromEuler(new Euler(0, yaw, 0))
    .multiply(mountQuaternion(mount))
  return new Vector3(0, -COLLAR_LENGTH, 0).applyQuaternion(transform)
}

/** The active level's mesh, or null. Carries the building transform plus the
 *  level's stacked elevation — the frame terminals are stored and parented in,
 *  so cursor hits resolve to true level-local coords on every floor. */
function activeLevelMesh() {
  const levelId = useViewer.getState().selection.levelId
  return levelId ? (sceneRegistry.nodes.get(levelId as AnyNodeId) ?? null) : null
}

type Placement = {
  position: [number, number, number]
  /** Yaw radians applied to the ghost / committed node. */
  yaw: number
  /** Mount the ghost / committed node uses — inferred from the mated port
   *  when snapped, else the user's manual M selection. */
  mount: Mount
  /** True when the collar mated onto a nearby duct port (magnetic snap). */
  snapped?: boolean
}

/** Direction is "vertical" when its Y component dominates this much. */
const VERTICAL_DOT = 0.7

/**
 * Pick the mount that makes a collar mate onto a duct port pointing
 * `dir` (the port's outward direction). The collar leaves the face along
 * −Y in the canonical frame, so the mount rotation must turn −Y to face
 * *into* the port (i.e. opposite `dir`):
 *   - port pointing up (a riser top) → collar must point down → **floor**
 *   - port pointing down (a ceiling drop) → collar points up → **ceiling**
 *   - port horizontal (a wall stub) → **wall**, yawed so the collar runs
 *     back along the port. `lockYaw` is set only for wall (floor / ceiling
 *     yaw is free — the user keeps spinning the face with R/T).
 */
function inferMountFromPort(dir: readonly [number, number, number]): {
  mount: Mount
  lockYaw: number | null
} {
  const v = new Vector3(dir[0], dir[1], dir[2])
  if (v.lengthSq() < 1e-8) return { mount: 'floor', lockYaw: null }
  v.normalize()
  if (v.y > VERTICAL_DOT) return { mount: 'floor', lockYaw: null }
  if (v.y < -VERTICAL_DOT) return { mount: 'ceiling', lockYaw: null }
  // Wall collar dir after mount + yaw is (−sin yaw, 0, −cos yaw); set it
  // opposite the port so the collar runs back into the wall stub.
  return { mount: 'wall', lockYaw: Math.atan2(v.x, v.z) }
}

/**
 * If a duct port is within snap range of `position` (XZ — ports hang at
 * duct height, the grid hit rides the floor), mate the register onto it:
 * the port's direction *picks the mount* (floor / ceiling / wall) and, for
 * walls, the yaw; the whole terminal then hops so its collar lands exactly
 * on the port. Null when nothing is in range. `fallbackYaw` keeps the
 * user's R/T face orientation for floor / ceiling mounts.
 */
function resolvePortSnap(
  position: [number, number, number],
  fallbackYaw: number,
): { position: [number, number, number]; mount: Mount; yaw: number } | null {
  const port = findNearestPortXZ(
    position,
    collectScenePorts({ systems: DUCT_PORT_SYSTEMS }),
    PORT_SNAP_RADIUS_M,
  )
  if (!port) return null
  const { mount, lockYaw } = inferMountFromPort(port.direction)
  const yaw = lockYaw ?? fallbackYaw
  const offset = collarOffset(mount, yaw)
  return {
    position: [
      port.position[0] - offset.x,
      port.position[1] - offset.y,
      port.position[2] - offset.z,
    ],
    mount,
    yaw,
  }
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

  // The ghost mirrors whatever mount will actually be committed: a snap can
  // override the manual M selection (port direction picks floor / ceiling /
  // wall), so the preview must show the inferred mount, not the toolbar one.
  const effectiveMount = placement?.mount ?? mount
  const previewNode = useMemo(
    () =>
      DuctTerminalNode.parse({
        ...ductTerminalDefinition.defaults(),
        name: 'Register',
        mount: effectiveMount,
      }),
    [effectiveMount],
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
     * The ray is transformed into level-local space first (building transform
     * plus the floor's stacked elevation), so the hit is already in the frame
     * terminals are stored and parented in — accurate on every floor.
     */
    const hitLocalPlane = (nativeEvent: PointerEvent | MouseEvent, y: number): Vector3 | null => {
      const rect = canvas.getBoundingClientRect()
      pointer.current.x = ((nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
      pointer.current.y = -((nativeEvent.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.current.setFromCamera(pointer.current, camera)

      const level = activeLevelMesh()
      const ray = raycaster.current.ray.clone()
      if (level) {
        const inv = new Matrix4().copy(level.matrixWorld).invert()
        ray.applyMatrix4(inv)
      }
      const plane = new Plane(new Vector3(0, 1, 0), -y)
      const hit = new Vector3()
      return ray.intersectPlane(plane, hit) ? hit : null
    }

    /**
     * Ceiling mount only lands where the cursor ray actually hits a real
     * ceiling. Walk the active level's ceiling nodes, raycast each against a
     * plane at its own height, and keep the lowest one whose polygon (minus
     * holes) contains the hit — the surface you'd see looking up. Null when
     * the ray misses every ceiling, so a ceiling register never drops onto a
     * fixed virtual plane; the height comes from the ceiling itself.
     */
    const resolveCeilingHit = (
      nativeEvent: PointerEvent | MouseEvent,
    ): { hit: Vector3; height: number } | null => {
      const nodes = useScene.getState().nodes
      let best: { hit: Vector3; height: number } | null = null
      for (const node of Object.values(nodes)) {
        if (node?.type !== 'ceiling') continue
        if (resolveLevelId(node, nodes) !== activeLevelId) continue
        const ceiling = node as {
          height?: number
          polygon: Array<[number, number]>
          holes?: Array<Array<[number, number]>>
        }
        const height = ceiling.height ?? DEFAULT_CEILING_HEIGHT
        const hit = hitLocalPlane(nativeEvent, height)
        if (!hit) continue
        if (!pointInPolygon(hit.x, hit.z, ceiling.polygon)) continue
        if (ceiling.holes?.some((h) => h.length >= 3 && pointInPolygon(hit.x, hit.z, h))) continue
        if (!best || height < best.height) best = { hit, height }
      }
      return best
    }

    const resolvePlanar = (nativeEvent: PointerEvent | MouseEvent): Placement | null => {
      // Floor sits on the grid (y=0; the slab lift is applied to the committed
      // mesh by FloorElevationSystem). Ceiling resolves the real ceiling the
      // ray hits and takes that surface's height — no fixed fallback plane.
      let hit: Vector3 | null
      let y: number
      if (mountRef.current === 'ceiling') {
        const ceiling = resolveCeilingHit(nativeEvent)
        if (!ceiling) return null
        hit = ceiling.hit
        y = ceiling.height
      } else {
        y = 0
        hit = hitLocalPlane(nativeEvent, y)
      }
      if (!hit) return null
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      // Grid-snap, then layer Figma-style alignment so a floor / ceiling
      // register lines up with ducts, equipment, and items. Grid + lines
      // follow the active snapping mode (the contextual HUD chip — Shift
      // cycles it); `'off'` is the no-snap bypass.
      const position = alignDrawPoint([snap(hit.x, step), y, snap(hit.z, step)], {
        applySnap: true,
        bypass: !isMagneticSnapActive(),
      })
      // Magnetic port snap: if a duct run end / fitting collar is in range,
      // the port's direction picks the mount (floor / ceiling / wall) and
      // hops the whole register so its collar mates exactly onto it. Takes
      // precedence over grid / alignment and the manual M mount; the
      // raw-cursor `'off'` mode bypasses it.
      const snapEnabled = isGridSnapActive() || isMagneticSnapActive()
      if (snapEnabled) {
        const mated = resolvePortSnap(position, yawRef.current)
        if (mated) {
          return { position: mated.position, yaw: mated.yaw, mount: mated.mount, snapped: true }
        }
      }
      return { position, yaw: yawRef.current, mount: mountRef.current }
    }

    const commit = (p: Placement) => {
      const terminal = DuctTerminalNode.parse({
        ...ductTerminalDefinition.defaults(),
        name: 'Register',
        mount: p.mount,
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
      const level = activeLevelMesh()
      const local = level ? level.worldToLocal(world.clone()) : world
      return { position: [local.x, local.y, local.z], yaw, mount: 'wall' }
    }

    const onWallMove = (event: WallEvent) => {
      if (mountRef.current !== 'wall') return
      // Wall-mounted terminals snap flush to the wall — no plan alignment.
      clearDrawAlignment()
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
      clearDrawAlignment()
    }
  }, [activeLevelId, camera, gl])

  if (!activeLevelId || !placement) return null

  const mountLabel = effectiveMount.charAt(0).toUpperCase() + effectiveMount.slice(1)

  // The committed mesh's slab lift is applied by FloorElevationSystem, but the
  // ghost renders here directly — preview it on the slab top too so a floor
  // register doesn't appear to sink in before the click.
  const previewPosition =
    effectiveMount === 'floor'
      ? getFloorStackPreviewPosition({
          node: previewNode,
          position: placement.position,
          rotation: placement.yaw,
          levelId: activeLevelId,
        })
      : placement.position

  return (
    <LevelOffsetGroup>
      {/* Same ground ring + vertical line + tool-icon badge the duct draw
          tool shows in 3D (icon resolved from the active `duct-terminal`
          structure-tools entry). In 2D the floorplan overlay draws this for
          every tool; in 3D each tool renders its own. */}
      <CursorSphere position={previewPosition} />
      <group position={previewPosition} rotation={[0, placement.yaw, 0]}>
        <primitive object={ghost} />
      </group>
      <Html
        center
        position={[previewPosition[0], previewPosition[1] + 1.45, previewPosition[2]]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur">
          {placement.snapped && (
            <>
              <span className="font-medium text-primary">Snapped to duct</span>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
            </>
          )}
          <span className="font-medium text-foreground">Mount {mountLabel}</span>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="text-muted-foreground">M surface</span>
          {effectiveMount !== 'wall' && (
            <>
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <span className="text-muted-foreground">R/T rotate</span>
            </>
          )}
        </div>
      </Html>
    </LevelOffsetGroup>
  )
}

export default DuctTerminalTool
