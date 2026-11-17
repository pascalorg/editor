'use client'

import { decodeTerrainField, type Ring, type SiteNode } from '@pascal-app/core'
import { SITE_GROUND } from '@pascal-app/viewer'
import { useEffect, useMemo } from 'react'
import type { Material } from 'three'
import { GroundVeil } from './ground-veil'
import { lotMaskedMaterial } from './lot-mask'
import { skirtRing } from './terrain-geometry'
import { createTerrainGeometry, disposeTerrainGeometry } from './terrain-mesh'

/**
 * The unchanged legacy grid, when neither tiles nor lot growth need composition.
 *
 * Live strokes use TerrainGroundRenderer's global authority instead. Keeping the
 * original lattice here avoids resampling old scenes merely by loading them.
 */
export const TerrainRenderer = ({
  material,
  veil,
  site,
  holes,
  polygon,
  showSkirt = true,
}: {
  /** Owned by `SiteRenderer` so the ground material stays defined in one place. */
  material: Material
  /** The veil drawn in the ground's place over a level below grade, owned there too. */
  veil: Material
  site: SiteNode
  holes: Ring[]
  /**
   * The lot's property line (live while it is being edited). With one, the
   * ground is the lot alone — cut to the line, closed by a skirt down to a flat
   * base — rather than the field's padded box.
   */
  polygon?: ReadonlyArray<readonly [number, number]> | null
  showSkirt?: boolean
}) => {
  const persistedField = useMemo(() => decodeTerrainField(site.terrain), [site.terrain])

  const target = useMemo(() => {
    const field = persistedField
    if (!field) return null
    const ring = polygon && polygon.length >= 3 ? skirtRing(field, polygon) : null
    return createTerrainGeometry(field, holes, ring && ring.length >= 6 ? ring : null)
  }, [persistedField, holes, polygon])

  // The surface (and the cut edges round recessed slabs) stop at the property
  // line; the skirt keeps the plain material — it *is* the line.
  const surfaceMaterial = useMemo(
    () => (polygon && polygon.length >= 3 ? lotMaskedMaterial(material, polygon) : material),
    [material, polygon],
  )
  useEffect(
    () => () => {
      if (surfaceMaterial !== material) surfaceMaterial.dispose()
    },
    [surfaceMaterial, material],
  )
  const surfaceVeil = useMemo(
    () => (polygon && polygon.length >= 3 ? lotMaskedMaterial(veil, polygon) : veil),
    [veil, polygon],
  )
  useEffect(
    () => () => {
      if (surfaceVeil !== veil) surfaceVeil.dispose()
    },
    [surfaceVeil, veil],
  )

  useEffect(
    () => () => {
      if (target) disposeTerrainGeometry(target)
    },
    [target],
  )

  if (!target) return null

  return (
    <>
      <mesh
        castShadow
        geometry={target.geometry}
        material={surfaceMaterial}
        receiveShadow
        userData={{ [SITE_GROUND]: 'solid' }}
      />
      <GroundVeil geometry={target.geometry} material={surfaceVeil} />
      {target.holeBoundary && (
        <>
          <mesh
            castShadow
            geometry={target.holeBoundary.geometry}
            material={surfaceMaterial}
            receiveShadow
            userData={{ [SITE_GROUND]: 'solid' }}
          />
          <GroundVeil geometry={target.holeBoundary.geometry} material={surfaceVeil} />
        </>
      )}
      {/*
        The edge curtain — along the property line when there is one, from the
        ground down to the block's flat base. Not `castShadow`: it hangs below the
        ground it closes, so it would cast a rim of shade onto the horizon disc all
        round the lot. `receiveShadow` for the same reason the surface has it — a raised edge
        is lit ground that a building next to it should darken.
      */}
      {showSkirt && (
        <>
          <mesh
            geometry={target.skirt.geometry}
            material={material}
            receiveShadow
            userData={{ [SITE_GROUND]: 'solid' }}
          />
          <GroundVeil geometry={target.skirt.geometry} material={veil} />
        </>
      )}
    </>
  )
}

export default TerrainRenderer
