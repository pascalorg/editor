'use client'

import {
  type AnyNodeId,
  type CabinetNode,
  emitter,
  resolveLevelId,
  useScene,
} from '@pascal-app/core'
import { useCommandRegistry, useEditor } from '@pascal-app/editor'
import {
  beginKitchenPlacement,
  KITCHEN_ITEMS,
  KitchenCollection,
  kitchenItemMatches,
  kitchenPresetForModule,
} from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'

function findKitchenItems(nodes: ReturnType<typeof useScene.getState>['nodes'], query: string) {
  return Object.values(nodes).filter((node) => {
    if (node.type !== 'cabinet-module' || node.moduleKind === 'corner-filler') return false
    const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
    const id = kitchenPresetForModule(node, parent?.type === 'cabinet' ? parent : undefined)
    return (
      kitchenItemMatches(id, query) || (node.name ?? '').toLowerCase().includes(query.toLowerCase())
    )
  })
}

function focusKitchenItem(id: AnyNodeId) {
  const nodes = useScene.getState().nodes
  const node = nodes[id]
  if (!node) return
  const levelId = resolveLevelId(node, nodes)
  const level = levelId ? nodes[levelId as AnyNodeId] : undefined
  const building = level?.parentId ? nodes[level.parentId as AnyNodeId] : undefined
  useEditor.getState().setMode('select')
  useViewer.getState().setSelection({
    selectedIds: [id],
    ...(level?.type === 'level' ? { levelId: level.id } : {}),
    ...(building?.type === 'building' ? { buildingId: building.id } : {}),
  })
  emitter.emit('camera-controls:focus', { nodeId: id })
  emitter.emit('selection:find-node', node)
}

export function KitchenBrowser({ query = '' }: { query?: string }) {
  const defaults = useEditor((state) => state.toolDefaults.cabinet)
  const mode = useEditor((state) => state.mode)
  const matches = useScene(useShallow((state) => findKitchenItems(state.nodes, query)))
  const active = KITCHEN_ITEMS.find((item) => item.id === defaults?.kitchenPreset)
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Add to kitchen</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose an item, then click to place it. Appliances include their cabinetry.
        </p>
      </div>
      <KitchenCollection
        query={query}
        activeId={mode === 'build' ? active?.id : null}
        onSelect={beginKitchenPlacement}
      />
      {query.trim() && (
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium">Find in this project · {matches.length}</h3>
          {matches.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => focusKitchenItem(node.id)}
              className="block w-full rounded-lg border border-border/60 px-3 py-2 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {node.name || 'Kitchen cabinet'}
              <span className="block text-[10px] text-muted-foreground">
                Select and show in scene
              </span>
            </button>
          ))}
          {!matches.length && (
            <p className="text-xs text-muted-foreground">No matching kitchen items placed yet.</p>
          )}
        </div>
      )}
    </div>
  )
}

export function KitchenCommands() {
  const register = useCommandRegistry((state) => state.register)
  const modules = useScene(useShallow((state) => findKitchenItems(state.nodes, '')))
  useEffect(
    () =>
      register([
        ...KITCHEN_ITEMS.map((item) => ({
          id: `kitchen.add.${item.id}`,
          label: `Add ${item.label}`,
          group: 'Kitchen · Add',
          keywords: item.keywords.split(' '),
          execute: () => beginKitchenPlacement(item.id),
        })),
        ...modules.map((node) => {
          const nodes = useScene.getState().nodes
          const parent = node.parentId ? nodes[node.parentId as AnyNodeId] : undefined
          const preset =
            node.type === 'cabinet-module'
              ? kitchenPresetForModule(
                  node,
                  parent?.type === 'cabinet' ? (parent as CabinetNode) : undefined,
                )
              : 'base-door'
          const item = KITCHEN_ITEMS.find((entry) => entry.id === preset)!
          return {
            id: `kitchen.find.${node.id}`,
            label: `Find ${node.name || item.label}`,
            group: 'Kitchen · In this project',
            keywords: item.keywords.split(' '),
            execute: () => focusKitchenItem(node.id),
          }
        }),
      ]),
    [register, modules],
  )
  return null
}
