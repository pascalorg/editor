'use client'

import type { DormerNode, RoofSegmentNode } from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { getDormerExposedFaces, getDormerSkirtWindowDims } from './csg-geometry'
import { buildDormerWindowGeometries, type DormerWindowShape } from './window-frame'

/**
 * Renders the window opening assembly (frame bars, glass panes, sill)
 * on each exposed gable face of a dormer. Owns its geometry lifecycle
 * (build via `buildDormerWindowGeometries`, dispose on unmount) so the
 * renderer doesn't have to.
 *
 * Mounted inside the dormer's rotation group, in dormer-mesh-local
 * coordinates. The CSG cut on the wall is performed separately inside
 * the viewer's `generateDormerGeometry`; the geometry built here is
 * sized to match that cut.
 */
const DormerWindowAssembly = ({
  node,
  segment,
  frameMaterial,
  glassMaterial,
}: {
  node: DormerNode
  segment: RoofSegmentNode
  frameMaterial: THREE.Material
  glassMaterial: THREE.Material
}) => {
  const skirtWin = useMemo(
    () => getDormerSkirtWindowDims(node),
    [
      node.width,
      node.windowWidth,
      node.windowHeight,
      node.windowOffsetX,
      node.windowOffsetY,
      node.wallSkirtHeight,
    ],
  )

  const winW = skirtWin.width
  const winH = skirtWin.height
  const winShape: DormerWindowShape = node.windowShape
  const resolvedRadii: [number, number, number, number] = [...node.windowCornerRadii]

  const winGeo = useMemo(
    () =>
      buildDormerWindowGeometries(
        winW,
        winH,
        node.windowFrameThickness,
        node.windowFrameDepth,
        node.windowColumns,
        node.windowRows,
        node.windowDividerThickness,
        winShape,
        node.windowArchHeight,
        resolvedRadii,
      ),
    [
      winW,
      winH,
      node.windowFrameThickness,
      node.windowFrameDepth,
      node.windowColumns,
      node.windowRows,
      node.windowDividerThickness,
      winShape,
      node.windowArchHeight,
      ...resolvedRadii,
    ],
  )

  useEffect(() => {
    return () => {
      const disposed = new Set<THREE.BufferGeometry>()
      for (const bar of winGeo.frameBars) {
        if (!disposed.has(bar.geo)) {
          bar.geo.dispose()
          disposed.add(bar.geo)
        }
      }
      for (const pane of winGeo.glassPanes) {
        if (!disposed.has(pane.geo)) {
          pane.geo.dispose()
          disposed.add(pane.geo)
        }
      }
    }
  }, [winGeo])

  const sillEnabled = node.windowSill !== false
  const sillT = Math.max(0.001, node.windowSillThickness)
  const sillD = Math.max(0.001, node.windowSillDepth)
  const sillW = winW + 0.06 // 3 cm overhang each side
  const sillGeo = useMemo(
    () => (sillEnabled ? new THREE.BoxGeometry(sillW, sillT, sillD) : null),
    [sillEnabled, sillW, sillT, sillD],
  )
  useEffect(() => () => sillGeo?.dispose(), [sillGeo])

  const exposed = useMemo(
    () => getDormerExposedFaces(node, segment),
    [
      segment,
      node.roofType,
      node.width,
      node.depth,
      node.height,
      node.roofHeight,
      node.position[0],
      node.position[1],
      node.position[2],
      // Rotation flips which dormer-local face projects to which Z in
      // segment frame, so dragging the dormer across the ridge with a
      // non-zero yaw needs to recompute exposure to know which gable
      // is now poking above the slope.
      node.rotation,
      // Window position + height feed `getDormerExposedFaces` now that
      // it's gating on window-bottom-above-slope (not wall-top-above-
      // slope) — dragging the window down via inspector or the new
      // window-height/offset handles must re-evaluate which gable
      // still has a fully-visible opening.
      node.windowHeight,
      node.windowOffsetY,
      node.wallSkirtHeight,
    ],
  )

  const gableHalfZ = node.depth / 2
  const winX = skirtWin.offsetX
  const winY = skirtWin.centerY

  // The glazing role material is FrontSide (DoubleSide on a NodeMaterial
  // poisons the MRT scene pass — see `createSurfaceRoleMaterial`). The
  // back gable face therefore renders inside a Y-rotated group so its
  // FrontSide points outward (-Z in segment frame). With the rotation,
  // the sill always extrudes along the group's local +Z, so its position
  // no longer needs to flip per-face.
  const renderFace = (zPos: number, yRot: number, keyPrefix: string) => (
    <group
      name={`dormer-window-${keyPrefix}`}
      position={[winX, winY, zPos]}
      rotation-y={yRot}
    >
      {winGeo.glassPanes.map((pane, i) => (
        <mesh
          geometry={pane.geo}
          // biome-ignore lint/suspicious/noArrayIndexKey: glass panes are derived from grid indices, no stable id.
          key={`${keyPrefix}-glass-${i}`}
          material={glassMaterial}
          name={`dormer-glass-${keyPrefix}-${i}`}
          position={pane.pos}
        />
      ))}
      {winGeo.frameBars.map((bar, i) => (
        <mesh
          castShadow
          geometry={bar.geo}
          // biome-ignore lint/suspicious/noArrayIndexKey: frame bars are derived from grid indices, no stable id.
          key={`${keyPrefix}-bar-${i}`}
          material={frameMaterial}
          name={`dormer-frame-${keyPrefix}-${i}`}
          position={bar.pos}
        />
      ))}
      {sillGeo && (
        <mesh
          castShadow
          geometry={sillGeo}
          material={frameMaterial}
          name={`dormer-sill-${keyPrefix}`}
          position={[0, -winH / 2 - sillT / 2, sillD / 2]}
          receiveShadow
        />
      )}
    </group>
  )

  return (
    <>
      {exposed.front && renderFace(gableHalfZ, 0, 'front')}
      {exposed.back && renderFace(-gableHalfZ, Math.PI, 'back')}
    </>
  )
}

export default DormerWindowAssembly
