import { expect, test } from 'bun:test'
import { MaterialBlending, NoBlending } from 'three'
import { diffuseColor, normalView, output } from 'three/tsl'
import { scenePassMrt } from './scene-pass-mrt'
import { packNormalToRGB } from './tsl-compat'

test('the scene pass blends its normal and diffuse attachments as it does its colour', () => {
  const target = scenePassMrt({ output, diffuseColor, normal: packNormalToRGB(normalView) })
  // A bare mrt() overwrites every attachment but `output` whatever a draw's alpha: a transparent
  // sprite then stamps its whole quad into the normals the ink reads.
  for (const name of ['output', 'diffuseColor', 'normal']) {
    expect(target.getBlendMode(name).blending).toBe(MaterialBlending)
  }
  expect(target.getBlendMode('depth').blending).toBe(NoBlending)
})
