import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { blenderRun, compileBlenderBuild } from './blender'
import { runBlenderLocally } from './blender-local'

// The runner's output for cabinet.py at width 1.5, exported by Blender 5.2.
const fixture = (name: string) => new URL(`./__fixtures__/blender/${name}`, import.meta.url)
const code = readFileSync(fixture('cabinet.py'), 'utf8')
const report = JSON.parse(readFileSync(fixture('cabinet.json'), 'utf8'))
const glb = new Uint8Array(readFileSync(fixture('cabinet.glb')))

describe('a Blender build', () => {
  test('reads into the same manifest as a three.js build', async () => {
    const compiled = await compileBlenderBuild({
      code,
      params: { width: 1.5 },
      run: blenderRun(report, glb),
    })
    expect(compiled.language).toBe('bpy')
    expect(compiled.mount).toBe('floor')
    expect(compiled.params).toEqual({ width: 1.5 })
    const { manifest } = compiled
    expect(manifest.parts.map((part) => part.id).sort()).toEqual([
      'body',
      'door_left',
      'door_right',
    ])
    expect(manifest.parts.find((part) => part.id === 'body')?.type).toBe('cabinet')
    expect(manifest.slots.map((slot) => [slot.id, slot.color])).toEqual(
      expect.arrayContaining([
        ['wood', expect.stringMatching(/^#/)],
        ['metal', expect.stringMatching(/^#/)],
      ]),
    )
    expect(manifest.anchors.map((anchor) => anchor.id)).toEqual(['top'])
    expect(manifest.lights).toEqual([expect.objectContaining({ id: 'lamp', intensity: 3 })])
    expect(manifest.animations.map((clip) => clip.name)).toEqual(['open'])
    // Blender is Z up; the GLB is Y up, re-origined on the bottom centre.
    const [width, height, depth] = manifest.bounds.max.map(
      (max, i) => max - manifest.bounds.min[i]!,
    )
    expect(width).toBeCloseTo(1.5, 1)
    expect(height).toBeCloseTo(0.9, 1)
    expect(depth).toBeGreaterThan(0.5)
    expect(manifest.bounds.min[1]).toBeCloseTo(0, 3)
  })

  test("both doors swing in the one clip, which survives Pascal's export", async () => {
    const compiled = await compileBlenderBuild({
      code,
      params: { width: 1.5 },
      run: blenderRun(report, glb),
    })
    const gltf = await new GLTFLoader().parseAsync(compiled.glb, '')
    const open = gltf.animations.find((clip) => clip.name === 'open')!
    const targets = new Set(open.tracks.map((track) => track.name.split('.')[0]))
    expect(targets.size).toBe(2)
  })

  test('params Blender resolved differently are refused', async () => {
    await expect(
      compileBlenderBuild({
        code,
        params: { width: 2 },
        run: blenderRun(report, glb),
      }),
    ).rejects.toThrow('different param values')
  })

  test("a script's error reaches the agent with its line", () => {
    expect(() =>
      blenderRun({ ok: false, error: "NameError: name 'w' is not defined", line: 12 }, null),
    ).toThrow("NameError: name 'w' is not defined (line 12)")
  })
})

const BLENDER = process.env.PASCAL_BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender'

describe.skipIf(!existsSync(BLENDER))('a local Blender', () => {
  test('runs the module and clamps params as Pascal does', async () => {
    const run = await runBlenderLocally({ blender: BLENDER, code, params: { width: 9 } })
    expect(run.resolved).toEqual({ width: 2.4 })
    const compiled = await compileBlenderBuild({ code, params: { width: 9 }, run })
    expect(compiled.params).toEqual({ width: 2.4 })
  })

  test('a failing module throws its error', async () => {
    await expect(
      runBlenderLocally({
        blender: BLENDER,
        code: 'def build(params):\n    raise ValueError("no")\n',
      }),
    ).rejects.toThrow('ValueError: no (line 2)')
  })
})
