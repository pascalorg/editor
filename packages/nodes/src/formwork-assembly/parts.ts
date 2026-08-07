import {
  applyPartOverrides,
  type FormworkPart,
  type FormworkPartSpec,
  partMark,
} from '@pascal-app/core/formwork'
import type { Group, Mesh } from 'three'
import type { FormworkAssemblyNode } from './schema'

/**
 * How a builder emits a part and its mesh together.
 *
 * The single enumeration is the whole point. A parts table written beside the
 * builders — walking the same catalog and repeating the same placement loops — is a
 * second enumeration, and two enumerations of the same shutter disagree the first
 * time one of them is edited: the BOM orders five panels for a run the model draws
 * six on, and neither side is obviously wrong. `design.ts` exists for exactly this
 * reason on the structural side ("Solving it twice — once per surface, off two
 * argument lists — is how a drawing and a panel come to disagree about the tie
 * spacing of the same wall"), and the parts list is the same hazard one layer down.
 *
 * So a builder does not return geometry and then get counted. It calls `emit` once
 * per part, with the spec and the mesh that draws it, and the collector produces
 * both: the group goes on screen and the marked list goes to the table, the BOM and
 * the inspector. A part with no mesh — a consumable, a hire item — passes none; a
 * mesh with no part goes through `add`, which is for the members that genuinely are
 * not shutter parts.
 *
 * Marks land on `mesh.userData.formworkPartMark` rather than in `mesh.name`. The
 * names are the existing part taxonomy — `panel-front-c0-2`, `tie-7`,
 * `corner-inside-a-start-owned-0-front` — and they are what a reader of the scene
 * graph already recognises. A mark is an additional identity, not a rename.
 */

export interface PartCollector {
  /** Adds a part, and the mesh that draws it where it has one. Returns the mark. */
  emit: (spec: FormworkPartSpec, mesh?: Mesh) => string
  /**
   * Adds another mesh drawing a part already emitted. One part is not always one
   * box: a panel crossed by a window is drawn as a band under the sill and a band
   * over the head, and it is still one panel off the rack. Both bands carry the one
   * mark, so clicking either selects the panel and the BOM counts it once.
   */
  tag: (mark: string, mesh: Mesh) => void
  /** Adds a mesh that is not a shutter part — a scaffold tube, an access platform. */
  add: (mesh: Mesh) => void
  /** The group and the marked parts, overrides applied. */
  finish: () => BuiltFormwork
}

export interface BuiltFormwork {
  group: Group
  /** Every part of this shutter, marked, with the assembly's overrides applied. */
  parts: FormworkPart[]
}

/**
 * A collector writing into `group`.
 *
 * Overrides are applied at the end rather than per part, because an override can
 * change a part's provenance and the parts list is what carries that — see
 * `applyPartOverrides`. An omitted part keeps its mesh: the geometry is what the crew
 * is looking at, and a panel that vanishes from the model when somebody ticks "omit"
 * in a table reads as a bug rather than as their own edit. The list carries the flag
 * and the table shows it struck out.
 */
export function collectParts(group: Group, node: FormworkAssemblyNode): PartCollector {
  const parts: FormworkPart[] = []
  return {
    emit(spec, mesh) {
      const mark = partMark(spec)
      parts.push({ ...spec, mark })
      if (mesh) {
        mesh.userData.formworkPartMark = mark
        group.add(mesh)
      }
      return mark
    },
    tag(mark, mesh) {
      mesh.userData.formworkPartMark = mark
      group.add(mesh)
    },
    add(mesh) {
      group.add(mesh)
    },
    finish() {
      return { group, parts: applyPartOverrides(parts, node.partOverrides) }
    },
  }
}
