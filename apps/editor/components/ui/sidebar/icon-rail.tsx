"use client";

import { Moon, Sun } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/primitives/tooltip";
import { cn } from "@/lib/utils";
import { useViewer } from "@pascal-app/viewer";

export type PanelId = "site" | "settings";

interface IconRailProps {
  activePanel: PanelId;
  onPanelChange: (panel: PanelId) => void;
  className?: string;
}

const panels: { id: PanelId; iconSrc: string; label: string }[] = [
  { id: "site", iconSrc: "/icons/level.png", label: "Site" },
  { id: "settings", iconSrc: "/icons/settings.png", label: "Settings" },
];

export function IconRail({
  activePanel,
  onPanelChange,
  className,
}: IconRailProps) {
  const theme = useViewer((state) => state.theme);
  const setTheme = useViewer((state) => state.setTheme);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      className={cn(
        "flex h-full w-11 flex-col items-center gap-1 border-border/50 border-r py-2",
        className,
      )}
    >
      {/* Pascal logo - link to the home page */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/"
            className="flex h-9 w-9 items-center justify-center rounded-lg transition-all hover:bg-accent"
          >
            <Image
              src="/pascal-logo-shape.svg"
              alt="Pascal"
              width={24}
              height={24}
              className="h-6 w-6 dark:invert"
            />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">Back to Pascal Editor</TooltipContent>
      </Tooltip>

      {/* Divider */}
      <div className="w-8 h-px bg-border/50 mb-1" />

      {panels.map((panel) => {
        const isActive = activePanel === panel.id;
        return (
          <Tooltip key={panel.id}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg transition-all",
                  isActive
                    ? "bg-accent"
                    : "hover:bg-accent",
                )}
                onClick={() => onPanelChange(panel.id)}
                type="button"
              >
                <img 
                  src={panel.iconSrc} 
                  alt={panel.label} 
                  className={cn(
                    "h-6 w-6 transition-all object-contain", 
                    !isActive && "opacity-50 saturate-0"
                  )} 
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{panel.label}</TooltipContent>
          </Tooltip>
        );
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Theme Toggle */}
      {mounted && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg transition-all text-muted-foreground hover:bg-accent hover:text-accent-foreground mb-2"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              type="button"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Toggle theme</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export { panels };
