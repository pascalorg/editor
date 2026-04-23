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
    },
  });

  return user;
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

export async function createProject(teamId: string, name: string, description: string) {
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
  return { success: true, project };
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
