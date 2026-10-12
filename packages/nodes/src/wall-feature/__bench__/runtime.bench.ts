import {
  type AnyNode,
  LevelNode,
  useLiveNodeOverrides,
  useScene,
  WallFeatureNode,
  WallNode,
  wallSupportForNodes,
  ZoneNode,
} from '@pascal-app/core'

const runtime = await import(process.env.WALL_FEATURE_BENCH_RUNTIME ?? '../runtime.ts')
const saved = useScene.getState()
const live = useLiveNodeOverrides.getState().overrides

function fixture(count: number) {
  const level = LevelNode.parse({ height: 3 })
  const nodes: Record<string, AnyNode> = { [level.id]: level }
  const features: WallFeatureNode[] = []
  for (let i = 0; i < 100; i++) {
    const wall = WallNode.parse({
      parentId: level.id,
      start: [i * 10, 0],
      end: [i * 10 + 8, 0],
      height: 3,
    })
    const feature = WallFeatureNode.parse({
      parentId: wall.id,
      face: 'a',
      mode: 'bump',
      u: 3,
      width: 1,
      height: 1,
      depth: 0.2,
    })
    wall.children = [feature.id]
    level.children.push(wall.id)
    nodes[wall.id] = wall
    nodes[feature.id] = feature
    features.push(feature)
  }
  for (let i = 201; i < count; i++) {
    const node = ZoneNode.parse({
      name: 'Unrelated',
      parentId: 'level_unrelated',
      polygon: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    })
    nodes[node.id] = node
  }
  return { nodes, level, features }
}

try {
  for (const count of [1_001, 10_001]) {
    const { nodes, level, features } = fixture(count)
    useScene.setState({ nodes, rootNodeIds: [level.id], dirtyNodes: new Set() })
    for (const deferred of [false, true]) {
      runtime.resetWallFeatureGeometry()
      useLiveNodeOverrides.getState().clearAll()
      for (const feature of features) {
        const wall = nodes[feature.parentId!] as WallNode
        runtime.createWallFeatureBodyModifier(wall, {
          nodes,
          elevation: 0,
          planeTop: 3,
          support: wallSupportForNodes(wall, nodes),
        })
      }
      const feature = features[0]!
      runtime.deferWallFeatureGeometry(feature.id, deferred)
      const samples: number[] = []
      for (let tick = 0; tick < 1_100; tick++) {
        const start = performance.now()
        useLiveNodeOverrides.getState().set(feature.id, { width: 1 + (tick % 2) * 0.1 })
        runtime.syncWallFeatureGeometry()
        const placement = runtime.getWallFeaturePlacement(feature.id)
        if (!placement || placement.node.width !== 1 + (tick % 2) * 0.1)
          throw Error('Preview did not follow the override')
        if (tick >= 100) samples.push(performance.now() - start)
      }
      samples.sort((a, b) => a - b)
      console.log(
        JSON.stringify({
          nodes: count,
          features: features.length,
          deferred,
          samples: samples.length,
          p50Ms: samples[500],
          p95Ms: samples[950],
          p99Ms: samples[990],
        }),
      )
    }
  }
} finally {
  runtime.resetWallFeatureGeometry()
  useScene.setState(saved)
  useLiveNodeOverrides.setState({ overrides: live })
}
