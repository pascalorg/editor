import { emitter, GridEvent, useScene, WallNode } from "@pascal-app/core";
import { useViewer } from "@pascal-app/viewer";
import { useEffect, useRef } from "react"
import { Line, Mesh, Vector3 } from "three";

export const WallEditor: React.FC = () => {

  const cursorRef = useRef<Mesh>(null);
  const drawingLineRef = useRef<Line>(null!);

  useEffect(() => {

    let buildingState = 0;
    const startingPoint = new Vector3(0, 0, 0);
    const endingPoint = new Vector3(0, 0, 0);
    let gridPosition: [number, number] = [0, 0];

        
        drawingLineRef.current.geometry.setFromPoints([
          startingPoint,
          endingPoint,
        ]);

    const onGridMove = (event: GridEvent) => {
      if (!cursorRef.current) return;

      gridPosition = [Math.round(event.position[0] * 2) / 2, Math.round(event.position[1] * 2) / 2];
      cursorRef.current.position.set(gridPosition[0], 0.1, gridPosition[1]);
      if (buildingState === 1) {
        endingPoint.set(gridPosition[0], 0.1, gridPosition[1]);
      }
      drawingLineRef.current.geometry.setFromPoints([
        startingPoint,
        endingPoint,
      ]);
    };
    const onGridClick = (event: GridEvent) => {
      if (buildingState === 0) {
        startingPoint.set(gridPosition[0], 0.1, gridPosition[1]);
        buildingState = 1;
        console.log('starting building at:', startingPoint);
        drawingLineRef.current.visible = true;

      } else if (buildingState === 1) {
        const currentLevelId = useViewer.getState().currentLevelId;
        console.log('currentLevelId:', currentLevelId);
        if (currentLevelId) {
          const wallNode = WallNode.parse({
            start: [startingPoint.x, startingPoint.z],
            end: [gridPosition[0], gridPosition[1]],
          })
          useScene.getState().createNode(wallNode, currentLevelId);
        }
        drawingLineRef.current.visible = false;
        buildingState = 0;
      }
      
    };


    emitter.on('grid:move', onGridMove);
    emitter.on('grid:click', onGridClick);

    return () => {
      emitter.off('grid:move', onGridMove);
      emitter.off('grid:click', onGridClick);
    };
  }, []);

  return (
    <group>
    <mesh ref={cursorRef}>
      <boxGeometry args={[0.2, 0.2, 0.2]} />
      <meshStandardMaterial color="red" />
    </mesh>
    <group>
    {/* @ts-ignore */}
    <line ref={drawingLineRef} frustumCulled={false} renderOrder={1} visible={false}>
      <bufferGeometry  />
      <lineDashedNodeMaterial color="blue" linewidth={4} linecap="round" depthTest={false} depthWrite={false} dashSize={2} gapSize={0.1} />
    </line>
    </group>
    </group>
  )
}