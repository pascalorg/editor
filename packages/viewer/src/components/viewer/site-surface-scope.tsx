'use client'

import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { Group, type Object3D } from 'three'
import { sectionActive } from '../../lib/section'
import { SITE_GROUND, useSiteSurfaceOwner } from '../../lib/site-surfaces'
import useViewer from '../../store/use-viewer'

type SiteSurfaceScopeProps = {
  siteId: string
  object?: () => Object3D | undefined | null
  objects?: readonly Object3D[]
  children?: ReactNode
}

/** Site-owned ground and lines escape an active cut; exports retain their original hierarchy. */
export function SiteSurfaceScope(props: SiteSurfaceScopeProps) {
  const outside = useViewer((state) => !state.isExporting && sectionActive(state))
  return outside ? <PortaledSiteSurfaces {...props} /> : props.children
}

function PortaledSiteSurfaces({ siteId, object, objects, children }: SiteSurfaceScopeProps) {
  const scene = useThree((state) => state.scene)
  const parent = objects ? object?.() : undefined
  const ref = useRef<Group>(null)
  useSiteSurfaceOwner(siteId, ref)
  const carriers = useRef<{ surface: Object3D; carrier: Group }[]>([])
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
    for (const { surface, carrier } of carriers.current) {
      if (surface.matrixAutoUpdate) surface.updateMatrix()
      carrier.matrix.copy(surface.matrix)
      carrier.matrixWorldNeedsUpdate = true
      carrier.visible = surface.visible
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
      parent: parent ?? surface.parent!,
      mountParent: surface.parent!,
      index: surface.parent!.children.indexOf(surface),
    }))
    // Escape each drawable's own surfaces. Descendants keep their clipped transform frame.
    carriers.current = originals.flatMap(({ surface, mountParent }) => {
      if (!surface.children.length) return []
      const carrier = new Group()
      carrier.matrixAutoUpdate = false
      carrier.visible = surface.visible
      if (surface.matrixAutoUpdate) surface.updateMatrix()
      carrier.matrix.copy(surface.matrix)
      carrier.userData = { ...surface.userData }
      // The carrier owns the clipped descendants' frame, never the escaped ground's draw.
      delete carrier.userData[SITE_GROUND]
      carrier.add(...[...surface.children])
      const index = mountParent.children.indexOf(surface)
      mountParent.add(carrier)
      mountParent.children.splice(mountParent.children.indexOf(carrier), 1)
      mountParent.children.splice(index, 0, carrier)
      return [{ surface, carrier }]
    })
    group.add(...objects)
    return () => {
      for (const { surface, carrier } of carriers.current) {
        surface.add(...[...carrier.children])
        carrier.removeFromParent()
      }
      carriers.current = []
      for (const { surface, parent, index } of originals) {
        parent.add(surface)
        parent.children.splice(parent.children.indexOf(surface), 1)
        parent.children.splice(index, 0, surface)
      }
    }
  }, [objects, parent])
  return createPortal(
    <group matrixAutoUpdate={false} ref={ref} userData={{ kind: 'site', pascalId: siteId }}>
      {children}
    </group>,
    scene,
  )
}

type BakedSiteSurfaceScope = {
  siteId: string
  parent: Object3D
  objects: Object3D[]
}

/** Capture ownership before portaling, for consumers that also style the baked site's surfaces. */
export function bakedSiteSurfaceScopes(root: Object3D): BakedSiteSurfaceScope[] {
  const groups: BakedSiteSurfaceScope[] = []
  root.traverse((site) => {
    if (site.userData.kind !== 'site' || !site.userData.pascalId) return
    const byParent = new Map<Object3D, Object3D[]>()
    const visit = (surface: Object3D) => {
      if (surface !== site && surface.userData.pascalId) return
      // Mixed collective meshes have no per-triangle site ownership: keep the whole draw in the cut.
      if (surface.userData.glbBatch) return
      if ('geometry' in surface && surface.parent) {
        const objects = byParent.get(surface.parent) ?? []
        objects.push(surface)
        byParent.set(surface.parent, objects)
      }
      for (const child of surface.children) visit(child)
    }
    visit(site)
    for (const [parent, objects] of byParent)
      groups.push({
        siteId: site.userData.pascalId,
        parent,
        objects,
      })
  })
  return groups
}

/** A baked site's own drawables stop at the next semantic owner (building, tree, fence, item). */
export function BakedSiteSurfaces({ scopes }: { scopes: readonly BakedSiteSurfaceScope[] }) {
  return scopes.map(({ siteId, parent, objects }) => (
    <SiteSurfaceScope key={parent.uuid} object={() => parent} objects={objects} siteId={siteId} />
  ))
}
