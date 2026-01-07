import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const email = searchParams.get("email");
  if (!token || !email) return NextResponse.redirect("/verify?status=missing");

  const vt = await prisma.verificationToken.findUnique({ where: { token } });
  if (!vt || vt.identifier !== email || vt.expires < new Date()) {
    return NextResponse.redirect("/verify?status=invalid");
  }

  await prisma.user.update({ where: { email }, data: { emailVerified: new Date() } });
  await prisma.verificationToken.delete({ where: { token } });

  return NextResponse.redirect("/verify?status=success");
}
