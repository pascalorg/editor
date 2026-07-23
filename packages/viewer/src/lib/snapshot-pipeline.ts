import { type Camera, Color, Matrix4, type Scene, UnsignedByteType } from 'three'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import { fxaa } from 'three/examples/jsm/tsl/display/FXAANode.js'
import {
  convertToTexture,
  diffuseColor,
  float,
  mix,
  mrt,
  normalView,
  output,
  pass,
  sample,
  saturation,
  screenUV,
  smoothstep,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import { RenderPipeline, RenderTarget, type WebGPURenderer } from 'three/webgpu'
import { GRADE_PARAMS, SSGI_PARAMS } from '../components/viewer/post-processing'
import { backdropGradient, deepSkyColor, horizonHazeColor } from './backdrop'
import { type EdgeMode, edgeColorFor, edgeOpacityScaleFor } from './edge-style'
import { inkedEdges } from './ink-edges'
import { getSceneTheme } from './scene-themes'
import { packNormalToRGB, unpackRGBToNormal } from './tsl-compat'

export const THUMBNAIL_WIDTH = 1920
export const THUMBNAIL_HEIGHT = 1080

export type SnapshotCaptureMode = 'standard' | 'viewport' | 'area'

export type SnapshotCropRegion = {
  x: number
  y: number
  width: number
  height: number
}

export type SnapshotSize = {
  w: number
  h: number
}

export type SnapshotCaptureResult = {
  blob: Blob
  outW: number
  outH: number
}

export type SnapshotPipeline = {
  applyEnvironment: ({
    theme,
    transparent,
    grade,
    edges,
    camera,
  }: {
    theme: string
    transparent: boolean
    grade: boolean
    edges: EdgeMode
    camera: Camera
  }) => void
  capture: ({
    captureMode,
    cropRegion,
    standardSize,
  }: {
    captureMode?: SnapshotCaptureMode
    cropRegion?: SnapshotCropRegion
    standardSize?: SnapshotSize
  }) => Promise<SnapshotCaptureResult>
  dispose: () => void
}

export async function createSnapshotPipeline({
  renderer,
  scene,
  camera,
}: {
  renderer: WebGPURenderer
  scene: Scene
  camera: Camera
}): Promise<SnapshotPipeline | null> {
  try {
    if ((renderer as any).init) await (renderer as any).init()

    // Backdrop compositing for scene snapshots (studio renders, project
    // thumbnails): theme background + sky gradient, same world-ray math as the
    // viewport backdrop in viewer's post-processing. Uniform-driven so the one
    // cached pipeline serves both opaque and transparent (preset/item) captures.
    const bgColorUniform = uniform(new Color('#ffffff'))
    const bgSkyUniform = uniform(new Color('#ffffff'))
    const bgSkyDeepUniform = uniform(new Color('#ffffff'))
    const bgHazeUniform = uniform(new Color('#ffffff'))
    const bgProjInvUniform = uniform(new Matrix4())
    const bgCamWorldUniform = uniform(new Matrix4())
    const bgMixUniform = uniform(1)
    const gradeMixUniform = uniform(0)
    const inkMixUniform = uniform(0)
    const inkColorUniform = uniform(new Color('#1a1d24'))
    const inkOpacityUniform = uniform(0.5)
    const inkOpacityScaleUniform = uniform(1)

    // pass() handles MRT internally for all material types, including custom
    // shaders — unlike renderer.setMRT() which crashes on non-NodeMaterials.
    // pass() also respects camera.layers, so caller-disabled objects are filtered.
    const scenePass = pass(scene, camera)
    scenePass.setMRT(
      mrt({
        output,
        diffuseColor,
        normal: packNormalToRGB(normalView),
      }),
    )

    const scenePassColor = scenePass.getTextureNode('output')
    const scenePassDepth = scenePass.getTextureNode('depth')
    const scenePassNormal = scenePass.getTextureNode('normal')

    scenePass.getTexture('diffuseColor').type = UnsignedByteType
    scenePass.getTexture('normal').type = UnsignedByteType

    const sceneNormal = sample((uv) => unpackRGBToNormal(scenePassNormal.sample(uv)))

    const giPass = ssgi(scenePassColor, scenePassDepth, sceneNormal, camera as any)
    giPass.sliceCount.value = SSGI_PARAMS.sliceCount
    giPass.stepCount.value = SSGI_PARAMS.stepCount
    giPass.radius.value = SSGI_PARAMS.radius
    giPass.expFactor.value = SSGI_PARAMS.expFactor
    giPass.thickness.value = SSGI_PARAMS.thickness
    giPass.backfaceLighting.value = SSGI_PARAMS.backfaceLighting
    giPass.aoIntensity.value = SSGI_PARAMS.aoIntensity
    giPass.giIntensity.value = SSGI_PARAMS.giIntensity
    giPass.useLinearThickness.value = SSGI_PARAMS.useLinearThickness
    giPass.useScreenSpaceSampling.value = SSGI_PARAMS.useScreenSpaceSampling
    giPass.useTemporalFiltering = SSGI_PARAMS.useTemporalFiltering

    // r185: SSGI's AO lives in its own single-channel texture (getAONode)
    // rather than the alpha of one packed rgba texture.
    const aoTexture = (giPass as any).getAONode()
    const aoAsRgb = vec4(aoTexture.r, aoTexture.r, aoTexture.r, float(1))
    const denoisePass = denoise(aoAsRgb, scenePassDepth, sceneNormal, camera)
    denoisePass.index.value = 0
    denoisePass.radius.value = 4

    // Same far-field AO fade as the viewport pipeline — without it the
    // horizon picks up a visible AO line in captures.
    const aoFarFade = smoothstep(float(0.9994), float(0.9998), scenePassDepth.sample(screenUV).r)
    const ao = mix((denoisePass as any).r, float(1), aoFarFade)
    const aoRgb = scenePassColor.rgb.mul(ao)

    // Ink edges, mirroring the viewport pipeline (AO → ink → grade) so
    // captures carry the same soft/strong edge look the canvas shows.
    // Uniform-gated like grade/backdrop: one cached pipeline serves all modes.
    // Radius scales with render height: a supersampled capture (4K → 1080p)
    // would otherwise halve the apparent line weight vs the viewport's 1px.
    const inkRadius = Math.max(1, Math.round(renderer.domElement.height / 1080))
    const inkedRgb = inkedEdges({
      sceneRgb: aoRgb,
      depthTex: scenePassDepth,
      normalTex: scenePassNormal,
      inkColor: inkColorUniform,
      radius: inkRadius,
      opacity: float(inkOpacityUniform).mul(inkOpacityScaleUniform),
    })
    const ungradedSceneRgb = mix(aoRgb, inkedRgb, inkMixUniform)
    const gradeRgb = (rgb: any) =>
      saturation(rgb.div(0.18).pow(vec3(GRADE_PARAMS.contrast)).mul(0.18), GRADE_PARAMS.saturation)
    const sceneRgb = mix(ungradedSceneRgb, gradeRgb(ungradedSceneRgb), gradeMixUniform)

    // Per-pixel world ray from the capture camera → sky gradient above the
    // horizon (dir.y = 0), flat background below — mirrors the viewport
    // backdrop. bgMix 0 bypasses it and keeps the capture transparent.
    const ndc = vec4(screenUV.x.mul(2).sub(1), float(1).sub(screenUV.y).mul(2).sub(1), 1, 1) as any
    const viewRay = (bgProjInvUniform as any).mul(ndc)
    const worldDir = (bgCamWorldUniform as any).mul(vec4(viewRay.xyz, 0)).xyz.normalize()
    const ungradedBgGradient = backdropGradient({
      dirY: worldDir.y,
      background: bgColorUniform,
      haze: bgHazeUniform,
      sky: bgSkyUniform,
      skyDeep: bgSkyDeepUniform,
    })
    const bgGradient = mix(ungradedBgGradient, gradeRgb(ungradedBgGradient), gradeMixUniform)
    const alpha = scenePassColor.a
    const finalOutput = vec4(
      mix(sceneRgb, mix(bgGradient, sceneRgb, alpha), bgMixUniform),
      mix(alpha, float(1), bgMixUniform),
    )

    // FXAA requires a texture node as input; convertToTexture renders finalOutput
    // into an intermediate RT so FXAA can sample it with neighbour UV offsets.
    const aaOutput = fxaa(convertToTexture(finalOutput))

    const pipeline = new RenderPipeline(renderer)
    pipeline.outputNode = aaOutput

    // Dedicated render target — pipeline outputs here instead of the canvas,
    // so R3F's main render loop can never overwrite our capture.
    const { width, height } = renderer.domElement
    const renderTarget = new RenderTarget(width, height, { depthBuffer: true })

    return {
      applyEnvironment: ({ theme, transparent, grade, edges, camera: captureCamera }) => {
        const sceneTheme = getSceneTheme(theme)
        inkMixUniform.value = edges === 'off' ? 0 : 1
        inkOpacityUniform.value = edges === 'strong' ? 1 : 0.5
        inkColorUniform.value.set(edgeColorFor(sceneTheme.background))
        inkOpacityScaleUniform.value = edgeOpacityScaleFor(sceneTheme.background)
        bgColorUniform.value.set(sceneTheme.background)
        bgSkyUniform.value.set(sceneTheme.backgroundSky ?? sceneTheme.background)
        bgSkyDeepUniform.value.set(deepSkyColor(sceneTheme.backgroundSky ?? sceneTheme.background))
        bgHazeUniform.value.set(
          horizonHazeColor(
            sceneTheme.backgroundSky ?? sceneTheme.background,
            sceneTheme.appearance,
          ),
        )
        bgMixUniform.value = transparent ? 0 : 1
        gradeMixUniform.value = grade ? 1 : 0

        // The capture camera never joins the scene graph, so its matrixWorld
        // is only refreshed by the render itself — too late for the backdrop
        // uniforms below.
        captureCamera.updateMatrixWorld()
        bgProjInvUniform.value.copy(captureCamera.projectionMatrixInverse)
        bgCamWorldUniform.value.copy(captureCamera.matrixWorld)
      },
      capture: async ({ captureMode, cropRegion, standardSize }) => {
        const standardW = standardSize?.w ?? THUMBNAIL_WIDTH
        const standardH = standardSize?.h ?? THUMBNAIL_HEIGHT
        const { width: captureWidth, height: captureHeight } = renderer.domElement

        // Resize RT if the canvas dimensions changed
        if (renderTarget.width !== captureWidth || renderTarget.height !== captureHeight) {
          renderTarget.setSize(captureWidth, captureHeight)
        }

        try {
          ;(renderer as any).setClearAlpha(0)
          renderer.setRenderTarget(renderTarget)
          pipeline.render()
        } finally {
          renderer.setRenderTarget(null)
        }

        // Let callers restore visibility and other capture policy immediately
        // after the render, before the asynchronous GPU readback begins.
        await Promise.resolve()

        // Read pixels from the RT asynchronously.
        // WebGPU copyTextureToBuffer aligns each row to 256 bytes, so we must
        // depad the rows before constructing ImageData.
        const pixels = (await (renderer as any).readRenderTargetPixelsAsync(
          renderTarget,
          0,
          0,
          captureWidth,
          captureHeight,
        )) as Uint8Array

        const actualBytesPerRow = captureWidth * 4
        const tightTotal = actualBytesPerRow * captureHeight
        const paddedBytesPerRow = Math.ceil(actualBytesPerRow / 256) * 256
        // Two readback shapes to handle:
        // - WebGPU (`copyTextureToBuffer`): top-down + 256-byte row padding
        //   when width*4 isn't already a multiple of 256.
        // - WebGL2 fallback (iOS Chrome, etc.): tightly-packed but bottom-up
        //   (OpenGL framebuffer convention).
        // `isWebGPURenderer` lies — it stays true even when the renderer
        // falls back to the WebGL backend. Inspect the actual backend
        // instead (presence of a GPU device, or backend constructor name).
        const backend = (renderer as any).backend
        const isWebGPU =
          !!backend?.device ||
          backend?.isWebGPUBackend === true ||
          backend?.constructor?.name === 'WebGPUBackend'
        let tightPixels: Uint8ClampedArray
        if (isWebGPU) {
          // WebGPU: depad rows if needed; orientation is already top-down.
          if (paddedBytesPerRow === actualBytesPerRow) {
            tightPixels = new Uint8ClampedArray(
              pixels.buffer,
              pixels.byteOffset,
              Math.min(pixels.byteLength, tightTotal),
            )
          } else {
            tightPixels = new Uint8ClampedArray(tightTotal)
            for (let row = 0; row < captureHeight; row++) {
              tightPixels.set(
                pixels.subarray(
                  row * paddedBytesPerRow,
                  row * paddedBytesPerRow + actualBytesPerRow,
                ),
                row * actualBytesPerRow,
              )
            }
          }
        } else {
          // WebGL2: tight buffer in bottom-up order — flip rows.
          tightPixels = new Uint8ClampedArray(tightTotal)
          for (let row = 0; row < captureHeight; row++) {
            const srcStart = (captureHeight - 1 - row) * actualBytesPerRow
            tightPixels.set(
              pixels.subarray(srcStart, srcStart + actualBytesPerRow),
              row * actualBytesPerRow,
            )
          }
        }

        const imageData = new ImageData(
          tightPixels as unknown as Uint8ClampedArray<ArrayBuffer>,
          captureWidth,
          captureHeight,
        )
        const srcCanvas = new OffscreenCanvas(captureWidth, captureHeight)
        srcCanvas.getContext('2d')!.putImageData(imageData, 0, 0)

        let outW: number
        let outH: number
        let blob: Blob

        if (captureMode === 'viewport') {
          outW = captureWidth
          outH = captureHeight
          const offscreen = new OffscreenCanvas(outW, outH)
          offscreen.getContext('2d')!.drawImage(srcCanvas, 0, 0)
          blob = await offscreen.convertToBlob({ type: 'image/png' })
        } else if (captureMode === 'area' && cropRegion) {
          const sx = Math.round(cropRegion.x * captureWidth)
          const sy = Math.round(cropRegion.y * captureHeight)
          outW = Math.round(cropRegion.width * captureWidth)
          outH = Math.round(cropRegion.height * captureHeight)
          const offscreen = new OffscreenCanvas(outW, outH)
          offscreen.getContext('2d')!.drawImage(srcCanvas, sx, sy, outW, outH, 0, 0, outW, outH)
          blob = await offscreen.convertToBlob({ type: 'image/png' })
        } else {
          // Standard: center-crop to the requested aspect (default 1920×1080)
          const srcAspect = captureWidth / captureHeight
          const dstAspect = standardW / standardH
          let sx = 0
          let sy = 0
          let sWidth = captureWidth
          let sHeight = captureHeight
          if (srcAspect > dstAspect) {
            sWidth = Math.round(captureHeight * dstAspect)
            sx = Math.round((captureWidth - sWidth) / 2)
          } else if (srcAspect < dstAspect) {
            sHeight = Math.round(captureWidth / dstAspect)
            sy = Math.round((captureHeight - sHeight) / 2)
          }
          outW = standardW
          outH = standardH
          const offscreen = new OffscreenCanvas(outW, outH)
          offscreen
            .getContext('2d')!
            .drawImage(srcCanvas, sx, sy, sWidth, sHeight, 0, 0, outW, outH)
          blob = await offscreen.convertToBlob({ type: 'image/png' })
        }

        return { blob, outW, outH }
      },
      dispose: () => {
        pipeline.dispose()
        renderTarget.dispose()
      },
    }
  } catch (error) {
    console.error(
      '[thumbnail] Failed to build post-processing pipeline, will use fallback render.',
      error,
    )
    return null
  }
}
