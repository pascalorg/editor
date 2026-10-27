'use client'

import {
  type AnyNodeId,
  type CabinetNode,
  emitter,
  resolveLevelId,
  usePascalI18n,
  useScene,
} from '@pascal-app/core'
import { useCommandPalette, useCommandRegistry, useEditor } from '@pascal-app/editor'
import {
  beginKitchenPlacement,
  findKitchenItems,
  KITCHEN_ITEMS,
  KitchenCollection,
  kitchenPresetForModule,
} from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'

const NO_ITEMS: never[] = []

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
  const i18n = usePascalI18n()
  const defaults = useEditor((state) => state.toolDefaults.cabinet)
  const mode = useEditor((state) => state.mode)
  // Read the scene only while a query asks for placed items.
  const matches = useScene(
    useShallow((state) => (query.trim() ? findKitchenItems(state.nodes, query) : NO_ITEMS)),
  )
  const active = KITCHEN_ITEMS.find((item) => item.id === defaults?.kitchenPreset)
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">
          {i18n._({ id: 'app.kitchenBrowser.addToKitchen', message: 'Add to kitchen' })}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {i18n._({
            id: 'app.kitchenBrowser.chooseAnItemThenClickTo',
            message: 'Choose an item, then click to place it. Appliances include their cabinetry.',
          })}
        </p>
      </div>
      <KitchenCollection
        query={query}
        activeId={mode === 'build' ? active?.id : null}
        onSelect={beginKitchenPlacement}
      />
      {query.trim() && (
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-medium">
            {i18n._({
              id: 'app.kitchenBrowser.findInThisProjectLength',
              message: 'Find in this project · {length}',
              values: { length: matches.length },
            })}
          </h3>
          {matches.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => focusKitchenItem(node.id)}
              className="block w-full rounded-lg border border-border/60 px-3 py-2 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {node.name ||
                i18n._({ id: 'app.kitchenBrowser.kitchenCabinet', message: 'Kitchen cabinet' })}
              <span className="block text-[10px] text-muted-foreground">
                {i18n._({
                  id: 'app.kitchenBrowser.selectAndShowInScene',
                  message: 'Select and show in scene',
                })}
              </span>
            </button>
          ))}
          {!matches.length && (
            <p className="text-xs text-muted-foreground">
              {i18n._({
                id: 'app.kitchenBrowser.noMatchingKitchenItemsPlacedYet',
                message: 'No matching kitchen items placed yet.',
              })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function KitchenCommands() {
  const i18n = usePascalI18n()
  const register = useCommandRegistry((state) => state.register)
  // Always mounted: the placed items are read only while the palette is open to list them.
  const paletteOpen = useCommandPalette((state) => state.open)
  const modules = useScene(
    useShallow((state) => (paletteOpen ? findKitchenItems(state.nodes, '') : NO_ITEMS)),
  )
  useEffect(
    () =>
      register(
        KITCHEN_ITEMS.map((item) => ({
          id: `kitchen.add.${item.id}`,
          label: i18n._({
            id: 'app.kitchenBrowser.addLabel',
            message: 'Add {label}',
            values: { label: item.label },
          }),
          group: i18n._({ id: 'app.kitchenBrowser.groupAdd', message: 'Kitchen · Add' }),
          keywords: item.keywords.split(' '),
          execute: () => beginKitchenPlacement(item.id),
        })),
      ),
    [register, i18n],
  )
  useEffect(
    () =>
      register(
        modules.map((node) => {
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
            label: i18n._({
              id: 'app.kitchenBrowser.findName',
              message: 'Find {name}',
              values: { name: node.name || item.label },
            }),
            group: i18n._({
              id: 'app.kitchenBrowser.groupInThisProject',
              message: 'Kitchen · In this project',
            }),
            keywords: item.keywords.split(' '),
            execute: () => focusKitchenItem(node.id),
          }
        }),
      ),
    [register, modules, i18n],
  )
  return null
}
