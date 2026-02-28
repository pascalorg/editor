"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { IconRail, type PanelId } from "./icon-rail";
import { Pencil, Moon, Sun, Monitor } from "lucide-react";
import { motion } from "framer-motion";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/primitives/sidebar";
import { cn } from "@/lib/utils";
import { SettingsPanel } from "./panels/settings-panel";
import { SitePanel } from "./panels/site-panel";
import { useProjectStore } from "@/features/community/lib/projects/store";
import { updateProjectName } from "@/features/community/lib/projects/actions";
import { useViewer } from "@pascal-app/viewer";

export function AppSidebar() {
  const [activePanel, setActivePanel] = useState<PanelId>("site");
  const activeProject = useProjectStore((s) => s.activeProject);
  const theme = useViewer((state) => state.theme);
  const setTheme = useViewer((state) => state.setTheme);
  const [mounted, setMounted] = useState(false);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isEditingTitle) {
      setTitleValue(activeProject?.name || "Untitled Project");
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 0);
    }
  }, [isEditingTitle, activeProject?.name]);

  const handleSaveTitle = useCallback(async () => {
    const trimmed = titleValue.trim();
    if (trimmed && activeProject && trimmed !== activeProject.name) {
      // Optimistic update
      useProjectStore.setState((state) => ({
        activeProject: state.activeProject ? { ...state.activeProject, name: trimmed } : null,
        projects: state.projects.map((p) => p.id === activeProject.id ? { ...p, name: trimmed } : p)
      }));
      // Server update
      try {
        await updateProjectName(activeProject.id, trimmed);
      } catch (error) {
        console.error("Failed to update project name:", error);
      }
    }
    setIsEditingTitle(false);
  }, [titleValue, activeProject]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsEditingTitle(false);
    }
  };

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
          <SidebarHeader className="flex-col items-start justify-center px-3 py-3 gap-1 border-b border-border/50 relative">
            <div className="flex w-full items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                {isEditingTitle ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={titleValue}
                    onChange={(e) => setTitleValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={handleSaveTitle}
                    placeholder="Untitled Project"
                    className="w-full bg-transparent text-foreground outline-none border-b border-primary/50 focus:border-primary rounded-none px-0 py-0 m-0 h-7 font-semibold text-lg"
                  />
                ) : (
                  <div 
                    className="flex items-center gap-2 group/title cursor-pointer w-full h-7 border-b border-transparent"
                    onClick={() => setIsEditingTitle(true)}
                  >
                    <h1 className="font-semibold text-lg truncate">
                      {activeProject?.name || "Untitled Project"}
                    </h1>
                    <Pencil className="w-3.5 h-3.5 opacity-0 group-hover/title:opacity-100 transition-opacity text-muted-foreground shrink-0" />
                  </div>
                )}
              </div>
              
              {mounted && (
                <button
                  className="shrink-0 flex items-center bg-accent/50 rounded-full p-1 border border-border/50 cursor-pointer"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  type="button"
                  aria-label="Toggle theme"
                >
                  <div className="relative flex">
                    {/* Sliding Background */}
                    <motion.div
                      className="absolute inset-0 bg-white shadow-sm rounded-full dark:bg-white/20"
                      initial={false}
                      animate={{
                        x: theme === "light" ? "100%" : "0%",
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 500,
                        damping: 35,
                      }}
                      style={{ width: "50%" }}
                    />

                    {/* Dark Mode Icon */}
                    <div
                      className={cn(
                        "relative z-10 flex h-6 w-8 items-center justify-center rounded-full transition-colors duration-200 pointer-events-none",
                        theme === "dark"
                          ? "text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      <Moon className="h-3.5 w-3.5" />
                    </div>

                    {/* Light Mode Icon */}
                    <div
                      className={cn(
                        "relative z-10 flex h-6 w-8 items-center justify-center rounded-full transition-colors duration-200 pointer-events-none",
                        theme === "light"
                          ? "text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      <Sun className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </button>
              )}
            </div>
            
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {getPanelTitle()}
            </span>
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
