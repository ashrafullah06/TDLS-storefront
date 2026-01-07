import { getTransporter } from "./smtp";

const FROM_SUPPORT = `TDLC Support <${process.env.EMAIL_FROM_SUPPORT}>`;
// Replies go to your public address which forwards to Gmail via Namecheap
const REPLY_TO = process.env.SUPPORT_ADDRESS; // support@thednalabstore.com

export async function sendSupportReply({ to, subject, message, inReplyTo }) {
  const transporter = getTransporter();
  const text = message;
  const html = `<div style="font-family:system-ui,Segoe UI,Arial">
    <p>${String(message || "").replace(/\n/g, "<br/>")}</p>
    <hr/><p style="color:#666;font-size:12px">TDLC Support — thednalabstore.com</p>
  </div>`;

  const headers = {};
  if (inReplyTo) {
    headers["In-Reply-To"] = inReplyTo;
    headers["References"] = inReplyTo;
  }

  return transporter.sendMail({
    from: FROM_SUPPORT,
    replyTo: REPLY_TO,
    to,
    subject,
    text,
    html,
    headers,
  });
}
