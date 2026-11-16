'use client'

import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { type ReactNode, useLayoutEffect, useRef } from 'react'
import type { Group, Object3D } from 'three'
import { sectionActive } from '../../lib/section'
import { useSiteSurfaceOwner } from '../../lib/site-surfaces'
import useViewer from '../../store/use-viewer'

type SiteSurfaceScopeProps = {
  siteId: string
  object?: () => Object3D | undefined | null
  objects?: readonly Object3D[]
  children?: ReactNode
}

/** Site-owned ground and lines escape an active cut; exports retain their original hierarchy. */
export function SiteSurfaceScope(props: SiteSurfaceScopeProps) {
  const outside = useViewer(
    (state) => !state.isExporting && (!props.object || sectionActive(state)),
  )
  return outside ? <PortaledSiteSurfaces {...props} /> : props.children
}

function PortaledSiteSurfaces({ siteId, object, objects, children }: SiteSurfaceScopeProps) {
  const scene = useThree((state) => state.scene)
  const ref = useRef<Group>(null)
  useSiteSurfaceOwner(siteId, ref)
  const sync = () => {
    const group = ref.current
    if (!group || !object) return
    const owner = object()
    group.visible = !!owner
    if (!owner) return
    owner.updateWorldMatrix(true, false)
    if (!group.matrix.equals(owner.matrixWorld)) {
      group.matrix.copy(owner.matrixWorld)
      group.matrixWorldNeedsUpdate = true
    }
    for (let ancestor: Object3D | null = owner; ancestor; ancestor = ancestor.parent)
      if (!ancestor.visible) group.visible = false
  }
  useLayoutEffect(sync)
  useFrame(sync, -1)
  useLayoutEffect(() => {
    const group = ref.current
    if (!group || !objects) return
    const originals = objects.map((surface) => ({
      surface,
      parent: surface.parent!,
      index: surface.parent!.children.indexOf(surface),
    }))
    group.add(...objects)
    return () => {
      for (const { surface, parent, index } of originals) {
        parent.add(surface)
        parent.children.splice(parent.children.indexOf(surface), 1)
        parent.children.splice(index, 0, surface)
      }
    }
  }, [objects])
  return createPortal(
    <group matrixAutoUpdate={false} ref={ref} userData={{ kind: 'site' }}>
      {children}
    </group>,
    scene,
  )
}

type BakedSiteSurfaceScope = { siteId: string; parent: Object3D; objects: Object3D[] }

/** Capture ownership before portaling, for consumers that also style the baked site's surfaces. */
export function bakedSiteSurfaceScopes(root: Object3D): BakedSiteSurfaceScope[] {
  const groups: BakedSiteSurfaceScope[] = []
  root.traverse((site) => {
    if (site.userData.kind !== 'site' || !site.userData.pascalId) return
    const visit = (parent: Object3D) => {
      const objects: Object3D[] = []
      for (const child of parent.children) {
        if (child.userData.pascalId) continue
        if ('geometry' in child) objects.push(child)
        else visit(child)
      }
      if (objects.length) groups.push({ siteId: site.userData.pascalId, parent, objects })
    }
    visit(site)
  })
  return groups
}

/** A baked site's own drawables stop at the next semantic owner (building, tree, fence, item). */
export function BakedSiteSurfaces({ scopes }: { scopes: readonly BakedSiteSurfaceScope[] }) {
  return scopes.map(({ siteId, parent, objects }) => (
    <SiteSurfaceScope key={parent.uuid} object={() => parent} objects={objects} siteId={siteId} />
  ))
}
