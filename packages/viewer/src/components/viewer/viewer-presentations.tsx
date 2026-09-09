'use client'

import { type AnyNode, useScene, type LazyComponent } from '@pascal-app/core'
import type { Object3D, Texture } from 'three'
import { lazy, type ComponentType, Suspense, useSyncExternalStore } from 'react'
import { ErrorBoundary } from '../error-boundary'

export type ViewerPresentationConfiguration = {
  /** Returns a detached, versioned snapshot suitable for host-owned persistence. */
  getSnapshot: () => unknown
  /** Validates and applies a previously persisted snapshot. */
  restore: (snapshot: unknown) => void
  /** Restores the contribution's initial presentation state. */
  reset: () => void
  /** Notifies the host only when persisted presentation state changes. */
  subscribe: (onChange: () => void) => () => void
}
export type ViewerPresentationExportContext = {
  /** Full semantic snapshot; output selection never removes generation context. */
  nodes: Readonly<Record<string, AnyNode>>
  /** Detached contribution configuration captured once when export starts. */
  configuration: unknown
  onlyVisible: boolean
  excludedNodeTypes: readonly string[]
}

export type ViewerPresentationStaticExport = {
  label: string
  build: (ctx: ViewerPresentationExportContext) => Object3D | null | Promise<Object3D | null>
}
const borrowedStaticExportTextures = new WeakSet<Texture>()

/**
 * Marks a cached presentation texture handle as borrowed. Static export owns
 * every returned resource by default; the host clones marked handles before
 * attaching the contribution and never disposes the marked source handle.
 */
export function markViewerPresentationTextureBorrowed<T extends Texture>(texture: T): T {
  borrowedStaticExportTextures.add(texture)
  return texture
}

export function isViewerPresentationTextureBorrowed(texture: Texture): boolean {
  return borrowedStaticExportTextures.has(texture)
}

export type ViewerPresentationContribution = {
  /** Globally unique contribution id, conventionally `${pluginId}:presentation`. */
  id: string
  /** Project installation gate. Omit only for host-owned, always-on presentation. */
  pluginId?: string
  /** Lazy R3F subtree mounted as a sibling of the authored scene renderer. */
  component: LazyComponent
  /** Optional host persistence seam; never stored in the semantic scene graph. */
  configuration?: ViewerPresentationConfiguration
  /**
   * Explicit opt-in static artifact contribution. The returned root must be
   * detached and uses the presentation's existing world coordinates.
   */
  staticExport?: ViewerPresentationStaticExport
}

function isDevMode(): boolean {
  try {
    const meta = import.meta as { env?: { DEV?: boolean } }
    if (typeof meta?.env?.DEV === 'boolean') return meta.env.DEV
  } catch {
    // import.meta unavailable in some CJS contexts — fall through.
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
    return process.env.NODE_ENV !== 'production'
  }
  return false
}

class ViewerPresentationRegistryImpl {
  private readonly contributions = new Map<string, ViewerPresentationContribution>()
  private readonly listeners = new Set<() => void>()
  private cached: ViewerPresentationContribution[] = []

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  getSnapshot = (): ViewerPresentationContribution[] => this.cached

  reset(): void {
    this.contributions.clear()
    this.emit()
  }

  register(contribution: ViewerPresentationContribution): void {
    if (typeof contribution.id !== 'string' || contribution.id.length === 0) {
      throw new Error('[viewer:presentations] contribution id must be a non-empty string')
    }
    if (
      contribution.pluginId !== undefined &&
      (typeof contribution.pluginId !== 'string' || contribution.pluginId.length === 0)
    ) {
      throw new Error('[viewer:presentations] plugin id must be a non-empty string when provided')
    }
    if (typeof contribution.component !== 'function') {
      throw new Error('[viewer:presentations] component must be a lazy component loader')
    }
    if (
      contribution.configuration !== undefined &&
      (contribution.configuration === null ||
        typeof contribution.configuration !== 'object' ||
        typeof contribution.configuration.getSnapshot !== 'function' ||
        typeof contribution.configuration.restore !== 'function' ||
        typeof contribution.configuration.reset !== 'function' ||
        typeof contribution.configuration.subscribe !== 'function')
    ) {
      throw new Error(
        '[viewer:presentations] configuration must implement getSnapshot, restore, reset, and subscribe',
      )
    }
    if (
      contribution.staticExport !== undefined &&
      (contribution.staticExport === null ||
        typeof contribution.staticExport !== 'object' ||
        typeof contribution.staticExport.label !== 'string' ||
        contribution.staticExport.label.length === 0 ||
        typeof contribution.staticExport.build !== 'function')
    ) {
      throw new Error(
        '[viewer:presentations] staticExport must provide a non-empty label and build function',
      )
    }
    if (this.contributions.has(contribution.id)) {
      if (isDevMode()) {
        console.warn(`[viewer:presentations] re-registering "${contribution.id}" (HMR)`)
      } else {
        throw new Error(
          `[viewer:presentations] duplicate id: "${contribution.id}" already registered`,
        )
      }
    }
    this.contributions.set(contribution.id, contribution)
    this.emit()
  }

  private emit(): void {
    this.cached = Array.from(this.contributions.values())
    for (const listener of this.listeners) listener()
  }
}

export const viewerPresentationRegistry = new ViewerPresentationRegistryImpl()

export function registerViewerPresentation(contribution: ViewerPresentationContribution): void {
  viewerPresentationRegistry.register(contribution)
}

const lazyComponents = new WeakMap<LazyComponent, ComponentType>()

function resolvePresentationComponent(loader: LazyComponent): ComponentType {
  const cached = lazyComponents.get(loader)
  if (cached) return cached
  const component = lazy(loader)
  lazyComponents.set(loader, component)
  return component
}

function RegisteredViewerPresentation({
  contribution,
}: {
  contribution: ViewerPresentationContribution
}) {
  const Component = resolvePresentationComponent(contribution.component)
  return (
    <ErrorBoundary fallback={null} scope={`presentation:${contribution.id}`}>
      <Suspense fallback={null}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  )
}

/**
 * Mounts registered presentation-only R3F subtrees for the current project.
 * Hosts place this once inside each Viewer they want to include presentation;
 * semantic scene export remains isolated because the mount is a sibling of
 * `scene-renderer`, not one of its authored descendants.
 */
export function ViewerPresentations() {
  const contributions = useSyncExternalStore(
    viewerPresentationRegistry.subscribe,
    viewerPresentationRegistry.getSnapshot,
    viewerPresentationRegistry.getSnapshot,
  )
  const installedPlugins = useScene((state) => state.installedPlugins)

  return contributions.map((contribution) =>
    contribution.pluginId && !installedPlugins.includes(contribution.pluginId) ? null : (
      <RegisteredViewerPresentation contribution={contribution} key={contribution.id} />
    ),
  )
}
