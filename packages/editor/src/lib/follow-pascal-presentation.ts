import type { WallMode } from '@pascal-app/viewer'
import type { RoomKey } from './room-selection'

/**
 * Follow Pascal changes how the building is shown so the build it follows is in view: the walls cut
 * away when no eye sees its target, the floor it works on selected, the floors above it hidden. This
 * keeps what it changed, and what the person had before, so that when Follow ends it puts back exactly
 * that: a setting it changed and the person has not touched since goes back to what the person had.
 *
 * A setting the person changes while Follow is on is theirs: it is not put back, and Follow does not
 * change it again until it has ended. Everything here is arithmetic on a port, so it is tested without
 * a viewer; the component that owns the port is `FollowPascal`.
 */

export type LevelMode = 'stacked' | 'exploded' | 'solo' | 'manual'

/** The floor as the person has it: the selection and the room picked in the editor. */
export type Floor = {
  buildingId: string | null
  levelId: string | null
  zoneId: string | null
  selectedIds: readonly string[]
  room: RoomKey | null
}

export type ViewPresentation = {
  wall: WallMode
  levels: LevelMode
  /** The upper floors are hidden, above the selected one. */
  hideAbove: boolean
  floor: Floor
}

/** What it needs of the viewer and the editor: read the view, and write one part of it. */
export type PresentationPort = {
  read(): ViewPresentation
  setWall(mode: WallMode): void
  setLevels(mode: LevelMode): void
  setHideAbove(hide: boolean): void
  /** Selects a floor in its building. The room and what was picked on the floor before are dropped. */
  setFloor(floor: { buildingId: string | null; levelId: string }): void
  /** Puts a floor back as the person had it; what is no longer in the scene is dropped. */
  putFloor(floor: Floor): void
}

type Part = keyof ViewPresentation

function sameFloor(a: Floor, b: Floor): boolean {
  return (
    a.buildingId === b.buildingId &&
    a.levelId === b.levelId &&
    a.zoneId === b.zoneId &&
    a.selectedIds.length === b.selectedIds.length &&
    a.selectedIds.every((id, index) => id === b.selectedIds[index]) &&
    (a.room === b.room ||
      (!!a.room &&
        !!b.room &&
        a.room.levelId === b.room.levelId &&
        a.room.zoneId === b.room.zoneId))
  )
}

function same<K extends Part>(part: K, a: ViewPresentation[K], b: ViewPresentation[K]): boolean {
  return part === 'floor' ? sameFloor(a as Floor, b as Floor) : a === b
}

export class FollowPresentation {
  /** For each part Follow changed: what the person had, and what Follow left it as. */
  private held: { [K in Part]?: { before: ViewPresentation[K]; set: ViewPresentation[K] } } = {}
  /** Parts the person changed after Follow did: theirs until Follow ends. */
  private theirs = new Set<Part>()

  constructor(private port: PresentationPort) {}

  /** The walls as `mode` shows them (cutaway, when no eye sees the target). */
  wall(mode: WallMode): void {
    this.change('wall', mode === this.port.read().wall, () => this.port.setWall(mode))
  }

  levels(mode: LevelMode): void {
    this.change('levels', mode === this.port.read().levels, () => this.port.setLevels(mode))
  }

  /** The floors above the selected one hidden, or shown. */
  hideAbove(hide: boolean): void {
    this.change('hideAbove', hide === this.port.read().hideAbove, () =>
      this.port.setHideAbove(hide),
    )
  }

  /** The floor a build works on, selected. Nothing changes when it is the selected one. */
  floor(target: { buildingId: string | null; levelId: string }): void {
    this.change('floor', this.port.read().floor.levelId === target.levelId, () =>
      this.port.setFloor(target),
    )
  }

  /**
   * Follow ends: each part it changed goes back to what the person had, unless they have changed it
   * since. A floor goes back only when the selection is as Follow left it: a room or an element
   * picked on the floor is the person's choice of that floor.
   */
  restore(): void {
    const now = this.port.read()
    const { wall, levels, hideAbove, floor } = this.held
    this.held = {}
    this.theirs.clear()
    if (wall && now.wall === wall.set) this.port.setWall(wall.before)
    if (levels && now.levels === levels.set) this.port.setLevels(levels.before)
    if (hideAbove && now.hideAbove === hideAbove.set) this.port.setHideAbove(hideAbove.before)
    if (floor && sameFloor(now.floor, floor.set)) this.port.putFloor(floor.before)
  }

  private change<K extends Part>(part: K, already: boolean, write: () => void): void {
    if (this.theirs.has(part)) return
    const held = this.held[part]
    const now = this.port.read()[part]
    if (held && !same(part, now, held.set as ViewPresentation[K])) {
      // Changed since Follow wrote it: the person's, and not Follow's to put back or to write over.
      delete this.held[part]
      this.theirs.add(part)
      return
    }
    if (already) return
    write()
    const set = this.port.read()[part]
    ;(this.held as Record<Part, unknown>)[part] = { before: held ? held.before : now, set }
  }
}
