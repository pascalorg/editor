'use client'

import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import { BATCHED_LAYER } from '../../lib/layers'
import { filterSectionHits, sectionActive } from '../../lib/section'
import { filterXrayHits, xrayActive } from '../../lib/xray'
import useViewer from '../../store/use-viewer'
import { isSectionObject } from './section-group'

/**
 * Lets R3F's pointer raycaster see geometry a collective batch draws.
 *
 * R3F picks with one shared raycaster whose default mask is `SCENE_LAYER`
 * alone. A wall sewn into its level's merged mesh is moved off that layer
 * (`hideBatchedWall`) while staying in the graph with its pointer handlers
 * intact — so without this the wall answers no hover, paint or click the
 * moment it joins a batch, and a floor's walls go dead a fraction of a second
 * after the last edit settles.
 *
 * Additive rather than `setSurfaceRaycastLayers`: that helper resets the mask
 * for the private raycasters callers build per query, and this one is shared.
 */
export const PointerRaycastLayers = () => {
  const active = useViewer((state) => sectionActive(state) || xrayActive(state))
  const get = useThree((state) => state.get)
  const setEvents = useThree((state) => state.setEvents)
  const raycaster = useThree((state) => state.raycaster)

  useLayoutEffect(() => {
    const mask = raycaster.layers.mask
    raycaster.layers.enable(BATCHED_LAYER)
    return () => {
      raycaster.layers.mask = mask
    }
  }, [raycaster])

  useLayoutEffect(() => {
    if (!active) return
    const previous = get().events.filter
    const filter: NonNullable<ReturnType<typeof get>['events']['filter']> = (hits, state) => {
      const kept = filterSectionHits(hits, useViewer.getState(), (hit) =>
        isSectionObject(hit.object),
      )
      const visible = filterXrayHits(kept, useViewer.getState())
      return previous ? previous(visible, state) : visible
    }
    setEvents({ filter })
    return () => {
      if (get().events.filter === filter) setEvents({ filter: previous })
    }
  }, [active, get, setEvents])

  return null
}
