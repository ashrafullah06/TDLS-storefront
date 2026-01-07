import { getTransporter } from "./smtp.js";

const FROM = `${process.env.BRAND_NAME} <${process.env.EMAIL_FROM_NOREPLY}>`;
const FOOTER = `
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
  <p style="color:#666;font-size:12px;margin:0">
    This is an automated message from ${process.env.BRAND_NAME}. Replies to this address are not monitored.
    For help, contact ${process.env.SUPPORT_ADDRESS} or visit ${process.env.BRAND_URL}.
  </p>
`;

function wrapHtml(title, inner) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;max-width:640px;margin:0 auto;padding:16px">
    <h2 style="margin:0 0 12px">${title}</h2>
    ${inner}
    ${FOOTER}
  </div>`;
}

export async function sendSystemEmail({ to, subject, text, html }) {
  const transporter = getTransporter();
  return transporter.sendMail({ from: FROM, to, subject, text, html });
}

/* ---------- Templates ---------- */

export function tplOTP({ code }) {
  const subject = `Your ${process.env.BRAND_NAME} OTP: ${code}`;
  const text = `Your OTP is ${code}. It expires in 10 minutes.`;
  const html = wrapHtml("One‑Time Password", `
    <p>Your OTP is <b style="font-size:18px">${code}</b>.</p>
    <p>This code expires in 10 minutes. If you didn’t request it, ignore this email.</p>
  `);
  return { subject, text, html };
}

export function tplOrderConfirmation({ orderId, placedAt, items, subtotal, shipping, tax, total }) {
  const subject = `Order ${orderId} confirmed — ${process.env.BRAND_NAME}`;
  const rows = items.map(i => `
    <tr>
      <td style="padding:8px 0">${i.name} × ${i.qty}</td>
      <td style="text-align:right;padding:8px 0">${i.amount}</td>
    </tr>`).join("");
  const html = wrapHtml("Thank you! Your order is confirmed.", `
    <p>Order ID: <b>${orderId}</b></p>
    <p>Date: ${placedAt}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <tbody>
        ${rows}
        <tr><td style="padding-top:8px;border-top:1px solid #eee">Subtotal</td><td style="text-align:right;padding-top:8px;border-top:1px solid #eee">${subtotal}</td></tr>
        <tr><td>Shipping</td><td style="text-align:right">${shipping}</td></tr>
        <tr><td>Tax</td><td style="text-align:right">${tax}</td></tr>
        <tr><td style="padding-top:8px;border-top:1px solid #eee"><b>Total</b></td><td style="text-align:right;padding-top:8px;border-top:1px solid #eee"><b>${total}</b></td></tr>
      </tbody>
    </table>
    <p>You’ll receive another email when your order ships.</p>
  `);
  const text = `Order ${orderId} confirmed. Total: ${total}.`;
  return { subject, text, html };
}

export function tplInvoice({ orderId, invoiceNumber, invoiceUrl, total }) {
  const subject = `Invoice ${invoiceNumber} for order ${orderId}`;
  const html = wrapHtml("Your invoice is ready", `
    <p>Invoice number: <b>${invoiceNumber}</b></p>
    <p>Order ID: <b>${orderId}</b></p>
    <p>Total: <b>${total}</b></p>
    <p><a href="${invoiceUrl}">View or download your invoice</a></p>
  `);
  const text = `Invoice ${invoiceNumber} for order ${orderId}. Total: ${total}. View: ${invoiceUrl}`;
  return { subject, text, html };
}

export function tplReturnExchange({ requestId, type, orderId, items, status }) {
  const subject = `${type} request received — #${requestId}`;
  const rows = items.map(i => `• ${i.name} × ${i.qty}`).join("\n");
  const html = wrapHtml(`${type} request received`, `
    <p>Request ID: <b>${requestId}</b></p>
    <p>Order ID: <b>${orderId}</b></p>
    <p>Items:</p>
    <ul>${items.map(i => `<li>${i.name} × ${i.qty}</li>`).join("")}</ul>
    <p>Status: <b>${status}</b></p>
  `);
  const text = `${type} request received. Request ${requestId} for order ${orderId}.\nItems:\n${rows}\nStatus: ${status}`;
  return { subject, text, html };
}

export function tplRefund({ orderId, amount, method, last4 }) {
  const subject = `Refund processed — ${amount} for order ${orderId}`;
  const html = wrapHtml("Your refund has been processed", `
    <p>Order ID: <b>${orderId}</b></p>
    <p>Amount: <b>${amount}</b></p>
    <p>Method: ${method}${last4 ? ` • **** ${last4}` : ""}</p>
    <p>Please allow 3–10 business days for the refund to appear.</p>
  `);
  const text = `Refund processed: ${amount} for order ${orderId}. Method: ${method}${last4 ? ` ****${last4}` : ""}.`;
  return { subject, text, html };
}

export function tplAddressChange({ orderId, oldAddress, newAddress }) {
  const subject = `Shipping address updated — order ${orderId}`;
  const html = wrapHtml("Shipping address updated", `
    <p>Order ID: <b>${orderId}</b></p>
    <p><b>Old address</b><br/>${oldAddress}</p>
    <p><b>New address</b><br/>${newAddress}</p>
    <p>If you didn’t make this change, contact ${process.env.SUPPORT_ADDRESS} immediately.</p>
  `);
  const text = `Address updated for order ${orderId}. New address: ${newAddress}.`;
  return { subject, text, html };
}

export function tplProfileChange({ changedFields }) {
  const subject = `Your ${process.env.BRAND_NAME} account was updated`;
  const list = changedFields.map(f => `<li>${f}</li>`).join("");
  const html = wrapHtml("Account changes confirmed", `
    <p>The following settings were changed on your account:</p>
    <ul>${list}</ul>
    <p>If this wasn’t you, reset your password and contact ${process.env.SUPPORT_ADDRESS}.</p>
  `);
  const text = `Your account was updated. Changes: ${changedFields.join(", ")}.`;
  return { subject, text, html };
}

/* ---------- Senders ---------- */

export async function sendOTP({ to, code }) {
  const { subject, text, html } = tplOTP({ code });
  return sendSystemEmail({ to, subject, text, html });
}

export async function sendOrderConfirmation(payload) {
  const { subject, text, html } = tplOrderConfirmation(payload);
  return sendSystemEmail({ to: payload.to, subject, text, html });
}

export async function sendInvoice(payload) {
  const { subject, text, html } = tplInvoice(payload);
  return sendSystemEmail({ to: payload.to, subject, text, html });
}

export async function sendReturnExchange(payload) {
  const { subject, text, html } = tplReturnExchange(payload);
  return sendSystemEmail({ to: payload.to, subject, text, html });
}

export async function sendRefund(payload) {
  const { subject, text, html } = tplRefund(payload);
  return sendSystemEmail({ to: payload.to, subject, text, html });
}

export async function sendAddressChange(payload) {
  const { subject, text, html } = tplAddressChange(payload);
  return sendSystemEmail({ to: payload.to, subject, text, html });
}

export async function sendProfileChange(payload) {
  const { subject, text, html } = tplProfileChange(payload);
  return sendSystemEmail({ to: payload.to, subject, text, html });
}
