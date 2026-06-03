'use client'

import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  type BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  type Group,
  PlaneGeometry,
  Vector3,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'

// How far the outline sits outside the opening's own extents, so it reads as
// a frame *around* the opening rather than coinciding with its edges.
const PAD = 0.05

const ACCENT = 0x83_81_ed

const NO_RAYCAST = () => null
const scratchScale = new Vector3()

// Indigo accent matching the resize-arrow handles — deliberately distinct
// from the white selection outline so the highlight reads as "editable child
// here", not "this is selected". `depthTest: false` keeps both layers drawn
// on top of the wall so frameless openings (which have no visible geometry)
// are still located. Shared across every box; never disposed.
const outlineMaterial = new LineBasicNodeMaterial({
  color: ACCENT,
  depthTest: false,
  depthWrite: false,
})

// Translucent pane that fills the opening so it reads as a highlighted
// region. Sits in the opening's plane (XY, facing the wall normal) and is
// double-sided so it shows from either side of the wall.
const fillMaterial = new MeshBasicNodeMaterial({
  color: ACCENT,
  transparent: true,
  opacity: 0.22,
  side: DoubleSide,
  depthTest: false,
  depthWrite: false,
})

function makeOutlineGeometry(width: number, height: number, depth: number): BufferGeometry {
  const box = new BoxGeometry(width + PAD, height + PAD, depth + PAD)
  const edges = new EdgesGeometry(box)
  box.dispose()
  return edges
}

/**
 * When a wall is selected, draws a translucent indigo highlight (filled pane
 * + outline) over each door / window it hosts. Openings whose `openingKind`
 * is `'opening'` have no visible geometry, so without this affordance the
 * user can't tell an editable cutout lives there — the fill marks it (and
 * stays out of the way of clicking the opening itself, which selects it).
 *
 * Highlights are portalled to the scene root so they sit outside the wall's
 * selection-outline subtree and keep their own accent colour.
 */
export function WallOpeningHighlights() {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const { scene } = useThree()

  if (selectedIds.length === 0) return null

  return createPortal(
    <>
      {selectedIds.map((id) => (
        <WallOpenings key={id} wallId={id} />
      ))}
    </>,
    scene,
  )
}

function WallOpenings({ wallId }: { wallId: string }) {
  const wall = useScene((state) => state.nodes[wallId as AnyNodeId])

  if (!wall || wall.type !== 'wall') return null

  const depth = wall.thickness ?? 0.1
  return (
    <>
      {(wall.children ?? []).map((childId) => (
        <OpeningHighlight depth={depth} key={childId} openingId={childId} />
      ))}
    </>
  )
}

function OpeningHighlight({ openingId, depth }: { openingId: string; depth: number }) {
  const node = useScene((state) => state.nodes[openingId as AnyNodeId])
  const groupRef = useRef<Group>(null)

  const isOpening = node?.type === 'door' || node?.type === 'window'
  const width = isOpening ? node.width : 0
  const height = isOpening ? node.height : 0

  const outlineGeometry = useMemo(
    () => (isOpening ? makeOutlineGeometry(width, height, depth) : null),
    [isOpening, width, height, depth],
  )
  const fillGeometry = useMemo(
    () => (isOpening ? new PlaneGeometry(width, height) : null),
    [isOpening, width, height],
  )
  useEffect(() => () => outlineGeometry?.dispose(), [outlineGeometry])
  useEffect(() => () => fillGeometry?.dispose(), [fillGeometry])

  // The opening's mesh (registered by its renderer) already carries the wall
  // transform + its own local pose baked into `matrixWorld`. Copy that
  // straight onto the highlight each frame so it tracks moves, resizes, and
  // wall rotation without any wall-local maths here.
  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const obj = sceneRegistry.nodes.get(openingId as AnyNodeId)
    if (!obj) {
      group.visible = false
      return
    }
    group.visible = true
    obj.matrixWorld.decompose(group.position, group.quaternion, scratchScale)
  })

  if (!isOpening || !outlineGeometry || !fillGeometry) return null

  return (
    <group ref={groupRef}>
      <mesh
        frustumCulled={false}
        geometry={fillGeometry}
        layers={EDITOR_LAYER}
        material={fillMaterial}
        raycast={NO_RAYCAST}
        renderOrder={1004}
      />
      <lineSegments
        frustumCulled={false}
        geometry={outlineGeometry}
        layers={EDITOR_LAYER}
        material={outlineMaterial}
        raycast={NO_RAYCAST}
        renderOrder={1005}
      />
    </group>
  )
}

export default WallOpeningHighlights
