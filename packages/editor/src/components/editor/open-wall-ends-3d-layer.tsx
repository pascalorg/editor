'use client'

import { type OpenWallEnd, sceneRegistry } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, CircleGeometry, type Group, RingGeometry } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  useOpenWallEndFocus,
  useOpenWallEnds,
  useOpenWallEndsSuppressed,
} from '../../hooks/use-open-wall-ends'
import { EDITOR_LAYER } from '../../lib/constants'
import { openWallEndKey, openWallEndLabel } from '../../lib/floorplan/open-wall-ends'
import { MEASUREMENT_DANGLING_COLOR } from '../../lib/measurements'
import { cn } from '../../lib/utils'
import useEditor from '../../store/use-editor'
import { isViewVisible, VIEW_3D, visibleScene } from '../../store/view-layout'
import { JoinWallsPill } from './join-walls-pill'
import { OpenWallEndsHint } from './open-wall-ends-hint'

/**
 * The 3D twin of `FloorplanOpenWallEndsLayer`: at each wall end that isn't
 * joined, a red disc on the floor with a dashed ribbon to the wall it nearly
 * meets, and a screen-space dot carrying the same label ("4 cm gap") and, on
 * hover or click, the same "Join walls" pill. The floor geometry ignores depth
 * so it reads through cutaway walls like the snap beacon; the dot is DOM, so
 * it stays clickable where a wall stands between it and the camera.
 *
 * Shares the analysis with the floor plan (`useOpenWallEnds`). Mounted inside
 * ToolManager's building-local group — wall points are building-local plan
 * coordinates — and lifted to the active level's floor each frame.
 */

const FLOOR_LIFT = 0.02
const DISC_RADIUS = 0.07
const DISC_OUTLINE = 0.095
const DASH_LEN = 0.06
const DASH_GAP = 0.04
const LINE_WIDTH = 0.025
const MAX_DASHES = 40
const NO_RAYCAST = () => null

function createMarkerResources() {
  const materialOptions = {
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    transparent: true,
  }
  return {
    redMaterial: new MeshBasicNodeMaterial({
      ...materialOptions,
      color: MEASUREMENT_DANGLING_COLOR,
    }),
    outlineMaterial: new MeshBasicNodeMaterial({ ...materialOptions, color: 0xff_ff_ff }),
    discGeometry: new CircleGeometry(1, 24),
    ringGeometry: new RingGeometry(0.7, 1, 24),
    dashGeometry: new BoxGeometry(1, 1, 1),
  }
}

type MarkerResources = ReturnType<typeof createMarkerResources>

type Vec3 = [number, number, number]

export const OpenWallEnds3DLayer = memo(function OpenWallEnds3DLayer() {
  const visible = useEditor((state) => isViewVisible(state, VIEW_3D))
  const suppressed = useOpenWallEndsSuppressed()
  return visible && !suppressed ? <ActiveOpenWallEnds3DLayer /> : null
})

const ActiveOpenWallEnds3DLayer = memo(function ActiveOpenWallEnds3DLayer() {
  const levelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const { drafting, ends } = useOpenWallEnds()
  // Split view shows the hint once, over the floor plan.
  const hintHere = useEditor((state) => visibleScene(state) === '3d')
  const focus = useOpenWallEndFocus(ends, drafting)
  const groupRef = useRef<Group>(null)
  const hasEnds = ends.length > 0
  const resources = useMemo(() => (hasEnds ? createMarkerResources() : null), [hasEnds])
  // Resources passed as mesh props are shared and aren't disposed by R3F.
  useEffect(
    () => () => {
      if (resources) for (const resource of Object.values(resources)) resource.dispose()
    },
    [resources],
  )

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const levelMesh = levelId ? sceneRegistry.nodes.get(levelId) : null
    group.position.y = levelMesh ? levelMesh.position.y : 0
  })

  if (!resources) return null
  return (
    <group ref={groupRef}>
      {ends.map((end) => {
        const key = openWallEndKey(end)
        const active = focus.activeEnd !== null && key === focus.activeKey
        return (
          <OpenWallEndMarker3D
            active={active}
            end={end}
            interactive={!!end.candidate && !drafting}
            key={key}
            label={openWallEndLabel(end, unit)}
            onHoverEnd={focus.releaseHover}
            onHoverStart={() => focus.keepHover(key)}
            onJoin={() => focus.join(end)}
            onPin={() => focus.togglePin(key)}
            refusal={active ? focus.refusal : null}
            resources={resources}
          />
        )
      })}
      {hintHere ? (
        // Html only to reach the DOM from inside the canvas; the hint portals
        // itself to the body and centres on the 3D view.
        <Html style={{ pointerEvents: 'none' }}>
          <OpenWallEndsHint ends={ends} onShow={(end) => focus.pin(openWallEndKey(end))} />
        </Html>
      ) : null}
    </group>
  )
})

