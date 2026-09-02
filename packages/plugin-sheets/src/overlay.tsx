'use client'

/**
 * The Sheets workspace — paper space, full-bleed over the editor.
 *
 * Mounted once at bootstrap into its own root (the same technique
 * `plugin-plans` uses for its overlay) and shown whenever the editor's
 * `workspaceMode` is `'sheets'`. The 3D canvas stays mounted underneath,
 * which is what lets the cover-view capture drive the real camera.
 */
import { X } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useEditor } from '@pascal-app/editor'
import { captureViewportImage } from './capture'
import { composeSheet } from './page'
import { Paper } from './paper'
import { ProjectEditor, Rail, useSceneNodes } from './rail'
import { sheets, viewports } from './model'
import type { SheetNode, ViewportNode } from './schema'
import { useSheets } from './store'

/* --------------------------------------------------------- escape */

/**
 * Anything that owns Escape before the workspace does. A nested dialog, a
 * menu, a popover, the command palette or the rail's own "+ Viewport" list
 * must all get to close themselves first — pressing Escape once should never
 * dismiss the whole workspace out from under an open thing.
 */
const ESCAPE_BLOCKING_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[cmdk-root]',
  '[data-radix-popper-content-wrapper]',
  '[data-sheets-menu]',
].join(', ')

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Whether Escape should close the Sheets workspace. Pure, and takes the
 * document, so the guard is testable without a browser.
 */
const PLEX = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;700&family=Big+Shoulders+Display:wght@800&display=swap'
function ensureFonts(): void {
  if (typeof document === 'undefined' || document.getElementById('pascal-sheets-plex')) return
  const l = document.createElement('link')
  l.id = 'pascal-sheets-plex'
  l.rel = 'stylesheet'
  l.href = PLEX
  document.head.appendChild(l)
}

export function shouldCloseOnEscape(doc: {
  querySelector: (selector: string) => unknown
  activeElement?: unknown
}): boolean {
  if (doc.querySelector(ESCAPE_BLOCKING_SELECTOR)) return false
  const active = doc.activeElement as
    | { tagName?: string; isContentEditable?: boolean }
    | null
    | undefined
  if (!active) return true
  if (active.tagName && TEXT_ENTRY_TAGS.has(active.tagName)) return false
  if (active.isContentEditable) return false
  return true
}

