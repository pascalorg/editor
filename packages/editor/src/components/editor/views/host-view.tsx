'use client'

import { type LazyComponent, usePascalI18n } from '@pascal-app/core'
import { type ComponentType, lazy, Suspense } from 'react'
import type { EditorViewDescriptor } from '../../../lib/editor-views'
import { ErrorBoundary } from '../../ui/primitives/error-boundary'
import { useViewsSettled } from './use-editor-views'

// `React.lazy` once per loader, so a view keeps its identity across renders.
const lazyViewCache = new WeakMap<LazyComponent, ComponentType>()

function resolveViewComponent(component: LazyComponent): ComponentType {
  const cached = lazyViewCache.get(component)
  if (cached) return cached
  const Lazy = lazy(component)
  lazyViewCache.set(component, Lazy)
  return Lazy
}

function ViewMessage({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-sidebar p-6 text-center">
      <div className="max-w-xs">
        <p className="font-medium text-sidebar-foreground text-sm">{title}</p>
        <p className="mt-1 text-sidebar-foreground/50 text-xs">{body}</p>
        {action && (
          <button
            className="mt-4 rounded-full bg-sidebar-foreground px-4 py-1.5 font-medium text-sidebar text-xs transition-opacity hover:opacity-90"
            onClick={action.onClick}
            type="button"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}

function LoadingViewMessage() {
  const i18n = usePascalI18n()
  return (
    <ViewMessage
      body=""
      title={i18n._({ id: 'editor.views.hostView.loading', message: 'Loading…' })}
    />
  )
}

function UnavailableViewMessage({ onShowScene }: { onShowScene?: () => void }) {
  const i18n = usePascalI18n()
  return (
    <ViewMessage
      action={
        onShowScene && {
          label: i18n._({
            id: 'editor.views.viewBar.closeUnavailableView',
            message: 'Close this view',
          }),
          onClick: onShowScene,
        }
      }
      body={i18n._({
        id: 'editor.views.hostView.pluginNotInstalled',
        message: "Its plugin isn't installed in this project.",
      })}
      title={i18n._({
        id: 'editor.views.hostView.viewUnavailable',
        message: "This view isn't available",
      })}
    />
  )
}

/**
 * A registered view, loaded lazily and isolated: a view that throws is
 * unloaded for the session and the rest of the editor keeps working. A layout
 * can name a view this project cannot show — its plugin uninstalled, or not
 * registered yet — and the pane says so rather than silently swapping views,
 * so the choice comes back once the view does.
 */
export function HostView({
  view,
  onShowScene,
}: {
  view: EditorViewDescriptor | undefined
  /** Leaves an unavailable view for the 3D scene. */
  onShowScene?: () => void
}) {
  const settled = useViewsSettled()
  if (!view?.component) {
    // Until the project's plugins have registered their views, a missing one is still loading.
    if (!settled) return <LoadingViewMessage />
    return <UnavailableViewMessage onShowScene={onShowScene} />
  }
  const Component = resolveViewComponent(view.component)
  return (
    <ErrorBoundary
      fallback={
        <ViewMessage
          body="This view hit an error and was unloaded for this session. Reload to try again."
          title={`"${view.label}" crashed`}
        />
      }
    >
      <Suspense fallback={<LoadingViewMessage />}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  )
}
