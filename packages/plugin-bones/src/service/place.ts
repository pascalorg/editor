import {
  extractPlacedFixtures,
  extractRooms,
  extractWalls,
} from '../core/wall-model'
import { probeSlabsFor } from '../framing/compute'
import { placeElectricMeterSpot, placePanelSpot } from '../engines/electrical'
import { placeCondenserSeedSpot, placeThermostatSpot } from '../engines/hvac'
import { placeMeterSpot, placeSewerExit, placeWhSpot } from '../engines/plumbing'
import { SERVICE_TYPES, ServiceNode, type ServiceType } from './schema'

/**
 * DISTINCT service types present on `levelId` (VISIBLE nodes only, unknown
 * types ignored) — duplicates of one type count once. Drives both the
 * idempotent skip below and the panel's "Place service points" badge/disable
 * (a raw node count over-reports when a type is duplicated and under-offers
 * the button while types are still missing).
 */
export function placedServiceTypes(
  nodes: Record<string, Record<string, unknown>>,
  levelId: string,
): Set<ServiceType> {
  const out = new Set<ServiceType>()
  for (const node of Object.values(nodes)) {
    if (node.type !== 'bones:service' || node.parentId !== levelId) continue
    if (node.visible === false) continue
    const t = String(node.serviceType) as ServiceType
    if ((SERVICE_TYPES as readonly string[]).includes(t)) out.add(t)
  }
  return out
}

/**
 * The "Place service points" panel action, as a pure function: build the
 * `bones:service` nodes to create on `levelId` — one per type, seeded at the
 * ENGINES' current auto positions (panelMountU garage rule, plumbing's
 * meter/WH/sewer-exit spots, hvac's thermostat/heat-pump spots, the electric
 * meter beside the panel), so nothing moves until the user drags one.
 * Idempotent: types that already have a node on this level are skipped.
 */
export function buildServicePointNodes(
  nodes: Record<string, Record<string, unknown>>,
  levelId: string,
): ServiceNode[] {
  const existing: Set<string> = placedServiceTypes(nodes, levelId)

  // The COMPUTE probe, not this level's own slabs: seeding must classify
  // walls exactly like the engines (widened storey-below probe + gated
  // attic rule), or on a slab-less gable storey the seeded meter lands on
  // a different wall than the engine's auto spot and creation alone moves
  // it — an A4 contract break (verify round 2026-08-16, F3).
  const { probeSlabs, hasLowerStorey } = probeSlabsFor(nodes, levelId)
  const walls = extractWalls(nodes, levelId, probeSlabs, hasLowerStorey)
  const rooms = extractRooms(nodes, levelId)
  const placed = extractPlacedFixtures(nodes, levelId)

  const out: ServiceNode[] = []
  const wallPoint = (
    serviceType: ServiceType,
    spot: { wall: { id: string; length: number }; u: number; heightAff: number } | null,
  ) => {
    if (existing.has(serviceType) || !spot || spot.wall.length <= 0) return
    out.push(
      ServiceNode.parse({
        serviceType,
        wallId: spot.wall.id,
        wallT: Math.max(0, Math.min(1, spot.u / spot.wall.length)),
        heightAff: spot.heightAff,
      }),
    )
  }

  const panelSpot = placePanelSpot(walls, rooms)
  wallPoint('panel', panelSpot)
  // Power entry: the service drop lands at the panel's wall bay, near the
  // top of the wall (weatherhead height) — routing to it is a later task.
  wallPoint(
    'power-entry',
    panelSpot
      ? { ...panelSpot, heightAff: Math.max(0.5, panelSpot.wall.height - 0.3) }
      : null,
  )
  wallPoint('water-heater', placeWhSpot(walls, rooms))
  wallPoint('water-entry', placeMeterSpot(walls))
  // Electric meter: the exterior face nearest the panel (street→meter→panel).
  wallPoint('electric-meter', placeElectricMeterSpot(walls, rooms))
  // Thermostat: interior wall face near the hvac return, 52" AFF.
  wallPoint('thermostat', placeThermostatSpot(walls, rooms))

  if (!existing.has('sewer-exit')) {
    const exit = placeSewerExit(walls, rooms, placed)
    if (exit) {
      out.push(ServiceNode.parse({ serviceType: 'sewer-exit', position: [exit[0], 0, exit[1]] }))
    }
  }

  // Heat pump: floor-placed pad outside the wall nearest the air handler
  // (condenserStandoff: t/2 + 24" face clearance + cabinet depth/2) —
  // `position` is the anchor (like the sewer exit), so the node stands
  // free and the lineset re-anchors wherever it's dragged.
  if (!existing.has('heat-pump')) {
    // Coverage rides along (A4 parity with the engine's own election): a
    // seed elected without it could validate a spot the engine rejects.
    const pad = placeCondenserSeedSpot(walls, rooms, probeSlabs)
    if (pad) {
      out.push(ServiceNode.parse({ serviceType: 'heat-pump', position: [pad[0], 0, pad[1]] }))
    }
  }

  return out
}

/**
 * ONE-SHOT service seeding plan for a level whose X-ray already exists but
 * predates automatic service points (user round 2026-08-20: "service points
 * should be placed automatically") — the auto-heal the FramingRenderer's
 * reconcile batch applies. The framing node's `servicesSeeded` latch makes
 * it run at most once per level, so a user DELETING a service point is
 * respected forever after:
 *
 *  - latch already set → nothing (the deleted-node no-resurrection contract);
 *  - level already carries ANY service node → ADOPT it: set the latch, create
 *    nothing (a pre-existing manual placement, possibly with deliberate
 *    deletions, is the user's arrangement — we never fill the gaps);
 *  - no service nodes yet → seed every type at the engines' auto spots and
 *    set the latch IN THE SAME batch;
 *  - nothing placeable yet (no walls) → no creates AND no latch, so the seed
 *    retries when the level grows geometry.
 */
export function planServiceSeeding(
  nodes: Record<string, Record<string, unknown>>,
  levelId: string,
  framing: { id: string; servicesSeeded?: unknown },
): { create: ServiceNode[]; update: { id: string; data: Record<string, unknown> }[] } {
  if (framing.servicesSeeded === true) return { create: [], update: [] }
  if (placedServiceTypes(nodes, levelId).size > 0) {
    return { create: [], update: [{ id: framing.id, data: { servicesSeeded: true } }] }
  }
  const create = buildServicePointNodes(nodes, levelId)
  if (create.length === 0) return { create: [], update: [] }
  return { create, update: [{ id: framing.id, data: { servicesSeeded: true } }] }
}
