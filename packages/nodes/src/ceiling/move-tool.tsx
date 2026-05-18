'use client'

import { type CeilingNode, useScene } from '@pascal-app/core'
import { CursorSphere, triggerSFX, useDragAction, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useMemo } from 'react'
import { BufferGeometry, DoubleSide, Path, Shape, ShapeGeometry, Vector3 } from 'three'
import { moveCeilingDragAction } from './actions/move'

/**
 * Phase 5 Stage D — thin React wrapper around `moveCeilingDragAction`.
 *
 * Renders the cursor sphere at the ceiling polygon's live center plus
 * a translucent preview fill + outline so the user sees where the
 * ceiling lands before clicking. Polygon + holes are pulled from
 * `useScene` so the wrapper mirrors the action's per-tick writes.
 */
export const CeilingMoveTool: React.FC<{ node: CeilingNode }> = ({ node }) => {
  const ceilingId = node.id
  const height = node.height ?? 2.5

  const live = useScene((s) => s.nodes[ceilingId])
  const liveCeiling = live?.type === 'ceiling' ? (live as CeilingNode) : node
  const polygon = liveCeiling.polygon
  // `?? []` would return a NEW empty array per render, busting downstream
  // useMemo deps and (under StrictMode) potentially triggering the
  // "getSnapshot result not cached" warning. Memoize against the source.
  const EMPTY_HOLES = useMemo(() => [] as Array<Array<[number, number]>>, [])
  const holes = liveCeiling.holes ?? EMPTY_HOLES

  const center: [number, number] = useMemo(() => {
    if (polygon.length === 0) return [0, 0]
    let sx = 0
    let sz = 0
    for (const [x, z] of polygon) {
      sx += x
      sz += z
    }
    return [sx / polygon.length, sz / polygon.length]
  }, [polygon])

  const previewFillGeometry = useMemo(() => createPreviewFill(polygon, holes), [polygon, holes])
  const previewOutlineGeometry = useMemo(() => createOutline(polygon), [polygon])

  const exitMoveMode = (committed: boolean) => {
    if (committed) triggerSFX('sfx:item-place')
    useViewer.getState().setSelection({ selectedIds: [ceilingId] })
    useEditor.getState().setMovingNode(null)
  }

  useDragAction({
    active: true,
    action: moveCeilingDragAction,
    initial: {
      node,
      point: center,
    },
    onCommit: () => exitMoveMode(true),
    onCancel: () => exitMoveMode(false),
  })

  return (
    <group>
      <mesh geometry={previewFillGeometry} position={[0, height + 0.012, 0]}>
        <meshBasicMaterial
          color="#f5f5f4"
          depthWrite={false}
          opacity={0.3}
          side={DoubleSide}
          transparent
        />
      </mesh>
      {/* @ts-ignore */}
      <line geometry={previewOutlineGeometry} position={[0, height + 0.02, 0]}>
        <lineBasicMaterial color="#ffffff" depthWrite={false} opacity={0.95} transparent />
      </line>
      <CursorSphere position={[center[0], height, center[1]]} showTooltip={false} />
    </group>
  )
}

function createPreviewFill(
  polygon: Array<[number, number]>,
  holes: Array<Array<[number, number]>>,
): BufferGeometry {
  if (polygon.length < 3) return new BufferGeometry()
  const shape = new Shape()
  const [firstX, firstZ] = polygon[0]!
  shape.moveTo(firstX, -firstZ)
  for (let i = 1; i < polygon.length; i++) {
    const [x, z] = polygon[i]!
    shape.lineTo(x, -z)
  }
  shape.closePath()
  for (const holePolygon of holes) {
    if (holePolygon.length < 3) continue
    const hole = new Path()
    const [hx, hz] = holePolygon[0]!
    hole.moveTo(hx, -hz)
    for (let i = 1; i < holePolygon.length; i++) {
      const [x, z] = holePolygon[i]!
      hole.lineTo(x, -z)
    }
    hole.closePath()
    shape.holes.push(hole)
  }
  const geometry = new ShapeGeometry(shape)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  return geometry
}

function createOutline(polygon: Array<[number, number]>): BufferGeometry {
  const geometry = new BufferGeometry()
  if (polygon.length < 2) return geometry
  const points = polygon.map(([x, z]) => new Vector3(x, 0, z))
  const [firstX, firstZ] = polygon[0]!
  points.push(new Vector3(firstX, 0, firstZ))
  geometry.setFromPoints(points)
  return geometry
}

export default CeilingMoveTool
