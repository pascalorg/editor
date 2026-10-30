import type { AnyNode, AnyNodeId, SlabNode, ZoneNode } from '../schema'
import type { BeamNode } from '../schema/nodes/beam'
import type { ColumnNode } from '../schema/nodes/column'
import { beamBottomElevation, createBeam } from './beam'
import {
  createFramingPost,
  FRAMING_POST_MIN_HEIGHT,
  framingPostFields,
  framingPostSize,
} from './framing-post'
import { type PorchFramingPlan, planPorchFraming, porchFramingSettings } from './porch-framing'

/**
 * A porch's posts and beams (`lib/porch-framing`), kept by the structure kernel as it keeps a
 * room's floor and ceiling: made when a covered porch has an open side, moved with the porch,
 * rebuilt when its framing settings change, removed when it stops being a covered porch. A deck
 * or patio gets the same once they are switched on, to carry a roof over it. They are ordinary
 * post and beam nodes. Moving, resizing or deleting one hands the room's framing to the user
 * (`porchFraming.auto: false`): framing edited by hand stops rebuilding; turning it back on
 * rebuilds it.
 */

type Nodes = Readonly<Record<string, AnyNode>>
type PorchPart = ColumnNode | BeamNode

/** What the kernel stamps on a porch part: the porch, which part, and what it made it as. */
export type PorchPartMetadata = { porchOf: string; porchPart: string; porchSeed: string }

/** The porch a post or beam was made for, when the kernel made it. */
export function porchPartOf(node: AnyNode | null | undefined): PorchPartMetadata | null {
  if (node?.type !== 'column' && node?.type !== 'beam') return null
  const metadata = node.metadata as Partial<PorchPartMetadata> | undefined
  return typeof metadata?.porchOf === 'string' && typeof metadata.porchPart === 'string'
    ? (metadata as PorchPartMetadata)
    : null
}

/** Keep generated parts linked when reconciliation assigns their room its stable ID. */
export function remapPorchOwner(
  metadata: Record<string, unknown> | undefined,
  ids: ReadonlyMap<string, string>,
): Record<string, unknown> | undefined {
  return typeof metadata?.porchOf === 'string' && ids.has(metadata.porchOf)
    ? { ...metadata, porchOf: ids.get(metadata.porchOf) }
    : undefined
}

const round = (value: number) => Math.round(value * 1e6) / 1e6

/** A part's shape, as it was made: anything else is a hand edit. */
function seedOf(part: PorchPart): string {
  if (part.type === 'column')
    return JSON.stringify(
      [part.position[0], part.position[2], part.width, part.depth, part.height, part.rotation].map(
        round,
      ),
    )
  return JSON.stringify([
    ...[...part.start, ...part.end, part.width, part.depth].map(round),
    part.topElevation === undefined ? null : round(part.topElevation),
    part.placement,
  ])
}

/**
 * A porch part's id and shape, for the structure sync to notice a hand edit or a delete (and run
 * the kernel, which hands the porch's framing over); null for any other node.
 */
export function porchPartSignature(node: AnyNode | null | undefined): string | null {
  return porchPartOf(node) ? JSON.stringify([node!.id, seedOf(node as PorchPart)]) : null
}

function edited(part: PorchPart): boolean {
  return seedOf(part) !== porchPartOf(part)?.porchSeed
}

/**
 * A room the kernel frames, still closed and its framing automatic: a covered porch (automatic
 * unless switched off), or a deck or patio whose posts and beam are switched on (`auto: true`, to
 * carry a roof over it; off by default).
 */
function framedPorch(zone: ZoneNode | undefined): boolean {
  if (!zone || zone.enclosureStatus === 'open') return false
  if (zone.roomType === 'porch')
    return zone.hasCeiling !== false && zone.porchFraming?.auto !== false
  return coverOptional(zone) && zone.porchFraming?.auto === true
}

/** A deck or patio: its posts and beam are off until switched on. */
function coverOptional(zone: Pick<ZoneNode, 'roomType'>): boolean {
  return zone.roomType === 'deck' || zone.roomType === 'patio'
}

/** The floor plate a porch's posts stand on: its own step-down plate, else the one it shares. */
function porchPlate(zone: ZoneNode, plates: readonly SlabNode[]): SlabNode | undefined {
  const holding = plates.filter((plate) => plate.zoneIds?.includes(zone.id))
  return holding.find((plate) => plate.plateRole !== 'base') ?? holding[0]
}

const yawOf = (start: readonly [number, number], end: readonly [number, number]) =>
  Math.atan2(-(end[1] - start[1]), end[0] - start[0])

function withPorch(node: PorchPart, zone: ZoneNode, key: string): PorchPart {
  const metadata: PorchPartMetadata = { porchOf: zone.id, porchPart: key, porchSeed: '' }
  const tagged = { ...node, metadata: { ...node.metadata, ...metadata } } as PorchPart
  ;(tagged.metadata as PorchPartMetadata).porchSeed = seedOf(tagged)
  return tagged
}

