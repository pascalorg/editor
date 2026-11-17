import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  registerNode,
  runAsSceneCommitAuthor,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { startConstructionReveal } from '@pascal-app/viewer'
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three'
import { builtinPlugin } from '../index'

// What replaying graded terrain costs a frame: a large graded scene (24 tiles, 5 breaks),
// every tile graded by the agent at once. Skipped unless SCENE_JSON=<a scene json> is set.
const path = process.env.SCENE_JSON
const scene = path ? JSON.parse(readFileSync(path, 'utf8')) : null

const tick = (frames: number[]) => ({
  mean: frames.reduce((sum, ms) => sum + ms, 0) / Math.max(1, frames.length),
  p95: [...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.95)] ?? 0,
  max: Math.max(0, ...frames),
})

test.skipIf(!scene)('grading every tile replays them at a cost no frame feels', () => {
  nodeRegistry._reset()
  for (const definition of builtinPlugin.nodes ?? []) registerNode(definition)
  globalThis.requestAnimationFrame ??= (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame ??= () => {}
  useScene.getState().setScene(scene.nodes, scene.rootNodeIds)
  const tiles = Object.values(useScene.getState().nodes as Record<string, AnyNode>).filter(
    (node) => node.type === 'terrain-tile',
  )
  // Each tile's mesh is what the renderer builds: 65 x 65 samples.
  const roots = tiles.map((tile) => {
    const root = new Group()
    root.add(new Mesh(new PlaneGeometry(32, 32, 64, 64), new MeshBasicMaterial()))
    sceneRegistry.nodes.set(tile.id, root)
    return root
  })
  const driver = startConstructionReveal({
    reveals: (commit) => commit.author === 'agent',
    prefersReducedMotion: () => false,
    level: () => 'full',
  })
  let now = 0
  const frames: number[] = []
  const ticks: number[] = []
  const step = () => {
    now += 16
    const began = performance.now()
    driver.tick(now)
    const tickMs = performance.now() - began
    ticks.push(tickMs)
    for (const root of roots) {
      root.updateMatrix()
      root.updateMatrixWorld(true)
    }
    frames.push(performance.now() - began)
  }
  for (let index = 0; index < 60; index += 1) step()
  const idle = tick(frames)
  frames.length = 0

  const runs: unknown[] = []
  for (let run = 0; run < 3; run += 1) {
    frames.length = 0
    const began = performance.now()
    runAsSceneCommitAuthor('agent', () =>
      useScene.getState().updateNodes(
        tiles.map((tile) => ({
          id: tile.id as AnyNodeId,
          data: {
            heights: `${(tile as unknown as { heights: string }).heights}${'A'.repeat(run + 1)}`,
          } as never,
        })),
      ),
    )
    const commitMs = performance.now() - began
    for (let index = 0; index < 400; index += 1) step()
    const playing = tick(frames)
    const slowest = frames
      .map((ms, index) => ({ index, ms }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 3)

    runs.push({ commitMs, playing, slowest })
  }
  console.log(JSON.stringify({ tiles: tiles.length, idleFrameMs: idle, runs }))
  for (const run of runs as { commitMs: number; playing: { p95: number } }[]) {
    expect(run.commitMs).toBeLessThan(100)
    expect(run.playing.p95).toBeLessThan(4)
  }
  driver.stop()
})
