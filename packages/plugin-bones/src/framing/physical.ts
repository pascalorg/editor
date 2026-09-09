/**
 * THE HOUSE AS BUILT — what the finished (Normal) view shows of what Bones
 * derives, and what the elevations draw of it.
 *
 * Bones derives everything from the model and persists nothing; the X-ray
 * views draw all of it. The finished house shows only the PHYSICAL part a
 * real house shows: the equipment standing outside the walls and on their
 * faces — the water heater with its enclosure and pad, the condenser on its
 * pad, the meter socket, the service mast, weatherhead, pole and drop, the
 * water entry, the outlet and switch plates, the lights, alarms, registers,
 * the panel door, the thermostat. Framing, wiring and piping stay inside the
 * walls where they are (Steve, 2026-09-09: "when i go back to normal view
 * the water heater is in the wall and things are missing ... the normal view
 * is what goes to sheets, for elevations so the actual hvac and wh and
 * meters and things are shown").
 *
 * ONE definition: `isPhysicalMember` drives the renderer's Normal view AND
 * plugin-sheets' elevation items, so the paper shows what the screen shows.
 * Pure — no React, no stores.
 */
import type { Fixture, Member } from '../core/types'

/** Members standing in the finished house: equipment, never framing, wiring or piping in the walls. */
export function isPhysicalMember(m: Member): boolean {
  // the water heater and everything that stands with it (tank, head, stand,
  // pad, pan, enclosure, T&P valve and discharge, expansion tank, flue)
  if (m.role === 'water-heater') return true
  if (m.sourceId === 'wh' || m.sourceId.startsWith('wh-'))
    return m.sourceId !== 'wh-condensate' || m.position[1] > 0
  // the service entrance outside the wall: the mast, the weatherhead, the
  // pole, the pad transformer and the overhead drop — never the feed in
  // the wall, never the lateral under the ground
  if (m.sourceId === 'service-entrance') {
    if (m.role === 'wire-run') return /^Service drop/.test(m.label ?? '')
    return m.position[1] - m.dims[1] / 2 > -0.3
  }
  // the HVAC equipment: the condenser and its pad, the disconnect, the air handler
  if (m.system === 'hvac' && m.role === 'equipment') return true
  // the water service at the property line: the meter box; the buried line stays buried
  if (m.sourceId === 'water-service')
    return m.role === 'equipment' && m.position[1] - m.dims[1] / 2 > -0.3
  return false
}

/** The finished-house paint of a physical member (the X-ray paints by material). */
export function finishColorOf(m: Member): string {
  if (m.sourceId === 'wh' || m.sourceId === 'wh-head') return '#e9ebed' // white enamel
  if (m.sourceId.startsWith('wh-enclosure')) return '#cdd3d8' // painted steel cabinet
  if (m.sourceId === 'wh-pad' || m.sourceId === 'wh-stand')
    return m.material === 'concrete' ? '#9aa0a5' : '#b89a72'
  if (m.sourceId === 'wh-pan') return '#b7bcc4'
  if (m.sourceId.startsWith('wh-')) return '#8f959c' // valves, tanks, pipes
  if (m.sourceId === 'service-entrance') {
    if (m.role === 'post') return '#7a5c3a' // the pole
    if (m.role === 'wire-run') return '#2b2b2b' // the drop
    return '#6f7378' // mast, weatherhead, pad transformer
  }
  if (m.system === 'hvac') return m.material === 'concrete' ? '#9aa0a5' : '#b9bec4'
  if (m.sourceId === 'water-service') return '#8a8f96'
  return '#b0b5bb'
}

/**
 * The finished face of a fixture: outlet and switch cover plates, a light
 * puck, the alarms, the thermostat, the panel door, the meter socket, the
 * water entry — sized as the real thing, painted as the real thing, not the
 * circuit colours of the X-ray.
 */
export function finishFixtureBox(f: Fixture): { dims: [number, number, number]; color: string } {
  switch (f.kind) {
    case 'receptacle':
    case 'receptacle-gfci':
    case 'switch':
      return { dims: [0.07, 0.115, 0.008], color: '#efe9dc' } // a duplex / decora cover plate
    case 'receptacle-wr-gfci':
      return { dims: [0.09, 0.15, 0.06], color: '#c8ccd0' } // the in-use bubble cover
    case 'light':
      return { dims: [0.2, 0.03, 0.2], color: '#f4f1ea' }
    case 'smoke-alarm':
    case 'co-alarm':
      return { dims: [0.14, 0.03, 0.14], color: '#f7f7f5' }
    case 'thermostat':
      return { dims: [0.09, 0.12, 0.03], color: '#f2f2f0' }
    case 'panel':
      return { dims: [0.3556, 0.762, 0.025], color: '#8f8f8f' } // the door face, 14 × 30
    case 'electric-meter':
      return { dims: [0.3, 0.4, 0.12], color: '#8e949b' } // the socket; the glass dome is pushed beside it
    case 'water-meter':
      return { dims: [0.2, 0.2, 0.14], color: '#5b6b7a' }
    case 'disconnect':
      return { dims: [0.2, 0.3, 0.1], color: '#8e949b' }
    case 'register':
    case 'return':
      return { dims: [0.3, 0.02, 0.12], color: '#f0efe9' }
    case 'exhaust-fan':
      return { dims: [0.3, 0.03, 0.3], color: '#f4f1ea' }
    default:
      return { dims: [0.0762, 0.1143, 0.0635], color: '#d9d9d6' }
  }
}

/** The meter's glass dome: a puck proud of the socket, along the socket's facing. */
export const METER_DOME = {
  dims: [0.15, 0.15, 0.06] as [number, number, number],
  color: '#dfe6ec',
  standoff: 0.09,
}
