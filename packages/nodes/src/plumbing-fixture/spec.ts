import type { PlumbingFixtureNode } from './schema'

/**
 * Per-fixture facts the geometry, ports, and (later) IPC validators
 * read. DFU values follow IPC Table 709.1 (private installations);
 * drain sizes are the standard residential rough-ins.
 */
export type FixtureSpec = {
  label: string
  /** Cabinet/body footprint + height in meters: [width, height, depth]. */
  size: [number, number, number]
  /** Drain rough-in point in the fixture's LOCAL frame (y ≈ floor). */
  drainLocal: [number, number, number]
  /** Drain size in inches. */
  drainIn: number
  /** IPC drainage fixture units. */
  dfu: number
}

export const FIXTURE_SPECS: Record<PlumbingFixtureNode['fixtureType'], FixtureSpec> = {
  toilet: {
    label: 'Toilet',
    size: [0.4, 0.78, 0.7],
    drainLocal: [0, 0.02, 0.05],
    drainIn: 3,
    dfu: 3,
  },
  lavatory: {
    label: 'Lavatory',
    size: [0.5, 0.82, 0.45],
    drainLocal: [0, 0.02, -0.12],
    drainIn: 1.25,
    dfu: 1,
  },
  'kitchen-sink': {
    label: 'Kitchen sink',
    size: [0.6, 0.9, 0.55],
    drainLocal: [0, 0.02, -0.18],
    drainIn: 1.5,
    dfu: 2,
  },
  tub: {
    label: 'Tub / shower',
    size: [1.5, 0.5, 0.75],
    drainLocal: [-0.55, 0.02, 0],
    drainIn: 1.5,
    dfu: 2,
  },
  washer: {
    label: 'Washer',
    size: [0.6, 0.85, 0.6],
    drainLocal: [0, 0.02, -0.22],
    drainIn: 2,
    dfu: 2,
  },
}
