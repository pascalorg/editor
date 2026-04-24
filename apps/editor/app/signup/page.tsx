"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Box, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import Link from "next/link";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !name) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, name }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "An error occurred during signup.");
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push("/login");
        }, 2000);
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
          <h1 className="text-2xl font-bold text-white mb-2">Create an Account</h1>
          <p className="text-gray-400 text-sm">
            Sign up using your work email to join your organization's workspace.
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {success ? (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-xl flex items-center justify-center gap-3">
            <CheckCircle2 className="w-5 h-5" />
            <p>Account created! Redirecting to login...</p>
          </div>
        ) : (
          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full bg-[#111] border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-gray-600"
              />
            </div>

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
                minLength={8}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password || !name}
              className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 text-white font-medium py-3 rounded-xl flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20 mt-6"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  Sign Up <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
        )}
      </motion.div>

      <p className="mt-8 text-sm text-gray-500">
        Already have an account? <Link href="/login" className="text-indigo-400 hover:text-indigo-300">Sign In</Link>
      </p>
    </div>
  );
}
