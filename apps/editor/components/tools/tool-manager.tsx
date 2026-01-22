import useEditor, { type Phase, type Tool } from "@/store/use-editor";
import { ItemTool } from "./item/item-tool";
import { WallTool } from "./wall/wall-tool";
import { ZoneTool } from "./zone/zone-tool";

const tools: Record<Phase, Partial<Record<Tool, React.FC>>> = {
  site: {},
  structure: {
    wall: WallTool,
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

  if (mode !== "build" || tool === null) return null;

  const Component = tools[phase]?.[tool];

  return Component ? <Component /> : null;
};
