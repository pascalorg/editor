import { create } from '@react-three/test-renderer'
import { expect, test } from 'bun:test'
import { StrictMode } from 'react'
import { SceneGroundReplacement, useSceneGroundReplacement } from './scene-ground-replacement'

function FallbackGround() {
  return useSceneGroundReplacement() ? null : <mesh name="fallback-ground" />
}

function Fixture({ owners }: { owners: number }) {
  return <StrictMode>
    <FallbackGround />
    {Array.from({ length: owners }, (_, index) => <SceneGroundReplacement key={index} />)}
  </StrictMode>
}

test('fallback ground is scene-local and returns only after the last replacement releases', async () => {
  const replaced = await create(<Fixture owners={2} />)
  const untouched = await create(<Fixture owners={0} />)
  const groundCount = (renderer: typeof replaced) => renderer.scene.findAllByProps({ name: 'fallback-ground' }).length
  try {
    expect(groundCount(replaced)).toBe(0)
    expect(groundCount(untouched)).toBe(1)
    await replaced.update(<Fixture owners={1} />)
    expect(groundCount(replaced)).toBe(0)
    await replaced.update(<Fixture owners={0} />)
    expect(groundCount(replaced)).toBe(1)
    await replaced.update(<Fixture owners={1} />)
    expect(groundCount(replaced)).toBe(0)
    expect(groundCount(untouched)).toBe(1)
  } finally {
    await replaced.unmount()
    await untouched.unmount()
  }
})
