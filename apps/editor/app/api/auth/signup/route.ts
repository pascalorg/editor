import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  try {
    const { email, password, name } = await req.json();

    if (!email || !password || !name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const emailLower = email.toLowerCase();
    const domain = emailLower.split('@')[1];
    if (!domain) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const org = await prisma.organization.findUnique({
      where: { domain },
    });

    if (!org || org.status !== 'APPROVED') {
      return NextResponse.json({ error: "Your organization has not been registered or approved yet." }, { status: 403 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let user = await prisma.user.findUnique({
      where: { email: emailLower },
    });

    if (user) {
      if (user.password) {
        return NextResponse.json({ error: "User already exists. Please sign in." }, { status: 400 });
      }
      
      // Update existing user (e.g., OWNER created during org approval)
      user = await prisma.user.update({
        where: { id: user.id },
        data: { 
          password: hashedPassword,
          name: name // update name if they provided one
        }
      });

      // Ensure they are linked to the organization if they aren't already
      const membership = await prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: org.id,
            userId: user.id
          }
        }
      });

      if (!membership) {
        await prisma.organizationMember.create({
          data: {
            organizationId: org.id,
            userId: user.id,
            role: 'MEMBER'
          }
        });
      }
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          email: emailLower,
          name,
          password: hashedPassword,
          organizations: {
            create: {
              organizationId: org.id,
              role: 'MEMBER',
            }
          }
        }
      });
    }

    return NextResponse.json({ success: true, message: "Account created successfully" });
  } catch (error: any) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