/** The porch's planned parts as nodes, reusing the ids (and the touches) of the ones it has. */
function buildParts(
  zone: ZoneNode,
  plan: PorchFramingPlan,
  owned: readonly PorchPart[],
  plate: SlabNode | undefined,
  levelId: string,
  nodes: Nodes,
  mintId: (kind: 'column' | 'beam') => string,
): PorchPart[] {
  const settings = porchFramingSettings(zone)
  const byKey = new Map(owned.map((part) => [porchPartOf(part)!.porchPart, part]))
  const beams = new Map<string, BeamNode>()
  for (const planned of plan.beams) {
    const existing = byKey.get(planned.key)
    const fresh = createBeam({
      start: planned.start,
      end: planned.end,
      preset: settings.beamSize,
      levelId,
      supportSlabId: plate?.id,
      name: `${zone.name} beam`,
    })
    const beam: BeamNode =
      existing?.type === 'beam'
        ? {
            ...existing,
            start: fresh.start,
            end: fresh.end,
            width: fresh.width,
            depth: fresh.depth,
            size: fresh.size,
            plies: fresh.plies,
            material: fresh.material,
            placement: 'dropped',
            topElevation: undefined,
            supportSlabId: plate?.id,
          }
        : { ...fresh, id: mintId('beam') as BeamNode['id'] }
    beams.set(planned.key, withPorch(beam, zone, planned.key) as BeamNode)
  }
  const foot = plate?.elevation ?? 0
  const posts = plan.posts.map((planned) => {
    // Up to the underside of the beam it carries (the lower of two at a corner).
    const bottoms = planned.beams.flatMap((key) => {
      const beam = beams.get(key)
      return beam ? [beamBottomElevation(nodes as never, beam)] : []
    })
    const height = Math.max(FRAMING_POST_MIN_HEIGHT, Math.min(...bottoms) - foot)
    const run = plan.beams.find((beam) => beam.key === planned.beams.at(-1))
    const rotation = run ? yawOf(run.start, run.end) : 0
    const existing = byKey.get(planned.key)
    const position: [number, number, number] = [planned.position[0], 0, planned.position[1]]
    const post: ColumnNode =
      existing?.type === 'column'
        ? {
            ...existing,
            ...(framingPostSize(existing) === settings.postSize
              ? {}
              : framingPostFields(settings.postSize, existing.postBase ?? 'post-base')),
            position,
            rotation,
            height,
            supportSlabId: plate?.id,
          }
        : {
            ...createFramingPost({
              position: planned.position,
              size: settings.postSize,
              base: 'post-base',
              height,
              levelId,
              supportSlabId: plate?.id,
              rotation,
              name: `${zone.name} post`,
            }),
            id: mintId('column') as ColumnNode['id'],
          }
    return withPorch(post, zone, planned.key)
  })
  return [...beams.values(), ...posts]
}

/**
 * The kernel's porch framing pass over one level: which posts and beams to put and delete, and
 * the porches whose framing a hand edit has handed to the user. `zones` are the level's rooms as
 * the pass leaves them, `plates` its floor plates, `current` a node as the pass has it so far;
 * `previousNodes` (the scene before the edit) tells a deleted part from one never made.
 */
export function reconcilePorchFraming({
  levelId,
  nodes,
  previousNodes,
  zones,
  plates,
  current,
  mintId,
}: {
  levelId: string
  nodes: Nodes
  previousNodes?: Nodes
  zones: readonly ZoneNode[]
  plates: readonly SlabNode[]
  current: (id: string) => AnyNode | undefined
  mintId: (kind: 'column' | 'beam') => string
}): { put: AnyNode[]; delete: AnyNodeId[] } {
  const put: AnyNode[] = []
  const remove: AnyNodeId[] = []
  const owned = new Map<string, PorchPart[]>()
  for (const node of Object.values(nodes)) {
    const part = porchPartOf(node)
    if (!part || node.parentId !== levelId) continue
    const latest = (current(node.id) ?? node) as PorchPart
    owned.set(part.porchOf, [...(owned.get(part.porchOf) ?? []), latest])
  }
  const zonesById = new Map(zones.map((zone) => [zone.id, zone]))
  // A porch gone, or no longer a covered one: what it made goes with it; a part edited by hand
  // stays, the user's own. A deck's or patio's switched off goes whole, edited or not.
  for (const [zoneId, parts] of owned) {
    const zone = zonesById.get(zoneId as ZoneNode['id'])
    if (framedPorch(zone) || zone?.porchFraming?.auto === false) continue
    const switchedOff = !!zone && coverOptional(zone) && zone.porchFraming?.auto === undefined
    for (const part of parts) {
      if (switchedOff || !edited(part)) remove.push(part.id)
      else {
        const {
          porchOf: _porchOf,
          porchPart: _porchPart,
          porchSeed: _seed,
          ...metadata
        } = part.metadata as PorchPartMetadata & Record<string, unknown>
        put.push({ ...part, metadata } as AnyNode)
      }
    }
  }
  for (const zone of zones) {
    if (!framedPorch(zone)) continue
    const parts = owned.get(zone.id) ?? []
    const before = previousNodes?.[zone.id]
    const settingsChanged =
      before?.type !== 'zone' ||
      before.roomType !== zone.roomType ||
      JSON.stringify(before.porchFraming ?? null) !== JSON.stringify(zone.porchFraming ?? null)
    const plan = planPorchFraming(zone, nodes)
    if (!settingsChanged) {
      // A part of the plan gone since the edit before: deleted by hand. (One the plan dropped
      // went with an earlier pass.)
      const planned = new Set([...plan.posts, ...plan.beams].map((part) => part.key))
      const deleted = Object.values(previousNodes ?? {}).some((node) => {
        const part = porchPartOf(node)
        return part?.porchOf === zone.id && planned.has(part.porchPart) && !nodes[node.id]
      })
      if (deleted || parts.some(edited)) {
        put.push({ ...zone, porchFraming: { ...zone.porchFraming, auto: false } })
        continue
      }
    }
    const built = buildParts(
      zone,
      plan,
      // Settings changed: what a hand made goes too; the porch is rebuilt from its settings.
      parts,
      porchPlate(zone, plates),
      levelId,
      nodes,
      mintId,
    )
    const kept = new Set(built.map((part) => part.id))
    for (const part of parts) if (!kept.has(part.id)) remove.push(part.id)
    put.push(...built)
  }
  return { put, delete: remove }
}
