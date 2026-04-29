"use client";
import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { StarButton } from "./StarButton";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { updateLastOpened } from "../actions";

interface ProjectItem {
  id: string;
  name: string;
  updatedAt: Date;
  lastOpenedAt: Date | null;
  teamName: string;
  description: string | null;
  thumbnailUrl: string | null;
}

interface ProjectsGridProps {
  projects: ProjectItem[];
  starredProjectIds: string[];
}

export function ProjectsGrid({ projects, starredProjectIds }: ProjectsGridProps) {
  const [query, setQuery] = useState("");
  const starredSet = new Set(starredProjectIds);

  const filtered = query.trim()
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(query.trim().toLowerCase())
      )
    : projects;

  return (
    <div>
      {/* Search bar */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
          className="w-full bg-zinc-800/60 border border-zinc-700 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="text-zinc-500 text-sm">
          {query ? "No projects match your search." : "No projects yet."}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((project) => (
            <div key={project.id} className="relative group">
              <Link
                href={`/editor/${project.id}`}
                onClick={() => updateLastOpened(project.id)}
                className="block"
              >
                <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl overflow-hidden hover:border-indigo-500/40 transition-colors">
                  <div className="relative w-full aspect-[16/10] bg-zinc-900 overflow-hidden">
                    {project.thumbnailUrl ? (
                      <img
                        src={project.thumbnailUrl}
                        alt=""
                        className="w-full h-full object-cover opacity-60"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:40px_40px]">
                        <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                          <div className="w-5 h-5 border-2 border-indigo-500/40 rounded-sm" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-white truncate">{project.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5 truncate">{project.teamName}</p>
                  </div>
                </div>
              </Link>

              {/* Star + context menu — absolute overlay, stopPropagation handled inside each component */}
              <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <StarButton
                  projectId={project.id}
                  initialStarred={starredSet.has(project.id)}
                />
                <ProjectContextMenu
                  projectId={project.id}
                  projectName={project.name}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
