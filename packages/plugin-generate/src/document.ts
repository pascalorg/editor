/**
 * The plan document — "houses as code", after PlanCrafters' roomcode v1
 * (docs/reference/plancrafters/roomcode.js). A plan is AUTHORED as a small
 * document: rooms with real dimensions in a local frame, adjacency
 * attachments with connector kinds, a front door, and declared intent
 * (roof form/pitch, ceiling, style). Everything else — walls, seated doors,
 * egress windows, zones, slab, roof geometry — is DERIVED by `build.ts`.
 *
 * Frame: `x` runs from the plan LEFT, `y` from the plan FRONT (the street
 * side), both in feet. Rooms are rectangles that tile the footprint; a room
 * boundary is a wall centreline. `normalizeDocument` turns the authored
 * document into inches with every coordinate on the 6" grid;
 * `validateDocument` never throws — it returns errors a person can act on,
 * in room-name language.
 */

export const ROOM_KINDS = [
  'living',
  'kitchen',
  'dining',
  'bed',
  'bath',
  'entry',
  'hall',
  'closet',
  'pantry',
  'laundry',
  'office',
  'garage',
  'stair',
] as const
export type RoomKind = (typeof ROOM_KINDS)[number]

export const ROOF_FORMS = ['auto', 'gable', 'hip', 'shed', 'flat'] as const
export type RoofForm = (typeof ROOF_FORMS)[number]

export const PLAN_EDGES = ['front', 'back', 'left', 'right'] as const
export type PlanEdge = (typeof PLAN_EDGES)[number]

export type AttachKind = 'door' | 'open' | 'zone'

/** The authored shape (feet). Every field but `rooms` is optional. */
export type PlanDocument = {
  roomcode?: 1
  name?: string
  units?: 'ft' | 'in'
  mode?: '1story' | 'adu'
  style?: string
  /** Plan ceiling, feet. */
  ceiling?: number
  roof?: {
    form?: RoofForm
    /** Rise in twelfths ("7" = 7:12). */
    pitch?: number
    /** Eave overhang, feet. */
    overhang?: number
    /** Which plan edges are gable ends. */
    gables?: PlanEdge[]
  }
  rooms: {
    name: string
    kind?: RoomKind
    x: number
    y: number
    w: number
    d: number
    primary?: boolean
    /** Finish-schedule text for the floor (LVP, TILE…). */
    floor?: string
    ceiling?: number
  }[]
  attach?: [string, string, AttachKind?][]
  frontDoor?: string
  finishes?: { siding?: string; roofMat?: string; palette?: number }
}

/** Inches, integers on the 6" grid, canonical names and kinds. */
export type NormalizedRoom = {
  name: string
  kind: RoomKind
  /** Rectangle in inches: u along the front, v into the lot. */
  u0: number
  v0: number
  u1: number
  v1: number
  primary: boolean
  floor: string | null
  /** Room ceiling, inches, when it differs from the plan ceiling. */
  ceil: number | null
}

export type NormalizedDocument = {
  name: string
  mode: '1story' | 'adu'
  style: string
  /** Plan ceiling, inches. */
  ceiling: number
  roof: { form: RoofForm; pitch: number | null; overhang: number | null; gables: PlanEdge[] }
  rooms: NormalizedRoom[]
  edges: { a: string; b: string; kind: AttachKind }[]
  frontDoorRoom: string | null
  finishes: { siding: string | null; roofMat: string | null; palette: number | null }
}

export const GRID_IN = 6

export const snapIn = (inches: number): number => Math.round(inches / GRID_IN) * GRID_IN

/** Room kind from the name when none is declared (the roomcode vocabulary). */
export function kindOf(name: string, declared?: string): RoomKind {
  if (declared && (ROOM_KINDS as readonly string[]).includes(declared)) return declared as RoomKind
  const n = name.toUpperCase()
  if (/GARAGE|CARPORT/.test(n)) return 'garage'
  if (/BATH|POWDER|WC|TOILET/.test(n)) return 'bath'
  if (/BED|SUITE/.test(n)) return 'bed'
  if (/KITCHEN/.test(n)) return 'kitchen'
  if (/DINING|BREAKFAST|NOOK/.test(n)) return 'dining'
  if (/LIVING|GREAT|FAMILY|DEN|LOUNGE/.test(n)) return 'living'
  if (/FOYER|ENTRY|MUD|VESTIBULE/.test(n)) return 'entry'
  if (/HALL|CORRIDOR|GALLERY/.test(n)) return 'hall'
  if (/CLOSET|WIC|WARDROBE|LINEN|STORAGE/.test(n)) return 'closet'
  if (/PANTRY/.test(n)) return 'pantry'
  if (/LAUNDRY|UTILITY|MECH/.test(n)) return 'laundry'
  if (/OFFICE|STUDY|FLEX|LIBRARY/.test(n)) return 'office'
  if (/STAIR/.test(n)) return 'stair'
  return 'living'
}

