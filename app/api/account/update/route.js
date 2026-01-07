//app/api/account/update/route.js
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { auth } from "../../auth/[...nextauth]/route";

const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const STRAPI_SYNC_SECRET = process.env.STRAPI_SYNC_SECRET || '';

function ok(val) {
  return typeof val === 'string' && val.trim().length > 0;
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // Allow only these fields from client
  const payload = {
    // identifiers
    email: session.user.email || '',         // from NextAuth
    phone_number: ok(body.phone_number) ? body.phone_number : session.user.phone || '',

    // updatable fields
    name: ok(body.name) ? body.name : undefined,
    date_of_birth: ok(body.date_of_birth) ? body.date_of_birth : undefined, // ISO: YYYY-MM-DD
    gender: ok(body.gender) ? body.gender : undefined, // align with your enum
  };

  try {
    const r = await fetch(`${STRAPI_URL}/api/user-update/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-app-secret': STRAPI_SYNC_SECRET, // shared secret
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json(json || { ok: false }, { status: r.status });
    }
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json({ ok: false, error: 'network_error' }, { status: 502 });
  }
}
