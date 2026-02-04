import type { AnyNode, BaseNode, BuildingNode, LevelNode, ZoneNode } from "@pascal-app/core";
import type { Object3D } from "three";
type SelectionPath = {
    buildingId: BuildingNode["id"] | null;
    levelId: LevelNode["id"] | null;
    zoneId: ZoneNode["id"] | null;
    selectedIds: BaseNode["id"][];
};
type Outliner = {
    selectedObjects: Object3D[];
    hoveredObjects: Object3D[];
};
type ViewerState = {
    selection: SelectionPath;
    hoveredId: AnyNode['id'] | ZoneNode['id'] | null;
    setHoveredId: (id: AnyNode['id'] | ZoneNode['id'] | null) => void;
    cameraMode: 'perspective' | 'orthographic';
    setCameraMode: (mode: 'perspective' | 'orthographic') => void;
    levelMode: 'stacked' | 'exploded' | 'solo' | 'manual';
    setLevelMode: (mode: 'stacked' | 'exploded' | 'solo' | 'manual') => void;
    wallMode: 'up' | 'cutaway' | 'down';
    setWallMode: (mode: 'up' | 'cutaway' | 'down') => void;
    showScans: boolean;
    setShowScans: (show: boolean) => void;
    showGuides: boolean;
    setShowGuides: (show: boolean) => void;
    setSelection: (updates: Partial<SelectionPath>) => void;
    resetSelection: () => void;
    outliner: Outliner;
    exportScene: (() => Promise<void>) | null;
    setExportScene: (fn: (() => Promise<void>) | null) => void;
};
declare const useViewer: import("zustand").UseBoundStore<import("zustand").StoreApi<ViewerState>>;
export default useViewer;
//# sourceMappingURL=use-viewer.d.ts.map