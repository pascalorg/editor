"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { createProject } from "../actions";
import { useRouter } from "next/navigation";

interface Team {
  id: string;
  name: string;
}

interface CreateProjectModalProps {
  teams: Team[];
}

export function CreateProjectModal({ teams }: CreateProjectModalProps) {
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [teamId, setTeamId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !teamId) return;
    setSubmitting(true);
    try {
      await createProject(teamId, name, desc);
      setShowModal(false);
      setName("");
      setDesc("");
      setTeamId("");
      router.refresh();
    } catch (error) {
      console.error(error);
    }
    setSubmitting(false);
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-medium transition-colors"
      >
        <Plus size={18} /> New Project
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Create New Project</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            {teams.length === 0 ? (
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
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
                    placeholder="e.g. Headquarters Redesign"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Select Team</label>
                  <select
                    required
                    value={teamId}
                    onChange={(e) => setTeamId(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
                  >
                    <option value="" disabled>Select a team...</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Description (Optional)</label>
                  <textarea
                    value={desc}
                    onChange={(e) => setDesc(e.target.value)}
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
    </>
  );
}
