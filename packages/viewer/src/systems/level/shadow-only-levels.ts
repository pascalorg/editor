import type { Object3D } from 'three'

/**
 * Levels currently in shadow-caster-only mode (hidden above the selected level
 * by solo or by the editor's level display). Tracked so layer masks are
 * restored exactly once on transition, and so a full-building capture can
 * show them for its one render.
 */
export const shadowOnlyLevels = new WeakSet<Object3D>()
