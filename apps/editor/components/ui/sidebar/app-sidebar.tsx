"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { IconRail, type PanelId } from "./icon-rail";
import { Pencil, Moon, Sun } from "lucide-react";
import { motion } from "framer-motion";
import { useScene } from "@pascal-app/core";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/primitives/sidebar";
import { cn } from "@/lib/utils";
import { SettingsPanel } from "./panels/settings-panel";
import { SitePanel } from "./panels/site-panel";
import {
  getProjectVersionStatus,
  saveProjectModel,
  saveProjectVersion,
  type ProjectVersionStatus,
} from "@/features/community/lib/models/actions";
import { useProjectStore } from "@/features/community/lib/projects/store";
import { updateProjectName } from "@/features/community/lib/projects/actions";
import { useViewer } from "@pascal-app/viewer";

export function AppSidebar() {
  type VersionAction = "save" | "savePublish" | "publish";

  const [activePanel, setActivePanel] = useState<PanelId>("site");
  const activeProject = useProjectStore((s) => s.activeProject);
  const theme = useViewer((state) => state.theme);
  const setTheme = useViewer((state) => state.setTheme);
  const [mounted, setMounted] = useState(false);

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [versionStatus, setVersionStatus] = useState<ProjectVersionStatus | null>(null);
  const [activeVersionAction, setActiveVersionAction] = useState<VersionAction | null>(null);
  const activeProjectId = activeProject?.id ?? null;

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

  const applyVersionStatus = useCallback(
    (status: ProjectVersionStatus) => {
      if (!activeProjectId) return;

      const publishedVersion = status.publishedVersion ?? null;
      setVersionStatus(status);
      useProjectStore.setState((state) => ({
        activeProject: state.activeProject
          ? {
              ...state.activeProject,
              published_model_version: publishedVersion,
            }
          : null,
        projects: state.projects.map((project) =>
          project.id === activeProjectId
            ? {
                ...project,
                published_model_version: publishedVersion,
              }
            : project,
        ),
      }));
    },
    [activeProjectId],
  );

  const refreshVersionStatus = useCallback(async () => {
    if (!activeProjectId) {
      setVersionStatus(null);
      return;
    }

    const statusResult = await getProjectVersionStatus(activeProjectId);
    if (!statusResult.success || !statusResult.data) {
      return;
    }

    if (useProjectStore.getState().activeProject?.id !== activeProjectId) {
      return;
    }

    applyVersionStatus(statusResult.data);
  }, [activeProjectId, applyVersionStatus]);

  useEffect(() => {
    if (!activeProjectId) {
      setVersionStatus(null);
      return;
    }

    refreshVersionStatus();

    const intervalId = window.setInterval(() => {
      refreshVersionStatus();
    }, 12_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeProjectId, refreshVersionStatus]);

  const runVersionAction = useCallback(
    async (action: VersionAction) => {
      if (!activeProjectId || activeVersionAction) return;

      setActiveVersionAction(action);

      try {
        const { nodes, rootNodeIds } = useScene.getState();
        const sceneGraph = { nodes, rootNodeIds };

        // Flush latest in-memory scene into the current draft before version actions.
        const saveDraftResult = await saveProjectModel(activeProjectId, sceneGraph);
        if (!saveDraftResult.success) {
          console.error("Failed to save draft:", saveDraftResult.error);
          return;
        }
        if (saveDraftResult.data) {
          applyVersionStatus(saveDraftResult.data);
        }

        const versionResult = await saveProjectVersion(activeProjectId, {
          publish: action !== "save",
        });
        if (!versionResult.success || !versionResult.data) {
          console.error("Failed to save/publish version:", versionResult.error);
          return;
        }

        if (useProjectStore.getState().activeProject?.id !== activeProjectId) {
          return;
        }

        applyVersionStatus(versionResult.data);
      } catch (error) {
        console.error("Failed to run version action:", error);
      } finally {
        setActiveVersionAction(null);
        refreshVersionStatus();
      }
    },
    [activeProjectId, activeVersionAction, applyVersionStatus, refreshVersionStatus],
  );

  const isVersionActionRunning = activeVersionAction !== null;
  const hasUnsavedDraftChanges = !!versionStatus?.hasUnsavedDraftChanges;
  const hasPublishableVersion = !!versionStatus?.hasPublishableVersion;

  const publishedVersionLabel = useMemo(() => {
    if (!versionStatus) return "Version status unavailable";
    if (versionStatus.publishedVersion === null) return "Not published yet";
    return `Published v${versionStatus.publishedVersion}`;
  }, [versionStatus]);

  const publishStateLabel = useMemo(() => {
    if (!activeProjectId) return "No active project";
    if (!versionStatus) return "Checking status...";
    if (versionStatus.hasUnsavedDraftChanges) {
      if (versionStatus.draftVersion !== null) {
        return `Draft v${versionStatus.draftVersion} has version changes`;
      }
      return "Draft has version changes";
    }
    if (versionStatus.hasPublishableVersion) {
      if (versionStatus.latestSavedVersion !== null) {
        return `Saved v${versionStatus.latestSavedVersion} is ready to publish`;
      }
      return "A saved version is ready to publish";
    }
    if (versionStatus.draftVersion !== null) {
      return `Editing draft v${versionStatus.draftVersion}`;
    }
    return "No draft version yet";
  }, [activeProjectId, versionStatus]);

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
                  className="shrink-0 flex items-center bg-black/20 rounded-full p-1 border border-border/50 cursor-pointer"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  type="button"
                  aria-label="Toggle theme"
                >
                  <div className="relative flex">
                    {/* Sliding Background */}
                    <motion.div
                      className="absolute inset-0 bg-[#3A3A3C] shadow-sm rounded-full"
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
            
            {activeProjectId && (
              <div className="mt-1 flex w-full items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    {publishedVersionLabel}
                  </div>
                  <div
                    className={cn(
                      "text-[10px] truncate",
                      hasUnsavedDraftChanges
                        ? "text-amber-400"
                        : "text-muted-foreground"
                    )}
                  >
                    {publishStateLabel}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  {hasUnsavedDraftChanges ? (
                    <>
                      <button
                        type="button"
                        onClick={() => runVersionAction("save")}
                        disabled={isVersionActionRunning}
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                          isVersionActionRunning
                            ? "border-border/60 bg-muted/20 text-muted-foreground"
                            : "border-border/60 bg-muted/40 text-foreground hover:bg-muted/60"
                        )}
                      >
                        {activeVersionAction === "save" ? "Saving..." : "Save version"}
                      </button>
                      <button
                        type="button"
                        onClick={() => runVersionAction("savePublish")}
                        disabled={isVersionActionRunning}
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                          isVersionActionRunning
                            ? "border-border/60 bg-muted/20 text-muted-foreground"
                            : "border-primary/60 bg-primary/10 text-primary hover:bg-primary/20"
                        )}
                      >
                        {activeVersionAction === "savePublish" ? "Publishing..." : "Save & publish"}
                      </button>
                    </>
                  ) : hasPublishableVersion ? (
                    <button
                      type="button"
                      onClick={() => runVersionAction("publish")}
                      disabled={isVersionActionRunning}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                        isVersionActionRunning
                          ? "border-border/60 bg-muted/20 text-muted-foreground"
                          : "border-primary/60 bg-primary/10 text-primary hover:bg-primary/20"
                      )}
                    >
                      {activeVersionAction === "publish" ? "Publishing..." : "Publish"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="rounded-md border border-border/60 bg-muted/20 px-2 py-1 text-[11px] font-medium text-muted-foreground"
                    >
                      Published
                    </button>
                  )}
                </div>
              </div>
            )}

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
