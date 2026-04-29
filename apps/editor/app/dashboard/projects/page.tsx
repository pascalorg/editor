import { getDashboardData } from "../actions";
import { ProjectsGrid } from "../_components/ProjectsGrid";
import { CreateProjectModal } from "../_components/CreateProjectModal";

export default async function ProjectsPage() {
  const data = await getDashboardData();

  const org = data?.organizations?.[0]?.organization;

  if (!org) {
    return (
      <div className="flex-1 overflow-y-auto p-8">
        <p className="text-zinc-500">No organization found.</p>
      </div>
    );
  }

  const teams = org.teams.map((t: { id: string; name: string }) => ({
    id: t.id,
    name: t.name,
  }));

  const allProjects = org.teams.flatMap(
    (team: {
      id: string;
      name: string;
      projects: Array<{
        id: string;
        name: string;
        updatedAt: Date;
        lastOpenedAt: Date | null;
        description: string | null;
        thumbnailUrl: string | null;
      }>;
    }) =>
      team.projects.map((proj) => ({
        ...proj,
        teamName: team.name,
      }))
  );

  const starredProjectIds = data?.starredProjectIds ?? [];

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="max-w-7xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">All Projects</h1>
            <p className="text-zinc-500 text-sm mt-0.5">Manage projects across all teams.</p>
          </div>
          <CreateProjectModal teams={teams} />
        </header>
        <ProjectsGrid
          projects={allProjects}
          starredProjectIds={starredProjectIds}
        />
      </div>
    </div>
  );
}
