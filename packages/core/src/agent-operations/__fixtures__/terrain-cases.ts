import { encodeTerrainField } from '../../lib/terrain-codec'
import { createTerrainField, heightAt } from '../../lib/terrain-field'
import { persistedTerrainFieldOf } from '../../lib/terrain-source-persisted'
import { type AnyNode, BuildingNode, LevelNode, SiteNode, SlabNode } from '../../schema'
import type { AgentToolCase, SceneGraph } from './cases'

/** y = x - 3 on a 9 × 9 field; the lot stays a spacing inside its border. */
export function terrainRampScene(scale = 1): SceneGraph {
  const field = createTerrainField({ cols: 9, rows: 9, spacing: 1, step: 0.01 })
  for (let row = 0; row < field.rows; row++)
    for (let col = 0; col < field.cols; col++)
      field.heights[row * field.cols + col] = (col - 3) * 100 * scale
  const site = SiteNode.parse({
    id: 'site_terrain',
    polygon: { type: 'polygon', points: [[1, 1], [5, 1], [5, 5], [1, 5]] },
    terrain: encodeTerrainField(field),
  })
  return { nodes: { [site.id]: site }, rootNodeIds: [site.id] }
}

/** A site nobody has shaped: no `terrain`, so its ground is the datum plane. */
function unshapedSiteScene(): SceneGraph {
  const site = SiteNode.parse({ id: 'site_empty' })
  return { nodes: { [site.id]: site }, rootNodeIds: [site.id] }
}

/** The ramp lot with a raised slab (top 1.6 m) over cols/rows 2..4 of the field. */
export function terrainHouseScene(): SceneGraph {
  const { nodes } = terrainRampScene()
  const site = nodes.site_terrain as SiteNode
  const building = BuildingNode.parse({
    id: 'building_house',
    parentId: site.id,
    children: ['level_house'],
  })
  const level = LevelNode.parse({
    id: 'level_house',
    parentId: building.id,
    level: 0,
    height: 3,
    children: ['slab_house'],
  })
  const slab = SlabNode.parse({
    id: 'slab_house',
    parentId: level.id,
    boundary: 'auto',
    polygon: [[2, 2], [4, 2], [4, 4], [2, 4]],
    elevation: 1.6,
  })
  return {
    nodes: {
      [site.id]: { ...site, children: [building.id] },
      [building.id]: building,
      [level.id]: level,
      [slab.id]: slab,
    },
    rootNodeIds: [site.id],
  }
}

