import type { CameraPose } from '../events/bus'
import { generateId } from './base'
import type { CollectionId } from './collections'
import type { AnyNodeId } from './types'

export type SavedViewId = `saved-view_${string}`

/**
 * What a saved view restores about one collection. Snapshotted per view so
 * switching views can put visibility back without the user re-hiding anything.
 */
export type SavedViewCollectionState = {
  visible?: boolean
  locked?: boolean
}

/**
 * A named camera + scene-state bookmark. SketchUp calls these "Scenes"; that
 * word is already the scene graph here (`useScene`), so they are saved views.
 *
 * Scene-side state like `collections` and `materials` — persisted with the
 * document, not a node. Anything added here has to travel across all five
 * persistence boundaries (save, load, clone, fork, live sync).
 */
export type SavedView = {
  id: SavedViewId
  name: string
  /** Sort key for the view list. Lower comes first; gaps are fine. */
  order: number
  camera: CameraPose
  /**
   * The section plane that was cutting when the view was captured. `null`
   * records "no cut" deliberately, which is different from an absent field on
   * a view saved before section planes existed.
   */
  sectionPlaneId?: AnyNodeId | null
  /** Per-collection visibility / lock at capture time. */
  collectionStates?: Record<CollectionId, SavedViewCollectionState>
  /**
   * Presentation state owned by the viewer and editor — view mode, level mode,
   * wall mode, scene theme, and so on. Opaque to core, which stores and
   * round-trips the bag without interpreting it: those are rendering and
   * editing concepts that core is not allowed to know. Same contract as
   * `NodeDefinition.extensions`.
   */
  presentation?: Readonly<Record<string, unknown>>
}

export const generateSavedViewId = (): SavedViewId => generateId('saved-view')

/** Views in list order. Ties fall back to id so the order is total. */
export function sortSavedViews(views: Record<SavedViewId, SavedView>): SavedView[] {
  return Object.values(views).sort((left, right) =>
    left.order === right.order ? left.id.localeCompare(right.id) : left.order - right.order,
  )
}

/** Order value that puts a new view at the end of the list. */
export function nextSavedViewOrder(views: Record<SavedViewId, SavedView>): number {
  let max = -1
  for (const view of Object.values(views)) {
    if (view.order > max) max = view.order
  }
  return max + 1
}

/**
 * Rewrite `order` so the view at `fromIndex` lands at `toIndex`, renumbering
 * the whole list from zero. Returns the patches to apply, empty when nothing
 * moves — a drag that ends where it started must not write history.
 */
export function reorderSavedViews(
  views: Record<SavedViewId, SavedView>,
  fromIndex: number,
  toIndex: number,
): Array<{ id: SavedViewId; order: number }> {
  const ordered = sortSavedViews(views)
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= ordered.length ||
    toIndex >= ordered.length
  ) {
    return []
  }

  const moved = ordered.splice(fromIndex, 1)[0]
  if (!moved) return []
  ordered.splice(toIndex, 0, moved)

  const patches: Array<{ id: SavedViewId; order: number }> = []
  ordered.forEach((view, index) => {
    if (view.order !== index) patches.push({ id: view.id, order: index })
  })
  return patches
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function normalizeCameraPose(value: unknown): CameraPose | null {
  if (!isRecord(value)) return null
  const { position, target, projection } = value
  const isTriple = (v: unknown): v is [number, number, number] =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  if (!(isTriple(position) && isTriple(target))) return null
  if (projection !== 'perspective' && projection !== 'orthographic') return null

  const pose: CameraPose = { position, target, projection }
  if (typeof value.viewWidth === 'number' && Number.isFinite(value.viewWidth)) {
    pose.viewWidth = value.viewWidth
  }
  if (typeof value.fov === 'number' && Number.isFinite(value.fov)) pose.fov = value.fov
  return pose
}

/**
 * Coerce a persisted `savedViews` bag into shape, dropping entries that cannot
 * be restored. Runs on every load: a view whose camera is malformed would
 * otherwise throw the camera controls into an undefined pose on click.
 */
export function normalizeSavedViews(value: unknown): Record<SavedViewId, SavedView> {
  if (!isRecord(value)) return {}

  const result: Record<SavedViewId, SavedView> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    const camera = normalizeCameraPose(raw.camera)
    if (!camera) continue

    const id = (typeof raw.id === 'string' ? raw.id : key) as SavedViewId
    const view: SavedView = {
      id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'View',
      order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : 0,
      camera,
    }

    if (raw.sectionPlaneId === null || typeof raw.sectionPlaneId === 'string') {
      view.sectionPlaneId = raw.sectionPlaneId as AnyNodeId | null
    }
    if (isRecord(raw.collectionStates)) {
      const states: Record<CollectionId, SavedViewCollectionState> = {}
      for (const [collectionId, state] of Object.entries(raw.collectionStates)) {
        if (!isRecord(state)) continue
        const entry: SavedViewCollectionState = {}
        if (typeof state.visible === 'boolean') entry.visible = state.visible
        if (typeof state.locked === 'boolean') entry.locked = state.locked
        states[collectionId as CollectionId] = entry
      }
      view.collectionStates = states
    }
    if (isRecord(raw.presentation)) view.presentation = raw.presentation

    result[id] = view
  }
  return result
}