function OpenWallEndMarker3D({
  active,
  end,
  interactive,
  label,
  onHoverEnd,
  onHoverStart,
  onJoin,
  onPin,
  refusal,
  resources,
}: {
  active: boolean
  end: OpenWallEnd
  interactive: boolean
  label: string | null
  onHoverEnd: () => void
  onHoverStart: () => void
  onJoin: () => void
  onPin: () => void
  refusal: string | null
  resources: MarkerResources
}) {
  const { dashGeometry, discGeometry, ringGeometry, redMaterial, outlineMaterial } = resources
  const [x, z] = end.point
  const target = end.candidate?.point
  const { dashes, angleY, dashLength } = useMemo(() => {
    if (!target) return { dashes: [] as Vec3[], angleY: 0, dashLength: 0 }
    const dx = target[0] - x
    const dz = target[1] - z
    const length = Math.hypot(dx, dz)
    const angle = -Math.atan2(dz, dx)
    if (length < 1e-4) return { dashes: [] as Vec3[], angleY: angle, dashLength: 0 }
    const period = Math.max(DASH_LEN + DASH_GAP, length / MAX_DASHES)
    const centres: Vec3[] = []
    for (let d = Math.min(period, length) / 2; d < length; d += period) {
      centres.push([x + (dx / length) * d, FLOOR_LIFT, z + (dz / length) * d])
    }
    return { dashes: centres, angleY: angle, dashLength: Math.min(DASH_LEN, length) }
  }, [target, x, z])
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

  return (
    <>
      {dashes.map((centre, index) => (
        <mesh
          geometry={dashGeometry}
          key={index}
          layers={EDITOR_LAYER}
          material={redMaterial}
          position={centre}
          raycast={NO_RAYCAST}
          renderOrder={1005}
          rotation={[0, angleY, 0]}
          scale={[dashLength, 0.002, LINE_WIDTH]}
        />
      ))}
      {target ? (
        <mesh
          geometry={ringGeometry}
          layers={EDITOR_LAYER}
          material={redMaterial}
          position={[target[0], FLOOR_LIFT + 0.001, target[1]]}
          raycast={NO_RAYCAST}
          renderOrder={1006}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[DISC_RADIUS * 0.8, DISC_RADIUS * 0.8, 1]}
        />
      ) : null}
      <mesh
        geometry={discGeometry}
        layers={EDITOR_LAYER}
        material={outlineMaterial}
        position={[x, FLOOR_LIFT + 0.002, z]}
        raycast={NO_RAYCAST}
        renderOrder={1006}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[DISC_OUTLINE, DISC_OUTLINE, 1]}
      />
      <mesh
        geometry={discGeometry}
        layers={EDITOR_LAYER}
        material={redMaterial}
        position={[x, FLOOR_LIFT + 0.003, z]}
        raycast={NO_RAYCAST}
        renderOrder={1007}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[DISC_RADIUS, DISC_RADIUS, 1]}
      />
      <Html
        center
        position={[x, FLOOR_LIFT, z]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[25, 0]}
      >
        <div className="relative flex items-center justify-center">
          <div className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 flex -translate-x-1/2 flex-col items-center gap-1.5">
            {active ? (
              <JoinWallsPill
                onHoverEnd={onHoverEnd}
                onHoverStart={onHoverStart}
                onJoin={onJoin}
                refusal={refusal}
              />
            ) : null}
            {label ? (
              <div
                className="whitespace-nowrap rounded-[3px] px-[5px] py-[2px] font-medium font-sans text-[11px] text-white"
                style={{ backgroundColor: MEASUREMENT_DANGLING_COLOR }}
              >
                {label}
              </div>
            ) : null}
          </div>
          <button
            aria-label={label ?? 'Wall end not joined'}
            className={cn(
              'h-3.5 w-3.5 rounded-full border-2 border-white shadow-sm transition-transform',
              interactive
                ? 'pointer-events-auto cursor-pointer hover:scale-125'
                : 'pointer-events-none',
              active && 'scale-125',
            )}
            data-open-wall-end=""
            onClick={(event) => {
              event.stopPropagation()
              onPin()
            }}
            onPointerDown={stop}
            onPointerEnter={interactive ? onHoverStart : undefined}
            onPointerLeave={interactive ? onHoverEnd : undefined}
            onPointerUp={stop}
            style={{ backgroundColor: MEASUREMENT_DANGLING_COLOR }}
            tabIndex={interactive ? 0 : -1}
            type="button"
          />
        </div>
      </Html>
    </>
  )
}
