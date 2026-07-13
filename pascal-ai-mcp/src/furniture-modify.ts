// ---------------------------------------------------------------------------
// Deterministic furniture modify (docs/MODIFY_REDESIGN.md §5, batch M1).
//
// Executes the furniture ModifyOps against the live scene with zero model
// calls, reusing the generation executor's machinery: catalog search +
// smallest-first ranking + wall-adjacent placement scan + door clearances.
// Structure is never touched — these ops exist precisely so "换个沙发" does
// not re-partition anything.
//
// Item matching for remove/swap: the requested term is resolved through
// `search_assets` (the catalog owns the trilingual vocabulary) and existing
// room items match by asset id; a case-insensitive name match is the
// fallback for items whose asset left the catalog. Multiple matches delete
// the LAST placed one (§5) — the most recently added item is the most likely
// regret.
// ---------------------------------------------------------------------------

import {
  doorClearances,
  findWallPlacement,
  footprintAt,
  parseCandidates,
  rankCandidates,
  type CatalogCandidate,
  type Footprint2D,
  type FurnitureRoom,
} from './furniture-executor'
import { pointInPolygon } from './layout-plan'
import type { FurnitureModifyOp } from './modify-ops'
import { callWithRetry, type McpCaller } from './scene-executor'

const MAX_CANDIDATES = 4

export type FurnitureModifyResult = {
  op: FurnitureModifyOp
  ok: boolean
  // zh internal, re-rendered at the reply boundary like executor reports.
  detail: string
}

export type FurnitureModifyReport = {
  results: FurnitureModifyResult[]
  executionIssues: string[]
}

type SceneItem = {
  id: string
  name: string
  assetId: string | null
  assetName: string
  dimensions: [number, number, number]
  position: [number, number, number]
  rotationY: number
  roomId: string | null
}

function isNumberTriple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every(v => typeof v === 'number')
}

function itemFootprint(item: SceneItem): Footprint2D {
  return footprintAt(item.position[0], item.position[2], item.dimensions[0], item.dimensions[2], item.rotationY)
}

// FurnitureRoom reference resolution: zone id → exact name → substring name.
// (Type-level resolution already happened in applyModifyOps against the
// intent; here refs are usually the intent room's name.)
function resolveRoom(ref: string, rooms: FurnitureRoom[]): FurnitureRoom | null {
  return rooms.find(room => room.id === ref || room.zoneId === ref)
    ?? rooms.find(room => room.name === ref)
    ?? rooms.find(room => room.name.includes(ref) || ref.includes(room.name))
    ?? null
}

async function searchTerm(
  callMcp: McpCaller,
  term: string,
  issues: string[],
  beforeCall?: () => void,
): Promise<CatalogCandidate[]> {
  const payload = await callWithRetry(callMcp, 'search_assets', { query: term }, issues, `检索「${term}」`, beforeCall)
  return parseCandidates(payload)
}

// Existing room items matching a user term: catalog-id match first (the
// catalog owns the vocabulary), name substring as fallback.
function matchRoomItems(items: SceneItem[], room: FurnitureRoom, term: string, catalogIds: Set<string>): SceneItem[] {
  const inRoom = items.filter(item => item.roomId === room.id)
  const byAsset = inRoom.filter(item => item.assetId !== null && catalogIds.has(item.assetId))
  if (byAsset.length > 0) return byAsset
  const needle = term.toLowerCase()
  return inRoom.filter(item =>
    item.name.toLowerCase().includes(needle) || item.assetName.toLowerCase().includes(needle))
}

