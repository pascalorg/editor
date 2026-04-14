import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Color, Layers, UnsignedByteType } from 'three'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { denoise } from 'three/examples/jsm/tsl/display/DenoiseNode.js'
import {
  add,
  colorToDirection,
  diffuseColor,
  directionToColor,
  float,
  mix,
  mrt,
  normalView,
  oscSine,
  output,
  pass,
  sample,
  time,
  uniform,
  vec4,
} from 'three/tsl'
import { RenderPipeline, type WebGPURenderer } from 'three/webgpu'
import { SCENE_LAYER, ZONE_LAYER } from '../../lib/layers'
import { mergedOutline } from '../../lib/merged-outline-node'
import useViewer from '../../store/use-viewer'

// SSGI Parameters - adjust these to fine-tune global illumination and ambient occlusion
export const SSGI_PARAMS = {
  enabled: true,
  sliceCount: 1,
  stepCount: 4,
  radius: 1,
  expFactor: 1.5,
  thickness: 0.5,
  backfaceLighting: 0.5,
  aoIntensity: 1.5,
  giIntensity: 0,
  useLinearThickness: false,
  useScreenSpaceSampling: true,
  useTemporalFiltering: false,
}

const MAX_PIPELINE_RETRIES = 3
const RETRY_DELAY_MS = 500

const DARK_BG = '#1f2433'
const LIGHT_BG = '#ffffff'

