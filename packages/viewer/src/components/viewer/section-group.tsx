'use client'

import { useThree } from '@react-three/fiber'
import { type ReactNode, useLayoutEffect, useMemo } from 'react'
import { type Object3D, Plane } from 'three'
import { ClippingGroup } from 'three/webgpu'
import { SCENE_LAYER } from '../../lib/layers'
import { sectionActive, updateSectionPlane } from '../../lib/section'
import useViewer from '../../store/use-viewer'

const roots = new WeakSet<Object3D>()

export function isSectionObject(object: Object3D): boolean {
  for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent) {
    if (roots.has(ancestor)) return true
  }
  return false
}

/** Model-only scope; plane identity and plane count stay stable while scrubbing. */
export function SectionGroup({ children, name }: { children?: ReactNode; name?: string }) {
  const invalidate = useThree((state) => state.invalidate)
  const group = useMemo(() => {
    const value = new ClippingGroup()
    value.clippingPlanes = [new Plane()]
    roots.add(value)
    return value
  }, [])

  useLayoutEffect(() => {
    const update = () => {
      const state = useViewer.getState()
      updateSectionPlane(group.clippingPlanes[0]!, state)
      group.enabled = sectionActive(state)
      group.layers.mask = group.enabled ? -1 : 1 << SCENE_LAYER
      group.clipShadows = group.enabled && state.sectionShadows === 'cut'
      invalidate()
    }
    update()
    return useViewer.subscribe((state, previous) => {
      if (
        state.sectionShadows !== previous.sectionShadows ||
        state.sectionEnabled !== previous.sectionEnabled ||
        state.sectionAxis !== previous.sectionAxis ||
        state.sectionPosition !== previous.sectionPosition ||
        state.sectionFlipped !== previous.sectionFlipped ||
        state.walkthroughMode !== previous.walkthroughMode
      )
        update()
    })
  }, [group, invalidate])

  return (
    <primitive object={group} name={name}>
      {children}
    </primitive>
  )
}
