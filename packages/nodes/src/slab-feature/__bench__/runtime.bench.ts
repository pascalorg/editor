import {
  type AnyNode,
  LevelNode,
  SlabFeatureNode,
  SlabNode,
  useLiveNodeOverrides,
  ZoneNode,
} from '@pascal-app/core'
import { slabFeatureLocalFrame, slabFeatureRenderNodes } from '@pascal-app/nodes'

const saved = useLiveNodeOverrides.getState().overrides
try {
  for (const count of [1_000, 10_000]) {
    const level = LevelNode.parse({})
    const slab = SlabNode.parse({
      parentId: level.id,
      polygon: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      thickness: 0.3,
    })
    const features = Array.from({ length: 100 }, (_, i) =>
      SlabFeatureNode.parse({
        parentId: slab.id,
        mode: 'bump',
        x: i + 0.5,
        z: 1,
        width: 0.5,
        length: 0.5,
        depth: 0.1,
      }),
    )
    const entries: AnyNode[] = [level, slab, ...features]
    while (entries.length < count)
      entries.push(
        ZoneNode.parse({
          name: 'Unrelated',
          parentId: level.id,
          polygon: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        }),
      )
    let scans = 0
    const nodes = new Proxy(Object.fromEntries(entries.map((n) => [n.id, n])), {
      ownKeys(target) {
        scans++
        return Reflect.ownKeys(target)
      },
    })
    useLiveNodeOverrides.getState().set(slab.id, { elevation: 1 })
    const start = performance.now()
    for (let frame = 0; frame < 120; frame++) {
      const graph = slabFeatureRenderNodes(nodes)
      for (const feature of features)
        slabFeatureLocalFrame(feature, { nodes: graph, planOnly: false })
    }
    console.log({
      nodes: count,
      features: features.length,
      frames: 120,
      sceneScans: scans,
      ms: performance.now() - start,
    })
    if (scans !== 1) throw Error(`Expected one construction-lift scan, got ${scans}`)
    useLiveNodeOverrides.getState().clearAll()
  }
} finally {
  useLiveNodeOverrides.setState({ overrides: saved })
}
