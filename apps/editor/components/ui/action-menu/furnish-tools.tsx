"use client";

import NextImage from "next/image";
import { Button } from "@/components/ui/primitives/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/primitives/tooltip";

import { cn } from "@/lib/utils";
import useEditor, { CatalogCategory } from "@/store/use-editor";

export type FurnishToolConfig = {
  id: "item";
  iconSrc: string;
  label: string;
  catalogCategory: CatalogCategory;
};

// Furnish mode tools: furniture, appliances, decoration (painting is now a control mode)
export const furnishTools: FurnishToolConfig[] = [
  {
    id: "item",
    iconSrc: "/icons/couch.png",
    label: "Furniture",
    catalogCategory: "furniture",
  },
  {
    id: "item",
    iconSrc: "/icons/appliance.png",
    label: "Appliance",
    catalogCategory: "appliance",
  },
  {
    id: "item",
    iconSrc: "/icons/kitchen.png",
    label: "Kitchen",
    catalogCategory: "kitchen",
  },
  {
    id: "item",
    iconSrc: "/icons/bathroom.png",
    label: "Bathroom",
    catalogCategory: "bathroom",
  },
  {
    id: "item",
    iconSrc: "/icons/tree.png",
    label: "Outdoor",
    catalogCategory: "outdoor",
  },
];

export function FurnishTools() {
  const mode = useEditor((state) => state.mode);
  const activeTool = useEditor((state) => state.tool);
  const setActiveTool = useEditor((state) => state.setTool);
  const setMode = useEditor((state) => state.setMode);
  const catalogCategory = useEditor((state) => state.catalogCategory);
  const setCatalogCategory = useEditor((state) => state.setCatalogCategory);

  const hasActiveTool = furnishTools.some((tool) =>
    mode === "build" &&
    activeTool === "item" &&
    catalogCategory === tool.catalogCategory
  );

  return (
    <div className="flex items-center gap-1.5 px-1">
      {furnishTools.map((tool, index) => {
        // For item tools with catalog category, check both tool and category match
        const isActive =
          mode === "build" &&
          activeTool === "item" &&
          catalogCategory === tool.catalogCategory;

        return (
          <Tooltip key={`${tool.id}-${tool.catalogCategory ?? index}`}>
            <TooltipTrigger asChild>
              <Button
                className={cn(
                  "size-11 rounded-lg transition-all duration-300",
                  isActive ? "bg-black/40 hover:bg-black/40 scale-110 z-10" : "bg-transparent opacity-60 grayscale hover:opacity-100 hover:grayscale-0 hover:bg-black/20 scale-95",
                )}
                onClick={() => {
                  if (!isActive) {
                    setCatalogCategory(tool.catalogCategory);
                    setActiveTool("item");
                    if (mode !== "build") {
                      setMode("build");
                    }
                  }
                }}
                size="icon"
                variant="ghost"
              >
                <NextImage
                  alt={tool.label}
                  className="size-full object-contain"
                  height={28}
                  src={tool.iconSrc}
                  width={28}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {tool.label}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
