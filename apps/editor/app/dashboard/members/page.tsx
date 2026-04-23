"use client";

import { useState, useEffect } from "react";
import { Users, Mail, Plus, X } from "lucide-react";
import { getDashboardData, inviteMember } from "../actions";

export default function MembersPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboardData().then(d => {
      setData(d);
      setLoading(false);
    });
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !data) return;
    
    setSubmitting(true);
    setError(null);
    const orgId = data.organizations[0].organizationId;
    
    try {
      const res = await inviteMember(orgId, email, name);
      if (res.success) {
        const newData = await getDashboardData();
        setData(newData);
        setShowModal(false);
        setEmail("");
        setName("");
      } else {
        setError(res.error || "Failed to invite member");
      }
    } catch (error) {
      console.error(error);
      setError("An unexpected error occurred.");
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
          <h1 className="text-3xl font-bold">Members</h1>
          <p className="text-gray-400 mt-1">Manage team members in {org.name}.</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-xl flex items-center gap-2 font-medium transition-colors"
        >
          <Plus size={18} /> Invite Member
        </button>
      </header>

      <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5 text-gray-400 text-sm">
              <th className="px-6 py-4 font-medium">Member</th>
              <th className="px-6 py-4 font-medium">Role</th>
              <th className="px-6 py-4 font-medium">Joined</th>
              <th className="px-6 py-4 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {org.members.map((member: any) => (
              <tr key={member.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold">
                      {member.user.name?.[0] || member.user.email?.[0] || "?"}
                    </div>
                    <div>
                      <div className="font-semibold">{member.user.name || "Pending User"}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                        <Mail size={12} /> {member.user.email}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs font-medium bg-white/10 px-2.5 py-1 rounded-md">
                    {member.role}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-400">
                  {new Date(member.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 text-right">
                  <span className="text-xs font-medium text-green-400 bg-green-400/10 px-2 py-1 rounded-md">
                    Active
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Invite Teammate</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl">
                {error}
              </div>
            )}
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Email Address</label>
                <input 
                  required 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="colleague@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Name (Optional)</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="Jane Doe"
                />
              </div>
              <button 
                type="submit" 
                disabled={submitting}
                className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2.5 rounded-xl disabled:opacity-50 transition-colors"
              >
                {submitting ? "Inviting..." : "Send Invite"}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
