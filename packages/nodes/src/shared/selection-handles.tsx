'use client'

import type { Cursor } from '@pascal-app/core'
import { ARROW_SCALE, HandleArrow, swallowNextClick } from '@pascal-app/editor'
import type { ThreeEvent } from '@react-three/fiber'
import { useThree } from '@react-three/fiber'
import { useState } from 'react'
import { OrthographicCamera } from 'three'

type Point = [number, number, number]

function consumeHandlePress(event: ThreeEvent<PointerEvent>) {
  event.stopPropagation()
  event.nativeEvent.stopPropagation()
  event.nativeEvent.stopImmediatePropagation()
  swallowNextClick()
}

/**
 * Small persistent cube the user CLICKS to latch a directional handle cluster
 * open (click again to close). A `tracker` HandleArrow (a tiny cube) reused so
 * it shares the rig's hit-area / depth / outline treatment, sized to match the
 * roof-segment pitch cube (`baseScale = zoom`, full `TRACKER_CUBE_SIZE`).
 * `hoverScale = 1.15` grows it 15% on hover / while its cluster is open so it
 * reads as clickable. Shared by the duct-segment and duct-fitting selection
 * rigs so every editing cube is the same size.
 */
export function HandleCube({
  position,
  active,
  onClick,
  onPointerDown,
  rotationY = 0,
  cursor = 'grab',
}: {
  position: Point
  active: boolean
  onClick?: () => void
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void
  /** Yaw (radians) so the cube can align with the run it sits on. */
  rotationY?: number
  cursor?: Cursor
}) {
  const [hovered, setHovered] = useState(false)
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const baseScale = zoom
  return (
    <HandleArrow
      cursor={cursor}
      hover={hovered || active}
      hoverScale={1.15}
      onHoverChange={setHovered}
      onPointerDown={(e) => {
        consumeHandlePress(e)
        if (onPointerDown) onPointerDown(e)
        else onClick?.()
      }}
      placement={{ position, rotation: [0, rotationY, 0], baseScale }}
      shape="tracker"
    />
  )
}

/**
 * In-world chevron arrow handle — a thin wrapper over the editor's shared
 * `HandleArrow` so directional move arrows render as the same solid violet
 * plate (depth-written, ink-edge outlined) the wall arrows use. Lays flat in
 * the XZ plane pointing along +X (yawed by `rotationY`); `vertical` tips the
 * chevron up / down for the riser pair. Scales with ortho zoom for a constant
 * on-screen size.
 */
export function MoveChevron({
  position,
  rotationY = 0,
  vertical,
  cursor = 'grab',
  onPointerDown,
}: {
  position: Point
  rotationY?: number
  vertical?: 'up' | 'down'
  cursor?: Cursor
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const baseScale = zoom * ARROW_SCALE
  // Tip the flat chevron up / down to point along ±Y — the same inner-rotation
  // chain the wall height arrow uses.
  const indicatorRotation: [number, number, number] | undefined = vertical
    ? [0, Math.PI / 2, vertical === 'up' ? Math.PI / 2 : -Math.PI / 2]
    : undefined

  return (
    <HandleArrow
      cursor={cursor}
      hover={hovered}
      indicatorRotation={indicatorRotation}
      onHoverChange={setHovered}
      onPointerDown={(event) => {
        consumeHandlePress(event)
        onPointerDown(event)
      }}
      placement={{ position, rotation: [0, rotationY, 0], baseScale }}
      shape="chevron"
      thin
    />
  )
}

/**
 * Rotation arc handle — the editor's `curved-arrow` (which wraps world +Y by
 * default) re-oriented by an arbitrary `rotation` euler. Scales with ortho zoom
 * for a constant on-screen size. The caller supplies the position + orientation
 * so the same component serves a duct's single roll arc and a fitting's three
 * per-axis arcs.
 */
export function RotateArc({
  position,
  rotation,
  cursor = 'grab',
  onPointerDown,
}: {
  position: Point
  rotation: [number, number, number]
  cursor?: Cursor
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const { camera } = useThree()
  const zoom = camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
  const baseScale = zoom * ARROW_SCALE
  return (
    <HandleArrow
      cursor={cursor}
      hover={hovered}
      onHoverChange={setHovered}
      onPointerDown={(event) => {
        consumeHandlePress(event)
        onPointerDown(event)
      }}
      placement={{ position, rotation, baseScale }}
      shape="curved-arrow"
    />
  )
}