export function SheetsWorkspace() {
  const workspaceMode = (useEditor as unknown as (selector: (s: { workspaceMode: string }) => string) => string)(
    (state) => state.workspaceMode,
  )
  const open = workspaceMode === 'sheets'
  const S = useSheets()
  const nodes = useSceneNodes()
  const list = sheets(nodes)
  const sheet = (S.sheetId ? (nodes[S.sheetId] as SheetNode | undefined) : undefined) ?? list[0]

  const composed = useMemo(
    () => (sheet && open ? composeSheet(sheet, { nodes, captureNotes: S.captureNotes }) : null),
    [sheet, nodes, open, S.captureNotes],
  )

  /**
   * Auto-capture the cover view the first time a sheet carrying a `view3d`
   * viewport is shown, so A0.0 is never a blank box waiting for someone to
   * find a button.
   *
   * The 3D viewer stays mounted underneath this overlay — the workspace is a
   * separate React root appended to `document.body` and painted over the
   * editor, not a replacement for it — so the camera is drivable from here and
   * the capture does not have to happen before the workspace opens. When it
   * fails anyway, the reason is parked in the store and printed on the sheet
   * by `resolveViewport`.
   *
   * One attempt per viewport per session: a retry loop against a viewer that
   * is not there would spin forever. "Recapture" in the Layers tab is the
   * manual retry.
   */
  useEffect(() => {
    if (!open || !sheet) return
    const pending = viewports(nodes, sheet.id).filter(
      (vp: ViewportNode) =>
        vp.kind === 'view3d' && !vp.dataUrl && !useSheets.getState().captureTried[vp.id],
    )
    if (pending.length === 0) return
    let cancelled = false
    void (async () => {
      for (const vp of pending) {
        useSheets.getState().markCaptureTried(vp.id)
        useSheets.getState().setBusy({ label: 'Capturing the cover view' })
        try {
          const result = await captureViewportImage(vp)
          if (cancelled) return
          useSheets.getState().setCaptureNote(vp.id, result.ok ? null : result.reason)
          useSheets
            .getState()
            .setMessage(result.ok ? 'Cover view captured' : `Cover view: ${result.reason}`)
        } catch (error) {
          if (cancelled) return
          useSheets.getState().setCaptureNote(vp.id, (error as Error).message)
        } finally {
          if (!cancelled) useSheets.getState().setBusy(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, sheet, nodes])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'Escape') {
        if (!shouldCloseOnEscape(document)) return
        if (useSheets.getState().editingProject) useSheets.getState().setEditingProject(false)
        else closeSheets()
        return
      }
      const current = list.findIndex((s) => s.id === sheet?.id)
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        const next = list[Math.min(list.length - 1, current + 1)]
        if (next) useSheets.getState().setSheet(next.id)
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        const prev = list[Math.max(0, current - 1)]
        if (prev) useSheets.getState().setSheet(prev.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, list, sheet?.id])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-background text-foreground"
      style={{ fontFamily: 'var(--font-sans, ui-sans-serif, system-ui)' }}
    >
      <header className="flex items-center gap-3 border-border border-b px-4 py-2">
        <span className="font-semibold text-sm">Sheets</span>
        <span className="truncate text-muted-foreground text-xs">
          {sheet ? `${sheet.number} · ${sheet.title}` : 'no sheets yet'}
        </span>
        <span className="ml-auto text-muted-foreground text-xs">
          {list.length} sheet{list.length === 1 ? '' : 's'} · ← → to page · Esc to close
        </span>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={closeSheets}
          title="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {S.editingProject ? (
          <aside className="flex w-[300px] shrink-0 flex-col overflow-hidden border-border border-r bg-card">
            <ProjectEditor nodes={nodes} onClose={() => S.setEditingProject(false)} />
          </aside>
        ) : (
          <Rail nodes={nodes} />
        )}

        <div className="relative min-w-0 flex-1">
          {composed ? (
            <Paper
              composed={composed}
              selectedId={S.selectedViewportId}
              onSelect={S.select}
              zoom={S.zoom}
              pan={S.pan}
              onView={S.setView}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
              <div>No sheets in this scene yet.</div>
              <div className="text-xs">Use “Generate default set” on the left.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function openSheets(): void {
  ensureFonts()
  ;(useEditor.getState() as unknown as { setWorkspaceMode: (m: string) => void }).setWorkspaceMode(
    'sheets',
  )
}

export function closeSheets(): void {
  ;(useEditor.getState() as unknown as { setWorkspaceMode: (m: string) => void }).setWorkspaceMode(
    'edit',
  )
}

// The paper is set in IBM Plex (PlanCrafters' sheet type); load it once.
const ROOT_ID = 'pascal-sheets-workspace'
const ROOT_KEY = '__pascalSheetsWorkspaceRoot'

type RootHolder = { [ROOT_KEY]?: { root: Root; element: HTMLElement } }

/**
 * Mount the workspace root. Idempotent ACROSS module instances, not just
 * within one: an HMR reload gives this module a fresh closure, so a
 * module-level flag alone would stack a second (and third…) copy of the whole
 * workspace on the page. The live root is parked on `globalThis`, and a
 * reload tears the previous one down before mounting the new code.
 */
export function mountSheetsWorkspace(): void {
  if (typeof document === 'undefined') return
  const holder = globalThis as unknown as RootHolder
  const existing = holder[ROOT_KEY]
  if (existing) {
    existing.root.unmount()
    existing.element.remove()
    holder[ROOT_KEY] = undefined
  }
  // Orphans from a module instance that never got to clean up after itself.
  for (const stale of Array.from(document.querySelectorAll(`#${ROOT_ID}`))) stale.remove()

  const element = document.createElement('div')
  element.id = ROOT_ID
  document.body.appendChild(element)
  const root = createRoot(element)
  root.render(<SheetsWorkspace />)
  holder[ROOT_KEY] = { root, element }
}
