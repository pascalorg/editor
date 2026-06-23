'use client'

import { type AnyNodeId, sceneRegistry, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, type BufferGeometry, EdgesGeometry, type Group, Vector3 } from 'three'
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

// Translucent block that fills the opening volume so the cutout reads as an
// occupied slot from every angle — the front face shows it head-on, the top
// face shows it from a top-down floorplan view (a single vertical pane would
// be edge-on, hence invisible, when looking straight down). Front-side culling
// keeps the translucency even instead of doubling up on overlapping back faces.
const fillMaterial = new MeshBasicNodeMaterial({
  color: ACCENT,
  transparent: true,
  opacity: 0.5,
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
 * When a wall is selected, draws a translucent indigo highlight (filled block
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
        <SelectionOpeningHighlights key={id} selectedId={id} />
      ))}
    </>,
    scene,
  )
}

// Resolves a selected node into the opening highlight(s) to draw:
//  - a selected wall → a hint over each door / window it hosts ("editable
//    child here").
//  - a directly-selected frameless opening (a `door` whose `openingKind` is
//    `'opening'`) → a fill over its own cutout, so the selection reads as
//    occupied even though the opening renders no geometry of its own.
function SelectionOpeningHighlights({ selectedId }: { selectedId: string }) {
  const node = useScene((state) => state.nodes[selectedId as AnyNodeId])

  if (node?.type === 'wall') {
    const depth = node.thickness ?? 0.1
    return (
      <>
        {(node.children ?? []).map((childId) => (
          <OpeningHighlight depth={depth} key={childId} openingId={childId} />
        ))}
      </>
    )
  }

  if (node?.type === 'door' && node.openingKind === 'opening') {
    return <SelectedOpeningHighlight openingId={selectedId} parentId={node.parentId} />
  }

  return null
}

// A frameless opening selected on its own. Pulls the cutout depth from its
// host wall's thickness so the fill block matches the wall it sits in.
function SelectedOpeningHighlight({
  openingId,
  parentId,
}: {
  openingId: string
  parentId: string | null
}) {
  const parent = useScene((state) => (parentId ? state.nodes[parentId as AnyNodeId] : undefined))
  const depth = parent?.type === 'wall' ? (parent.thickness ?? 0.1) : 0.1
  return <OpeningHighlight depth={depth} openingId={openingId} />
}

function OpeningHighlight({ openingId, depth }: { openingId: string; depth: number }) {
  const node = useScene((state) => state.nodes[openingId as AnyNodeId])
  // Resize arrows publish width/height to the live-override store during the
  // drag and only commit to the scene node on pointer-up, so read the
  // override-merged dimensions to keep the highlight box tracking the resize.
  const override = useLiveNodeOverrides((s) => s.overrides.get(openingId))
  const groupRef = useRef<Group>(null)

  const isOpening = node?.type === 'door' || node?.type === 'window'
  const width = isOpening ? ((override?.width as number | undefined) ?? node.width) : 0
  const height = isOpening ? ((override?.height as number | undefined) ?? node.height) : 0

  const outlineGeometry = useMemo(
    () => (isOpening ? makeOutlineGeometry(width, height, depth) : null),
    [isOpening, width, height, depth],
  )
  const fillGeometry = useMemo(
    () => (isOpening ? new BoxGeometry(width, height, depth) : null),
    [isOpening, width, height, depth],
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
