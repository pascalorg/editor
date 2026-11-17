'use client'

import {
  type Ring,
  type TerrainField,
  type TerrainTileNode,
  terrainPreviewField,
  useLiveTerrain,
} from '@pascal-app/core'
import { SITE_GROUND } from '@pascal-app/viewer'
import { createContext, useContext, useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, type Material } from 'three'
import { GroundVeil } from './ground-veil'
import { lotMaskedMaterial } from './lot-mask'
import type { RampGroundCut } from './ramp-ground-holes'
import type { TerrainMeshBuffers } from './terrain-geometry'
import {
  groundMeshInReach,
  type TerrainGroundBounds,
  terrainFieldBounds,
  updateTerrainGroundMesh,
} from './terrain-ground'

export type TerrainGroundPresentation = {
  siteId: string
  field: TerrainField
  material: Material
  veil: Material
  holes: Ring[]
  /** The graded ramps' footprints on the ground, with what stands at their edge. */
  cuts: readonly RampGroundCut[]
  polygon: ReadonlyArray<readonly [number, number]>
  visible: boolean
  showSkirt: boolean
  tiles: readonly TerrainTileNode[]
}

export const TerrainGroundContext = createContext<TerrainGroundPresentation | null>(null)
export const useTerrainGround = () => useContext(TerrainGroundContext)

export function terrainBufferGeometry(buffers: TerrainMeshBuffers): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(buffers.positions, 3).setUsage(DynamicDrawUsage),
  )
  geometry.setAttribute(
    'normal',
    new BufferAttribute(buffers.normals, 3).setUsage(DynamicDrawUsage),
  )
  geometry.setAttribute('uv', new BufferAttribute(buffers.uvs, 2))
  geometry.setIndex(new BufferAttribute(buffers.indices, 1))
  geometry.computeBoundingSphere()
  return geometry
}

function useLiveGroundGeometry(
  ground: TerrainGroundPresentation | null,
  buffers: TerrainMeshBuffers,
  geometry: BufferGeometry,
) {
  useEffect(() => {
    if (!ground) return
    // A faceted break ground is read whole whatever the rectangle (`updateTerrainGroundMesh`).
    const bounded = !buffers.terrainBreakSides || buffers.terrainBreakGround === 'smooth'
    // Past the plain ground's one spacing, a height beside a break reads a few cells farther.
    const reach = ground.field.spacing * 5
    const refresh = (field: TerrainField, bounds?: TerrainGroundBounds) => {
      if (bounded && bounds && !groundMeshInReach(geometry.boundingSphere, bounds, reach)) return
      const range = updateTerrainGroundMesh(
        buffers,
        terrainPreviewField(field, ground.field),
        bounds,
      )
      if (!range) return
      for (const name of ['position', 'normal']) {
        const attribute = geometry.getAttribute(name) as BufferAttribute
        let start = range.start
        let end = start + range.count
        for (const pending of attribute.updateRanges) {
          start = Math.min(start, pending.start)
          end = Math.max(end, pending.start + pending.count)
        }
        attribute.clearUpdateRanges()
        attribute.addUpdateRange(start, end - start)
        attribute.needsUpdate = true
      }
      geometry.computeBoundingSphere()
    }
    const halo = ground.field.spacing
    const live = useLiveTerrain.getState().fieldOf(ground.siteId)
    // A stroke that begins or ends changes the ground inside its edit field's rectangle alone.
    if (live) refresh(live, terrainFieldBounds(live, halo))
    let previous = live
    return useLiveTerrain.subscribe((state) => {
      const field = state.fieldOf(ground.siteId)
      if (field === previous) return
      const edit = field ?? previous
      previous = field
      const stroke = state.strokes.get(ground.siteId) ?? state.remoteStrokes.get(ground.siteId)
      const patch = stroke?.lastPatch
      if (!field || !patch) {
        refresh(field ?? ground.field, edit ? terrainFieldBounds(edit, halo) : undefined)
        return
      }
      refresh(field, {
        minX: field.origin[0] + patch.col0 * field.spacing - halo,
        minZ: field.origin[1] + patch.row0 * field.spacing - halo,
        maxX: field.origin[0] + (patch.col0 + patch.cols - 1) * field.spacing + halo,
        maxZ: field.origin[1] + (patch.row0 + patch.rows - 1) * field.spacing + halo,
      })
    })
  }, [ground?.siteId, ground?.field, buffers, geometry])
}

export function TerrainGroundSurface({
  buffers,
  drawn = true,
}: {
  buffers: TerrainMeshBuffers
  /** False for a mesh no part of which is inside the property line: kept, and not drawn. */
  drawn?: boolean
}) {
  const ground = useTerrainGround()
  const geometry = useMemo(() => terrainBufferGeometry(buffers), [buffers])
  useEffect(() => () => geometry.dispose(), [geometry])
  const materials = useMemo(() => {
    if (!ground) return null
    return {
      surface: lotMaskedMaterial(ground.material, ground.polygon),
      veil: lotMaskedMaterial(ground.veil, ground.polygon),
    }
  }, [ground?.material, ground?.veil, ground?.polygon])
  useEffect(
    () => () => {
      materials?.surface.dispose()
      materials?.veil.dispose()
    },
    [materials],
  )
  useLiveGroundGeometry(ground, buffers, geometry)
  if (!ground || !materials || !ground.visible) return null
  return (
    <>
      <mesh
        castShadow
        geometry={geometry}
        material={materials.surface}
        receiveShadow
        userData={{ [SITE_GROUND]: 'solid' }}
        visible={drawn}
      />
      {drawn && <GroundVeil geometry={geometry} material={materials.veil} />}
    </>
  )
}
