import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Color } from "three";
import { outline } from "three/addons/tsl/display/OutlineNode.js";
import { oscSine, pass, time, uniform } from "three/tsl";
import { PostProcessing, type WebGPURenderer } from "three/webgpu";
import useViewer from "../../store/use-viewer";

const PostProcessingPasses = () => {
  const { gl: renderer, scene, camera } = useThree();
  const postProcessingRef = useRef<PostProcessing | null>(null);

  useEffect(() => {
    if (!renderer || !scene || !camera) {
      return;
    }

    const scenePass = pass(scene, camera);

    function generateSelectedOutlinePass() {
      const edgeStrength = uniform(3);
      const edgeGlow = uniform(0);
      const edgeThickness = uniform(1);
      const visibleEdgeColor = uniform(new Color(0xffffff));
      const hiddenEdgeColor = uniform(new Color(0xf3ff47));

      const outlinePass = outline(scene, camera, {
        selectedObjects: useViewer.getState().outliner.selectedObjects,
        edgeGlow,
        edgeThickness,
      });
      const { visibleEdge, hiddenEdge } = outlinePass;

      const outlineColor = visibleEdge
        .mul(visibleEdgeColor)
        .add(hiddenEdge.mul(hiddenEdgeColor))
        .mul(edgeStrength);

      return outlineColor;
    }
    function generateHoverOutlinePass() {
      const edgeStrength = uniform(5);
      const edgeGlow = uniform(0.5);
      const edgeThickness = uniform(1.5);
      const pulsePeriod = uniform(3);
      const visibleEdgeColor = uniform(new Color(0x00aaff));
      const hiddenEdgeColor = uniform(new Color(0xf3ff47));

      const outlinePass = outline(scene, camera, {
        selectedObjects: useViewer.getState().outliner.hoveredObjects,
        edgeGlow,
        edgeThickness,
      });
      const { visibleEdge, hiddenEdge } = outlinePass;

      const period = time.div(pulsePeriod).mul(2);
      const osc = oscSine(period).mul(0.5).add(0.5); // osc [ 0.5, 1.0 ]

      const outlineColor = visibleEdge
        .mul(visibleEdgeColor)
        .add(hiddenEdge.mul(hiddenEdgeColor))
        .mul(edgeStrength);
      const outlinePulse = pulsePeriod
        .greaterThan(0)
        .select(outlineColor.mul(osc), outlineColor);
      return outlinePulse;
    }

    // Setup post-processing
    const postProcessing = new PostProcessing(
      renderer as unknown as WebGPURenderer,
    );

    const selectedOutlinePass = generateSelectedOutlinePass();
    const hoverOutlinePass = generateHoverOutlinePass();

    postProcessing.outputNode = selectedOutlinePass
      .add(hoverOutlinePass)
      .add(scenePass);
    postProcessingRef.current = postProcessing;

    return () => {
      if (postProcessingRef.current) {
        postProcessingRef.current.dispose();
      }
      postProcessingRef.current = null;
    };
  }, [renderer, scene, camera]);

  useFrame(() => {
    if (postProcessingRef.current) {
      postProcessingRef.current.render();
    }
  }, 1);

  return null;
};

export default PostProcessingPasses;
