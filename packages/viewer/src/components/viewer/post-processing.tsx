import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Color, UnsignedByteType } from 'three'
import { outline } from 'three/addons/tsl/display/OutlineNode.js'
import { ssgi } from 'three/addons/tsl/display/SSGINode.js'
import { traa } from 'three/addons/tsl/display/TRAANode.js'
import {
  add,
  colorToDirection,
  diffuseColor,
  directionToColor,
  mrt,
  normalView,
  oscSine,
  output,
  pass,
  sample,
  time,
  uniform,
  vec4,
  velocity,
} from 'three/tsl'
import { PostProcessing, type WebGPURenderer } from 'three/webgpu'
import useViewer from '../../store/use-viewer'

// SSGI Parameters - adjust these to fine-tune global illumination and ambient occlusion
export const SSGI_PARAMS = {
  enabled: true,
  sliceCount: 1,
  stepCount: 8,
  radius: 1,
  expFactor: 1.5,
  thickness: 0.5,
  backfaceLighting: 0.5,
  aoIntensity: 1.5,
  giIntensity: 0.5,
  useLinearThickness: false,
  useScreenSpaceSampling: true,
  useTemporalFiltering: true,
}

const PostProcessingPasses = () => {
  const { gl: renderer, scene, camera } = useThree()
  const postProcessingRef = useRef<PostProcessing | null>(null)

  useEffect(() => {
    if (!renderer || !scene || !camera) {
      return
    }

    // Scene pass with MRT for SSGI
    const scenePass = pass(scene, camera)
    scenePass.setMRT(
      mrt({
        output: output,
        diffuseColor: diffuseColor,
        normal: directionToColor(normalView),
        velocity: velocity,
      }),
    )

    // Get texture outputs
    const scenePassColor = scenePass.getTextureNode('output')
    const scenePassDiffuse = scenePass.getTextureNode('diffuseColor')
    const scenePassDepth = scenePass.getTextureNode('depth')
    const scenePassNormal = scenePass.getTextureNode('normal')
    const scenePassVelocity = scenePass.getTextureNode('velocity')

    // Optimize texture bandwidth
    const diffuseTexture = scenePass.getTexture('diffuseColor')
    diffuseTexture.type = UnsignedByteType

    const normalTexture = scenePass.getTexture('normal')
    normalTexture.type = UnsignedByteType

    // Extract normal from color-encoded texture
    const sceneNormal = sample((uv) => {
      return colorToDirection(scenePassNormal.sample(uv))
    })

    // SSGI Pass (cast to PerspectiveCamera for SSGI)
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

    // Extract GI and AO from SSGI pass
    const gi = giPass.rgb
    const ao = giPass.a

    // Composite: scene * AO + diffuse * GI
    const compositePass = vec4(
      add(scenePassColor.rgb.mul(ao), scenePassDiffuse.rgb.mul(gi)),
      scenePassColor.a,
    )

    // TRAA (Temporal Reprojection Anti-Aliasing)
    const traaPass = traa(compositePass, scenePassDepth, scenePassVelocity, camera)

    function generateSelectedOutlinePass() {
      const edgeStrength = uniform(3)
      const edgeGlow = uniform(0)
      const edgeThickness = uniform(1)
      const visibleEdgeColor = uniform(new Color(0xffffff))
      const hiddenEdgeColor = uniform(new Color(0xf3ff47))

      const outlinePass = outline(scene, camera, {
        selectedObjects: useViewer.getState().outliner.selectedObjects,
        edgeGlow,
        edgeThickness,
      })
      const { visibleEdge, hiddenEdge } = outlinePass

      const outlineColor = visibleEdge
        .mul(visibleEdgeColor)
        .add(hiddenEdge.mul(hiddenEdgeColor))
        .mul(edgeStrength)

      return outlineColor
    }
    function generateHoverOutlinePass() {
      const edgeStrength = uniform(5)
      const edgeGlow = uniform(0.5)
      const edgeThickness = uniform(1.5)
      const pulsePeriod = uniform(3)
      const visibleEdgeColor = uniform(new Color(0x00aaff))
      const hiddenEdgeColor = uniform(new Color(0xf3ff47))

      const outlinePass = outline(scene, camera, {
        selectedObjects: useViewer.getState().outliner.hoveredObjects,
        edgeGlow,
        edgeThickness,
      })
      const { visibleEdge, hiddenEdge } = outlinePass

      const period = time.div(pulsePeriod).mul(2)
      const osc = oscSine(period).mul(0.5).add(0.5) // osc [ 0.5, 1.0 ]

      const outlineColor = visibleEdge
        .mul(visibleEdgeColor)
        .add(hiddenEdge.mul(hiddenEdgeColor))
        .mul(edgeStrength)
      const outlinePulse = pulsePeriod.greaterThan(0).select(outlineColor.mul(osc), outlineColor)
      return outlinePulse
    }

    // Setup post-processing
    const postProcessing = new PostProcessing(renderer as unknown as WebGPURenderer)

    const selectedOutlinePass = generateSelectedOutlinePass()
    const hoverOutlinePass = generateHoverOutlinePass()

    // Combine SSGI output with outlines
    const finalOutput = SSGI_PARAMS.enabled
      ? selectedOutlinePass.add(hoverOutlinePass).add(traaPass)
      : selectedOutlinePass.add(hoverOutlinePass).add(scenePassColor)

    postProcessing.outputNode = finalOutput
    postProcessingRef.current = postProcessing

    return () => {
      if (postProcessingRef.current) {
        postProcessingRef.current.dispose()
      }
      postProcessingRef.current = null
    }
  }, [renderer, scene, camera])

  useFrame(() => {
    if (postProcessingRef.current) {
      postProcessingRef.current.render()
    }
  }, 1)

  return null
}

export default PostProcessingPasses
