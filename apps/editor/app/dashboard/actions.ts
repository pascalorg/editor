"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function getDashboardData() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      organizations: {
        include: {
          organization: {
            include: {
              teams: {
                include: {
                  projects: true,
                  members: true,
                },
              },
              members: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      },
      starredProjects: { select: { projectId: true } },
    },
  });

  if (!user) return null;

  return {
    ...user,
    starredProjectIds: user.starredProjects.map((sp) => sp.projectId),
  };
}

export async function createTeam(organizationId: string, name: string, description: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Unauthorized");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) throw new Error("User not found");

  const team = await prisma.team.create({
    data: {
      organizationId,
      name,
      description,
      members: {
        create: {
          userId: user.id,
        },
      },
    },
  });

  revalidatePath("/dashboard/teams");
  return { success: true, team };
}

export async function createProject(teamId: string, name: string, description: string): Promise<{ id: string; success: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Unauthorized");

  const project = await prisma.project.create({
    data: {
      teamId,
      name,
      description,
    },
  });

  revalidatePath("/dashboard/projects");
  revalidatePath("/dashboard");
  return { id: project.id, success: true };
}

export async function getFirstTeamId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user) return null
  const userId = (session.user as { id: string }).id
  const member = await prisma.organizationMember.findFirst({
    where: { userId },
    include: {
      organization: {
        include: { teams: { take: 1 } },
      },
    },
  })
  return member?.organization.teams[0]?.id ?? null
}

export async function inviteMember(organizationId: string, email: string, name: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Unauthorized");

  try {
    // Upsert user
    const invitedUser = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name },
    });

    // Create org member
    await prisma.organizationMember.create({
      data: {
        organizationId,
        userId: invitedUser.id,
        role: "MEMBER",
      },
    });

    revalidatePath("/dashboard/members");
    return { success: true };
  } catch (error) {
    console.error("Invite error:", error);
    return { success: false, error: "Failed to invite member. They may already be in the organization." };
  }
}

export async function renameProject(projectId: string, name: string) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new Error("Unauthorized");
  await prisma.project.update({
    where: { id: projectId },
    data: { name: name.trim() },
  });
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/projects");
}

export async function deleteProject(projectId: string) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new Error("Unauthorized");
  await prisma.project.delete({ where: { id: projectId } });
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/projects");
}

export async function starProject(projectId: string) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new Error("Unauthorized");
  await prisma.starredProject.create({
    data: { userId, projectId },
  });
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/projects");
}

export async function unstarProject(projectId: string) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) throw new Error("Unauthorized");
  await prisma.starredProject.delete({
    where: { userId_projectId: { userId, projectId } },
  });
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/projects");
}

export async function updateLastOpened(projectId: string) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return; // fire-and-forget, no throw
  await prisma.project.update({
    where: { id: projectId },
    data: { lastOpenedAt: new Date() },
  });
  revalidatePath("/dashboard");
}
