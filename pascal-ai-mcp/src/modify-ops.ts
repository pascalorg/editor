// ---------------------------------------------------------------------------
// ModifyOp — the modify pipeline's intent layer (docs/MODIFY_REDESIGN.md §3).
//
// The model's ONLY job on a modify turn is translating the user's request
// into these ops (no coordinates). `applyModifyOps` then edits the session's
// persisted LayoutIntent deterministically; the regular partitioner /
// validator / executors take it from there. Furniture ops never touch the
// intent — they pass through to the furniture executor stage untouched.
//
// M0 scope: schema + tolerant parse + pure application. Agent wiring,
// furniture execution and the stability-constrained re-partition land with
// M1/M2 (design doc §9).
// ---------------------------------------------------------------------------

import { classifyRoomTypeByName } from './lang/room-vocab'
import { ROOM_TYPES, type LayoutIntent, type LayoutIntentRoom, type RoomType } from './layout-plan'
import type { NormProfile } from './norms/profile'
import { TYPE_TO_KIND } from './plan-validator'

export type StructuralModifyOp =
  | { op: 'add_room'; room: { name: string; type: RoomType; targetAreaSqm?: number }; near?: string }
  | { op: 'remove_room'; room: string }
  | { op: 'resize_room'; room: string; targetAreaSqm: number }
  | { op: 'rename_room'; room: string; name: string }

export type FurnitureModifyOp =
  | { op: 'add_furniture'; room: string; item: string }
  | { op: 'remove_furniture'; room: string; item: string }
  | { op: 'swap_furniture'; room: string; from: string; to: string }

export type ModifyOp = StructuralModifyOp | FurnitureModifyOp

export type ModifyPlan = { ops: ModifyOp[]; note?: string }

const STRUCTURAL_OPS = new Set(['add_room', 'remove_room', 'resize_room', 'rename_room'])
const FURNITURE_OPS = new Set(['add_furniture', 'remove_furniture', 'swap_furniture'])

// --- parse -------------------------------------------------------------------
// Tolerant parse, same posture as parseLayoutIntent: strip fences, take the
// outermost JSON object, report per-op shape defects as errors (they feed the
// correction loop, never throw).

