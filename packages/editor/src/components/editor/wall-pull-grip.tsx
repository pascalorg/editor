'use client'

import { nodeRegistry, type WallNode } from '@pascal-app/core'
import { type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { Color, DoubleSide, ExtrudeGeometry, OrthographicCamera, Shape } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'
import { sfxEmitter } from '../../lib/sfx-bus'
import { startWallPull, WALL_PULL_GRIP_TITLE, wallPullSeed } from '../../lib/wall-pull'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import {
  createEndpointHitAreaGeometry,
  InvisibleHandleHitArea,
  NO_RAYCAST,
  useInvisibleHitAreaMaterial,
} from './handles/handle-arrow'

const PULL_FILL = '#10b981' // emerald-500 — the 2D grip's colour
const PULL_HOVER_FILL = '#34d399' // emerald-400
// Out from the wall end (m, before zoom): clear of the corner picker's hex.
const PULL_ARROW_OFFSET = 0.2
const PULL_ARROW_LENGTH = 0.34
const PULL_ARROW_HALF_WIDTH = 0.11
const PULL_ARROW_SHAFT_HALF_WIDTH = 0.04
const PULL_HIT_RADIUS = 0.17
const PULL_FLOOR_LIFT = 0.02

// The grip's tooltip: one plain DOM element beside the pointer, so it never
// lives in (or unmounts with) the R3F tree.
let tooltip: HTMLDivElement | null = null

function showGripTooltip(clientX: number, clientY: number) {
  if (typeof document === 'undefined') return
  if (!tooltip) {
    tooltip = document.createElement('div')
    tooltip.textContent = WALL_PULL_GRIP_TITLE
    tooltip.setAttribute('role', 'tooltip')
    Object.assign(tooltip.style, {
      position: 'fixed',
      zIndex: '60',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      borderRadius: '6px',
      background: 'rgba(24, 24, 27, 0.92)',
      color: '#fff',
      font: '500 11px/1.4 system-ui, -apple-system, sans-serif',
      padding: '4px 8px',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.25)',
    })
  }
  tooltip.style.left = `${clientX + 14}px`
  tooltip.style.top = `${clientY + 18}px`
  if (!tooltip.isConnected) document.body.appendChild(tooltip)
}

function hideGripTooltip() {
  tooltip?.remove()
}

/** A flat outward arrow (tip along +X), lying in the XZ plane from x = 0. */
function createPullArrowGeometry() {
  const head = PULL_ARROW_LENGTH * 0.45
  const shape = new Shape()
  shape.moveTo(0, -PULL_ARROW_SHAFT_HALF_WIDTH)
  shape.lineTo(PULL_ARROW_LENGTH - head, -PULL_ARROW_SHAFT_HALF_WIDTH)
  shape.lineTo(PULL_ARROW_LENGTH - head, -PULL_ARROW_HALF_WIDTH)
  shape.lineTo(PULL_ARROW_LENGTH, 0)
  shape.lineTo(PULL_ARROW_LENGTH - head, PULL_ARROW_HALF_WIDTH)
  shape.lineTo(PULL_ARROW_LENGTH - head, PULL_ARROW_SHAFT_HALF_WIDTH)
  shape.lineTo(0, PULL_ARROW_SHAFT_HALF_WIDTH)
  shape.lineTo(0, -PULL_ARROW_SHAFT_HALF_WIDTH)
  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.03,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.012,
    bevelSegments: 4,
  })
  geometry.translate(0, 0, -0.015)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * A selected wall end's "pull to continue" grip in 3D — the twin of the floor
 * plan's: an emerald arrow lying on the floor just past the end, pointing out
 * along the wall (along its tangent when curved), titled "Drag to draw the next
 * wall" while the pointer rests on it. Pressing it starts
 * `startWallPull`: the wall tool's Walls run opens at that end, the drag shows
 * the next wall, and the release (the canvas click) places it. Screen-sized
 * like the corner picker beside it; rendered in the wall's level frame at its
 * base, by `WallMoveSideHandles`.
 */
export function WallPullGrip({ wall, endpoint }: { wall: WallNode; endpoint: 'start' | 'end' }) {
  const [hover, setHover] = useState(false)
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const seed = wallPullSeed(wall, endpoint)
  const geometry = useMemo(() => createPullArrowGeometry(), [])
  const hitGeometry = useMemo(() => createEndpointHitAreaGeometry(PULL_HIT_RADIUS), [])
  const hitMaterial = useInvisibleHitAreaMaterial()
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(PULL_FILL),
        side: DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => {
    material.color.set(hover ? PULL_HOVER_FILL : PULL_FILL)
  }, [hover, material])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => hitGeometry.dispose(), [hitGeometry])
  useEffect(() => () => material.dispose(), [material])
  // Warm the wall tool's module so the press starts drawing at once.
  useEffect(() => {
    void nodeRegistry
      .get('wall')
      ?.tool?.()
      .catch(() => {})
  }, [])
  useEffect(
    () => () => {
      hideGripTooltip()
      if (document.body.style.cursor === 'grab') document.body.style.cursor = ''
    },
    [],
  )

  if (!seed) return null
  const [dx, dz] = seed.reference
  const offset = PULL_ARROW_OFFSET * zoom
  const position: [number, number, number] = [
    seed.start[0] + dx * offset,
    PULL_FLOOR_LIFT,
    seed.start[1] + dz * offset,
  ]
  const rotationY = Math.atan2(-dz, dx)

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    sfxEmitter.emit('sfx:item-pick')
    setHover(false)
    hideGripTooltip()
    if (document.body.style.cursor === 'grab') document.body.style.cursor = ''
    startWallPull({ wallId: wall.id, endpoint, origin: '3d' })
  }

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={zoom}>
      <group position={[PULL_ARROW_LENGTH / 2, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <InvisibleHandleHitArea
          geometry={hitGeometry}
          material={hitMaterial}
          onPointerDown={onPointerDown}
          onPointerEnter={(event) => {
            event.stopPropagation()
            setHover(true)
            showGripTooltip(event.nativeEvent.clientX, event.nativeEvent.clientY)
            document.body.style.cursor = 'grab'
          }}
          onPointerLeave={(event) => {
            event.stopPropagation()
            setHover(false)
            hideGripTooltip()
            if (document.body.style.cursor === 'grab') document.body.style.cursor = ''
          }}
          scale={1}
        />
      </group>
      <mesh
        frustumCulled={false}
        geometry={geometry}
        layers={EDITOR_LAYER}
        material={material}
        raycast={NO_RAYCAST}
        renderOrder={1003}
        scale={hover ? 1.15 : 1}
      />
    </group>
  )
}
