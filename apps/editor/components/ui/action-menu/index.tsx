"use client";

import { TooltipProvider } from "@/components/ui/primitives/tooltip";
import { cn } from "@/lib/utils";

import { ControlModes } from "./control-modes";
import { PhaseSwitcher } from "./phase-switcher";
// import { ViewToggles } from "./view-toggles";

export function ActionMenu({ className }: { className?: string }) {
  return (
    <TooltipProvider>
      <div
        className={cn(
          "-translate-x-1/2 fixed bottom-6 left-1/2 z-50",
          "rounded-2xl border border-zinc-800 bg-zinc-950/90 shadow-2xl backdrop-blur-md",
          "transition-all duration-200 ease-out",
          className
        )}
      >
        {/* Control Mode Row - Always visible, centered */}
        <div className="flex items-center justify-center gap-1 px-2 py-1.5">
          <PhaseSwitcher />
          <div className="mx-1 h-5 w-px bg-zinc-700" />
          <ControlModes />
          {/* <div className="mx-1 h-5 w-px bg-zinc-700" /> */}
          {/* <ViewToggles /> */}
        </div>
      </div>
    </TooltipProvider>
  );
}
