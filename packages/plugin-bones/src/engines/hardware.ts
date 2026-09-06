/**
 * Simpson Strong-Tie hardware the plans call out (W9). The IRC names no
 * manufacturer — it asks for the connection (R802.11 uplift, R507.9 deck
 * ledgers, R403.1.6 anchorage, R602.10.6.4 portal straps) — but a permit
 * set prints a part, so every steel member Bones emits carries the model a
 * builder would order, "or equal", with the catalog fastening for that
 * part. Models here are the common catalog parts for the member sizes the
 * engines use; anything sized outside the table says "verify".
 *
 *   - face-mount joist hangers by joist size (LUS single 2x, LUS-2 double
 *     2x, HUS for 2x12) — floor joists at girders / headers, deck joists at
 *     the ledger and flush beam, porch rafters at the roof ledger;
 *   - H2.5A rafter-to-plate ties (roof-framing `tieAt`);
 *   - ABU post bases at every post that stands on concrete (deck and
 *     porch posts, crawl-space girder posts on their pads) — ZMAX for
 *     pressure-treated lumber (AWPA UC4A contact);
 *   - AC post caps at a dropped beam on posts;
 *   - HDU hold-downs at braced-wall ends (seismic), BPS bearing plates for
 *     the R602.11.1 plate washers, CS16 coil strap for the portal frame.
 */
import type { LumberSize } from '../lumber'

export interface HardwarePart {
  /** Catalog model, e.g. "LUS28". */
  model: string
  /** What it is, for labels and the takeoff item column. */
  name: string
  /** Catalog fastening for the part, as the schedule prints it. */
  fastening: string
  /** True when the size fell outside the table and a designer must confirm the part. */
  verify?: boolean
}

const JOIST_HANGERS: Partial<Record<LumberSize, string>> = {
  '2x4': 'LUS24',
  '2x6': 'LUS26',
  '2x8': 'LUS28',
  '2x10': 'LUS210',
  '2x12': 'HUS212',
}

const DOUBLE_HANGERS: Partial<Record<LumberSize, string>> = {
  '2x6': 'LUS26-2',
  '2x8': 'LUS28-2',
  '2x10': 'LUS210-2',
  '2x12': 'HUS212-2',
}

/** Face-mount hanger for a joist / rafter of `size` (single or doubled). */
export function hangerFor(size: LumberSize | undefined, double = false): HardwarePart {
  const table = double ? DOUBLE_HANGERS : JOIST_HANGERS
  const model = size ? table[size] : undefined
  if (!model) {
    return {
      model: double ? 'LUS-2 series' : 'LUS series',
      name: 'face-mount joist hanger',
      fastening: 'nailing per the Simpson catalog for the part',
      verify: true,
    }
  }
  const heavy = model.startsWith('HUS')
  return {
    model,
    name: 'face-mount joist hanger',
    fastening: heavy
      ? '16d common to the header and to the joist per the HUS table (double-shear nailing)'
      : '10d common to the header, 10d×1½" to the joist (double-shear nailing)',
  }
}

/** Rafter / truss to top plate uplift tie (roof-framing tieAt). */
export const HURRICANE_TIE: HardwarePart = {
  model: 'H2.5A',
  name: 'hurricane tie',
  fastening: '(5) 8d×1½" to the rafter + (5) 8d×1½" to the double top plate',
}

/** Post base for a post standing on concrete — ZMAX for PT posts. */
export function postBaseFor(post: LumberSize | undefined, treated = true): HardwarePart {
  const z = treated ? 'Z' : ''
  if (post === '4x4')
    return {
      model: `ABU44${z}`,
      name: 'post base',
      fastening:
        '5/8" anchor bolt into the pad, (12) 16d to the post; 1" standoff above the concrete',
    }
  if (post === '4x6')
    return {
      model: `ABU46${z}`,
      name: 'post base',
      fastening: '5/8" anchor bolt into the pad, 16d to the post per the catalog; 1" standoff',
    }
  if (post === '6x6')
    return {
      model: `ABU66${z}`,
      name: 'post base',
      fastening: '5/8" anchor bolt into the pad, (12) 16d to the post; 1" standoff',
    }
  return {
    model: 'ABU series',
    name: 'post base',
    fastening: 'per the Simpson catalog for the post size',
    verify: true,
  }
}

/** Post cap for a dropped beam bearing on a post. */
export function postCapFor(post: LumberSize | undefined, treated = true): HardwarePart {
  const z = treated ? 'Z' : ''
  if (post === '4x4')
    return {
      model: `AC4${z}`,
      name: 'post cap',
      fastening:
        '(6) 16d to the post + (6) 16d to the beam per side; a doubled 2x beam narrower than the post: verify the fit',
    }
  if (post === '6x6')
    return {
      model: `AC6${z}`,
      name: 'post cap',
      fastening: '(6) 16d to the post + (6) 16d to the beam per side',
    }
  return {
    model: 'AC series',
    name: 'post cap',
    fastening: 'per the Simpson catalog for the post size',
    verify: true,
  }
}

/** Seismic hold-down at a braced-wall end (foundation). */
export const HOLD_DOWN: HardwarePart = {
  model: 'HDU2-SDS2.5',
  name: 'hold-down',
  fastening:
    '(6) SDS ¼"×2½" screws to the end post, 5/8" anchor bolt into the foundation — sized per the lateral design (HDU4 / HDU5 where the engineer calls it)',
}

/** The R602.11.1 plate washer as a Simpson bearing plate. */
export const PLATE_WASHER: HardwarePart = {
  model: 'BPS 5/8-3',
  name: 'bearing plate washer',
  fastening: 'on the 5/8" anchor bolt over the sill, 3"×3"×0.229" (R602.11.1)',
}

/** The CS-PF portal frame's 1000-lb header-to-jack strap. */
export const PORTAL_STRAP: HardwarePart = {
  model: 'CS16',
  name: 'coil strap',
  fastening: '16-ga coil strap, (10) 10d each end min. — 1,000 lb header-to-jack (R602.10.6.4)',
}

/** Framing angle at full-depth blocking to the plate (the eave shear transfer). */
export const FRAMING_ANGLE: HardwarePart = {
  model: 'A35',
  name: 'framing angle',
  fastening: '(12) 8d×1½" total, bent per the catalog',
}

/** `Simpson LUS28 (or equal) — …`: the label form every engine prints. */
export function partLabel(part: HardwarePart, purpose: string): string {
  return `Simpson ${part.model} (or equal) ${part.name} — ${purpose}; ${part.fastening}${part.verify ? ' — VERIFY the part for this size' : ''}`
}

/** The model in a label written by `partLabel`, or null. */
export function modelOf(label: string | undefined): string | null {
  const m = /Simpson (\S+) \(or equal\)/.exec(label ?? '')
  return m ? (m[1] as string) : null
}
