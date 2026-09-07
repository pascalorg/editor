import type { PassNode, RenderPipeline } from 'three/webgpu'
import type { LayerPassIndex } from './layer-pass'

// RenderPipeline.dispose() only releases its fullscreen material, so the owner
// must also release the passes and scene observers on failure and teardown.
export class PostProcessingResources {
  layerIndex: LayerPassIndex | null = null
  readonly passes: PassNode[] = []
  outline: { dispose(): void } | null = null
  pipeline: RenderPipeline | null = null

  dispose() {
    this.layerIndex?.dispose()
    this.layerIndex = null
    for (const pass of this.passes) pass.dispose()
    this.passes.length = 0
    this.outline?.dispose()
    this.outline = null
    this.pipeline?.dispose()
    this.pipeline = null
  }
}
