import { hideFromScene, showInScene, useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import type { Object3D } from 'three'

/**
 * A ref for one of the site's ground surfaces that holds it off the scene while the viewer sets the
 * ground aside (the active level lies below grade): out of the colour passes, the shadow map and
 * every pick, so the floor under it is seen and clicked where the ground was. A ref rather than a
 * prop: the surfaces mount and unmount with the terrain, and each must be held while it is there.
 */
export function useGroundAsideRef() {
  const aside = useViewer((state) => state.groundAside)
  return useCallback(
    (surface: Object3D | null) => {
      if (!(surface && aside)) return
      hideFromScene(surface, 'ground-aside')
      return () => showInScene(surface, 'ground-aside')
    },
    [aside],
  )
}
