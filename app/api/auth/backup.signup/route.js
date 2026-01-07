import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { sendVerificationEmail } from "@/lib/email";

// simple in-memory rate limit; replace with Redis in prod
const buckets = new Map();
function rateLimit(ip, limit = 5, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const b = buckets.get(ip) || { count: 0, ts: now };
  if (now - b.ts > windowMs) { b.count = 0; b.ts = now; }
  b.count += 1; buckets.set(ip, b);
  return b.count <= limit;
}

export async function POST(req) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(ip)) return NextResponse.json({ error: "Too many attempts. Try later." }, { status: 429 });

  const { name, email, password } = await req.json();
  if (!email || !password) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  if (!/\S+@\S+\.\S+/.test(email)) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Weak password" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "Email already in use" }, { status: 409 });

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({ data: { name, email, passwordHash } });

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.verificationToken.create({ data: { identifier: email, token, expires } });

  if (process.env.EMAIL_FROM) await sendVerificationEmail({ to: email, token });

  return NextResponse.json({ ok: true });
}
