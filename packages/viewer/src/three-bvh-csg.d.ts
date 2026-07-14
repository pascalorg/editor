/**
 * `three-bvh-csg@0.0.18` ships an `Evaluator.consolidateGroups` flag at
 * runtime (see `build/index.module.js`) but omits it from its type
 * declarations, which only expose `consolidateMaterials`. Declaring it
 * here lets callers set the flag without an escape-hatch cast.
 */
declare module 'three-bvh-csg' {
  interface Evaluator {
    consolidateGroups: boolean
  }
}

export {}