export function parseModifyOps(raw: string): { plan: ModifyPlan | null; errors: string[] } {
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return { plan: null, errors: ['回复中找不到 JSON 对象'] }
  let data: unknown
  try {
    data = JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    return { plan: null, errors: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`] }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { plan: null, errors: ['ModifyPlan 必须是 JSON 对象'] }
  }
  const value = data as Record<string, unknown>
  const rawOps = Array.isArray(value.ops) ? value.ops : null
  if (!rawOps || rawOps.length === 0) return { plan: null, errors: ['ops 缺失或为空'] }

  const errors: string[] = []
  const ops: ModifyOp[] = []
  for (let i = 0; i < rawOps.length; i++) {
    const entry = rawOps[i] as Record<string, unknown>
    const op = typeof entry?.op === 'string' ? entry.op : ''
    const fail = (why: string) => errors.push(`ops[${i}]（${op || '未知'}）：${why}`)
    const str = (key: string): string | null =>
      typeof entry[key] === 'string' && (entry[key] as string).trim() ? (entry[key] as string).trim() : null

    if (op === 'add_room') {
      const room = entry.room as Record<string, unknown> | undefined
      const name = typeof room?.name === 'string' && room.name.trim() ? room.name.trim() : null
      const type = (ROOM_TYPES as readonly string[]).includes(room?.type as string)
        ? room!.type as RoomType
        : null
      if (!name || !type) {
        fail('room.name/room.type 缺失或非法')
        continue
      }
      const area = typeof room?.targetAreaSqm === 'number' && room.targetAreaSqm > 0
        ? room.targetAreaSqm
        : undefined
      const near = str('near')
      ops.push({
        op: 'add_room',
        room: { name, type, ...(area !== undefined ? { targetAreaSqm: area } : {}) },
        ...(near ? { near } : {}),
      })
    } else if (op === 'remove_room') {
      const room = str('room')
      if (!room) { fail('room 缺失'); continue }
      ops.push({ op: 'remove_room', room })
    } else if (op === 'resize_room') {
      const room = str('room')
      const area = typeof entry.targetAreaSqm === 'number' && entry.targetAreaSqm > 0
        ? entry.targetAreaSqm
        : null
      if (!room || area === null) { fail('room/targetAreaSqm 缺失或非法'); continue }
      ops.push({ op: 'resize_room', room, targetAreaSqm: area })
    } else if (op === 'rename_room') {
      const room = str('room')
      const name = str('name')
      if (!room || !name) { fail('room/name 缺失'); continue }
      ops.push({ op: 'rename_room', room, name })
    } else if (op === 'add_furniture' || op === 'remove_furniture') {
      const room = str('room')
      const item = str('item')
      if (!room || !item) { fail('room/item 缺失'); continue }
      ops.push({ op, room, item })
    } else if (op === 'swap_furniture') {
      const room = str('room')
      const from = str('from')
      const to = str('to')
      if (!room || !from || !to) { fail('room/from/to 缺失'); continue }
      ops.push({ op: 'swap_furniture', room, from, to })
    } else {
      fail('未知操作类型')
    }
  }
  if (ops.length === 0) return { plan: null, errors }
  const note = typeof value.note === 'string' && value.note.trim() ? value.note.trim() : undefined
  // Partial success keeps the parsed ops AND the errors: the caller decides
  // whether defects block (they do — errors feed the correction loop).
  return { plan: { ops, ...(note ? { note } : {}) }, errors }
}

// --- room reference resolution -------------------------------------------------
// §3: id exact → name exact → room-vocab type match when it names a unique
// room. Ambiguity is an error, not a guess.

export function resolveRoomRef(
  ref: string,
  rooms: readonly LayoutIntentRoom[],
): { room: LayoutIntentRoom } | { error: string } {
  const byId = rooms.find(room => room.id === ref)
  if (byId) return { room: byId }
  const byName = rooms.filter(room => room.name === ref)
  if (byName.length === 1) return { room: byName[0]! }
  if (byName.length > 1) return { error: `「${ref}」匹配到多个同名房间，请用更具体的说法` }
  const type = classifyRoomTypeByName(ref)
  if (type !== 'other') {
    const byType = rooms.filter(room => room.type === type)
    if (byType.length === 1) return { room: byType[0]! }
    if (byType.length > 1) {
      return { error: `「${ref}」匹配到多个${ref}类房间（${byType.map(r => r.name).join('、')}），请指明是哪一间` }
    }
  }
  return { error: `找不到房间「${ref}」` }
}

// --- application ----------------------------------------------------------------

export type AppliedModify = {
  intent: LayoutIntent
  // True when any structural op applied — the caller re-partitions only then.
  structural: boolean
  // Furniture ops pass through untouched for the executor stage (M1).
  furnitureOps: FurnitureModifyOp[]
  notes: string[]
  // Non-empty ⇒ do NOT proceed; feed back to the correction loop / user.
  errors: string[]
}

function roomArea(room: LayoutIntentRoom, profile: NormProfile): number {
  return room.targetAreaSqm !== undefined && room.targetAreaSqm > 0
    ? room.targetAreaSqm
    : profile.defaultRoomAreas[room.type]
}

function uniqueRoomId(type: RoomType, rooms: readonly LayoutIntentRoom[]): string {
  const ids = new Set(rooms.map(room => room.id))
  let n = 1
  let id = `${type}-${n}`
  while (ids.has(id)) id = `${type}-${++n}`
  return id
}

// Area-band judgement for add/resize (§3): beyond the fatal bounds → reject
// with the band quoted; outside the soft range → keep the value, warn.
function checkAreaBounds(
  type: RoomType,
  area: number,
  label: string,
  intent: LayoutIntent,
  profile: NormProfile,
): { error?: string; warning?: string } {
  const bedroomCount = intent.rooms.filter(room => room.type === 'bedroom').length
  const bounds = profile.roomAreaBounds({ totalAreaSqm: intent.targetTotalAreaSqm, bedroomCount })
  const bound = bounds[TYPE_TO_KIND[type]]
  if (!bound) return {}
  if (area < bound.fatalMin || area > bound.fatalMax) {
    return {
      error: `「${label}」目标面积 ${area}㎡ 超出该房型允许范围（合理区间 ${bound.softMin}–${bound.softMax}㎡），请调整`,
    }
  }
  if (area < bound.softMin || area > bound.softMax) {
    return { warning: `「${label}」目标面积 ${area}㎡ 在该房型舒适区间 ${bound.softMin}–${bound.softMax}㎡ 之外` }
  }
  return {}
}

const round1 = (value: number) => Math.round(value * 10) / 10

export function applyModifyOps(
  intent: LayoutIntent,
  plan: ModifyPlan,
  profile: NormProfile,
): AppliedModify {
  const notes: string[] = []
  const errors: string[] = []
  const furnitureOps: FurnitureModifyOp[] = []
  let rooms = [...intent.rooms]
  let adjacency = intent.adjacency ? [...intent.adjacency] : undefined
  let totalArea = intent.targetTotalAreaSqm
  let structural = false

  // Structural ops apply first, furniture ops resolve afterwards against the
  // final room set — the outcome of a mixed plan must not depend on the order
  // the model happened to emit the ops in ("删卫生间并移除里面的洗衣机" means
  // the same thing whichever op comes first).
  const removedRooms: LayoutIntentRoom[] = []
  for (const op of plan.ops) {
    if (FURNITURE_OPS.has(op.op)) continue

    const sop = op as StructuralModifyOp
    if (sop.op === 'add_room') {
      const area = sop.room.targetAreaSqm ?? profile.defaultRoomAreas[sop.room.type]
      const check = checkAreaBounds(sop.room.type, area, sop.room.name, { ...intent, rooms, targetTotalAreaSqm: totalArea }, profile)
      if (check.error) { errors.push(check.error); continue }
      if (check.warning) notes.push(check.warning)
      const id = uniqueRoomId(sop.room.type, rooms)
      rooms = [...rooms, {
        id,
        name: sop.room.name,
        type: sop.room.type,
        ...(sop.room.targetAreaSqm !== undefined ? { targetAreaSqm: sop.room.targetAreaSqm } : {}),
      }]
      if (sop.near) {
        const near = resolveRoomRef(sop.near, rooms)
        if ('error' in near) {
          notes.push(`邻接意愿「${sop.near}」未能解析（${near.error}），忽略`)
        } else {
          adjacency = [...(adjacency ?? []), { a: id, b: near.room.id }]
        }
      }
      totalArea = round1(totalArea + area)
      notes.push(`新增「${sop.room.name}」（${area}㎡），总面积调整为 ${totalArea}㎡`)
      structural = true
    } else if (sop.op === 'remove_room') {
      const resolved = resolveRoomRef(sop.room, rooms)
      if ('error' in resolved) { errors.push(resolved.error); continue }
      if (rooms.length <= 1) { errors.push('不能删除最后一个房间'); continue }
      const target = resolved.room
      const area = roomArea(target, profile)
      removedRooms.push(target)
      rooms = rooms.filter(room => room.id !== target.id)
      if (adjacency) {
        adjacency = adjacency.filter(pair => pair.a !== target.id && pair.b !== target.id)
      }
      // §8-2 拍板：footprint 缩小 —— 删除的面积从总面积里扣掉，不由其余
      // 房间瓜分。
      totalArea = round1(totalArea - area)
      notes.push(`删除「${target.name}」（${area}㎡），总面积调整为 ${totalArea}㎡`)
      structural = true
    } else if (sop.op === 'resize_room') {
      const resolved = resolveRoomRef(sop.room, rooms)
      if ('error' in resolved) { errors.push(resolved.error); continue }
      const target = resolved.room
      const check = checkAreaBounds(target.type, sop.targetAreaSqm, target.name, { ...intent, rooms, targetTotalAreaSqm: totalArea }, profile)
      if (check.error) { errors.push(check.error); continue }
      if (check.warning) notes.push(check.warning)
      const oldArea = roomArea(target, profile)
      rooms = rooms.map(room => room.id === target.id ? { ...room, targetAreaSqm: sop.targetAreaSqm } : room)
      totalArea = round1(totalArea + sop.targetAreaSqm - oldArea)
      notes.push(`「${target.name}」面积 ${oldArea}㎡ → ${sop.targetAreaSqm}㎡，总面积调整为 ${totalArea}㎡`)
      structural = true
    } else {
      // rename_room：纯元数据，不触发重分区（§3）。
      const resolved = resolveRoomRef(sop.room, rooms)
      if ('error' in resolved) { errors.push(resolved.error); continue }
      const target = resolved.room
      rooms = rooms.map(room => room.id === target.id ? { ...room, name: sop.name } : room)
      notes.push(`「${target.name}」更名为「${sop.name}」`)
    }
  }

  for (const op of plan.ops) {
    if (!FURNITURE_OPS.has(op.op)) continue
    const fop = op as FurnitureModifyOp
    // Only the room reference is validated here; item matching against the
    // live scene is the executor stage's job (M1). Resolution runs on the
    // post-structural room set so refs to a room added in the same plan work;
    // the ref is normalised to the room's final name because the executor
    // resolves against the rebuilt rooms (a rename in the same plan would
    // otherwise orphan it).
    const resolved = resolveRoomRef(fop.room, rooms)
    if ('room' in resolved) {
      furnitureOps.push({ ...fop, room: resolved.room.name })
      continue
    }
    // Pre-edit names are still valid refs: map through the original intent's
    // id — a room renamed in the same plan keeps its furniture ops, a room
    // removed in the same plan drops them with a note instead of an error
    // (the furniture disappears with its room).
    const original = resolveRoomRef(fop.room, intent.rooms)
    if ('room' in original) {
      const current = rooms.find(room => room.id === original.room.id)
      if (current) {
        furnitureOps.push({ ...fop, room: current.name })
        continue
      }
      if (removedRooms.some(room => room.id === original.room.id)) {
        notes.push(`「${original.room.name}」已随房间删除，其中的家具操作（${fop.op}）不再需要，忽略`)
        continue
      }
    }
    errors.push(resolved.error)
  }

  const applied: LayoutIntent = { targetTotalAreaSqm: totalArea, rooms }
  if (adjacency !== undefined && adjacency.length > 0) applied.adjacency = adjacency
  return { intent: applied, structural, furnitureOps, notes, errors }
}
