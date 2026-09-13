import type { DeviceOverride } from '../core/types'
import { isMovedPosition } from '../service/placement'

/**
 * Extraction of `bones:device` overrides for the engines — the device analog
 * of `extractServiceOverrides` (wall-model.ts), with one extra rule: a node
 * whose anchor still EQUALS its seed (the derived spot it was reconciled to)
 * is NOT an override — it merely mirrors auto-placement so the device is
 * hoverable. Only moved nodes reach the engine, which keeps a scene full of
 * untouched device nodes byte-equal to a node-less one (the movable-outlets
 * S6-style guarantee). Same contracts as the service extraction otherwise:
 * visible nodes only, lowest id wins on duplicate deviceIds (extras reported
 * for the computeLevel warning), NaN guards on every numeric field.
 */

const EPS = 1e-6

type LooseNode = Record<string, unknown>

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * True when the node's anchor differs from its seeded derivation — ANY write
 * path counts (drag commit, inspector wallT/heightAff slider, MCP): moved =
 * the anchor no longer matches the seed, or a non-default `position` escape
 * hatch, or a node with no seed at all (hand-authored = explicit override).
 */
export function isMovedDeviceNode(node: LooseNode): boolean {
  if (isMovedPosition(node.position as readonly unknown[] | undefined)) return true
  if (finite(node.wallT)) {
    if (!finite(node.seedWallT) || Math.abs(node.wallT - node.seedWallT) > EPS) return true
  }
  if (finite(node.heightAff)) {
    if (!finite(node.seedHeightAff) || Math.abs(node.heightAff - node.seedHeightAff) > EPS) {
      return true
    }
  }
  if (typeof node.wallId === 'string' && node.wallId.length > 0) {
    if (node.wallId !== node.seedWallId) return true
  }
  return false
}

export type DeviceOverrideExtraction = {
  overrides: Map<string, DeviceOverride>
  /** deviceIds that had more than one node on the level (extras ignored). */
  duplicates: string[]
}

export function extractDeviceOverrides(
  nodes: Record<string, LooseNode>,
  levelId: string,
): DeviceOverrideExtraction {
  const winners = new Map<string, { id: string; node: LooseNode }>()
  const duplicates = new Set<string>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'bones:device' || node.parentId !== levelId) continue
    if (node.visible === false) continue
    const deviceId = typeof node.deviceId === 'string' ? node.deviceId : ''
    if (!deviceId) continue
    const id = String(node.id ?? '')
    const current = winners.get(deviceId)
    if (!current) {
      winners.set(deviceId, { id, node })
      continue
    }
    duplicates.add(deviceId)
    if (id < current.id) winners.set(deviceId, { id, node })
  }

  const overrides = new Map<string, DeviceOverride>()
  for (const [deviceId, { node }] of winners) {
    if (!isMovedDeviceNode(node)) continue // tracks the derivation — no override
    const override: DeviceOverride = {}
    if (typeof node.wallId === 'string' && node.wallId.length > 0) override.wallId = node.wallId
    if (finite(node.wallT)) override.wallT = node.wallT
    if (finite(node.heightAff)) override.heightAff = node.heightAff
    const pos = Array.isArray(node.position) ? (node.position as unknown[]) : null
    if (pos && pos.length >= 3) {
      override.position = [
        finite(pos[0]) ? pos[0] : 0,
        finite(pos[1]) ? pos[1] : 0,
        finite(pos[2]) ? pos[2] : 0,
      ]
    }
    if (
      override.wallId === undefined &&
      override.wallT === undefined &&
      override.heightAff === undefined &&
      !isMovedPosition(override.position)
    ) {
      continue // nothing usable — never an override
    }
    overrides.set(deviceId, override)
  }
  return { overrides, duplicates: [...duplicates].sort() }
}
