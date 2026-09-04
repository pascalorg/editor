import { expect, mock, test } from 'bun:test'
import * as core from '@pascal-app/core'

const saveAsset = mock(async () => 'asset://stored-scan')

mock.module('@pascal-app/core', () => ({ ...core, saveAsset }))

const { createLocalScan } = await import('./local-guide-image')

test('createLocalScan stores and attaches a scan asset to its level', async () => {
  const createNode = mock()
  const file = new File(['scan data'], 'living-room.glb', { type: 'model/gltf-binary' })

  const { scan, url } = await createLocalScan({ createNode, file, levelId: 'level_ground' })

  expect(saveAsset).toHaveBeenCalledWith(file)
  expect(scan).toMatchObject({
    name: 'living-room',
    type: 'scan',
    url: 'asset://stored-scan',
  })
  expect(url).toBe('asset://stored-scan')
  expect(createNode).toHaveBeenCalledWith(scan, 'level_ground')
})