const PostProcessingPasses = () => {
  const { gl: renderer, scene, camera } = useThree()
  const renderPipelineRef = useRef<RenderPipeline | null>(null)
  const hasPipelineErrorRef = useRef(false)
  const retryCountRef = useRef(0)
  const rebuildTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isInitialized, setIsInitialized] = useState(false)

  // Background color uniform — updated every frame via lerp, read by the TSL pipeline.
  // Initialised from the current theme so there's no flash on first render.
  const initBg = useViewer.getState().theme === 'dark' ? DARK_BG : LIGHT_BG
  const bgUniform = useRef(uniform(new Color(initBg)))
  const bgCurrent = useRef(new Color(initBg))
  const bgTarget = useRef(new Color())

  const zoneLayers = useMemo(() => {
    const l = new Layers()
    l.enable(ZONE_LAYER)
    l.disable(SCENE_LAYER)
    return l
  }, [])
  const hoverHighlightMode = useViewer((s) => s.hoverHighlightMode)

  // Subscribe to projectId so the pipeline rebuilds on project switch
  const projectId = useViewer((s) => s.projectId)

  // Bump this to force a pipeline rebuild (used by retry logic)
  const [pipelineVersion, setPipelineVersion] = useState(0)

  const requestPipelineRebuild = useCallback(() => {
    if (rebuildTimeoutRef.current !== null) {
      clearTimeout(rebuildTimeoutRef.current)
      rebuildTimeoutRef.current = null
    }

    setPipelineVersion((v) => v + 1)
  }, [])

  // Renderer initialization

  useEffect(() => {
    let mounted = true

    const initRenderer = async () => {
      try {
        if (renderer && (renderer as any).init) {
          await (renderer as any).init()
        }

        if (mounted) {
          setIsInitialized(true)
        }
      } catch (error) {
        console.error('[viewer] Failed to initialize renderer for post-processing.', error)
        if (mounted) {
          setIsInitialized(false)
        }
      }
    }

    initRenderer()

    return () => {
      mounted = false
    }
  }, [renderer])

  // Reset retry state when project changes
  useEffect(() => {
    // Intentionally touch projectId so the effect reruns on project switches.
    void projectId
    retryCountRef.current = 0
    if (rebuildTimeoutRef.current !== null) {
      clearTimeout(rebuildTimeoutRef.current)
      rebuildTimeoutRef.current = null
    }
  }, [projectId])

  useEffect(() => {
    return () => {
      if (rebuildTimeoutRef.current !== null) {
        clearTimeout(rebuildTimeoutRef.current)
        rebuildTimeoutRef.current = null
      }
    }
  }, [])

  // Build / rebuild the post-processing pipeline
  useEffect(() => {
    // Intentionally touch these so React/biome treat project switches and retry bumps
    // as explicit rebuild triggers instead of accidental extra dependencies.
    void projectId
    void pipelineVersion

    if (!(renderer && scene && camera && isInitialized)) {
      return
    }

    hasPipelineErrorRef.current = false

    // Clear outliner arrays synchronously to prevent stale Object3D refs
    // from the previous project leaking into the new pipeline's outline passes.
    const outliner = useViewer.getState().outliner
    outliner.selectedObjects.length = 0
    outliner.hoveredObjects.length = 0

    try {
      const scenePass = pass(scene, camera)
      const zonePass = pass(scene, camera)
      zonePass.setLayers(zoneLayers)

      const scenePassColor = scenePass.getTextureNode('output')

      // Background detection via alpha: renderer clears with alpha=0 (setClearAlpha(0) in useFrame),
      // so background pixels have scenePassColor.a=0 while geometry pixels have output.a=1.
      // WebGPU only applies clearColorValue to MRT attachment 0 (output), so scenePassColor.a
      // is the reliable geometry mask — no normals, no flicker.
      const hasGeometry = scenePassColor.a
      const contentAlpha = hasGeometry.max(zonePass.a)

      let sceneColor = scenePassColor as unknown as ReturnType<typeof vec4>

      if (SSGI_PARAMS.enabled) {
        // MRT only needed for SSGI (diffuse for GI, normal for SSGI sampling)
        scenePass.setMRT(
          mrt({
            output,
            diffuseColor,
            normal: directionToColor(normalView),
          }),
        )

        const scenePassDiffuse = scenePass.getTextureNode('diffuseColor')
        const scenePassDepth = scenePass.getTextureNode('depth')
        const scenePassNormal = scenePass.getTextureNode('normal')

        // Optimize texture bandwidth
        const diffuseTexture = scenePass.getTexture('diffuseColor')
        diffuseTexture.type = UnsignedByteType
        const normalTexture = scenePass.getTexture('normal')
        normalTexture.type = UnsignedByteType

        // Extract normal from color-encoded texture
        const sceneNormal = sample((uv) => colorToDirection(scenePassNormal.sample(uv)))

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

        const giTexture = (giPass as any).getTextureNode()

        // DenoiseNode only denoises RGB — alpha is passed through unchanged.
        // SSGI packs AO into alpha, so we remap it into RGB before denoising.
        const aoAsRgb = vec4(giTexture.a, giTexture.a, giTexture.a, float(1))
        const denoisePass = denoise(aoAsRgb, scenePassDepth, sceneNormal, camera)
        denoisePass.index.value = 0
        denoisePass.radius.value = 4

        const gi = giPass.rgb
        const ao = (denoisePass as any).r

        // Composite: scene * AO + diffuse * GI
        sceneColor = vec4(
          add(scenePassColor.rgb.mul(ao), add(zonePass.rgb, scenePassDiffuse.rgb.mul(gi))),
          contentAlpha,
        )
      }

      // Single merged outline node: one shared depth pass for both selected + hovered groups.
      const outliner = useViewer.getState().outliner
      const outlineNode = mergedOutline(scene, camera, {
        primaryObjects: outliner.selectedObjects,
        secondaryObjects: outliner.hoveredObjects,
        primaryEdgeThickness: uniform(1),
        secondaryEdgeThickness: uniform(1.5),
      })

      // Selected: white visible, yellow hidden
      const selectedVisibleColor = uniform(new Color(0xff_ff_ff))
      const selectedHiddenColor = uniform(new Color(0xf3_ff_47))
      const selectedStrength = uniform(3)
      const selectedOutline = outlineNode.primaryVisibleEdge
        .mul(selectedVisibleColor)
        .add(outlineNode.primaryHiddenEdge.mul(selectedHiddenColor))
        .mul(selectedStrength)

      // Hovered: blue visible, yellow hidden, pulsing
      const hoverVisibleColor = uniform(
        new Color(hoverHighlightMode === 'delete' ? 0xef_44_44 : 0x00_aa_ff),
      )
      const hoverHiddenColor = uniform(
        new Color(hoverHighlightMode === 'delete' ? 0x99_1b_1b : 0xf3_ff_47),
      )
      const hoverStrength = uniform(hoverHighlightMode === 'delete' ? 6 : 5)
      const pulsePeriod = uniform(3)
      const osc =
        hoverHighlightMode === 'delete'
          ? float(1)
          : oscSine(time.div(pulsePeriod).mul(2)).mul(0.5).add(0.5) // [ 0.5, 1.0 ]
      const hoverOutline = outlineNode.secondaryVisibleEdge
        .mul(hoverVisibleColor)
        .add(outlineNode.secondaryHiddenEdge.mul(hoverHiddenColor))
        .mul(hoverStrength)
        .mul(osc)

      const compositeWithOutlines = vec4(
        add(sceneColor.rgb, selectedOutline.add(hoverOutline)),
        sceneColor.a,
      )

      const finalOutput = vec4(
        mix(bgUniform.current, compositeWithOutlines.rgb, contentAlpha),
        float(1),
      )

      const renderPipeline = new RenderPipeline(renderer as unknown as WebGPURenderer)
      renderPipeline.outputNode = finalOutput
      renderPipelineRef.current = renderPipeline
      retryCountRef.current = 0
    } catch (error) {
      hasPipelineErrorRef.current = true
      console.error(
        '[viewer] Failed to set up post-processing pipeline. Rendering without post FX.',
        error,
      )
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null
    }

    return () => {
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null
    }
  }, [
    renderer,
    scene,
    camera,
    hoverHighlightMode,
    isInitialized,
    zoneLayers,
    projectId,
    pipelineVersion,
  ])

  useFrame((_, delta) => {
    // Animate background colour toward the current theme target (same lerp as AnimatedBackground)
    bgTarget.current.set(useViewer.getState().theme === 'dark' ? DARK_BG : LIGHT_BG)
    bgCurrent.current.lerp(bgTarget.current, Math.min(delta, 0.1) * 4)
    bgUniform.current.value.copy(bgCurrent.current)

    if (hasPipelineErrorRef.current || !renderPipelineRef.current) {
      try {
        if ((renderer as any).setClearAlpha) {
          ;(renderer as any).setClearAlpha(1)
        }
        ;(renderer as any).render(scene, camera)
      } catch (fallbackError) {
        console.error('[viewer] Fallback render failed.', fallbackError)
      }
      return
    }

    try {
      // Clear alpha=0 so background pixels in the output MRT attachment (index 0) get a=0,
      // making scenePassColor.a a reliable geometry mask (geometry pixels write a=1 via output node).
      ;(renderer as any).setClearAlpha(0)
      renderPipelineRef.current.render()
    } catch (error) {
      hasPipelineErrorRef.current = true
      console.error('[viewer] Post-processing render pass failed.', error)
      if (renderPipelineRef.current) {
        renderPipelineRef.current.dispose()
      }
      renderPipelineRef.current = null

      if (retryCountRef.current < MAX_PIPELINE_RETRIES) {
        // Auto-retry: schedule a pipeline rebuild if we haven't exceeded the retry limit
        retryCountRef.current++
        console.warn(
          `[viewer] Scheduling post-processing rebuild (attempt ${retryCountRef.current}/${MAX_PIPELINE_RETRIES})`,
        )
        if (rebuildTimeoutRef.current !== null) {
          clearTimeout(rebuildTimeoutRef.current)
        }
        rebuildTimeoutRef.current = setTimeout(requestPipelineRebuild, RETRY_DELAY_MS)
      } else {
        console.error(
          '[viewer] Post-processing retries exhausted. Rendering without post FX for this session.',
        )
      }
    }
  }, 1)

  return null
}

export default PostProcessingPasses