export async function executeFurnitureModifyOps(options: {
  ops: FurnitureModifyOp[]
  rooms: FurnitureRoom[]
  levelId: string
  callMcp: McpCaller
  beforeCall?: () => void
}): Promise<FurnitureModifyReport> {
  const { ops, rooms, levelId, callMcp, beforeCall } = options
  const issues: string[] = []
  const results: FurnitureModifyResult[] = []

  const wallsPayload = await callWithRetry(callMcp, 'get_walls', { levelId }, issues, '读取墙体清单', beforeCall)
  const isPair = (v: unknown): v is [number, number] =>
    Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
  const walls = (Array.isArray(wallsPayload?.walls) ? wallsPayload.walls : [])
    .filter((wall): wall is { start: [number, number]; end: [number, number]; openings: never[] } => {
      const value = wall as { start?: unknown; end?: unknown; openings?: unknown }
      return isPair(value?.start) && isPair(value?.end) && Array.isArray(value?.openings)
    })
  const keepClear = doorClearances(walls)

  const summaryPayload = await callWithRetry(callMcp, 'get_level_summary', {}, issues, '读取已放置家具', beforeCall)
  const rawItems = Array.isArray(summaryPayload?.items) ? summaryPayload.items : []
  const items: SceneItem[] = []
  for (const entry of rawItems) {
    const value = entry as {
      id?: unknown
      name?: unknown
      position?: unknown
      rotation?: unknown
      asset?: { id?: unknown; name?: unknown; dimensions?: unknown; attachTo?: unknown }
    }
    if (typeof value.id !== 'string' || !isNumberTriple(value.position)) continue
    if (value.asset?.attachTo === 'wall' || value.asset?.attachTo === 'ceiling') continue
    const position = value.position
    const dims = isNumberTriple(value.asset?.dimensions)
      ? value.asset.dimensions
      : [1, 1, 1] as [number, number, number]
    const home = rooms.find(room => pointInPolygon(position[0], position[2], room.polygon))
    items.push({
      id: value.id,
      name: typeof value.name === 'string' ? value.name : value.id,
      assetId: typeof value.asset?.id === 'string' ? value.asset.id : null,
      assetName: typeof value.asset?.name === 'string' ? value.asset.name : '',
      dimensions: dims,
      position: value.position,
      rotationY: isNumberTriple(value.rotation) ? value.rotation[1] : 0,
      roomId: home?.id ?? null,
    })
  }

  // Occupied footprints track deletions/additions across ops in this run.
  const occupied = new Map<string, Footprint2D>()
  for (const item of items) occupied.set(item.id, itemFootprint(item))
  const liveItems = [...items]

  const removeItem = async (item: SceneItem): Promise<boolean> => {
    const payload = await callWithRetry(callMcp, 'delete_node', { id: item.id }, issues, `删除「${item.name}」`, beforeCall)
    if (payload === null) return false
    occupied.delete(item.id)
    const index = liveItems.findIndex(entry => entry.id === item.id)
    if (index !== -1) liveItems.splice(index, 1)
    return true
  }

  const placeCandidate = async (
    room: FurnitureRoom,
    candidates: CatalogCandidate[],
    excluded?: Footprint2D,
  ): Promise<{ item: SceneItem; candidate: CatalogCandidate } | { reason: string }> => {
    const floorCandidates = rankCandidates(candidates).slice(0, MAX_CANDIDATES)
    if (floorCandidates.length === 0) return { reason: '目录中检索不到匹配资产' }
    const obstacles = [...occupied.values()].filter(fp => fp !== excluded)
    for (const candidate of floorCandidates) {
      const spot = findWallPlacement({
        polygon: room.polygon,
        itemDims: candidate.dimensions,
        occupied: obstacles,
        keepClear,
      })
      if (!spot) continue
      const payload = await callWithRetry(
        callMcp,
        'place_item',
        {
          catalogItemId: candidate.id,
          targetNodeId: room.zoneId ?? levelId,
          position: spot.position,
          rotation: spot.rotationY,
        },
        issues,
        `在「${room.name}」放置「${candidate.name}」`,
        beforeCall,
      )
      const itemId = typeof payload?.itemId === 'string' ? payload.itemId : null
      if (!itemId || payload?.status === 'catalog_unavailable') continue
      const item: SceneItem = {
        id: itemId,
        name: candidate.name,
        assetId: candidate.id,
        assetName: candidate.name,
        dimensions: candidate.dimensions,
        position: spot.position,
        rotationY: spot.rotationY,
        roomId: room.id,
      }
      occupied.set(itemId, itemFootprint(item))
      liveItems.push(item)
      return { item, candidate }
    }
    return { reason: '所有候选规格都放不进剩余空间（贴墙扫描无合法位置）' }
  }

  for (const op of ops) {
    const room = resolveRoom(op.room, rooms)
    if (!room) {
      results.push({ op, ok: false, detail: `找不到房间「${op.room}」` })
      continue
    }

    if (op.op === 'remove_furniture') {
      const catalog = await searchTerm(callMcp, op.item, issues, beforeCall)
      const matches = matchRoomItems(liveItems, room, op.item, new Set(catalog.map(c => c.id)))
      if (matches.length === 0) {
        results.push({ op, ok: false, detail: `「${room.name}」里没有找到「${op.item}」` })
        continue
      }
      const target = matches[matches.length - 1]!
      const ok = await removeItem(target)
      results.push({
        op,
        ok,
        detail: ok
          ? matches.length > 1
            ? `已删除「${room.name}」的「${target.name}」（匹配到 ${matches.length} 件，删除了最后放置的一件）`
            : `已删除「${room.name}」的「${target.name}」`
          : `删除「${target.name}」失败`,
      })
    } else if (op.op === 'add_furniture') {
      const catalog = await searchTerm(callMcp, op.item, issues, beforeCall)
      const placed = await placeCandidate(room, catalog)
      results.push('reason' in placed
        ? { op, ok: false, detail: `「${op.item}」放不进「${room.name}」：${placed.reason}` }
        : { op, ok: true, detail: `已在「${room.name}」放置「${placed.candidate.name}」` })
    } else {
      // swap：先解析旧物并算好新位置（旧物脚印豁免），成功才删旧放新；
      // 新物放置失败时旧物原样保留（§5 的回滚以"先算后删"实现，避免真
      // 删除后 place_item 失败留下空位）。
      const oldCatalog = await searchTerm(callMcp, op.from, issues, beforeCall)
      const matches = matchRoomItems(liveItems, room, op.from, new Set(oldCatalog.map(c => c.id)))
      if (matches.length === 0) {
        results.push({ op, ok: false, detail: `「${room.name}」里没有找到「${op.from}」` })
        continue
      }
      const target = matches[matches.length - 1]!
      const newCatalog = await searchTerm(callMcp, op.to, issues, beforeCall)
      const floorCandidates = rankCandidates(newCatalog).slice(0, MAX_CANDIDATES)
      if (floorCandidates.length === 0) {
        results.push({ op, ok: false, detail: `目录中检索不到「${op.to}」，「${target.name}」保持不变` })
        continue
      }
      // Dry placement with the old item's footprint excluded — the new item
      // may take its spot.
      const targetFp = occupied.get(target.id)
      const obstacles = [...occupied.entries()].filter(([id]) => id !== target.id).map(([, fp]) => fp)
      let spotFound = false
      for (const candidate of floorCandidates) {
        if (findWallPlacement({ polygon: room.polygon, itemDims: candidate.dimensions, occupied: obstacles, keepClear })) {
          spotFound = true
          break
        }
      }
      if (!spotFound) {
        results.push({ op, ok: false, detail: `「${op.to}」放不进「${room.name}」，「${target.name}」保持不变` })
        continue
      }
      const removed = await removeItem(target)
      if (!removed) {
        results.push({ op, ok: false, detail: `删除「${target.name}」失败，未执行更换` })
        continue
      }
      const placed = await placeCandidate(room, newCatalog, targetFp)
      results.push('reason' in placed
        ? { op, ok: false, detail: `已删除「${target.name}」但「${op.to}」放置失败：${placed.reason}` }
        : { op, ok: true, detail: `已将「${room.name}」的「${target.name}」换为「${placed.candidate.name}」` })
    }
  }

  return { results, executionIssues: issues }
}
