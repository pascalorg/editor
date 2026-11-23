import { afterEach, expect, test } from 'bun:test'
import {
  configureKtx2Support,
  configureViewer,
  getViewerConfig,
  resolveAssetUrl,
  resolveCdnUrl,
  stampPascalTextureRef,
} from '@pascal-app/viewer'
import { Texture } from 'three'

afterEach(() => configureViewer({}))

test('asset and storage origins resolve at call time after configuration changes', async () => {
  configureViewer({
    assetsBaseUrl: 'https://assets.example/one/',
    storageUrl: 'https://one.example',
  })
  expect(resolveCdnUrl('/model.glb')).toBe('https://assets.example/one/model.glb')
  expect(await resolveAssetUrl('model.glb')).toBe('https://assets.example/one/model.glb')
  const texture = new Texture()
  const stamp = (origin: string) =>
    stampPascalTextureRef(texture, {
      kind: 'material',
      slot: 'map',
      src: `${origin}/storage/v1/object/public/materials/wood.ktx2`,
    })
  expect(stamp('https://one.example')?.kind).toBe('library-material')
  configureViewer({ assetsBaseUrl: 'https://two.example', storageUrl: 'https://two.example' })
  expect(resolveCdnUrl('/model.glb')).toBe('https://two.example/model.glb')
  expect(stamp('https://one.example')).toBeNull()
  expect(stamp('https://two.example')?.kind).toBe('library-material')
})

test('decoder configuration overrides both paths and defaults are immutable versions', () => {
  configureViewer({ decoders: { dracoPath: '/draco/', basisPath: '/basis/' } })
  expect(getViewerConfig().decoders).toEqual({ dracoPath: '/draco/', basisPath: '/basis/' })
  let attachedBasisPath: string | undefined
  expect(
    configureKtx2Support(
      {
        setKTX2Loader(loader: { transcoderPath: string }) {
          attachedBasisPath = loader.transcoderPath
        },
      },
      { isWebGPURenderer: true, hasFeature: () => false },
    ),
  ).toBe(true)
  expect(attachedBasisPath).toBe('/basis/')
  configureViewer({})
  expect(getViewerConfig().decoders.basisPath).not.toContain('@master')
  expect(getViewerConfig().decoders.dracoPath).toContain('/1.5.5/')
})

test('unconfigured URL resolution works without a browser process polyfill', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')!
  try {
    Reflect.deleteProperty(globalThis, 'process')
    expect(resolveCdnUrl('/model.glb')).toBe('https://editor.pascal.app/model.glb')
    expect(getViewerConfig().storageUrl).toBeUndefined()
  } finally {
    Object.defineProperty(globalThis, 'process', descriptor)
  }
})
