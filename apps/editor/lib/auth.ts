import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "you@example.com" },
      },
      async authorize(credentials) {
        if (!credentials?.email) {
          return null;
        }

        const email = credentials.email.toLowerCase();

        let user = await prisma.user.findUnique({
          where: { email },
        });

        if (user) {
          return { id: user.id, email: user.email, name: user.name };
        }

        // Auto-provisioning logic for new users
        const domain = email.split('@')[1];
        if (!domain) return null;

        const org = await prisma.organization.findUnique({
          where: { domain },
        });

        if (org && org.status === 'APPROVED') {
          // Provision new user and link to organization
          user = await prisma.user.create({
            data: {
              email,
              name: email.split('@')[0], // Use email prefix as default name
              organizations: {
                create: {
                  organizationId: org.id,
                  role: 'MEMBER',
                }
              }
            }
          });

          return { id: user.id, email: user.email, name: user.name };
        }

        throw new Error("Your organization has not been registered or approved yet.");
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET || "default_secret_for_development",
};
