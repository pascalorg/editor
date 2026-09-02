'use client'

import '../../../three-types'

import { Html } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import { PlaneGeometry } from 'three'
import { distance, smoothstep, uv, vec2 } from 'three/tsl'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import {
  formatLinearMeasurement,
  type LinearUnit,
  type MetricNotation,
} from '../../../lib/measurements'
import { createLineGeometry, getBoxEdgePoints } from './placement-box-geometry'

const VALID_COLOR = 0x22_c5_5e // green-500
const INVALID_COLOR = 0xef_44_44 // red-500
const MEASUREMENT_COLOR = 0x0f_17_2a

type PlacementBoxMeasurements = {
  unit: LinearUnit
  metricNotation?: MetricNotation
}

function getMeasurementGuidePoints(width: number, height: number, depth: number) {
  const minX = -width / 2
  const maxX = width / 2
  const minZ = -depth / 2
  const maxZ = depth / 2
  const guideOffset = 0.18
  const tick = 0.08
  const y = 0.02

  return {
    depth: [
      maxX + guideOffset,
      y,
      minZ,
      maxX + guideOffset,
      y,
      maxZ,

      maxX + guideOffset - tick,
      y,
      minZ,
      maxX + guideOffset + tick,
      y,
      minZ,

      maxX + guideOffset - tick,
      y,
      maxZ,
      maxX + guideOffset + tick,
      y,
      maxZ,
    ],
    height: [
      minX - guideOffset,
      0,
      minZ,
      minX - guideOffset,
      height,
      minZ,

      minX - guideOffset - tick,
      0,
      minZ,
      minX - guideOffset + tick,
      0,
      minZ,

      minX - guideOffset - tick,
      height,
      minZ,
      minX - guideOffset + tick,
      height,
      minZ,
    ],
    width: [
      minX,
      y,
      maxZ + guideOffset,
      maxX,
      y,
      maxZ + guideOffset,

      minX,
      y,
      maxZ + guideOffset - tick,
      minX,
      y,
      maxZ + guideOffset + tick,

      maxX,
      y,
      maxZ + guideOffset - tick,
      maxX,
      y,
      maxZ + guideOffset + tick,
    ],
  }
}

function MeasurementPill({
  active,
  label,
  onSelect,
  position,
}: {
  active?: boolean
  label: string
  onSelect?: () => void
  position: [number, number, number]
}) {
  return (
    <Html center position={position} style={{ pointerEvents: onSelect ? 'auto' : 'none' }}>
      <button
        className={active ? 'ring-1 ring-indigo-200' : undefined}
        onClick={(event) => {
          event.stopPropagation()
          onSelect?.()
        }}
        style={{
          background: 'rgba(15, 23, 42, 0.86)',
          border: '1px solid rgba(15, 23, 42, 0.65)',
          borderRadius: '999px',
          color: '#f8fafc',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '11px',
          fontWeight: 600,
          lineHeight: 1,
          padding: '4px 8px',
          pointerEvents: onSelect ? 'auto' : 'none',
          whiteSpace: 'nowrap',
        }}
        type="button"
      >
        {label}
      </button>
    </Html>
  )
}

/**
 * Green/red placement footprint shown while a node follows the cursor — the
 * same wireframe-box + radial base plane the GLB item tool draws (geometry
 * helpers shared via `placement-box-geometry`). Unlike the item coordinator's
 * imperative cursor (it mutates module-singleton materials in a `useFrame`
 * loop), this is a declarative, React-driven box: the caller passes the live
 * `position` / `rotationY` / `valid` and the box re-renders. Its own materials
 * are instanced per-mount so it never fights the item tool's singletons.
 *
 * The box is centred on its footprint in X/Z and sits on the floor (its base
 * at the group origin's Y), so a node whose local origin is floor-level — like
 * a shelf — lines up without an extra offset.
 */
