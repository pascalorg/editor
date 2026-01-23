"use client";

// import JsonView from '@uiw/react-json-view'
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/shallow";
import { IconRail, type PanelId } from "./icon-rail";

import { Button } from "@/components/ui/primitives/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/primitives/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/primitives/dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/primitives/sidebar";
import { cn } from "@/lib/utils";
import useEditor from "@/store/use-editor";
import { useViewer } from "@pascal-app/viewer";
import { SettingsPanel } from "./panels/settings-panel";
import { SitePanel } from "./panels/site-panel";
import { ZonePanel } from "./panels/zone-panel";

export function AppSidebar() {
  // const isHelpOpen = useEditor((state) => state.isHelpOpen);
  // const setIsHelpOpen = useEditor((state) => state.setIsHelpOpen);
  // const isJsonInspectorOpen = useEditor((state) => state.isJsonInspectorOpen);
  // const setIsJsonInspectorOpen = useEditor(
  //   (state) => state.setIsJsonInspectorOpen,
  // );
  // const selectedNodeIds = useEditor((state) => state.selectedNodeIds);
  // const handleDeleteSelected = useEditor((state) => state.handleDeleteSelected);
  // const serializeLayout = useEditor((state) => state.serializeLayout);
  const activeTool = useEditor((state) => state.tool);
  const currentLevelId = useViewer((state) => state.selection.levelId);
  const setPhase = useEditor((state) => state.setPhase);
  const setMode = useEditor((state) => state.setMode);
  const setActiveTool = useEditor((state) => state.setTool);

  const [jsonCollapsed, setJsonCollapsed] = useState<boolean | number>(1);
  const [mounted, setMounted] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelId>("site");

  // Wait for client-side hydration to complete before rendering store-dependent content
  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle backspace key to delete selected elements
  // useEffect(() => {
  //   const handleKeyDown = (event: KeyboardEvent) => {
  //     if (event.key === "Backspace" && selectedNodeIds.length > 0) {
  //       event.preventDefault();
  //       handleDeleteSelected();
  //     }
  //   };

  //   document.addEventListener("keydown", handleKeyDown);
  //   return () => document.removeEventListener("keydown", handleKeyDown);
  // }, [selectedNodeIds, handleDeleteSelected]);

  // Auto-switch to zones panel when zone tool is active
  useEffect(() => {
    if (activeTool === "zone") {
      setActivePanel("zones");
    }
  }, [activeTool]);

  const renderPanelContent = () => {
    switch (activePanel) {
      case "site":
        return <SitePanel />;
      case "zones":
        return <ZonePanel />;
      // case "collections":
      //   return <CollectionsPanel />;
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
      case "zones":
        return "Zones";
      case "collections":
        return "Collections";
      case "settings":
        return "Settings";
      default:
        return "";
    }
  };

  const handleAddZone = () => {
    if (currentLevelId) {
      setPhase("structure");
      setMode("build");
      setActiveTool("zone");
    }
  };

  // const handleAddCollection = () => {
  //   const existingNames = collections.map((c) => c.name);
  //   let counter = 1;
  //   let newName = `Collection ${counter}`;
  //   while (existingNames.includes(newName)) {
  //     counter++;
  //     newName = `Collection ${counter}`;
  //   }
  //   addCollection(newName);
  // };

  const renderHeaderAction = () => {
    switch (activePanel) {
      case "zones":
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                className="size-6 p-0"
                disabled={!currentLevelId}
                onClick={handleAddZone}
                size="sm"
                variant="ghost"
              >
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {currentLevelId ? "Add new zone" : "Select a level first"}
            </TooltipContent>
          </Tooltip>
        );
      // case "collections":
      //   if (addToCollectionState.isActive) {
      //     return (
      //       <Tooltip>
      //         <TooltipTrigger asChild>
      //           <Button
      //             className="size-6 p-0 text-destructive"
      //             onClick={cancelAddToCollection}
      //             size="sm"
      //             variant="ghost"
      //           >
      //             <X className="size-4" />
      //           </Button>
      //         </TooltipTrigger>
      //         <TooltipContent>Cancel</TooltipContent>
      //       </Tooltip>
      //     );
      //   }
      //   return (
      //     <Tooltip>
      //       <TooltipTrigger asChild>
      //         <Button
      //           className="size-6 p-0"
      //           onClick={handleAddCollection}
      //           size="sm"
      //           variant="ghost"
      //         >
      //           <Plus className="size-4" />
      //         </Button>
      //       </TooltipTrigger>
      //       <TooltipContent>Add new collection</TooltipContent>
      //     </Tooltip>
      //   );
      default:
        return null;
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
            {renderHeaderAction()}
          </SidebarHeader>

          <SidebarContent
            className={cn("no-scrollbar flex flex-1 flex-col overflow-hidden")}
          >
            {renderPanelContent()}
          </SidebarContent>
        </div>
      </div>

      {/* Dialogs */}
      {/*
      <Dialog onOpenChange={setIsJsonInspectorOpen} open={isJsonInspectorOpen}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Build Data Inspector</span>
              <div className="flex gap-2">
                <Button
                  className="gap-1"
                  onClick={() => setJsonCollapsed(false)}
                  size="sm"
                  variant="outline"
                >
                  <ChevronDown className="h-3 w-3" />
                  Expand All
                </Button>
                <Button
                  className="gap-1"
                  onClick={() => setJsonCollapsed(true)}
                  size="sm"
                  variant="outline"
                >
                  <ChevronRight className="h-3 w-3" />
                  Collapse All
                </Button>
              </div>
            </DialogTitle>
            <DialogDescription>
              View the raw JSON structure of your current build
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <JsonView
                collapsed={jsonCollapsed}
                style={{
                  fontSize: '12px',
                }}
                value={serializeLayout()}
              /> 
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setIsHelpOpen} open={isHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>House Builder Controls</DialogTitle>
            <DialogDescription>
              - Click on grid intersections to place walls using the building
              tools.
              <br />- Hold spacebar to enable camera controls (orbit, pan,
              zoom).
              <br />- Use control modes (Select/Delete/Building) to switch
              between different interactions.
              <br />- Create multiple levels and organize your 3D objects and
              guides within each level.
              <br />- Click on level names to select them and expand/collapse
              with the chevron icons.
              <br />- Upload PNG/JPEG reference images as guides within each
              level.
              <br />- Save your build as JSON file for later use or database
              storage.
              <br />- Load previously saved builds from JSON files.
              <br />- Inspect data to view the raw JSON structure of your
              current build.
              <br />- Export your 3D model as GLB file.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      */}
    </Sidebar>
  );
}
