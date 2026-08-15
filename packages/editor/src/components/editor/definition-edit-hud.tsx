'use client'

import { useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Check, Component } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { LocalizedContent } from '../../lib/i18n'
import useInteractionScope, { useDefinitionEditContext } from '../../store/use-interaction-scope'

export function DefinitionEditHud() {
  const context = useDefinitionEditContext()
  const activeScope = useInteractionScope((state) => state.scope)
  const definition = useScene((state) =>
    context ? state.definitions[context.definitionId] : undefined,
  )
  const instanceExists = useScene((state) =>
    context ? state.nodes[context.instanceId]?.type === 'instance' : false,
  )

  const exit = useCallback(() => {
    const state = useInteractionScope.getState()
    const currentContext = state.definitionEditContext
    if (!currentContext) return
    if (state.scope.kind !== 'definition-edit') {
      state.end()
      return
    }
    state.exitDefinitionEdit()
    const instance = useScene.getState().nodes[currentContext.instanceId]
    useViewer.getState().setSelection({
      selectedIds: instance?.type === 'instance' ? [instance.id] : [],
    })
    useViewer.setState({ hoveredId: null })
  }, [])

  useEffect(() => {
    if (!(context && definition && instanceExists)) {
      if (context) useInteractionScope.getState().exitDefinitionEdit()
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (useInteractionScope.getState().scope.kind !== 'definition-edit') return
      event.preventDefault()
      event.stopImmediatePropagation()
      exit()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [context, definition, exit, instanceExists])

  if (!(context && definition && instanceExists)) return null

  return (
    <LocalizedContent>
      <div className="pointer-events-none absolute top-3 left-1/2 z-50 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border/60 bg-background/95 px-3 py-2 shadow-lg backdrop-blur-xl">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-foreground">
            <Component className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="max-w-56 truncate font-medium text-foreground text-sm">
              {definition.name}
            </p>
            <p className="text-muted-foreground text-xs">Component Instance</p>
          </div>
          <button
            className="ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 font-medium text-background text-xs hover:bg-foreground/90"
            onClick={exit}
            type="button"
          >
            <Check className="h-3.5 w-3.5" />
            {activeScope.kind === 'definition-edit' ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </LocalizedContent>
  )
}
