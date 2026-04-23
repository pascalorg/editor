"use client";

import { useState, useEffect } from "react";
import { Users, Plus, X } from "lucide-react";
import { getDashboardData, createTeam } from "../actions";

export default function TeamsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getDashboardData().then(d => {
      setData(d);
      setLoading(false);
    });
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !data) return;
    
    setSubmitting(true);
    const orgId = data.organizations[0].organizationId;
    
    try {
      await createTeam(orgId, name, desc);
      const newData = await getDashboardData();
      setData(newData);
      setShowModal(false);
      setName("");
      setDesc("");
    } catch (error) {
      console.error(error);
    }
    setSubmitting(false);
  };

  if (loading) return <div className="p-10">Loading...</div>;

  const org = data?.organizations?.[0]?.organization;
  if (!org) return <div className="p-10">No organization found.</div>;

  return (
    <div className="p-10">
      <header className="flex justify-between items-center mb-12">
        <div>
          <h1 className="text-3xl font-bold">Teams</h1>
          <p className="text-gray-400 mt-1">Manage teams within {org.name}.</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-medium transition-colors"
        >
          <Plus size={18} /> New Team
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {org.teams.map((team: any) => (
          <div key={team.id} className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Users className="text-blue-400" />
              </div>
              <div>
                <h3 className="font-bold">{team.name}</h3>
                <p className="text-xs text-gray-500">{team.members.length} members</p>
              </div>
            </div>
            <p className="text-sm text-gray-400 line-clamp-2 min-h-[40px]">{team.description || "No description provided."}</p>
            <div className="mt-4 pt-4 border-t border-white/5 text-xs text-gray-500 flex justify-between">
              <span>{team.projects.length} Projects</span>
            </div>
          </div>
        ))}
        {org.teams.length === 0 && (
          <div className="col-span-full py-10 text-center text-gray-500 bg-white/[0.02] rounded-2xl border border-white/5">
            No teams found. Create one to get started!
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Create New Team</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Team Name</label>
                <input 
                  required 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="e.g. Design Team"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Description (Optional)</label>
                <textarea 
                  value={desc} 
                  onChange={e => setDesc(e.target.value)} 
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="What is this team responsible for?"
                  rows={3}
                />
              </div>
              <button 
                type="submit" 
                disabled={submitting}
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2.5 rounded-xl disabled:opacity-50 transition-colors"
              >
                {submitting ? "Creating..." : "Create Team"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
