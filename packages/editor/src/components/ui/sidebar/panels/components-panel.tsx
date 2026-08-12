'use client'

import {
  type AnyNodeId,
  type Definition,
  type DefinitionId,
  InstanceNode,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Boxes, PackagePlus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createDefinitionThumbnail } from '../../../../lib/component-actions'
import { triggerSFX } from '../../../../lib/sfx-bus'
import useEditor from '../../../../store/use-editor'
import { Button } from '../../primitives/button'
import { Input } from '../../primitives/input'

type DefinitionCardProps = {
  definition: Definition
  instanceCount: number
  canPlace: boolean
  readOnly: boolean
  onDelete: (id: DefinitionId) => void
  onPlace: (definition: Definition) => void
  onRename: (id: DefinitionId, name: string) => void
}

function DefinitionCard({
  definition,
  instanceCount,
  canPlace,
  readOnly,
  onDelete,
  onPlace,
  onRename,
}: DefinitionCardProps) {
  const [name, setName] = useState(definition.name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => setName(definition.name), [definition.name])

  const commitName = (value: string) => {
    const nextName = value.trim()
    if (!nextName) {
      setName(definition.name)
      return
    }
    setName(nextName)
    if (nextName !== definition.name) onRename(definition.id, nextName)
  }

  return (
    <article className="overflow-hidden rounded-xl border border-border/60 bg-accent/20">
      <div className="aspect-[4/3] bg-background/50">
        {definition.thumbnail ? (
          <img
            alt=""
            className="h-full w-full object-cover"
            src={definition.thumbnail}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-indigo-950 to-violet-700 text-white/70">
            <Boxes className="h-10 w-10" />
          </div>
        )}
      </div>

      <div className="space-y-3 p-3">
        <div>
          <Input
            aria-label="Component name"
            className="h-8 border-transparent bg-transparent px-1 font-medium shadow-none hover:border-border focus-visible:bg-background/60"
            disabled={readOnly}
            onBlur={(event) => commitName(event.currentTarget.value)}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.currentTarget.value = definition.name
                setName(definition.name)
                event.currentTarget.blur()
              }
            }}
            value={name}
          />
          <p className="px-1 text-sidebar-foreground/50 text-xs">
            {instanceCount} {instanceCount === 1 ? 'instance' : 'instances'}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            className="flex-1 rounded-full"
            disabled={readOnly || !canPlace}
            onClick={() => onPlace(definition)}
            size="sm"
          >
            <PackagePlus />
            Place
          </Button>
          <Button
            aria-label={confirmingDelete ? `Confirm deleting ${definition.name}` : `Delete ${definition.name}`}
            className="rounded-full"
            disabled={readOnly}
            onClick={() => {
              if (!confirmingDelete) {
                setConfirmingDelete(true)
                return
              }
              onDelete(definition.id)
            }}
            size={confirmingDelete ? 'sm' : 'icon-sm'}
            variant={confirmingDelete ? 'destructive' : 'ghost'}
          >
            <Trash2 />
            {confirmingDelete ? 'Confirm' : null}
          </Button>
        </div>
      </div>
    </article>
  )
}

export function ComponentsPanel() {
  const definitions = useScene((state) => state.definitions)
  const nodes = useScene((state) => state.nodes)
  const readOnly = useScene((state) => state.readOnly)
  const updateDefinition = useScene((state) => state.updateDefinition)
  const deleteDefinition = useScene((state) => state.deleteDefinition)
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)
  const setMovingNode = useEditor((state) => state.setMovingNode)

  const sortedDefinitions = useMemo(
    () => Object.values(definitions).sort((a, b) => a.name.localeCompare(b.name)),
    [definitions],
  )
  const instanceCounts = useMemo(() => {
    const counts = new Map<DefinitionId, number>()
    for (const node of Object.values(nodes)) {
      if (node.type !== 'instance') continue
      counts.set(node.definitionId, (counts.get(node.definitionId) ?? 0) + 1)
    }
    return counts
  }, [nodes])
  const canPlace = activeLevelId ? nodes[activeLevelId]?.type === 'level' : false

  const handlePlace = (definition: Definition) => {
    if (!(activeLevelId && nodes[activeLevelId]?.type === 'level')) return
    const instance = InstanceNode.parse({
      definitionId: definition.id,
      name: definition.name,
      parentId: activeLevelId,
      metadata: { isNew: true },
    })

    pauseSceneHistory(useScene)
    try {
      useScene.getState().createNode(instance, activeLevelId as AnyNodeId)
    } finally {
      resumeSceneHistory(useScene)
    }

    setSelection({ selectedIds: [] })
    setMovingNode(instance)
    triggerSFX('sfx:item-pick')
  }

  const handleDelete = (definitionId: DefinitionId) => {
    const selectedIds = useViewer.getState().selection.selectedIds
    const retainedSelection = selectedIds.filter((id) => {
      const node = useScene.getState().nodes[id as AnyNodeId]
      return node?.type !== 'instance' || node.definitionId !== definitionId
    })
    if (retainedSelection.length !== selectedIds.length) {
      setSelection({ selectedIds: retainedSelection })
    }
    deleteDefinition(definitionId)
    triggerSFX('sfx:item-delete')
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4">
      <div className="mb-5">
        <h2 className="font-semibold text-lg text-sidebar-foreground">Components</h2>
        <p className="mt-1 text-sidebar-foreground/60 text-sm">
          Reuse linked building elements across the scene.
        </p>
      </div>

      {sortedDefinitions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-border/60 border-dashed px-6 py-10 text-center">
          <Boxes className="mb-3 h-9 w-9 text-sidebar-foreground/40" />
          <p className="font-medium text-sidebar-foreground">No components yet</p>
          <p className="mt-1 text-sidebar-foreground/55 text-sm">
            Select an element on a level and choose Make Component from its action menu.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {sortedDefinitions.map((definition) => (
            <DefinitionCard
              canPlace={canPlace}
              definition={definition}
              instanceCount={instanceCounts.get(definition.id) ?? 0}
              key={definition.id}
              onDelete={handleDelete}
              onPlace={handlePlace}
              onRename={(id, name) =>
                updateDefinition(id, {
                  name,
                  thumbnail: createDefinitionThumbnail(name),
                })
              }
              readOnly={readOnly}
            />
          ))}
        </div>
      )}

      {!canPlace && sortedDefinitions.length > 0 ? (
        <p className="mt-4 text-center text-amber-300/80 text-xs">
          Select a level before placing a component.
        </p>
      ) : null}
    </div>
  )
}
