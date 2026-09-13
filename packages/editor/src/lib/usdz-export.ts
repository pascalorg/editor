import type { AnyNode } from '@pascal-app/core'
import type { Object3D } from 'three'
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js'
import * as WebGPUTextureUtils from 'three/examples/jsm/utils/WebGPUTextureUtils.js'
import { type GlbExportOptions, preparePortableSceneFromViewer } from './glb-export'
import { createUsdzScene, disposeExportResources } from './portable-export'

export type UsdzExportOptions = Pick<
  GlbExportOptions,
  'excludedNodeTypes' | 'includedPresentationIds' | 'onlyVisible' | 'onWarning'
>

/** Export a native, self-contained USDZ with no glTF conversion fallback. */
export async function exportSceneToUsdz(
  sceneGroup: Object3D,
  nodes: Record<string, AnyNode>,
  options: UsdzExportOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const prepared = await preparePortableSceneFromViewer(sceneGroup, nodes, {
    ...options,
    textures: 'embed',
  })
  for (const warning of prepared.warnings) options.onWarning?.(warning)

  let scene: Object3D | null = null
  try {
    scene = createUsdzScene(prepared.scene)
    const exporter = new USDZExporter()
    exporter.textureUtils = WebGPUTextureUtils
    return await exporter.parseAsync(scene, {
      onlyVisible: options.onlyVisible ?? true,
      quickLookCompatible: true,
    })
  } finally {
    if (scene) disposeExportResources(scene, { textures: false })
    prepared.dispose()
  }
}