export function normalizeDocument(input: PlanDocument): NormalizedDocument {
  const units = input.units ?? 'ft'
  const S = units === 'ft' ? 12 : 1
  const rooms: NormalizedRoom[] = (input.rooms ?? []).map((r) => {
    const name = String(r.name ?? '').trim().toUpperCase()
    const kind = kindOf(name, r.kind)
    return {
      name,
      kind,
      u0: snapIn(r.x * S),
      v0: snapIn(r.y * S),
      u1: snapIn((r.x + r.w) * S),
      v1: snapIn((r.y + r.d) * S),
      primary: !!r.primary || (kind === 'bed' && /PRIMARY|MASTER/.test(name)),
      floor: r.floor ? String(r.floor) : null,
      ceil: Number.isFinite(r.ceiling) ? Math.round((r.ceiling as number) * 12) : null,
    }
  })
  const edges = (input.attach ?? []).map(([a, b, kind]) => ({
    a: String(a ?? '').trim().toUpperCase(),
    b: String(b ?? '').trim().toUpperCase(),
    kind: (kind ?? 'door') as AttachKind,
  }))
  const roof = input.roof ?? {}
  return {
    name: input.name?.trim() || 'plan',
    mode: input.mode === 'adu' ? 'adu' : '1story',
    style: input.style?.trim().toLowerCase() || 'farmhouse',
    ceiling: Number.isFinite(input.ceiling) ? Math.round((input.ceiling as number) * 12) : 108,
    roof: {
      form: roof.form ?? 'auto',
      pitch: Number.isFinite(roof.pitch) ? (roof.pitch as number) : null,
      overhang: Number.isFinite(roof.overhang) ? Math.round((roof.overhang as number) * 12) : null,
      gables: (roof.gables ?? []).map((g) => String(g).toLowerCase() as PlanEdge),
    },
    rooms,
    edges,
    frontDoorRoom: input.frontDoor ? String(input.frontDoor).trim().toUpperCase() : null,
    finishes: {
      siding: input.finishes?.siding ?? null,
      roofMat: input.finishes?.roofMat ?? null,
      palette: Number.isFinite(input.finishes?.palette) ? (input.finishes?.palette as number) : null,
    },
  }
}

/** Overlap area of two rectangles, square inches. */
function overlap(a: NormalizedRoom, b: NormalizedRoom): number {
  const w = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0)
  const d = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0)
  return w > 0 && d > 0 ? w * d : 0
}

/** Length of wall two rooms share (inches), 0 when they only touch at a corner. */
export function sharedLength(a: NormalizedRoom, b: NormalizedRoom): number {
  const touchU = a.u1 === b.u0 || b.u1 === a.u0
  const touchV = a.v1 === b.v0 || b.v1 === a.v0
  if (touchU) return Math.max(0, Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0))
  if (touchV) return Math.max(0, Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0))
  return 0
}

export type Validation = { ok: boolean; errors: string[]; warnings: string[] }

/** The exterior sides of a room: plan edges where no other room continues. */
export function exteriorSides(room: NormalizedRoom, rooms: readonly NormalizedRoom[]): PlanEdge[] {
  const covers = (edge: PlanEdge): boolean =>
    rooms.some((o) => {
      if (o === room) return false
      switch (edge) {
        case 'front':
          return o.v1 === room.v0 && Math.min(o.u1, room.u1) - Math.max(o.u0, room.u0) > 0
        case 'back':
          return o.v0 === room.v1 && Math.min(o.u1, room.u1) - Math.max(o.u0, room.u0) > 0
        case 'left':
          return o.u1 === room.u0 && Math.min(o.v1, room.v1) - Math.max(o.v0, room.v0) > 0
        default:
          return o.u0 === room.u1 && Math.min(o.v1, room.v1) - Math.max(o.v0, room.v0) > 0
      }
    })
  return PLAN_EDGES.filter((edge) => !covers(edge))
}

