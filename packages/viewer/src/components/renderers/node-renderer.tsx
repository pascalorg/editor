'use client'

import { type AnyNode, nodeRegistry, type RendererSource, useScene } from '@pascal-app/core'
import { type ComponentType, lazy, Suspense } from 'react'
import { BuildingRenderer } from './building/building-renderer'
import { CeilingRenderer } from './ceiling/ceiling-renderer'
import { ColumnRenderer } from './column/column-renderer'
import { DoorRenderer } from './door/door-renderer'
import { ElevatorRenderer } from './elevator/elevator-renderer'
import { FenceRenderer } from './fence/fence-renderer'
import { GuideRenderer } from './guide/guide-renderer'
import { ItemRenderer } from './item/item-renderer'
import { LevelRenderer } from './level/level-renderer'
import { ParametricNodeRenderer } from './parametric-node-renderer'
import { RoofRenderer } from './roof/roof-renderer'
import { RoofSegmentRenderer } from './roof-segment/roof-segment-renderer'
import { ScanRenderer } from './scan/scan-renderer'
import { SiteRenderer } from './site/site-renderer'
import { SlabRenderer } from './slab/slab-renderer'
import { SpawnRenderer } from './spawn/spawn-renderer'
import { StairRenderer } from './stair/stair-renderer'
import { StairSegmentRenderer } from './stair-segment/stair-segment-renderer'
import { WallRenderer } from './wall/wall-renderer'
import { WindowRenderer } from './window/window-renderer'
import { ZoneRenderer } from './zone/zone-renderer'

// Cache lazy components by their RendererSource so React.lazy isn't re-invoked
// on every render — that would create a new Suspense boundary each time.
const lazyCache = new WeakMap<RendererSource<AnyNode>, ComponentType<{ node: AnyNode }>>()

function getRegistryRenderer(
  source: RendererSource<AnyNode>,
): ComponentType<{ node: AnyNode }> | null {
  const cached = lazyCache.get(source)
  if (cached) return cached
  // GLB / instanced-GLB sources lower onto built-in renderers landed in
  // Phase 5 — for now only parametric (lazy module) sources are honored.
  if (source.kind !== 'parametric') return null
  const Comp = lazy(source.module) as unknown as ComponentType<{ node: AnyNode }>
  lazyCache.set(source, Comp)
  return Comp
}

function RegistryRenderer({ node }: { node: AnyNode }) {
  const def = nodeRegistry.get(node.type)
  if (!def) return null
  // Three-checkbox dispatch (see wiki/architecture/node-definitions.md):
  //  1. Custom renderer overrides everything — JSX-side composition for
  //     kinds that need GLB, drei, <Html>, instancing, shader materials.
  //  2. Else, if the kind ships `def.geometry`, use the generic empty-group
  //     <ParametricNodeRenderer>. `<GeometrySystem>` fills it from the pure
  //     builder. No per-kind renderer.tsx needed.
  //  3. Else, the kind has neither — registered but unrenderable. Fall
  //     through to null; <NodeRenderer> falls back to the legacy switch
  //     (used by wall during milestone A before its runtime wired up).
  if (def.renderer) {
    const Renderer = getRegistryRenderer(def.renderer as RendererSource<AnyNode>)
    if (!Renderer) return null
    return (
      <Suspense fallback={null}>
        <Renderer node={node} />
      </Suspense>
    )
  }
  if (def.geometry) {
    return <ParametricNodeRenderer node={node} />
  }
  return null
}

export const NodeRenderer = ({ nodeId }: { nodeId: AnyNode['id'] }) => {
  const node = useScene((state) => state.nodes[nodeId])

  if (!node) return null

  // Registry-first: if a NodeDefinition is registered for this kind (via
  // @pascal-app/nodes or a future plugin), it owns the render. Falls through
  // to the legacy chain below for kinds not yet migrated. Legacy chain is
  // removed in Phase 6 once every kind is registry-backed.
  if (nodeRegistry.has(node.type)) {
    return <RegistryRenderer node={node} />
  }

  return (
    <>
      {node.type === 'site' && <SiteRenderer node={node} />}
      {node.type === 'building' && <BuildingRenderer node={node} />}
      {node.type === 'ceiling' && <CeilingRenderer node={node} />}
      {node.type === 'column' && <ColumnRenderer node={node} />}
      {node.type === 'elevator' && <ElevatorRenderer node={node} />}
      {node.type === 'level' && <LevelRenderer node={node} />}
      {node.type === 'item' && <ItemRenderer node={node} />}
      {node.type === 'slab' && <SlabRenderer node={node} />}
      {node.type === 'spawn' && <SpawnRenderer node={node} />}
      {node.type === 'wall' && <WallRenderer node={node} />}
      {node.type === 'fence' && <FenceRenderer node={node} />}
      {node.type === 'door' && <DoorRenderer node={node} />}
      {node.type === 'window' && <WindowRenderer node={node} />}
      {node.type === 'zone' && <ZoneRenderer node={node} />}
      {node.type === 'roof' && <RoofRenderer node={node} />}
      {node.type === 'roof-segment' && <RoofSegmentRenderer node={node} />}
      {node.type === 'stair' && <StairRenderer node={node} />}
      {node.type === 'stair-segment' && <StairSegmentRenderer node={node} />}
      {node.type === 'scan' && <ScanRenderer node={node} />}
      {node.type === 'guide' && <GuideRenderer node={node} />}
    </>
  )
}