export const TERRAIN_CASES: AgentToolCase[] = [
  {
    name: 'ramp relief and datum areas are sampled facts',
    tool: 'read_site_terrain', scene: terrainRampScene, input: { cellM: 1 },
    expect: { result: {
      hasTerrain: true, flat: false, datumM: 0, minM: -2, maxM: 2, reliefM: 4,
      slopeMeanDeg: 45, slopeMaxDeg: 45, areaAboveGradeM2: 8, areaBelowGradeM2: 8,
      sampling: { approximate: true, cellM: 1, spacingM: 1, heightStepM: 0.01 },
    } },
  },
  {
    name: 'line profile includes its endpoints',
    tool: 'sample_terrain_line', scene: terrainRampScene,
    input: { from: [1, 2], to: [5, 2], stepM: 2 },
    expect: { result: { points: [
      { x: 1, z: 2, yM: -2, slopeDeg: 45 },
      { x: 3, z: 2, yM: 0, slopeDeg: 45 },
      { x: 5, z: 2, yM: 2, slopeDeg: 45 },
    ] } },
  },
  {
    name: 'contours report the scene datum and resolution',
    tool: 'read_terrain_contours', scene: terrainRampScene, input: { intervalM: 1 },
    expect: { result: { datum: 0, sampling: { approximate: true, intervalM: 1, spacingM: 1 } },
      check: (result) => (result.lines as unknown[]).length ? [] : ['the ramp has no contours'] },
  },
  {
    name: 'the house slab reports relief, clearance and advisory guard edges',
    tool: 'describe_terrain_under_house', scene: terrainHouseScene, input: {},
    expect: { result: {
      levelId: 'level_house', slabId: 'slab_house', slabTopM: 1.6,
      highestM: 1, lowestM: -1, reliefM: 2,
      guardAdvisory: { advisory: true, thresholdM: 0.5 },
      sampling: { approximate: true, spacingM: 1, heightStepM: 0.01 },
    },
    check: (result) => {
      const guarded = result.needsGuardAt as unknown[]
      const clearance = result.clearanceUnderSlabM as number
      return [
        ...(guarded.length === 4 ? [] : [`${guarded.length} guard edges, not 4`]),
        ...(Math.abs(clearance - 0.6) < 1e-9 ? [] : [`clearance ${clearance}, not 0.6`]),
      ]
    } },
  },
  ...['read_site_terrain', 'sample_terrain_line', 'read_terrain_contours', 'describe_terrain_under_house'].map((tool): AgentToolCase => ({
    name: 'missing site is refused', tool, scene: () => ({ nodes: {}, rootNodeIds: [] }),
    input: tool === 'sample_terrain_line' ? { from: [1, 1], to: [2, 1] } : {},
    expect: { refusal: 'no_site' },
  })),
  ...['read_site_terrain', 'sample_terrain_line', 'read_terrain_contours'].map((tool): AgentToolCase => ({
    name: 'a site with no shaped ground answers with the flat datum, as facts', tool,
    scene: unshapedSiteScene,
    input: tool === 'sample_terrain_line' ? { from: [1, 1], to: [2, 1] } : {},
    expect: { result: {
      note: 'No relief is shaped on this site: the ground is the flat datum plane at y = 0. Relief is shaped with shape_site_terrain and carve_terrain_pad.',
      sampling: { approximate: true, method: 'flat_datum' },
    } },
  })),
  { name: 'a site with no shaped ground still needs a slab to describe the ground under',
    tool: 'describe_terrain_under_house', scene: unshapedSiteScene, input: {},
    expect: { refusal: 'footprint_empty' } },
  { name: 'empty footprint is refused', tool: 'read_site_terrain', scene: terrainRampScene,
    input: { footprint: [] }, expect: { refusal: 'footprint_empty' } },
  { name: 'outside footprint measures continuation rather than clamping', tool: 'read_site_terrain', scene: terrainRampScene,
    input: { footprint: [[7, 1], [9, 1], [9, 2], [7, 2]] },
    expect: { result: {}, check: (result) => (result.maxM as number) > 5 ? [] : ['the rising border slope was clamped'] } },
  { name: 'outside line follows continuation rather than clamping', tool: 'sample_terrain_line', scene: terrainRampScene,
    input: { from: [1, 2], to: [9, 2] },
    expect: { result: {}, check: (result) => {
      const points = result.points as { x: number; yM: number }[]
      const last = points.at(-1)
      return last?.x === 9 && last.yM > 5 ? [] : ['the continuation endpoint was lost or clamped']
    } } },
  { name: 'tiny cells exceed the sampling budget', tool: 'read_site_terrain', scene: terrainRampScene,
    input: { cellM: 0.00001 }, expect: { refusal: 'sampling_limit' } },
  { name: 'tiny line steps exceed the sampling budget', tool: 'sample_terrain_line', scene: terrainRampScene,
    input: { from: [1, 2], to: [5, 2], stepM: 0.00001 }, expect: { refusal: 'sampling_limit' } },
  { name: 'too many contours are refused, not reported absent', tool: 'read_terrain_contours', scene: terrainRampScene,
    input: { intervalM: 0.001 }, expect: { refusal: 'contour_limit' } },
]

const PAD = [[2, 2], [4, 2], [4, 4], [2, 4]]

function terrainWriteScene(): SceneGraph {
  const scene = terrainRampScene()
  const field = createTerrainField({ cols: 17, rows: 17, spacing: 0.5 })
  for (let row = 0; row < 17; row++)
    for (let col = 0; col < 17; col++) field.heights[row * 17 + col] = (col * 0.5 - 3) * 100
  const site = scene.nodes.site_terrain as SiteNode
  return { ...scene, nodes: { ...scene.nodes, [site.id]: { ...site, terrain: encodeTerrainField(field) } } }
}

function padSamplesAre(nodes: Readonly<Record<string, unknown>>, quantized: number): string[] {
  const site = nodes.site_terrain as SiteNode | undefined
  const field = site ? persistedTerrainFieldOf(site, nodes as Record<string, AnyNode>) : null
  if (!field) return ['no persisted field after the write']
  const wrong: string[] = []
  for (let z = 2; z <= 4; z += 0.5)
    for (let x = 2; x <= 4; x += 0.5)
      if (Math.round(heightAt(field, x, z) / field.step) !== quantized)
        wrong.push(`sample ${x},${z} is ${heightAt(field, x, z)} m, not ${quantized} units`)
  return wrong
}

