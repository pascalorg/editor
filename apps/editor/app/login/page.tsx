"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Box, ArrowRight, AlertCircle } from "lucide-react";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError("");

    try {
      const res = await signIn("credentials", {
        redirect: false,
        email,
        password,
      });

      if (res?.error) {
        setError(res.error);
      } else if (res?.ok) {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-4">
      <Link href="/" className="flex items-center gap-2 mb-12">
        <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Box className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold tracking-tight text-white text-xl">archly</span>
      </Link>

      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        className="w-full max-w-md bg-[#0a0a0a] border border-white/10 rounded-2xl p-8"
      >
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Sign in to your Workspace</h1>
          <p className="text-gray-400 text-sm">
            Enter your work email address and password to sign in to your organization.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Work Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              className="w-full bg-[#111] border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-gray-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#111] border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-gray-600"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20 mt-6"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Continue <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </motion.div>

      <p className="mt-8 text-sm text-gray-500">
        Don't have an account? <Link href="/signup" className="text-indigo-400 hover:text-indigo-300">Sign Up</Link>
      </p>
      <p className="mt-2 text-sm text-gray-500">
        Don't have an organization yet? <Link href="/apply" className="text-indigo-400 hover:text-indigo-300">Apply for Early Access</Link>
      </p>
    </div>
  );
}
