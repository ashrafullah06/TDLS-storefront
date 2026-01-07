// FILE: src/auth/index.js
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import prisma from "@/lib/prisma";
import crypto from "crypto";
import bcrypt from "bcryptjs";

/* ───────── helpers ───────── */
const isEmail = (v) => /\S+@\S+\.\S+/.test(String(v || "").trim());
const onlyDigits = (v) => String(v || "").replace(/\D/g, "");

function toE164BD(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const d = onlyDigits(s);

  // +8801XXXXXXXXX
  if (s.startsWith("+8801") && d.length === 13) return `+${d}`;
  // 8801XXXXXXXXX
  if (d.length === 13 && d.startsWith("8801")) return `+${d}`;
  // 01XXXXXXXXX -> +8801XXXXXXXXX
  if (d.length === 11 && d.startsWith("01")) return `+880${d.slice(1)}`;
  // +88 01XXXXXXXXX -> +8801XXXXXXXXX
  if (s.startsWith("+88")) {
    const rest = d.replace(/^88+/, "");
    const cleaned = rest.replace(/^0+/, "");
    if (/^1\d{9}$/.test(cleaned)) return `+880${cleaned}`;
  }
  return "";
}

const OTP_SECRET = process.env.OTP_SECRET || "dev-otp-secret";
const hashOTP = (code) =>
  crypto.createHmac("sha256", OTP_SECRET).update(String(code || "")).digest("hex");

/* ───────── Credentials provider (password + otp) ───────── */
const CredentialsProvider = Credentials({
  name: "TDLC Credentials",
  credentials: {
    type: { label: "type", type: "text" },             // "password" | "otp"
    identifier: { label: "identifier", type: "text" }, // email or phone
    to: { label: "to", type: "text" },                 // alt key
    password: { label: "password", type: "password" },
    code: { label: "code", type: "text" },             // 6-digit
    purpose: { label: "purpose", type: "text" },       // "login" | "signup"
  },
  async authorize(creds) {
    const type = String(creds?.type || "").toLowerCase();

    // PASSWORD
    if (type === "password") {
      const raw = (creds?.identifier || "").trim();
      if (!raw) return null;

      const id = isEmail(raw) ? raw.toLowerCase() : toE164BD(raw);
      if (!id) return null;

      const user = await prisma.user.findFirst({
        where: isEmail(raw) ? { email: id } : { phone: id },
      });
      if (!user?.passwordHash) return null;

      const ok = await bcrypt.compare(String(creds?.password || ""), user.passwordHash);
      if (!ok) return null;

      return { id: user.id, name: user.name || user.email || user.phone || "", email: user.email || null };
    }

    // OTP
    if (type === "otp") {
      const purpose = String(creds?.purpose || "login").toLowerCase();
      const raw = (creds?.identifier || creds?.to || "").trim();
      const code = String(creds?.code || "").trim();
      if (!raw) return null;

      const emailMode = isEmail(raw);
      const id = emailMode ? raw.toLowerCase() : toE164BD(raw);
      if (!id) return null;

      // find or create (signup only)
      let user = await prisma.user.findFirst({
        where: emailMode ? { email: id } : { phone: id },
      });
      if (!user && purpose === "signup") {
        user = await prisma.user.create({
          data: emailMode ? { email: id } : { phone: id },
        });
      }
      if (!user) return null;

      const now = new Date();
      const latest = await prisma.otpCode.findFirst({
        where: { userId: user.id, purpose, consumedAt: null, expiresAt: { gte: now } },
        orderBy: { createdAt: "desc" },
      });
      if (!latest) return null;

      if (!/^\d{6}$/.test(code)) {
        await prisma.otpCode.update({ where: { id: latest.id }, data: { attemptCount: { increment: 1 } } });
        return null;
      }

      const ok = latest.codeHash === hashOTP(code);
      if (!ok) {
        await prisma.otpCode.update({ where: { id: latest.id }, data: { attemptCount: { increment: 1 } } });
        return null;
      }

      // consume + mark verified
      const tx = [];
      tx.push(prisma.otpCode.update({ where: { id: latest.id }, data: { consumedAt: new Date() } }));
      if (emailMode) {
        tx.push(prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }));
      } else {
        tx.push(prisma.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } }));
      }
      await prisma.$transaction(tx);

      return { id: user.id, name: user.name || user.email || user.phone || "", email: user.email || null };
    }

    return null;
  },
});

/* ───────── NextAuth config ───────── */
export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  // Keep adapter for user linking/accounts, but use JWT sessions (required for Credentials)
  adapter: PrismaAdapter(prisma),

  // ✅ FIX: Credentials requires JWT strategy in Auth.js v5
  session: { strategy: "jwt" },

  trustHost: true,
  debug: process.env.NODE_ENV !== "production",

  providers: [CredentialsProvider],
  pages: { signIn: "/login" },

  callbacks: {
    async session({ session, user, token }) {
      // When using JWT sessions, 'user' is only present on first call after login.
      // We’ll propagate id/email/name from JWT when available.
      if (!session.user) session.user = {};
      if (token?.sub) session.user.id = token.sub;
      if (typeof token?.email !== "undefined") session.user.email = token.email;
      if (typeof token?.name !== "undefined") session.user.name = token.name;

      // If this is the first call right after login, 'user' will be present:
      if (user?.id) {
        session.user.id = user.id;
        session.user.email = user.email || session.user.email || null;
        session.user.name = user.name || user.email || user.phone || session.user.name || null;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.email = user.email ?? token.email ?? null;
        token.name = user.name ?? token.name ?? null;
      }
      return token;
    },
  },

  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET,
});
