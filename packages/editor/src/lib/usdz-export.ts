import type { AnyNode } from '@pascal-app/core'
import type { Object3D } from 'three'
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js'
import { createExportTextureUtils } from './export-texture-utils'
import {
  DEFAULT_MODEL_EXPORT_TIMEOUT_MS,
  type GlbExport,
  type GlbExportOptions,
  preparePortableSceneFromViewer,
  withExportDeadline,
} from './glb-export'
import { createUsdzScene, disposeExportResources } from './portable-export'

export type UsdzExportOptions = Pick<
  GlbExportOptions,
  'excludedNodeTypes' | 'includedPresentationIds' | 'onlyVisible' | 'onWarning' | 'timeoutMs'
>

/** Export a native, self-contained USDZ with no glTF conversion fallback. */
export async function exportSceneToUsdz(
  sceneGroup: Object3D,
  nodes: Record<string, AnyNode>,
  options: UsdzExportOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const textureUtils = createExportTextureUtils()
  const preparation = preparePortableSceneFromViewer(sceneGroup, nodes, {
    ...options,
    textures: 'embed',
    animations: 'none',
    textureUtils,
  })
  // Assigned inside the raced closure, so plain `let`s narrow to `never` in
  // the `finally`.
  const run: { prepared: GlbExport | null; scene: Object3D | null; abandoned: boolean } = {
    prepared: null,
    scene: null,
    abandoned: false,
  }
  try {
    return await withExportDeadline(
      (async () => {
        run.prepared = await preparation
        if (run.abandoned) throw new Error('USDZ export abandoned')
        for (const warning of run.prepared.warnings) options.onWarning?.(warning)
        run.scene = createUsdzScene(run.prepared.scene)
        const exporter = new USDZExporter()
        exporter.textureUtils = textureUtils as unknown as USDZExporter['textureUtils']
        return exporter.parseAsync(run.scene, {
          onlyVisible: options.onlyVisible ?? true,
          quickLookCompatible: true,
        })
      })(),
      options.timeoutMs ?? DEFAULT_MODEL_EXPORT_TIMEOUT_MS,
      'USDZ',
      () => {
        run.abandoned = true
      },
    )
  } finally {
    if (run.scene) disposeExportResources(run.scene, { textures: false })
    if (run.prepared) run.prepared.dispose()
    else preparation.then((late) => late.dispose()).catch(() => {})
    await textureUtils.dispose()
  }
}
