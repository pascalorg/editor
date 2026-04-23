import { getDashboardData } from "./actions";
import { FolderKanban, Users, Building2 } from "lucide-react";

export default async function DashboardOverview() {
  const data = await getDashboardData();
  
  if (!data || data.organizations.length === 0) {
    return (
      <div className="p-10">
        <h1 className="text-3xl font-bold mb-4">Dashboard</h1>
        <div className="bg-zinc-900 border border-white/5 rounded-2xl p-6 text-center text-gray-400">
          You are not part of any organization yet.
        </div>
      </div>
    );
  }

  const org = data.organizations[0]!.organization;
  const totalTeams = org.teams.length;
  const totalProjects = org.teams.reduce((acc, team) => acc + team.projects.length, 0);
  const totalMembers = org.members.length;

  return (
    <div className="p-10">
      <header className="mb-12">
        <h1 className="text-3xl font-bold">{org.name} Workspace</h1>
        <p className="text-gray-400 mt-1">Overview of your organization's activity.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <StatsCard label="Total Teams" value={totalTeams} icon={<Building2 className="text-blue-400" />} />
        <StatsCard label="Total Projects" value={totalProjects} icon={<FolderKanban className="text-purple-400" />} />
        <StatsCard label="Total Members" value={totalMembers} icon={<Users className="text-green-400" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-6">Recent Teams</h2>
          {org.teams.length === 0 ? (
            <p className="text-gray-500 text-sm">No teams created yet.</p>
          ) : (
            <div className="space-y-4">
              {org.teams.slice(0, 5).map(team => (
                <div key={team.id} className="flex items-center justify-between p-4 bg-white/[0.02] rounded-xl border border-white/5">
                  <div>
                    <h3 className="font-semibold text-sm">{team.name}</h3>
                    <p className="text-xs text-gray-500">{team.projects.length} projects</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-6">Organization Members</h2>
          {org.members.length === 0 ? (
            <p className="text-gray-500 text-sm">No members yet.</p>
          ) : (
            <div className="space-y-4">
              {org.members.slice(0, 5).map(member => (
                <div key={member.id} className="flex items-center justify-between p-4 bg-white/[0.02] rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold">
                      {member.user.name?.[0] || member.user.email?.[0] || "?"}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{member.user.name || "Unknown"}</h3>
                      <p className="text-xs text-gray-500">{member.user.email}</p>
                    </div>
                  </div>
                  <span className="text-xs bg-white/10 px-2 py-1 rounded-md">{member.role}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsCard({ label, value, icon }: { label: string, value: number, icon: React.ReactNode }) {
  return (
    <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 bg-white/5 rounded-lg">{icon}</div>
      </div>
      <div className="flex flex-col">
        <span className="text-gray-400 text-sm font-medium">{label}</span>
        <span className="text-3xl font-bold mt-1">{value}</span>
      </div>
    </div>
  )
}