export function PlacementBox({
  activeDimensionId,
  dimensions,
  dimensionInput = '',
  measurements,
  measurementValues,
  onDimensionSelect,
  position,
  rotationY = 0,
  valid,
}: {
  /** Footprint extent `[width, height, depth]` (unrotated). */
  dimensions: [number, number, number]
  /** Optional dimension guide labels matching the GLB item placement cursor. */
  measurements?: PlacementBoxMeasurements
  /** Values represented by the editable dimension pills; defaults to the box dimensions. */
  measurementValues?: [width: number, height: number, depth: number]
  /** World-plan position of the footprint centre (floor level). */
  position: [number, number, number]
  /** Y-rotation in radians, applied to the whole box. */
  rotationY?: number
  /** Drives the colour: green when placeable, red otherwise. */
  valid: boolean
  activeDimensionId?: string | null
  dimensionInput?: string
  onDimensionSelect?: (id: string) => void
}) {
  const [width, height, depth] = dimensions
  const [measurementWidth, measurementHeight, measurementDepth] = measurementValues ?? dimensions

  const edgeGeometry = useMemo(
    () =>
      createLineGeometry(
        getBoxEdgePoints({
          min: [-width / 2, 0, -depth / 2],
          max: [width / 2, height, depth / 2],
          dimensions: [width, height, depth],
          center: [0, height / 2, 0],
        }),
      ),
    [width, height, depth],
  )

  const basePlaneGeometry = useMemo(() => {
    const geometry = new PlaneGeometry(width, depth)
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, 0.01, 0)
    return geometry
  }, [width, depth])
  const measurementGuideGeometries = useMemo(() => {
    const points = getMeasurementGuidePoints(width, height, depth)
    return {
      depth: createLineGeometry(points.depth),
      height: createLineGeometry(points.height),
      width: createLineGeometry(points.width),
    }
  }, [width, height, depth])

  const edgeMaterial = useMemo(
    () => new LineBasicNodeMaterial({ linewidth: 3, depthTest: false, depthWrite: false }),
    [],
  )
  const basePlaneMaterial = useMemo(() => {
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    // Radial opacity: transparent in the centre, opaque toward the edges —
    // matches the item placement base plane.
    material.opacityNode = smoothstep(0, 0.7, distance(uv(), vec2(0.5, 0.5))).mul(0.6)
    return material
  }, [])
  const measurementMaterial = useMemo(
    () =>
      new LineBasicNodeMaterial({
        color: MEASUREMENT_COLOR,
        linewidth: 2,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )

  useEffect(() => {
    const color = valid ? VALID_COLOR : INVALID_COLOR
    edgeMaterial.color.setHex(color)
    basePlaneMaterial.color.setHex(color)
  }, [valid, edgeMaterial, basePlaneMaterial])

  useEffect(
    () => () => {
      edgeGeometry.dispose()
    },
    [edgeGeometry],
  )
  useEffect(
    () => () => {
      measurementGuideGeometries.depth.dispose()
      measurementGuideGeometries.height.dispose()
      measurementGuideGeometries.width.dispose()
    },
    [measurementGuideGeometries],
  )
  useEffect(
    () => () => {
      basePlaneGeometry.dispose()
    },
    [basePlaneGeometry],
  )
  useEffect(
    () => () => {
      edgeMaterial.dispose()
      basePlaneMaterial.dispose()
      measurementMaterial.dispose()
    },
    [edgeMaterial, basePlaneMaterial, measurementMaterial],
  )

  const measurementContent = measurements ? (
    <>
      <lineSegments
        geometry={measurementGuideGeometries.width}
        layers={EDITOR_LAYER}
        material={measurementMaterial}
        renderOrder={998}
      />
      <lineSegments
        geometry={measurementGuideGeometries.depth}
        layers={EDITOR_LAYER}
        material={measurementMaterial}
        renderOrder={998}
      />
      <lineSegments
        geometry={measurementGuideGeometries.height}
        layers={EDITOR_LAYER}
        material={measurementMaterial}
        renderOrder={998}
      />
      <MeasurementPill
        active={activeDimensionId === 'cabinet-width'}
        label={
          activeDimensionId === 'cabinet-width' && dimensionInput
            ? dimensionInput
            : formatLinearMeasurement(
                measurementWidth,
                measurements.unit,
                measurements.metricNotation,
              )
        }
        onSelect={onDimensionSelect ? () => onDimensionSelect('cabinet-width') : undefined}
        position={[0, 0.04, depth / 2 + 0.24]}
      />
      <MeasurementPill
        active={activeDimensionId === 'cabinet-depth'}
        label={
          activeDimensionId === 'cabinet-depth' && dimensionInput
            ? dimensionInput
            : formatLinearMeasurement(
                measurementDepth,
                measurements.unit,
                measurements.metricNotation,
              )
        }
        onSelect={onDimensionSelect ? () => onDimensionSelect('cabinet-depth') : undefined}
        position={[width / 2 + 0.24, 0.04, 0]}
      />
      <MeasurementPill
        active={activeDimensionId === 'cabinet-height'}
        label={
          activeDimensionId === 'cabinet-height' && dimensionInput
            ? dimensionInput
            : formatLinearMeasurement(
                measurementHeight,
                measurements.unit,
                measurements.metricNotation,
              )
        }
        onSelect={onDimensionSelect ? () => onDimensionSelect('cabinet-height') : undefined}
        position={[-width / 2 - 0.24, height / 2, -depth / 2]}
      />
    </>
  ) : null

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <lineSegments
        geometry={edgeGeometry}
        layers={EDITOR_LAYER}
        material={edgeMaterial}
        renderOrder={999}
      />
      {measurementContent}
      <mesh
        geometry={basePlaneGeometry}
        layers={EDITOR_LAYER}
        material={basePlaneMaterial}
        renderOrder={999}
      />
    </group>
  )
}