export const TERRAIN_SHAPING_CASES: AgentToolCase[] = [
  {
    name: 'a pad is levelled at its height with cut and fill reported',
    tool: 'carve_terrain_pad', scene: terrainWriteScene,
    input: { pad: PAD, padHeightM: 0, blendM: 1 },
    expect: { result: { padHeightM: 0, padAreaM2: 4, sampling: { approximate: true, spacingM: 0.5 } },
      check: (result, nodes) => [
        ...padSamplesAre(nodes, 0),
        ...((result.cutVolumeM3 as number) > 0 && (result.fillVolumeM3 as number) > 0
          ? []
          : ['the ramp pad should both cut and fill']),
        ...(Math.abs((result.netM3 as number) - ((result.cutVolumeM3 as number) - (result.fillVolumeM3 as number))) < 1e-9
          ? []
          : ['net is not cut − fill']),
      ] },
  },
  {
    name: 'flatten sets the samples in a polygon to one height',
    tool: 'shape_site_terrain', scene: terrainWriteScene,
    input: { verb: 'flatten', area: PAD, heightM: 0.5 },
    expect: { result: { changedSamples: 20, beforeMinMaxM: { minM: -1, maxM: 1 }, afterMinMaxM: { minM: 0.5, maxM: 0.5 } },
      check: (_result, nodes) => padSamplesAre(nodes, 50) },
  },
  {
    name: 'raise over a circle moves only its samples',
    tool: 'shape_site_terrain', scene: terrainWriteScene,
    input: { verb: 'raise', area: { x: 3, z: 3, radiusM: 1 }, heightM: 0.5 },
    expect: { result: { changedSamples: 13 } },
  },
  {
    name: 'grading around a house pads it and cuts a batter to the ground behind it',
    tool: 'grade_around_house', scene: terrainWriteScene,
    input: { footprint: PAD, padHeightM: 0, marginM: 0.5, run: 2, reachM: 3 },
    expect: { result: { padHeightM: 0, marginM: 0.5, run: 2, sampling: { approximate: true, spacingM: 0.5 } },
      check: (result, nodes) => [
        ...padSamplesAre(nodes, 0),
        ...((result.cutVolumeM3 as number) > 0 ? [] : ['the rising ground behind the pad was not cut']),
        ...(Math.abs((result.netM3 as number) - ((result.cutVolumeM3 as number) - (result.fillVolumeM3 as number))) < 1e-9
          ? []
          : ['net is not cut − fill']),
      ] },
  },
  {
    name: 'an exact wall around a graded pad is one retaining terrain break written with the ground',
    tool: 'grade_around_house', scene: terrainWriteScene,
    input: { footprint: PAD, padHeightM: 0, marginM: 0.5, run: 2, reachM: 3, wallM: 0.5, exactWall: true },
    expect: { result: { wall: { heightM: 0.5, exact: true, kind: 'retaining' } },
      check: (_result, nodes) => {
        const walls = Object.values(nodes).filter((node) => (node as AnyNode).type === 'terrain-break') as unknown as { kind: string; left: unknown; right: unknown }[]
        return walls.length === 1 && walls[0]?.kind === 'retaining' && walls[0]?.left === 0 && walls[0]?.right === 'ground'
          ? []
          : [`expected one retaining break with the pad as its numeric side, found ${JSON.stringify(walls)}`]
      } },
  },
  { name: 'a pad needs a level or a footprint', tool: 'grade_around_house', scene: terrainWriteScene,
    input: { pads: [{ padHeightM: 0 }] }, expect: { refusal: 'invalid_input' } },
  { name: 'a house outline needs its pad height', tool: 'grade_around_house', scene: terrainWriteScene,
    input: { footprint: PAD }, expect: { refusal: 'invalid_input' } },
  { name: 'a house outline outside the property is refused', tool: 'grade_around_house', scene: terrainWriteScene,
    input: { footprint: [[4, 2], [6, 2], [6, 4], [4, 4]], padHeightM: 0 }, expect: { refusal: 'outside_property' } },
  { name: 'a pad outside the property is refused', tool: 'carve_terrain_pad', scene: terrainWriteScene,
    input: { pad: [[4, 2], [6, 2], [6, 4], [4, 4]], padHeightM: 0 }, expect: { refusal: 'outside_property' } },
  { name: 'a shaping area outside the property is refused', tool: 'shape_site_terrain', scene: terrainWriteScene,
    input: { verb: 'raise', area: { x: 4.5, z: 3, radiusM: 1 }, heightM: 1 }, expect: { refusal: 'outside_property' } },
  { name: 'a pad holding no sample is too small', tool: 'carve_terrain_pad', scene: terrainWriteScene,
    input: { pad: [[2.2, 2.2], [2.4, 2.2], [2.4, 2.4], [2.2, 2.4]], padHeightM: 0 }, expect: { refusal: 'pad_too_small' } },
  { name: 'a write that moves nothing is refused', tool: 'shape_site_terrain', scene: terrainWriteScene,
    input: { verb: 'raise', area: PAD, heightM: 0 }, expect: { refusal: 'no_change' } },
  { name: 'flatten without a height is refused', tool: 'shape_site_terrain', scene: terrainWriteScene,
    input: { verb: 'flatten', area: PAD }, expect: { refusal: 'invalid_input' } },
  { name: 'shaping a scene with no site is refused', tool: 'shape_site_terrain',
    scene: () => ({ nodes: {}, rootNodeIds: [] }),
    input: { verb: 'raise', area: PAD, heightM: 1 }, expect: { refusal: 'no_site' } },
]
