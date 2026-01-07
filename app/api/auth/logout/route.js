// FILE: app/api/auth/logout/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";

function json(body, status = 200) {
  return new NextResponse(JSON.stringify(body ?? null), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      vary: "origin, cookie",
      "x-tdlc-customer-logout": "v1",
    },
  });
}

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function safeHostFromRequestUrl(requestUrl) {
  try {
    return new URL(requestUrl).hostname || "";
  } catch {
    return "";
  }
}

function candidateDomains(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return [null];

  const out = [null, host];

  const parts = host.split(".").filter(Boolean);
  if (parts.length >= 2) {
    const apex = parts.slice(-2).join(".");
    out.push(apex);
    out.push(`.${apex}`);
  }

  out.push(`.${host}`);
  return Array.from(new Set(out));
}

function expireCookieMatrix(response, name, hostname) {
  const domains = candidateDomains(hostname);

  // Customer paths only (CRITICAL: no /admin or /api/admin)
  const paths = ["/", "/api", "/customer"];

  const secures = [false, true];
  const httpOnlys = [false, true];
  const sameSites = ["lax", "strict", "none"];

  for (const path of paths) {
    for (const secure of secures) {
      for (const httpOnly of httpOnlys) {
        for (const sameSite of sameSites) {
          for (const domain of domains) {
            const base = {
              name,
              value: "",
              path,
              maxAge: 0,
              secure,
              httpOnly,
              sameSite,
            };
            if (!domain) response.cookies.set(base);
            else response.cookies.set({ ...base, domain });
          }
        }
      }
    }
  }
}

export async function POST(request) {
  if (!isSameOrigin(request)) {
    return json({ ok: false, error: "FORBIDDEN_ORIGIN" }, 403);
  }

  const host = safeHostFromRequestUrl(request.url);
  const res = json({ ok: true, cleared: true });

  // Customer auth cookies only (Auth.js/NextAuth variants)
  const customerAuthCookies = [
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
    "next-auth.csrf-token",
    "__Host-next-auth.csrf-token",
    "next-auth.callback-url",

    "authjs.session-token",
    "__Secure-authjs.session-token",
    "authjs.csrf-token",
    "__Host-authjs.csrf-token",
    "authjs.callback-url",

    "__Secure-next-auth.callback-url",
    "__Secure-authjs.callback-url",
  ];

  for (const name of customerAuthCookies) {
    expireCookieMatrix(res, name, host);
  }

  return res;
}

export async function GET() {
  return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}
