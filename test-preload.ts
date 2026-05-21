import { mock } from 'bun:test'

// three-mesh-bvh@0.9.9's UMD bundle has a class-initialization-order bug:
// `class ObjectBVH extends threeMeshBvh.BVH` fires before `BVH` is exported.
// This manifests when three-bvh-csg loads three-mesh-bvh via CJS `require`,
// which happens transitively when any test imports @pascal-app/viewer (e.g.
// packages/nodes shelf geometry tests). No test exercises CSG at runtime;
// the mock prevents the crash without losing coverage.
mock.module('three-bvh-csg', () => ({
  ADDITION: 0,
  SUBTRACTION: 1,
  REVERSE_SUBTRACTION: 2,
  Brush: class Brush {},
  Evaluator: class Evaluator {
    evaluate() {}
    dispose() {}
  },
  OperationGroup: class OperationGroup {},
}))
