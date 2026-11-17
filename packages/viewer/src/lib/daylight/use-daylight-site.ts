import { useScene } from '@pascal-app/core'
import { useMemo } from 'react'
import useViewer from '../../store/use-viewer'
import { resolveDaylightSite } from './location'

export function useDaylightSite() {
  const override = useViewer((s) => s.daylightSite)
  const device = useViewer((s) => s.deviceLocation)
  const site = useScene((state) => {
    for (const id of state.rootNodeIds) {
      const node = state.nodes[id]
      if (node?.type === 'site') return node
    }
    return undefined
  })
  return useMemo(() => resolveDaylightSite(site, override, device), [site, override, device])
}
