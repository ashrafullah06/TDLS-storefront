import { NextResponse } from "next/server";
import { sendSupportReply } from "@/lib/support-mailer";

export async function POST(req) {
  const { to, subject, message, inReplyTo } = await req.json().catch(() => ({}));
  if (!to || !subject || !message) {
    return NextResponse.json({ error: "to, subject, message required" }, { status: 400 });
  }
  const text = message;
  const html = `<div style="font-family:system-ui,Segoe UI,Arial">
    <p>${message.replace(/\n/g, "<br/>")}</p>
    <hr/><p style="color:#666;font-size:12px">TDLC Support — thednalabstore.com</p>
  </div>`;

  await sendSupportReply({ to, subject, text, html, inReplyTo });
  return NextResponse.json({ ok: true });
}
