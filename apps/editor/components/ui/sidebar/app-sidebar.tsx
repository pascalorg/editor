"use client";

import { useState } from "react";
import { IconRail, type PanelId } from "./icon-rail";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/primitives/sidebar";
import { cn } from "@/lib/utils";
import { SettingsPanel } from "./panels/settings-panel";
import { SitePanel } from "./panels/site-panel";

export function AppSidebar() {
  const [activePanel, setActivePanel] = useState<PanelId>("site");

  const renderPanelContent = () => {
    switch (activePanel) {
      case "site":
        return <SitePanel />;
      case "settings":
        return <SettingsPanel />;
      default:
        return null;
    }
  };

  const getPanelTitle = () => {
    switch (activePanel) {
      case "site":
        return "Site";
      case "settings":
        return "Settings";
      default:
        return "";
    }
  };

  return (
    <Sidebar className={cn("dark text-white ")} variant="floating">
      <div className="flex h-full">
        {/* Icon Rail */}
        <IconRail activePanel={activePanel} onPanelChange={setActivePanel} />

        {/* Panel Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <SidebarHeader className="flex-row items-center justify-between px-3 py-2">
            <h3 className="font-semibold text-base">{getPanelTitle()}</h3>
          </SidebarHeader>

          <SidebarContent
            className={cn("no-scrollbar flex flex-1 flex-col overflow-hidden")}
          >
            {renderPanelContent()}
          </SidebarContent>
        </div>
      </div>
    </Sidebar>
  );
}
