'use client'

import {
  type SiteNode,
  type TerrainTileNode,
  terrainPreviewField,
  useLiveTerrain,
} from '@pascal-app/core'
import { SITE_GROUND } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import type { BufferAttribute } from 'three'
import { GroundVeil } from './ground-veil'
import { buildTerrainSkirt, skirtRing, updateTerrainSkirt } from './terrain-geometry'
import {
  buildTerrainGroundMesh,
  type TerrainGroundBounds,
  terrainGroundPatches,
} from './terrain-ground'
import {
  TerrainGroundSurface,
  terrainBufferGeometry,
  useTerrainGround,
} from './terrain-ground-surface'

export function TerrainGroundRenderer({
  site,
  tiles,
}: {
  site: SiteNode
  tiles: readonly TerrainTileNode[]
}) {
  const ground = useTerrainGround()
  const meshes = useMemo(() => {
    if (!ground) return []
    return terrainGroundPatches(site, tiles).map(({ key, grid, holes }) => ({
      key,
      buffers: buildTerrainGroundMesh(grid, ground.field, [...ground.holes, ...holes], ground.cuts),
    }))
  }, [site.terrain, site.polygon, tiles, ground?.field, ground?.holes, ground?.cuts])
  return (
    <>
      {meshes.map(({ key, buffers }) => (
        <TerrainGroundSurface buffers={buffers} key={key} />
      ))}
      {ground?.showSkirt && <TerrainGroundSkirt />}
    </>
  )
}

function TerrainGroundSkirt() {
  const ground = useTerrainGround()
  const target = useMemo(() => {
    if (!ground) return null
    const buffers = buildTerrainSkirt(ground.field, skirtRing(ground.field, ground.polygon))
    const geometry = terrainBufferGeometry({
      ...buffers,
      uvs: new Float32Array((buffers.positions.length / 3) * 2),
    })
    return { buffers, geometry }
  }, [ground?.field, ground?.polygon])
  useEffect(() => () => target?.geometry.dispose(), [target])
  useEffect(() => {
    if (!ground || !target) return
    const refresh = (bounds?: TerrainGroundBounds) => {
      const live = useLiveTerrain.getState().fieldOf(ground.siteId)
      const field = live ? terrainPreviewField(live, ground.field) : ground.field
      const range = updateTerrainSkirt(field, target.buffers, bounds)
      if (!range) return
      // A dab moves heights only: the points it reached are uploaded, and no normal.
      const position = target.geometry.getAttribute('position') as BufferAttribute
      let start = bounds ? range.start : 0
      let end = bounds ? range.start + range.count : position.array.length
      for (const pending of position.updateRanges) {
        start = Math.min(start, pending.start)
        end = Math.max(end, pending.start + pending.count)
      }
      position.clearUpdateRanges()
      position.addUpdateRange(start, end - start)
      position.needsUpdate = true
      if (!bounds) (target.geometry.getAttribute('normal') as BufferAttribute).needsUpdate = true
      target.geometry.computeBoundingSphere()
    }
    refresh()
    let previous = useLiveTerrain.getState().fieldOf(ground.siteId)
    return useLiveTerrain.subscribe((state) => {
      const field = state.fieldOf(ground.siteId)
      if (field === previous) return
      previous = field
      const stroke = state.strokes.get(ground.siteId) ?? state.remoteStrokes.get(ground.siteId)
      const patch = stroke?.lastPatch
      if (!field || !patch) {
        refresh()
        return
      }
      const halo = ground.field.spacing
      refresh({
        minX: field.origin[0] + patch.col0 * field.spacing - halo,
        minZ: field.origin[1] + patch.row0 * field.spacing - halo,
        maxX: field.origin[0] + (patch.col0 + patch.cols - 1) * field.spacing + halo,
        maxZ: field.origin[1] + (patch.row0 + patch.rows - 1) * field.spacing + halo,
      })
    })
  }, [ground?.siteId, ground?.field, target])
  if (!ground || !target || !ground.visible) return null
  return (
    <>
      <mesh
        geometry={target.geometry}
        material={ground.material}
        receiveShadow
        userData={{ [SITE_GROUND]: 'solid' }}
      />
      <GroundVeil geometry={target.geometry} material={ground.veil} />
    </>
  )
}
