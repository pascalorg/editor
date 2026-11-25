'use client'

import {
  deriveTerrainSlopeFromPoints,
  minBrushRadius,
  raycastTerrain,
  type SiteNode,
  surfaceHeightAt,
  type TerrainField,
  terrainFieldOf,
  terrainSlopeDirectionVector,
  terrainSlopeGradePercent,
  useLiveTerrain,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { LocalizedHtml as Html } from '@pascal-app/viewer/ui'
import { useFrame, useThree } from '@react-three/fiber'
import { type MutableRefObject, useEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Group,
  type Line,
  Raycaster,
  Vector2,
} from 'three'
import { EDITOR_LAYER } from '../../../lib/constants'
import { sculptFieldForSite, terrainPointInsideSite } from '../../../lib/terrain-sculpt'
import { brushRingColor, TERRAIN_SAMPLING_COLOR } from '../../../lib/terrain-verb-color'
import useEditor, { selectActiveTerrainVerb } from '../../../store/use-editor'
import { formatMeasurement } from '../../editor/measurement-pill'

/** Segments in the cursor ring. 64 reads as a circle at any usable brush size. */
const RING_SEGMENTS = 64
const ARROW_POINTS = 5
const PICK_LINE_SEGMENTS = 16

/**
 * Lift above the surface, so the ring is not z-fighting the ground it traces.
 *
 * Two centimetres only works because the ring samples `surfaceHeightAt` — the
 * plane of the triangle under each point — and not the bilinear `heightAt`. Those
 * differ by up to a quarter of a cell's warp, which on steep ground is decimetres,
 * so a bilinear ring would submerge on half of every cell no matter how large this
 * gets. `depthTest={false}` hides that on screen but not in the exported GLB.
 */
const RING_LIFT = 0.02

/** The ring is decoration; it must never intercept a pointer ray. */
const NO_RAYCAST = () => null

export type TerrainBrushFocus = {
  radius: number
  x: number
  z: number
}

/**
 * The brush ring, drawn *on the terrain surface* rather than as a flat disc.
 *
 * Following the surface is the whole point: a flat ring on sloped ground tells
 * the user nothing about what the brush will touch, because the footprint is a
 * cylinder in XZ and the interesting question is which part of the slope falls
 * inside it. Sampling the ring's height per segment answers that directly.
 *
 * Updated in `useFrame` from a ref, never through React state — the ring tracks
 * the pointer, and routing that through a re-render would re-run every hook in
 * the tool subtree at pointer rate.
 *
 * On `EDITOR_LAYER`, non-negotiably: an overlay mesh left on the scene layer
 * poisons the MRT scene pass and makes FrontSide geometry render see-through.
 */
export const TerrainBrushCursor: React.FC<{
  focusRef: MutableRefObject<TerrainBrushFocus | null>
  site: SiteNode
}> = ({ focusRef, site }) => {
  const { camera, gl } = useThree()
  const radius = useEditor((state) => state.terrainBrush.radius)
  const shape = useEditor((state) => state.terrainBrush.shape)
  // The ring is the only thing at the point of action that can say what the next
  // drag will do — its geometry is identical for all four verbs, so colour is the
  // one channel left. Keep the mapping centralized in `lib/terrain-verb-color`.
  const verb = useEditor(selectActiveTerrainVerb)
  const sampling = useEditor((state) => state.terrainSampling)
  const slopePitch = useEditor((state) => state.terrainSlope.pitch)
  const slopeDirection = useEditor((state) => state.terrainSlope.direction)
  const slopePickStart = useEditor((state) => state.terrainSlopePickStart)
  const color = brushRingColor(verb, sampling)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)

  const lineRef = useRef<Line>(null)
  const arrowLineRef = useRef<Line>(null)
  const pickLineRef = useRef<Line>(null)
  const centerRef = useRef<Group>(null)
  const heightRef = useRef<HTMLSpanElement>(null)
  const lastHeightLabelRef = useRef('')
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const raycaster = useRef(new Raycaster())
  const ndc = useRef(new Vector2())

  const geometry = useMemo(() => {
    const positions = new Float32Array((RING_SEGMENTS + 1) * 3)
    const buffer = new BufferGeometry()
    buffer.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return buffer
  }, [])
  const arrowGeometry = useMemo(() => {
    const positions = new Float32Array(ARROW_POINTS * 3)
    const buffer = new BufferGeometry()
    buffer.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return buffer
  }, [])
  const pickLineGeometry = useMemo(() => {
    const positions = new Float32Array((PICK_LINE_SEGMENTS + 1) * 3)
    const buffer = new BufferGeometry()
    buffer.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return buffer
  }, [])
  useEffect(() => {
    return () => {
      geometry.dispose()
      arrowGeometry.dispose()
      pickLineGeometry.dispose()
    }
  }, [geometry, arrowGeometry, pickLineGeometry])

  useEffect(() => {
    const canvas = gl.domElement
    const track = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointerRef.current = {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      }
    }
    const freeze = () => {
      pointerRef.current = null
    }
    canvas.addEventListener('pointermove', track)
    canvas.addEventListener('pointerleave', freeze)
    return () => {
      canvas.removeEventListener('pointermove', track)
      canvas.removeEventListener('pointerleave', freeze)
    }
  }, [gl])

  useFrame(() => {
    const line = lineRef.current
    const arrowLine = arrowLineRef.current
    const pickLine = pickLineRef.current
    const center = centerRef.current
    const pointer = pointerRef.current
    if (!(line && center)) return
    if (!(pointer || focusRef.current)) {
      line.visible = false
      if (arrowLine) arrowLine.visible = false
      if (pickLine) pickLine.visible = false
      center.visible = false
      if (heightRef.current) heightRef.current.style.display = 'none'
      return
    }

    // Two fields, deliberately. Aiming uses the stroke's *snapshot* so the ring
    // sits exactly where the next dab will land — the tool raycasts the snapshot
    // too, and a cursor that disagreed with the brush by even a few centimetres
    // would read as lag. Drawing uses the live field so the ring drapes over the
    // hill as it rises. Outside a stroke the two are the same field.
    const stroke = useLiveTerrain.getState().strokeOf(site.id)
    const surface: TerrainField = stroke?.field ?? terrainFieldOf(site) ?? sculptFieldForSite(site)
    const aim: TerrainField = stroke?.snapshot ?? surface

    let hit: { x: number; z: number } | null = null
    if (pointer) {
      ndc.current.set(pointer.x, pointer.y)
      raycaster.current.setFromCamera(ndc.current, camera)
      const { origin, direction } = raycaster.current.ray
      hit = raycastTerrain(
        aim,
        [origin.x, origin.y, origin.z],
        [direction.x, direction.y, direction.z],
      )
      if (hit && terrainPointInsideSite(site, hit.x, hit.z)) {
        focusRef.current = { radius: Math.max(radius, minBrushRadius(aim)), x: hit.x, z: hit.z }
      } else {
        hit = null
        focusRef.current = null
      }
    } else if (focusRef.current) {
      hit = terrainPointInsideSite(site, focusRef.current.x, focusRef.current.z)
        ? focusRef.current
        : null
    }
    if (!hit) {
      line.visible = false
      if (arrowLine) arrowLine.visible = false
      if (pickLine) pickLine.visible = false
      center.visible = false
      if (heightRef.current) heightRef.current.style.display = 'none'
      return
    }
    line.visible = true
    center.visible = true

    const attribute = line.geometry.getAttribute('position')
    const array = attribute.array as Float32Array
    // The same floor the tool applies at pointer-down. Drawing the stored radius
    // instead would draw a ring smaller than the footprint the next dab actually
    // gets — on a coarse lot the ring would be the one thing insisting the brush
    // is 2 m wide while the stroke is 1.5 spacings wide.
    const drawn = Math.max(radius, minBrushRadius(aim))
    focusRef.current = { radius: drawn, x: hit.x, z: hit.z }
    for (let index = 0; index <= RING_SEGMENTS; index++) {
      const angle = (index / RING_SEGMENTS) * Math.PI * 2
      // The square brush uses Chebyshev distance, so its rim is a square: scale
      // the unit circle out to the box so the ring shows the actual footprint
      // rather than an inscribed circle that under-reports it.
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const scale =
        shape === 'square' ? 1 / Math.max(Math.abs(cos), Math.abs(sin), Number.EPSILON) : 1
      const x = hit.x + cos * drawn * scale
      const z = hit.z + sin * drawn * scale
      array[index * 3] = x
      array[index * 3 + 1] = surfaceHeightAt(surface, x, z) + RING_LIFT
      array[index * 3 + 2] = z
    }
    attribute.needsUpdate = true
    line.geometry.computeBoundingSphere()

    // Uphill direction arrow inside the brush ring when in slope mode with non-zero pitch.
    if (arrowLine) {
      if (verb === 'slope' && !sampling && slopePitch > 0) {
        const { dx, dz } = terrainSlopeDirectionVector(slopeDirection)
        const perpX = -dz
        const perpZ = dx
        const halfLen = drawn * 0.55
        const headLen = drawn * 0.25
        const headHalfWidth = drawn * 0.2
        const tailX = hit.x - dx * halfLen
        const tailZ = hit.z - dz * halfLen
        const tipX = hit.x + dx * halfLen
        const tipZ = hit.z + dz * halfLen
        const tipY = surfaceHeightAt(surface, tipX, tipZ) + RING_LIFT
        const leftX = tipX - dx * headLen - perpX * headHalfWidth
        const leftZ = tipZ - dz * headLen - perpZ * headHalfWidth
        const rightX = tipX - dx * headLen + perpX * headHalfWidth
        const rightZ = tipZ - dz * headLen + perpZ * headHalfWidth

        const arrowAttr = arrowLine.geometry.getAttribute('position')
        const arrowArr = arrowAttr.array as Float32Array
        arrowArr[0] = tailX
        arrowArr[1] = surfaceHeightAt(surface, tailX, tailZ) + RING_LIFT
        arrowArr[2] = tailZ
        arrowArr[3] = tipX
        arrowArr[4] = tipY
        arrowArr[5] = tipZ
        arrowArr[6] = leftX
        arrowArr[7] = surfaceHeightAt(surface, leftX, leftZ) + RING_LIFT
        arrowArr[8] = leftZ
        arrowArr[9] = tipX
        arrowArr[10] = tipY
        arrowArr[11] = tipZ
        arrowArr[12] = rightX
        arrowArr[13] = surfaceHeightAt(surface, rightX, rightZ) + RING_LIFT
        arrowArr[14] = rightZ
        arrowAttr.needsUpdate = true
        arrowLine.geometry.computeBoundingSphere()
        arrowLine.visible = true
      } else {
        arrowLine.visible = false
      }
    }

    // Two-point A -> B guide line while picking the second slope point.
    if (pickLine) {
      if (verb === 'slope' && sampling && slopePickStart) {
        const pickAttr = pickLine.geometry.getAttribute('position')
        const pickArr = pickAttr.array as Float32Array
        for (let i = 0; i <= PICK_LINE_SEGMENTS; i++) {
          const t = i / PICK_LINE_SEGMENTS
          const px = slopePickStart[0] + (hit.x - slopePickStart[0]) * t
          const pz = slopePickStart[1] + (hit.z - slopePickStart[1]) * t
          pickArr[i * 3] = px
          pickArr[i * 3 + 1] = surfaceHeightAt(surface, px, pz) + RING_LIFT
          pickArr[i * 3 + 2] = pz
        }
        pickAttr.needsUpdate = true
        pickLine.geometry.computeBoundingSphere()
        pickLine.visible = true
      } else {
        pickLine.visible = false
      }
    }

    const centerHeight = surfaceHeightAt(surface, hit.x, hit.z)
    center.position.set(hit.x, centerHeight + RING_LIFT, hit.z)
    let heightLabel = `H ${formatMeasurement(centerHeight, unit, metricNotation)}`
    if (verb === 'slope' && sampling && slopePickStart) {
      const liveDerived = deriveTerrainSlopeFromPoints(slopePickStart, [hit.x, hit.z, centerHeight])
      if (liveDerived) {
        heightLabel = `${heightLabel} · ${terrainSlopeGradePercent(liveDerived.pitch).toFixed(1)}%`
      }
    }
    if (heightRef.current) {
      heightRef.current.style.display = ''
      if (heightLabel !== lastHeightLabelRef.current) {
        heightRef.current.textContent = heightLabel
        lastHeightLabelRef.current = heightLabel
      }
    }
  })

  return (
    <>
      <line
        frustumCulled={false}
        geometry={geometry}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        // @ts-expect-error R3F <line> element conflicts with SVG <line> type
        ref={lineRef}
        renderOrder={13}
      >
        <lineBasicNodeMaterial color={color} depthTest={false} depthWrite={false} linewidth={2} />
      </line>
      <line
        frustumCulled={false}
        geometry={arrowGeometry}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        // @ts-expect-error R3F <line> element conflicts with SVG <line> type
        ref={arrowLineRef}
        renderOrder={13}
        visible={false}
      >
        <lineBasicNodeMaterial color={color} depthTest={false} depthWrite={false} linewidth={2} />
      </line>
      <line
        frustumCulled={false}
        geometry={pickLineGeometry}
        layers={EDITOR_LAYER}
        raycast={NO_RAYCAST}
        // @ts-expect-error R3F <line> element conflicts with SVG <line> type
        ref={pickLineRef}
        renderOrder={13}
        visible={false}
      >
        <lineBasicNodeMaterial
          color={TERRAIN_SAMPLING_COLOR}
          depthTest={false}
          depthWrite={false}
          linewidth={2}
        />
      </line>
      <group ref={centerRef} visible={false}>
        <mesh
          layers={EDITOR_LAYER}
          raycast={NO_RAYCAST}
          renderOrder={14}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.055, 24]} />
          <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
        </mesh>
        <Html
          center
          position={[0, 0.18, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
          zIndexRange={[20, 0]}
        >
          <span
            className="whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-2 py-1 font-medium font-mono text-foreground text-xs shadow-sm backdrop-blur"
            ref={heightRef}
          />
        </Html>
      </group>
    </>
  )
}

export default TerrainBrushCursor
