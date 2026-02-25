"use client";

import { Building2, Settings } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/primitives/tooltip";
import { cn } from "@/lib/utils";

export type PanelId = "site" | "settings";

interface IconRailProps {
  activePanel: PanelId;
  onPanelChange: (panel: PanelId) => void;
  className?: string;
}

const panels: { id: PanelId; icon: typeof Building2; label: string }[] = [
  { id: "site", icon: Building2, label: "Site" },
  { id: "settings", icon: Settings, label: "Settings" },
];

export function IconRail({
  activePanel,
  onPanelChange,
  className,
}: IconRailProps) {
  return (
    <div
      className={cn(
        "flex w-11 flex-col items-center gap-1 border-border/50 border-r py-2",
        className,
      )}
    >
      {/* Pascal logo - link to the home page */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-all hover:bg-primary/90 mb-1"
          >
            <Image
              src="/pascal-logo-shape.svg"
              alt="Pascal"
              width={16}
              height={16}
              className="h-4 w-4"
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Back to Pascal Editor</TooltipContent>
      </Tooltip>

      {/* Divider */}
      <div className="w-8 h-px bg-border/50 mb-1" />

      {panels.map((panel) => {
        const Icon = panel.icon;
        const isActive = activePanel === panel.id;
        return (
          <Tooltip key={panel.id}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
                onClick={() => onPanelChange(panel.id)}
                type="button"
              >
                <Icon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{panel.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export { panels };
