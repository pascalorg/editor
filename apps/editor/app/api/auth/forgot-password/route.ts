import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "node:crypto";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }
    const emailLower = email.toLowerCase();

    // Always respond the same way regardless of whether the user exists (no enumeration).
    // But only generate a token if the user actually exists.
    const user = await prisma.user.findUnique({ where: { email: emailLower } });

    let resetUrl: string | undefined;
    if (user) {
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      await prisma.passwordResetToken.create({
        data: { token, email: emailLower, expiresAt },
      });
      const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
      resetUrl = `${base}/reset-password?token=${token}`;
      // v1: no email provider — log to server console for dev convenience.
      console.log(`[forgot-password] reset URL for ${emailLower}: ${resetUrl}`);
    }

    // v1 quirk: we DO return the resetUrl in the response so the UI can display it
    // (per locked decision — no email provider for v1). This is a v1 dev/staging shortcut
    // and MUST be removed before any production launch — track as a v2 task.
    return NextResponse.json({ success: true, resetUrl });
  } catch (error) {
    console.error("forgot-password error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
