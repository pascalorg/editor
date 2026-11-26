import {
  defaultTreeSpread,
  hash3,
  resolveTreeParameters,
  TREE_FAR_MAX_TRIANGLES,
  TREE_HABITS,
  TREE_MAX_TRIANGLES,
  type TreeEstimate,
  type TreeInput,
  type TreeMesh,
  type TreeParameters,
  type TreeSkeleton,
} from '@pascal-app/core'
import { foliagePalette } from '../shared/foliage'
import { treeSkeleton, treeStemCount } from './branches'
import { finishTreeMesh, treeWriter, writeTreeBranch, writeTreeSprigs } from './mesh-writer'

/** Counts use only numbers, never a skeleton or attribute arrays. */
export function estimateTree(input: TreeInput): TreeEstimate {
  const stems = treeStemCount(input)
  const boughs = stems * TREE_HABITS[input.form].scaffolds
  const pine = input.form === 'conifer'
  const woodTriangles =
    stems * (144 + (pine ? 13 : 6) * 12) + boughs * (pine ? 24 + 6 * 12 : 72 + 4 * (24 + 3 * 12))
  const farWood = stems * 36 + (pine ? boughs / 2 : boughs) * 6
  const wanted = Math.round((2740 + input.heightM * 85) * input.density)
  const leaves = Math.min(wanted, Math.floor((TREE_MAX_TRIANGLES - woodTriangles) / 2))
  const farCards = Math.round(input.density * (TREE_FAR_MAX_TRIANGLES - farWood))
  return {
    triangles: woodTriangles + leaves * 2,
    farTriangles: farWood + farCards,
    woodTriangles,
    leaves,
  }
}

/** Use the same wood to size both levels, including in winter. The apical leader
 * of a conifer already marks its full height. Other shoots need room for their leaves. */
function crownScale(tree: TreeSkeleton, input: TreeParameters, requestedSpread: number) {
  const reaches: number[] = []
  let top = 0
  for (const shoot of tree.shoots)
    for (const point of [shoot.start, shoot.end]) {
      reaches.push(Math.sqrt(point[0] * point[0] + point[2] * point[2]))
      top = Math.max(top, point[1])
    }
  const length = 0.044 * input.heightM + 0.018 * input.spreadM
  // A single unusually long twig should not shrink the rest of the crown.
  reaches.sort((a, b) => a - b)
  const outer = reaches[Math.floor(0.92 * (reaches.length - 1))] as number
  const horizontal = requestedSpread / (2 * (outer + length * 0.66))
  const vertical = input.heightM / (top + (input.form === 'conifer' ? 0 : length * 0.61))
  return { horizontal, vertical }
}

function fitTree(mesh: TreeMesh, input: TreeParameters, horizontal: number, vertical: number) {
  const radius = input.spreadM / 2
  const wood = mesh.barkUV.length / 2
  for (let i = 0; i < mesh.position.length; i += 3) {
    let x = (mesh.position[i] as number) * horizontal
    let y = (mesh.position[i + 1] as number) * vertical
    let z = (mesh.position[i + 2] as number) * horizontal
    // Ease long twigs into the nominal ground-plan disc with a continuous tangent.
    const r = Math.sqrt(x * x + z * z)
    const shoulder = 0.84 * radius
    if (r > shoulder) {
      const tail = radius - shoulder
      const scale = (shoulder + (tail * (r - shoulder)) / (tail + r - shoulder)) / r
      x *= scale
      z *= scale
    }
    if (i >= wood * 3) {
      y = Math.max(0.015 * input.heightM, Math.min(input.heightM, y))
    }
    mesh.position[i] = x
    mesh.position[i + 1] = y
    mesh.position[i + 2] = z
    const nx = (mesh.normal[i] as number) / horizontal,
      ny = (mesh.normal[i + 1] as number) / vertical,
      nz = (mesh.normal[i + 2] as number) / horizontal
    const d = Math.sqrt(nx * nx + ny * ny + nz * nz)
    mesh.normal[i] = nx / d
    mesh.normal[i + 1] = ny / d
    mesh.normal[i + 2] = nz / d
  }
  return mesh
}

/** Root-local metres and linear RGB. Both levels sample the same terminal wood. */
export function buildTree(rawInput: TreeInput) {
  const requested = resolveTreeParameters(rawInput)
  const input = { ...requested, spreadM: defaultTreeSpread(requested.form, requested.heightM) }
  const estimate = estimateTree(input)
  const skeleton = treeSkeleton(input)
  const pine = input.form === 'conifer'
  const farWood = skeleton.trunks.length * 36 + skeleton.scaffolds.length * (pine ? 3 : 6)
  const farCards = estimate.farTriangles - farWood
  const near = treeWriter(estimate.triangles, estimate.leaves, 4)
  const far = treeWriter(estimate.farTriangles, farCards, 3)
  for (const trunk of skeleton.trunks) {
    writeTreeBranch(near, trunk)
    writeTreeBranch(far, trunk, true)
  }
  for (const [i, bough] of skeleton.scaffolds.entries()) {
    writeTreeBranch(near, bough)
    if (!pine || i % 2 === 0) writeTreeBranch(far, bough, true)
  }
  for (const branch of skeleton.branches) writeTreeBranch(near, branch)
  const palette = foliagePalette(input.foliage)
  // Vigorous terminal shoots carry more growth. The same weights preserve gaps
  // at the far level, and cumulative integer quotas spend exactly the estimate.
  const buds = skeleton.shoots.map((shoot) => {
    const vigor = hash3(shoot.seed, 7, 3, 1)
    return pine ? 8 + Math.floor(21 * vigor) : 1 + Math.floor(60 * vigor ** 3)
  })
  const total = buds.reduce((sum, count) => sum + count, 0)
  let cumulative = 0
  for (const [i, shoot] of skeleton.shoots.entries()) {
    cumulative += buds[i] as number
    const nearCount = Math.floor((cumulative * estimate.leaves) / total) - near.cards
    const farCount = Math.floor((cumulative * farCards) / total) - far.cards
    writeTreeSprigs(near, shoot, input, palette, nearCount)
    writeTreeSprigs(far, shoot, input, palette, farCount)
  }
  const { horizontal, vertical } = crownScale(skeleton, input, requested.spreadM)
  return {
    near: fitTree(finishTreeMesh(near), requested, horizontal, vertical),
    far: fitTree(finishTreeMesh(far), requested, horizontal, vertical),
    estimate,
  }
}
