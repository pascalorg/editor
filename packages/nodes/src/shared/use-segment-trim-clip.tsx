import {
  type AnyNodeId,
  normalizeRoofSegmentTrim,
  type RoofSegmentNode,
  type RoofSegmentTrim,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import { clipGeometryBySegmentTrim } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Matrix4 } from 'three'

// Does this segment remove any material? Mirrors the viewer's internal
// `hasSegmentTrim` (not exported) — the clip is a no-op otherwise, so the
// common (untrimmed) case skips all CSG work.
function segmentHasTrim(segment: RoofSegmentNode): boolean {
  const t = normalizeRoofSegmentTrim(segment)
  return (
    t.left > 0 ||
    t.right > 0 ||
    t.front > 0 ||
    t.back > 0 ||
    t.frontLeftX > 0 ||
    t.frontLeftZ > 0 ||
    t.frontRightX > 0 ||
    t.frontRightZ > 0 ||
    t.backLeftX > 0 ||
    t.backLeftZ > 0 ||
    t.backRightX > 0 ||
    t.backRightZ > 0
  )
}

// A stable key for the segment's trim + footprint, so the memo only re-clips
// when the cut shape actually changes (not on unrelated segment edits like
// material).
function segmentTrimKey(segment: RoofSegmentNode | undefined): string {
  if (!segment) return 'none'
  const t = normalizeRoofSegmentTrim(segment)
  return JSON.stringify([
    segment.width,
    segment.depth,
    t.left,
    t.right,
    t.front,
    t.back,
    t.frontLeftX,
    t.frontLeftZ,
    t.frontRightX,
    t.frontRightZ,
    t.backLeftX,
    t.backLeftZ,
    t.backRightX,
    t.backRightZ,
  ])
}

/**
 * Clip a roof accessory's geometry by its host segment's trim, so the part of
 * the accessory standing in a trimmed-away region is sliced off exactly like
 * the roof shell.
 *
 * `geometry` is in accessory-local space; `localToSegment` maps it into the
 * segment-local frame the trim cut prisms live in (compose the same
 * `node.position` + inner-group quaternion the renderer mounts the mesh with).
 * The function bakes that transform, runs `clipGeometryBySegmentTrim`, then
 * strips the transform back off so the returned geometry is still
 * accessory-local and drops straight into the renderer's existing mesh.
 *
 * Returns the input geometry untouched when the segment is missing or has no
 * trim — zero cost for the overwhelmingly common case. The derived (clipped)
 * geometry is owned by the hook and disposed on change / unmount; the input
 * geometry is never consumed (we clip a clone), so the caller keeps owning it.
 */
export function useSegmentTrimClippedGeometry(
  geometry: THREE.BufferGeometry | null,
  segment: RoofSegmentNode | undefined,
  localToSegment: THREE.Matrix4,
): THREE.BufferGeometry | null {
  // Subscribe to the segment's live trim override so the accessory re-slices
  // in lockstep with the trim handle drag (the editor publishes the in-flight
  // trim to `useLiveNodeOverrides`; the store only updates on commit). Without
  // this the accessory would only re-clip once the drag is released.
  const liveTrim = useLiveNodeOverrides((s) =>
    segment ? (s.get(segment.id as AnyNodeId)?.trim as RoofSegmentTrim | undefined) : undefined,
  )
  const effectiveSegment = useMemo(
    () => (segment && liveTrim ? { ...segment, trim: liveTrim } : segment),
    [segment, liveTrim],
  )

  const trimKey = segmentTrimKey(effectiveSegment)
  // Matrix identity isn't stable across renders; key on its elements.
  const matrixKey = localToSegment.elements.join(',')

  const clipped = useMemo(() => {
    if (!geometry || !effectiveSegment || !segmentHasTrim(effectiveSegment)) return null
    const baked = geometry.clone()
    baked.applyMatrix4(localToSegment)
    const result = clipGeometryBySegmentTrim(baked, effectiveSegment)
    if (!result) return null
    // `clipGeometryBySegmentTrim` returns the same object when there's no trim
    // (already guarded above) or a fresh clone otherwise; either way it's our
    // `baked` clone or its descendant, safe to mutate + own.
    const inverse = new Matrix4().copy(localToSegment).invert()
    result.applyMatrix4(inverse)
    result.computeVertexNormals()
    // CSG can stamp the freshly-exposed cut faces with the cutter's material
    // slot, which may exceed the accessory's material array (multi-slot kinds:
    // dormer = 5 slots, solar-panel / skylight = 2). Clamp every group back into
    // the original geometry's slot range so the renderer never indexes past its
    // `material` array (mismatch crashes the draw, as the empty-segment
    // placeholder guard documents).
    const maxSlot = geometry.groups.reduce((m, g) => Math.max(m, g.materialIndex ?? 0), 0)
    for (const g of result.groups) {
      if ((g.materialIndex ?? 0) > maxSlot) g.materialIndex = maxSlot
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, localToSegment, effectiveSegment])

  useEffect(() => {
    return () => {
      clipped?.dispose()
    }
  }, [clipped])

  // No trim (or no input) → render the original geometry unchanged.
  return clipped ?? geometry
}

const _trimMeshLocal = new THREE.Matrix4()
const _trimMeshPos = new THREE.Vector3()
const _trimMeshQuat = new THREE.Quaternion()
const _trimMeshEuler = new THREE.Euler()
const _trimMeshScale = new THREE.Vector3(1, 1, 1)

/**
 * A `<mesh>` whose geometry is sliced by the host roof segment's trim, for
 * accessory sub-parts that live deeper than the registered group (skylight
 * glass panes, dormer window glass / frame / sill). Pass the matrix that maps
 * the part's own parent frame into the segment-local frame (`parentToSegment`)
 * plus the part's local `position` / `rotation`; the component composes the
 * full mesh→segment transform, clips, and renders the result at the same local
 * pose. When the segment has no trim the original geometry renders unchanged.
 *
 * `geometry` is owned by the caller (built once and reused); the clipped
 * derivative is owned by the hook and disposed on change / unmount.
 */
export function TrimClippedMesh({
  geometry,
  segment,
  parentToSegment,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  material,
  name,
  castShadow,
  receiveShadow,
}: {
  geometry: THREE.BufferGeometry
  segment: RoofSegmentNode | undefined
  parentToSegment: THREE.Matrix4
  position?: [number, number, number]
  rotation?: [number, number, number]
  material: THREE.Material | THREE.Material[]
  name?: string
  castShadow?: boolean
  receiveShadow?: boolean
}) {
  // mesh→segment = parentToSegment · T(position) · R(rotation). Keyed in the
  // hook on the matrix elements, so a moving/animated pane re-clips correctly.
  const localToSegment = useMemo(() => {
    _trimMeshEuler.set(rotation[0], rotation[1], rotation[2])
    _trimMeshQuat.setFromEuler(_trimMeshEuler)
    _trimMeshPos.set(position[0], position[1], position[2])
    _trimMeshLocal.compose(_trimMeshPos, _trimMeshQuat, _trimMeshScale)
    return new Matrix4().multiplyMatrices(parentToSegment, _trimMeshLocal)
  }, [
    parentToSegment,
    position[0],
    position[1],
    position[2],
    rotation[0],
    rotation[1],
    rotation[2],
  ])

  const clipped = useSegmentTrimClippedGeometry(geometry, segment, localToSegment)

  return (
    <mesh
      castShadow={castShadow}
      geometry={clipped ?? geometry}
      material={material}
      name={name}
      position={position}
      receiveShadow={receiveShadow}
      rotation={rotation}
    />
  )
}
