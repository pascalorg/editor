import useEditor, { type Phase, type Tool } from "@/store/use-editor";
import { useViewer } from "@pascal-app/viewer";
import { CeilingTool } from "./ceiling/ceiling-tool";
import { ItemTool } from "./item/item-tool";
import { MoveTool } from "./item/move-tool";
import { RoofTool } from "./roof/roof-tool";
import { SlabTool } from "./slab/slab-tool";
import { WallTool } from "./wall/wall-tool";
import { SiteBoundaryEditor } from "./site/site-boundary-editor";
import { ZoneBoundaryEditor } from "./zone/zone-boundary-editor";
import { ZoneTool } from "./zone/zone-tool";

const tools: Record<Phase, Partial<Record<Tool, React.FC>>> = {
  site: {},
  structure: {
    wall: WallTool,
    slab: SlabTool,
    ceiling: CeilingTool,
    roof: RoofTool,
    item: ItemTool,
    zone: ZoneTool,
  },
  furnish: {
    item: ItemTool,
  },
};

export const ToolManager: React.FC = () => {
  const phase = useEditor((state) => state.phase);
  const mode = useEditor((state) => state.mode);
  const tool = useEditor((state) => state.tool);
  const movingNode = useEditor((state) => state.movingNode);
  const selectedZoneId = useViewer((state) => state.selection.zoneId);

  // Show site boundary editor when in site/edit mode
  const showSiteBoundaryEditor = phase === "site" && mode === "edit";

  // Show zone boundary editor when in structure/select mode with a zone selected
  const showZoneBoundaryEditor =
    phase === "structure" && mode === "select" && selectedZoneId !== null;

  // Show build tools when in build mode
  const showBuildTool = mode === "build" && tool !== null;

  const BuildToolComponent = showBuildTool ? tools[phase]?.[tool] : null;

  return (
    <>
      {showSiteBoundaryEditor && <SiteBoundaryEditor />}
      {showZoneBoundaryEditor && <ZoneBoundaryEditor />}
      {movingNode && <MoveTool />}
      {!movingNode && BuildToolComponent && <BuildToolComponent />}
    </>
  );
};
