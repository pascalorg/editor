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
                  isActive && "bg-primary shadow-lg shadow-primary/40 ring-2 ring-primary ring-offset-2 ring-offset-zinc-950 scale-110 z-10",
                  !isActive && hasActiveTool && "opacity-30 hover:opacity-60 scale-95 grayscale",
                  !isActive && !hasActiveTool && "opacity-60 hover:opacity-100 hover:bg-white/10 hover:scale-105",
                )}
                onClick={() => {
                  if (isActive) {
                    setActiveTool(null);
                    setCatalogCategory(null);
                    setMode("select");
                  } else {
                    setCatalogCategory(tool.catalogCategory);
                    setActiveTool("item");
                    if (mode !== "build") {
                      setMode("build");
                    }
                  }
                }}
                size="icon"
                variant={isActive ? "default" : "ghost"}
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
                {isActive && " (Click to deselect)"}
              </p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
