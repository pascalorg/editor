'use client'

import type { DormerNode, RoofSegmentNode } from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { TrimClippedMesh } from '../shared/use-segment-trim-clip'
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
  dormerToSegment,
}: {
  node: DormerNode
  segment: RoofSegmentNode
  frameMaterial: THREE.Material
  glassMaterial: THREE.Material
  // Maps dormer-mesh-local space into the host segment-local frame (where the
  // trim cut prisms live). Threaded from the renderer so the window glass /
  // frame / sill slice at the trim plane like the dormer body.
  dormerToSegment: THREE.Matrix4
}) => {
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps deliberately list the build inputs; depending on the whole object would rebuild on unrelated field changes.
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
      // The window's vertical placement feeds `getDormerExposedFaces`
      // (gates on the window CENTER clearing the host slope) — dragging
      // the window down via inspector or the offset handle must
      // re-evaluate which gable still exposes the opening.
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
  const renderFace = (zPos: number, yRot: number, keyPrefix: string) => {
    // Compose this face group's transform onto the dormer→segment matrix, so
    // each window part can be clipped by the trim in segment-local space.
    const faceToSegment = new THREE.Matrix4()
      .copy(dormerToSegment)
      .multiply(
        new THREE.Matrix4().compose(
          new THREE.Vector3(winX, winY, zPos),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yRot),
          new THREE.Vector3(1, 1, 1),
        ),
      )
    return (
      <group name={`dormer-window-${keyPrefix}`} position={[winX, winY, zPos]} rotation-y={yRot}>
        {winGeo.glassPanes.map((pane, i) => (
          <TrimClippedMesh
            geometry={pane.geo}
            key={`${keyPrefix}-glass-${i}`}
            material={glassMaterial}
            name={`dormer-glass-${keyPrefix}-${i}`}
            parentToSegment={faceToSegment}
            position={pane.pos}
            segment={segment}
          />
        ))}
        {winGeo.frameBars.map((bar, i) => (
          <TrimClippedMesh
            castShadow
            geometry={bar.geo}
            key={`${keyPrefix}-bar-${i}`}
            material={frameMaterial}
            name={`dormer-frame-${keyPrefix}-${i}`}
            parentToSegment={faceToSegment}
            position={bar.pos}
            segment={segment}
          />
        ))}
        {sillGeo && (
          <TrimClippedMesh
            castShadow
            geometry={sillGeo}
            material={frameMaterial}
            name={`dormer-sill-${keyPrefix}`}
            parentToSegment={faceToSegment}
            position={[0, -winH / 2 - sillT / 2, sillD / 2]}
            receiveShadow
            segment={segment}
          />
        )}
      </group>
    )
  }

  return (
    <>
      {exposed.front && renderFace(gableHalfZ, 0, 'front')}
      {exposed.back && renderFace(-gableHalfZ, Math.PI, 'back')}
    </>
  )
}

export default DormerWindowAssembly
