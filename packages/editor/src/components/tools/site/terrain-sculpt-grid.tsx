'use client'

import {
  type HeightPatch,
  type SiteNode,
  type TerrainField,
  terrainFieldOf,
  useLiveTerrain,
  useScene,
} from '@pascal-app/core'
import { GRID_LAYER, getSceneTheme, useViewer } from '@pascal-app/viewer'
import { useFrame } from '@react-three/fiber'
import { type MutableRefObject, useEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, type LineSegments, Vector2 } from 'three'
import { float, positionLocal, smoothstep, uniform } from 'three/tsl'
import { LineBasicNodeMaterial } from 'three/webgpu'
import { sculptFieldForSite, terrainPointInsideSite } from '../../../lib/terrain-sculpt'
import type { TerrainBrushFocus } from './terrain-brush-cursor'

const GRID_LIFT = 0.012
const NO_RAYCAST = () => null

function writeGridHeights(
  attribute: BufferAttribute,
  field: TerrainField,
  patch: HeightPatch | null,
): void {
  const col0 = patch ? Math.max(0, patch.col0) : 0
  const row0 = patch ? Math.max(0, patch.row0) : 0
  const col1 = patch ? Math.min(field.cols, patch.col0 + patch.cols) : field.cols
  const row1 = patch ? Math.min(field.rows, patch.row0 + patch.rows) : field.rows
  if (col0 >= col1 || row0 >= row1) return

  const positions = attribute.array as Float32Array
  for (let row = row0; row < row1; row += 1) {
    for (let col = col0; col < col1; col += 1) {
      const sampleIndex = row * field.cols + col
      positions[sampleIndex * 3 + 1] = (field.heights[sampleIndex] ?? 0) * field.step + GRID_LIFT
    }
  }

  attribute.clearUpdateRanges()
  const first = (row0 * field.cols + col0) * 3
  const last = ((row1 - 1) * field.cols + (col1 - 1)) * 3 + 2
  attribute.addUpdateRange(first, last - first + 1)
  attribute.needsUpdate = true
}

function createGridGeometry(field: TerrainField, site: Pick<SiteNode, 'polygon'>): BufferGeometry {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(field.cols * field.rows * 3)
  const indices: number[] = []

  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col < field.cols; col += 1) {
      const sampleIndex = row * field.cols + col
      positions[sampleIndex * 3] = field.origin[0] + col * field.spacing
      positions[sampleIndex * 3 + 2] = field.origin[1] + row * field.spacing
    }
  }

  let indexOffset = 0
  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col < field.cols - 1; col += 1) {
      const sampleIndex = row * field.cols + col
      const x = field.origin[0] + col * field.spacing
      const z = field.origin[1] + row * field.spacing
      if (
        terrainPointInsideSite(site, x, z) &&
        terrainPointInsideSite(site, x + field.spacing, z)
      ) {
        indices[indexOffset++] = sampleIndex
        indices[indexOffset++] = sampleIndex + 1
      }
    }
  }
  for (let col = 0; col < field.cols; col += 1) {
    for (let row = 0; row < field.rows - 1; row += 1) {
      const sampleIndex = row * field.cols + col
      const x = field.origin[0] + col * field.spacing
      const z = field.origin[1] + row * field.spacing
      if (
        terrainPointInsideSite(site, x, z) &&
        terrainPointInsideSite(site, x, z + field.spacing)
      ) {
        indices[indexOffset++] = sampleIndex
        indices[indexOffset++] = sampleIndex + field.cols
      }
    }
  }

  const positionAttribute = new BufferAttribute(positions, 3)
  geometry.setAttribute('position', positionAttribute)
  geometry.setIndex(indices)
  writeGridHeights(positionAttribute, field, null)
  geometry.computeBoundingSphere()
  return geometry
}

/**
 * A terrain-following lattice shown for the entire lifetime of sculpt mode.
 *
 * The ordinary editor grid is a planar snapping aid, so making it visible here
 * would leave it cutting through hills and hiding below excavations. This grid
 * shares the terrain samples instead: every row and column visibly bends with
 * the surface, and live dabs rewrite only the affected height span. It stays on
 * `GRID_LAYER` so scene geometry depth-occludes it instead of the overlay pass
 * compositing it through walls and objects.
 */
export function TerrainSculptGrid({
  focusRef,
  site,
}: {
  focusRef: MutableRefObject<TerrainBrushFocus | null>
  site: SiteNode
}) {
  const appearance = useViewer((state) => getSceneTheme(state.sceneTheme).appearance)
  const targetRef = useRef<LineSegments>(null)

  const field = useMemo(() => sculptFieldForSite(site), [site])
  const geometry = useMemo(() => createGridGeometry(field, site), [field, site])
  useEffect(() => () => geometry.dispose(), [geometry])

  const focusCenter = useMemo(() => uniform(new Vector2()), [])
  const focusRadius = useMemo(() => uniform(1), [])
  const focusVisible = useMemo(() => uniform(0), [])
  const material = useMemo(() => {
    const baseOpacity = appearance === 'dark' ? 0.07 : 0.05
    const focusBoost = appearance === 'dark' ? 0.11 : 0.09
    const distance = positionLocal.xz.sub(focusCenter).length()
    const focus = float(1)
      .sub(smoothstep(focusRadius.mul(1.05), focusRadius.mul(2.5), distance))
      .mul(focusVisible)

    return new LineBasicNodeMaterial({
      color: appearance === 'dark' ? '#cbd5e1' : '#475569',
      depthTest: true,
      depthWrite: false,
      opacityNode: float(baseOpacity).add(focus.mul(focusBoost)),
      transparent: true,
    })
  }, [appearance, focusCenter, focusRadius, focusVisible])
  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    const focus = focusRef.current
    focusVisible.value = focus ? 1 : 0
    if (!focus) return
    focusCenter.value.set(focus.x, focus.z)
    focusRadius.value = focus.radius
  })

  useEffect(() => {
    let lastPatch = useLiveTerrain.getState().strokeOf(site.id)?.lastPatch ?? null

    return useLiveTerrain.subscribe((state) => {
      const target = targetRef.current
      if (!target) return
      const attribute = target.geometry.getAttribute('position') as BufferAttribute
      const stroke = state.strokes.get(site.id)

      if (stroke?.lastPatch && stroke.lastPatch !== lastPatch) {
        lastPatch = stroke.lastPatch
        writeGridHeights(attribute, stroke.field, stroke.lastPatch)
        target.geometry.computeBoundingSphere()
        return
      }

      if (!stroke && lastPatch) {
        lastPatch = null
        const current = useScene.getState().nodes[site.id]
        if (current?.type !== 'site') return
        const restored = terrainFieldOf(current) ?? sculptFieldForSite(current)
        if (restored.cols !== field.cols || restored.rows !== field.rows) return
        writeGridHeights(attribute, restored, null)
        target.geometry.computeBoundingSphere()
      }
    })
  }, [field.cols, field.rows, site.id])

  return (
    <lineSegments
      frustumCulled={false}
      geometry={geometry}
      layers={GRID_LAYER}
      material={material}
      raycast={NO_RAYCAST}
      ref={targetRef}
      renderOrder={11}
    />
  )
}
