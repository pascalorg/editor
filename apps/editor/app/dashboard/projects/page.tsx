"use client";

import { useState, useEffect } from "react";
import { FolderKanban, Plus, X } from "lucide-react";
import { getDashboardData, createProject } from "../actions";

export default function ProjectsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [teamId, setTeamId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getDashboardData().then(d => {
      setData(d);
      setLoading(false);
    });
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !teamId || !data) return;
    
    setSubmitting(true);
    try {
      await createProject(teamId, name, desc);
      const newData = await getDashboardData();
      setData(newData);
      setShowModal(false);
      setName("");
      setDesc("");
      setTeamId("");
    } catch (error) {
      console.error(error);
    }
    setSubmitting(false);
  };

  if (loading) return <div className="p-10">Loading...</div>;

  const org = data?.organizations?.[0]?.organization;
  if (!org) return <div className="p-10">No organization found.</div>;

  const allProjects = org.teams.flatMap((team: any) => 
    team.projects.map((proj: any) => ({ ...proj, teamName: team.name }))
  );

  return (
    <div className="p-10">
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-gray-400 mt-1">Manage projects across all teams.</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-medium transition-colors"
        >
          <Plus size={18} /> New Project
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {allProjects.map((project: any) => (
          <div key={project.id} className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors group cursor-pointer">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <FolderKanban className="text-purple-400" />
              </div>
              <div>
                <h3 className="font-bold">{project.name}</h3>
                <p className="text-xs text-gray-500">Team: {project.teamName}</p>
              </div>
            </div>
            <p className="text-sm text-gray-400 line-clamp-2 min-h-[40px]">{project.description || "No description provided."}</p>
            <div className="mt-4 pt-4 border-t border-white/5 text-xs font-medium text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
              Open Project &rarr;
            </div>
          </div>
        ))}
        {allProjects.length === 0 && (
          <div className="col-span-full py-10 text-center text-gray-500 bg-white/[0.02] rounded-2xl border border-white/5">
            No projects found. Create one to get started!
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Create New Project</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            {org.teams.length === 0 ? (
              <div className="text-center text-gray-400 py-4">
                You must create a Team first before creating a Project.
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Project Name</label>
                  <input 
                    required 
                    type="text" 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
                    placeholder="e.g. Headquarters Redesign"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Select Team</label>
                  <select 
                    required
                    value={teamId} 
                    onChange={e => setTeamId(e.target.value)} 
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
                  >
                    <option value="" disabled>Select a team...</option>
                    {org.teams.map((team: any) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Description (Optional)</label>
                  <textarea 
                    value={desc} 
                    onChange={e => setDesc(e.target.value)} 
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
                    placeholder="What is this project about?"
                    rows={3}
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={submitting}
                  className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2.5 rounded-xl disabled:opacity-50 transition-colors"
                >
                  {submitting ? "Creating..." : "Create Project"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
