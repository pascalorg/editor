import { expect, test } from 'bun:test'

test('enables cursor-centered dolly on the camera controls', async () => {
  const source = await Bun.file(new URL('./custom-camera-controls.tsx', import.meta.url)).text()
  const cameraControlsElements = source.match(/<CameraControls\b[\s\S]*?\/>/g) ?? []

  expect(cameraControlsElements).toHaveLength(1)
  expect(cameraControlsElements[0]).toMatch(/\bdollyToCursor(?=\s|\/>)/)
  expect(cameraControlsElements[0]).toMatch(/\bdollySpeed=\{0\.75\}(?=\s|\/>)/)
  expect(cameraControlsElements[0]).not.toMatch(/\b(?:smoothTime|draggingSmoothTime)\s*=/)
})
