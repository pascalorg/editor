import { type CornerWindowInput, planCornerWindow } from '../building/corner-window'
import { cornerPair, wallEndPoint, windowCornerEnd } from '../lib/corner-pair'
import type { WallNode, WindowNode } from '../schema'
import { achievedChanges } from './achieved'
import { type LevelTargetInput, targetLevel } from './level-target'
import type { AgentOperation, SceneChanges } from './types'
import { registerSceneCheck, type SceneIssue } from './verify-scene'

type AddCornerWindowInput = Omit<CornerWindowInput, 'levelId'> & LevelTargetInput

/**
 * `add_corner_window`: one window on each of the two walls meeting at a corner, joined, on the level
 * named, else the one in view: stacked storeys share their corners' plan points.
 */
export const addCornerWindow: AgentOperation<AddCornerWindowInput> = (nodes, input, context) => {
  const level = targetLevel(nodes, input, context)
  const { windows, wallIds, angle } = planCornerWindow(nodes, { ...input, levelId: level.id })
  const changes: SceneChanges = {
    create: windows.map((node) => ({ node: node as never, parentId: node.parentId! })),
  }
  return {
    changes,
    result: {
      ok: true,
      windowIds: windows.map((window) => window.id),
      wallIds,
      angle: Math.round(angle * 10) / 10,
      post: windows[0]!.corner!.post,
      message: `Added a corner window across ${wallIds.join(' and ')} (${Math.round(angle)}°), the glass ${windows[0]!.corner!.post === 'none' ? 'fused at the corner' : 'meeting at a post'}.`,
      achieved: achievedChanges(nodes, changes),
    },
  }
}

const round = (value: number) => Math.round(value * 100) / 100

/**
 * Corner windows, checked: two windows running to the same corner unjoined (one face of a corner
 * window built, the wrap missed), a pair whose sides drifted apart, a window naming a partner that
 * is gone.
 */
export function cornerWindowIssues(nodes: Parameters<typeof cornerPair>[0]): SceneIssue[] {
  const issues: SceneIssue[] = []
  const atCorner = new Map<string, WindowNode[]>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'window') continue
    const window = node as WindowNode
    const pair = cornerPair(nodes, window)
    // Informational: what broke the pair (a side deleted or moved, a wall moved) was a choice.
    if (window.corner && !pair) {
      issues.push({
        type: 'corner_partner_missing',
        severity: 'info',
        message: `Window ${window.id} names corner partner ${window.corner.partnerId}, but they no longer make a corner window (one is gone or moved off the corner, or the walls no longer meet there): it renders as a plain window. Only if the person wants the corner wrapped again, merge_windows joins two windows there.`,
      })
      continue
    }
    if (pair) {
      const sill = (w: WindowNode) => w.position[1] - w.height / 2
      if (
        window.id < pair.partner.id &&
        (Math.abs(window.height - pair.partner.height) > 1e-3 ||
          Math.abs(sill(window) - sill(pair.partner)) > 1e-3)
      )
        issues.push({
          type: 'corner_out_of_step',
          message: `Corner window ${window.id} and ${pair.partner.id} differ (heights ${round(window.height)} and ${round(pair.partner.height)} m, sills ${round(sill(window))} and ${round(sill(pair.partner))} m): a corner window's sides share height and sill.`,
        })
      continue
    }
    const end = windowCornerEnd(nodes, window)
    const wall = nodes[window.parentId ?? ''] as WallNode | undefined
    if (!end || wall?.type !== 'wall') continue
    const [x, z] = wallEndPoint(wall, end)
    const key = `${wall.parentId}:${x!.toFixed(3)},${z!.toFixed(3)}`
    atCorner.set(key, [...(atCorner.get(key) ?? []), window])
  }
  for (const [key, windows] of atCorner) {
    if (new Set(windows.map((w) => w.parentId)).size < 2) continue
    const corner = key.split(':')[1]
    // Informational: two windows meeting at a corner may be what the person drew.
    issues.push({
      type: 'corner_unjoined',
      severity: 'info',
      message: `Windows ${windows.map((w) => w.id).join(' and ')} both run to the corner (${corner}) without being joined: if the reference wraps the corner, merge_windows joins them as one corner window, the glass fused.`,
    })
  }
  return issues
}

registerSceneCheck({ name: 'corner windows', order: 50, run: (n) => cornerWindowIssues(n) })
