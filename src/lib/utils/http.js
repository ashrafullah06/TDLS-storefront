// tiny helpers for NextResponse
import { NextResponse } from "next/server";

export const bad = (msg, code = 400, extra = {}) =>
  NextResponse.json({ ok: false, error: msg, ...extra }, { status: code });

export const ok = (data = {}, code = 200) =>
  NextResponse.json({ ok: true, ...data }, { status: code });
