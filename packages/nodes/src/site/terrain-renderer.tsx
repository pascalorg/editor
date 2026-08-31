'use client'

import { type SiteNode, terrainFieldOf, useLiveTerrain } from '@pascal-app/core'
import { useEffect, useMemo, useRef } from 'react'
import type { Material } from 'three'
import {
  applyTerrainPatch,
  createTerrainGeometry,
  disposeTerrainGeometry,
  needsRebuild,
  type TerrainGeometry,
} from './terrain-mesh'

/**
 * Renders the site's sculpted ground.
 *
 * Mounted by `SiteRenderer` only when the site has terrain (or a stroke is in
 * flight), so a scene that never touched terrain mounts nothing at all and pays
 * nothing.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * - **The geometry is a ref, not React state.** A sculpt stroke pushes dozens of
 *   patches a second; routing each through a re-render would rebuild the
 *   `BufferGeometry` object identity every dab and throw away the partial-upload
 *   win entirely. The component subscribes to the *patch*, mutates the buffers in
 *   place, and never re-renders during a stroke.
 * - **It stays on the default `SCENE_LAYER`.** This is real, visible,
 *   shadow-receiving geometry — not an overlay. Overlay/hit-area meshes must use
 *   the editor layer, but moving actual scene geometry there would exclude it from
 *   the MRT depth/normal pass and break the screen-space ink against it.
 */
export const TerrainRenderer = ({
  material,
  site,
}: {
  /** Owned by `SiteRenderer` so the ground material stays defined in one place. */
  material: Material
  site: SiteNode
}) => {
  const targetRef = useRef<TerrainGeometry | null>(null)

  // Persisted terrain only — the live stroke is applied imperatively below, so a
  // dab never triggers a React render.
  const persistedField = useMemo(
    () => terrainFieldOf({ id: site.id, terrain: site.terrain }),
    [site.id, site.terrain],
  )

  const target = useMemo(() => {
    const field = useLiveTerrain.getState().fieldOf(site.id) ?? persistedField
    if (!field) return null
    return createTerrainGeometry(field)
  }, [persistedField, site.id])

  targetRef.current = target
  useEffect(
    () => () => {
      if (target) disposeTerrainGeometry(target)
    },
    [target],
  )

  // Imperative subscription rather than a selector hook: the point is to react to
  // a dab *without* re-rendering. Zustand's subscribe gives the previous state
  // too, so a patch is only uploaded once even if an unrelated store update
  // notifies.
  useEffect(() => {
    let lastPatch = useLiveTerrain.getState().strokeOf(site.id)?.lastPatch ?? null
    return useLiveTerrain.subscribe((state) => {
      const stroke = state.strokes.get(site.id)
      const current = targetRef.current
      if (!(stroke && current)) {
        lastPatch = null
        return
      }
      if (!stroke.lastPatch || stroke.lastPatch === lastPatch) return
      lastPatch = stroke.lastPatch
      // A resized field cannot be patched — the vertex count changed. That only
      // happens on import, never mid-stroke, so bail and let the persisted-field
      // rebuild handle it rather than silently corrupting the buffers.
      if (needsRebuild(current, stroke.field)) return
      applyTerrainPatch(current, stroke.field, stroke.lastPatch)
    })
  }, [site.id])

  if (!target) return null

  return (
    <>
      <mesh castShadow geometry={target.geometry} material={material} receiveShadow />
      {/*
        The edge curtain. Not `castShadow`: it hangs a metre below the ground it
        closes, so it would cast a rim of shade onto the horizon disc all round the
        lot. `receiveShadow` for the same reason the surface has it — a raised edge
        is lit ground that a building next to it should darken.
      */}
      <mesh geometry={target.skirt.geometry} material={material} receiveShadow />
    </>
  )
}

export default TerrainRenderer