export function validateDocument(input: PlanDocument): Validation {
  const errors: string[] = []
  const warnings: string[] = []
  let doc: NormalizedDocument
  try {
    doc = normalizeDocument(input)
  } catch (error) {
    return { ok: false, errors: [(error as Error).message], warnings }
  }
  if (doc.rooms.length === 0) return { ok: false, errors: ['the document has no rooms.'], warnings }

  const byName = new Map<string, NormalizedRoom>()
  for (const r of doc.rooms) {
    if (!r.name) errors.push('every room needs a name.')
    else if (byName.has(r.name)) errors.push(`two rooms are both named "${r.name}" — names must be unique.`)
    else byName.set(r.name, r)
    if (r.u1 - r.u0 < 24 || r.v1 - r.v0 < 24) {
      errors.push(`room "${r.name}" is under 2ft on a side — give it real dimensions.`)
    }
  }
  const R = doc.rooms
  for (let i = 0; i < R.length; i++) {
    for (let j = i + 1; j < R.length; j++) {
      if (overlap(R[i] as NormalizedRoom, R[j] as NormalizedRoom) > 0) {
        errors.push(`rooms "${R[i]?.name}" and "${R[j]?.name}" overlap — rooms tile, never stack.`)
      }
    }
  }
  // Connectivity: every room shares a wall with the body of the plan.
  if (R.length > 1) {
    const seen = new Set<number>([0])
    const queue = [0]
    while (queue.length) {
      const i = queue.pop() as number
      for (let j = 0; j < R.length; j++) {
        if (!seen.has(j) && sharedLength(R[i] as NormalizedRoom, R[j] as NormalizedRoom) > 0) {
          seen.add(j)
          queue.push(j)
        }
      }
    }
    for (let j = 0; j < R.length; j++) {
      if (!seen.has(j)) {
        errors.push(
          `room "${R[j]?.name}" does not touch the rest of the plan — every room must share a wall with the body of the house.`,
        )
      }
    }
  }
  for (const e of doc.edges) {
    const A = byName.get(e.a)
    const B = byName.get(e.b)
    if (!A || !B) {
      errors.push(`attach references unknown room "${A ? e.b : e.a}".`)
      continue
    }
    const sl = sharedLength(A, B)
    if (sl <= 6) {
      errors.push(`"${e.a}" and "${e.b}" are attached but share no wall — move them together or drop the attach.`)
    } else if (sl < 30 && e.kind === 'door') {
      warnings.push(`"${e.a}"–"${e.b}" share under 2'-6" of wall — a door will be tight there.`)
    }
  }
  if (doc.frontDoorRoom) {
    const F = byName.get(doc.frontDoorRoom)
    if (!F) errors.push(`frontDoor names unknown room "${doc.frontDoorRoom}".`)
    else {
      const minV = Math.min(...R.map((r) => r.v0))
      if (F.v0 - minV > 6) {
        warnings.push(
          `the front-door room "${F.name}" does not touch the plan front — the entry will land on whatever exterior wall it has.`,
        )
      }
    }
  } else {
    warnings.push('no frontDoor declared — the entry goes on the living or entry room that touches the front.')
  }
  for (const r of R) {
    if (r.kind === 'bed' && exteriorSides(r, R).length === 0) {
      errors.push(`bedroom "${r.name}" is fully interior — an egress window is impossible. Give it an exterior wall.`)
    }
  }
  if (!(ROOF_FORMS as readonly string[]).includes(doc.roof.form)) {
    errors.push(`roof.form must be one of ${ROOF_FORMS.join(', ')}.`)
  }
  for (const g of doc.roof.gables) {
    if (!(PLAN_EDGES as readonly string[]).includes(g)) {
      errors.push(`roof.gables entries are plan edges — front, back, left, right (got "${g}").`)
    }
  }
  if (doc.roof.pitch != null && (doc.roof.pitch < 0.5 || doc.roof.pitch > 18)) {
    errors.push('roof.pitch is rise:12 — use 0.5 to 18.')
  }
  if (doc.roof.overhang != null && (doc.roof.overhang < 0 || doc.roof.overhang > 48)) {
    errors.push('roof.overhang is in feet — use 0 to 4.')
  }
  if (doc.ceiling < 84 || doc.ceiling > 240) errors.push('ceiling is in feet — use 7 to 20.')
  return { ok: errors.length === 0, errors, warnings }
}
