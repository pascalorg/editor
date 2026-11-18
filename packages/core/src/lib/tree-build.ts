import { treePrimaryCount, treeSkeleton, treeStemCount } from './tree-branches'
import { TREE_MAX_TRIANGLES, type TreeEstimate, type TreeParameters } from './tree-form'
import {
  finishTreeMesh,
  treeWriter,
  writeTreeBranch,
  writeTreeCrown,
  writeTreeLeaves,
} from './tree-mesh'

/** Counts use only numbers, never a skeleton or attribute arrays. Detail is thinned uniformly. */
export function estimateTree(input: TreeParameters): TreeEstimate {
  const primaries = treePrimaryCount(input)
  const woodTriangles = treeStemCount(input) * 80 + primaries * (48 + 3 * (30 + 2 * 12 + 4 * 6))
  const wanted = Math.round((4900 + input.heightM * 200) * input.density)
  const leaves = Math.max(0, Math.min(wanted, Math.floor((TREE_MAX_TRIANGLES - woodTriangles) / 2)))
  return {
    triangles: woodTriangles + leaves * 2,
    farTriangles: treeStemCount(input) * 16 + (input.density >= 0.3 ? primaries * 24 : 0),
    woodTriangles,
    leaves,
  }
}

/** Root-local metres and linear RGB; one ordinary mesh per level, with caller-owned arrays. */
export function buildTree(input: TreeParameters) {
  const estimate = estimateTree(input)
  const skeleton = treeSkeleton(input)
  const near = treeWriter(estimate.triangles)
  const far = treeWriter(estimate.farTriangles)
  for (const trunk of skeleton.trunks) {
    writeTreeBranch(near, trunk)
    writeTreeBranch(far, trunk, true)
  }
  for (const branch of skeleton.branches) writeTreeBranch(near, branch)
  if (input.density >= 0.3)
    for (const crown of skeleton.crowns) writeTreeCrown(far, crown, input.foliage)
  const count = skeleton.clusters.length
  for (let i = 0; i < count; i++) {
    const cluster = skeleton.clusters[i]
    if (cluster)
      writeTreeLeaves(
        near,
        cluster,
        input,
        Math.floor(((i + 1) * estimate.leaves) / count) - Math.floor((i * estimate.leaves) / count),
      )
  }
  return { near: finishTreeMesh(near), far: finishTreeMesh(far), estimate }
}
