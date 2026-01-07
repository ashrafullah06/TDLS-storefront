// FILE: app/(admin)/admin/catalog/_components/LaunchDraftModal.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import InlineExecStatus from "./InlineExecStatus";

function str(v) {
  return String(v ?? "").trim();
}

function cls(...parts) {
  return parts.filter(Boolean).join(" ");
}

function isoNow() {
  return new Date().toISOString();
}

async function safeJson(res) {
  const text = await res.text().catch(() => "");
  if (!text) return { ok: res.ok, status: res.status, data: null };
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: res.ok, status: res.status, data: { raw: text } };
  }
}

export default function LaunchDraftModal({
  open,
  onClose,
  draftId,
  onDone, // callback after successful publish/push
}) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [validation, setValidation] = useState(null);
  const [exec, setExec] = useState(null);

  const [warehouseMode, setWarehouseMode] = useState(false);
  const [autoPushBeforePublish, setAutoPushBeforePublish] = useState(true);
  const [validateBeforePublish, setValidateBeforePublish] = useState(true);

  const closeBtnRef = useRef(null);
  const panelRef = useRef(null);

  const id = useMemo(() => {
    const n = Number(draftId);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  }, [draftId]);

  const canFetch = open && id > 0;

  // Lock body scroll only while open, and guarantee cleanup (no "non scrollable page" bug)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Autofocus close button when opened
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => closeBtnRef.current?.focus?.(), 0);
    return () => clearTimeout(t);
  }, [open]);

  async function fetchDetail() {
    if (!id) return;
    setLoading(true);
    setExec(null);

    const url = `/api/admin/catalog/launch-drafts/${id}?warehouse=${warehouseMode ? "1" : "0"}`;

    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const out = await safeJson(res);

    if (!out.ok) {
      setDetail(null);
      setValidation(null);
      setExec({
        tone: "error",
        title: "Failed to load draft",
        message: out?.data?.error || `HTTP ${out.status}`,
        at: isoNow(),
      });
      setLoading(false);
      return;
    }

    setDetail(out.data);
    setLoading(false);
  }

  async function fetchValidate() {
    if (!id) return;
    setExec(null);
    setValidation(null);

    const res = await fetch(`/api/admin/catalog/launch-drafts/${id}/validate`, {
      method: "GET",
      cache: "no-store",
    });
    const out = await safeJson(res);

    if (!out.ok) {
      setValidation(null);
      setExec({
        tone: "error",
        title: "Validation failed",
        message: out?.data?.error || `HTTP ${out.status}`,
        at: isoNow(),
      });
      return;
    }

    setValidation(out.data);
    setExec({
      tone: out?.data?.canPublish ? "success" : "warn",
      title: out?.data?.canPublish ? "Validation passed" : "Validation requires attention",
      message: out?.data?.canPublish
        ? "No blocking issues detected."
        : "Resolve HIGH severity issues before publishing.",
      at: isoNow(),
    });
  }

  async function doPush({ dryRun = false } = {}) {
    if (!id) return;
    setLoading(true);
    setExec(null);

    const url = `/api/admin/catalog/launch-drafts/${id}/push${dryRun ? "?dryRun=1" : ""}`;
    const res = await fetch(url, { method: "POST", cache: "no-store" });
    const out = await safeJson(res);

    if (!out.ok) {
      setExec({
        tone: "error",
        title: dryRun ? "Push plan failed" : "Push failed",
        message: out?.data?.error || `HTTP ${out.status}`,
        at: isoNow(),
      });
      setLoading(false);
      return null;
    }

    const msg = dryRun
      ? "Dry-run push plan prepared."
      : `Pushed to appDb. Variants: created ${out?.data?.app?.variants?.created ?? 0}, updated ${
          out?.data?.app?.variants?.updated ?? 0
        }.`;

    setExec({
      tone: "success",
      title: dryRun ? "Push plan ready" : "Push completed",
      message: msg,
      at: isoNow(),
    });

    setLoading(false);
    return out.data;
  }

  async function doPublish({ dryRun = false } = {}) {
    if (!id) return;
    setLoading(true);
    setExec(null);

    const qp = new URLSearchParams();
    if (dryRun) qp.set("dryRun", "1");
    if (validateBeforePublish) qp.set("validate", "1");
    if (autoPushBeforePublish) qp.set("push", "1");

    const url = `/api/admin/catalog/launch-drafts/${id}/publish?${qp.toString()}`;

    const res = await fetch(url, { method: "POST", cache: "no-store" });
    const out = await safeJson(res);

    if (!out.ok) {
      const issues = Array.isArray(out?.data?.issues) ? out.data.issues : [];
      const issueMsg =
        issues.length > 0
          ? issues
              .slice(0, 5)
              .map((i) => `${str(i?.code)}: ${str(i?.message)}`)
              .filter(Boolean)
              .join("\n")
          : "";

      setExec({
        tone: "error",
        title: dryRun ? "Publish plan failed" : "Publish failed",
        message: issueMsg || out?.data?.error || `HTTP ${out.status}`,
        at: isoNow(),
      });
      setLoading(false);
      return null;
    }

    setExec({
      tone: dryRun ? "info" : "success",
      title: dryRun ? "Publish plan ready" : "Published",
      message: dryRun
        ? "Dry-run publish plan prepared."
        : `Published at ${out?.data?.publishedAt || "now"}. App status synced.`,
      at: isoNow(),
    });

    setLoading(false);
    return out.data;
  }

  // Refresh details when opened or options change
  useEffect(() => {
    if (!canFetch) return;
    fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFetch, warehouseMode]);

  if (!open) return null;

  const product = detail?.product || null;
  const title = str(product?.title) || `Draft #${id}`;
  const thumb = product?.media?.thumbnail || null;
  const availability = product?.availability || null;

  const canPublish = validation?.canPublish ?? null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Launch draft"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default bg-black/50"
        onClick={() => onClose?.()}
      />

      {/* Modal */}
      <div className="relative mx-auto flex h-full max-w-6xl items-center px-4 py-8">
        <div
          ref={panelRef}
          className="relative w-full overflow-hidden rounded-3xl border border-white/15 bg-white shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-4 border-b bg-gradient-to-r from-[#0F2147] to-[#102a62] px-6 py-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="h-12 w-12 overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/20">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt={title}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-white/80">
                    No Image
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <div className="truncate text-lg font-extrabold text-white">{title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-white/80">
                  <span>Draft ID: {id}</span>
                  {product?.slug ? <span className="truncate">Slug: {product.slug}</span> : null}
                  {product?.publication?.updatedAt ? (
                    <span>Updated: {new Date(product.publication.updatedAt).toLocaleString()}</span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                ref={closeBtnRef}
                type="button"
                onClick={() => onClose?.()}
                className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white ring-1 ring-white/20 transition hover:bg-white/15"
              >
                Close
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="grid grid-cols-1 gap-0 md:grid-cols-12">
            {/* Left: content */}
            <div className="md:col-span-8">
              <div className="p-6">
                {/* Exec status */}
                <InlineExecStatus state={exec} className="mb-5" />

                {/* Availability summary */}
                <div className="rounded-3xl border bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-extrabold text-[#0F2147]">
                        Availability snapshot
                      </div>
                      <div className="mt-1 text-xs font-semibold text-neutral-600">
                        Joined from appDb by Strapi size_stocks component IDs (strapiSizeId).
                      </div>
                    </div>

                    <label className="flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-50">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={warehouseMode}
                        onChange={(e) => setWarehouseMode(e.target.checked)}
                      />
                      Warehouse mode
                    </label>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <KpiCard
                      label="Size stocks"
                      value={availability?.totalSizeStocks ?? "—"}
                    />
                    <KpiCard
                      label="Mapped"
                      value={availability?.mappedSizeStocks ?? "—"}
                    />
                    <KpiCard
                      label="Unmapped"
                      value={availability?.unmappedSizeStocks ?? "—"}
                    />
                    <KpiCard
                      label="Available"
                      value={availability?.totalAvailable ?? "—"}
                    />
                  </div>

                  {warehouseMode ? (
                    <div className="mt-3 text-xs font-semibold text-neutral-700">
                      Computed availability is shown inside the draft detail endpoint; use Product Drawer
                      matrix to see per-warehouse breakdown.
                    </div>
                  ) : null}
                </div>

                {/* Validation */}
                <div className="mt-5 rounded-3xl border bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-extrabold text-[#0F2147]">Launch validation</div>
                      <div className="mt-1 text-xs font-semibold text-neutral-600">
                        Runs deterministic checks: required fields, media, bridge/mappings, price sync.
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={loading}
                      onClick={fetchValidate}
                      className={cls(
                        "rounded-full px-5 py-2.5 text-sm font-extrabold text-white",
                        "bg-[#0F2147] shadow-sm ring-1 ring-black/5 transition",
                        "hover:bg-[#102a62] active:scale-[0.99]",
                        loading ? "opacity-60" : ""
                      )}
                    >
                      Run validation
                    </button>
                  </div>

                  {validation ? (
                    <div className="mt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cls(
                            "rounded-full px-3 py-1 text-xs font-extrabold",
                            validation.canPublish
                              ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                              : "bg-amber-50 text-amber-900 ring-1 ring-amber-200"
                          )}
                        >
                          {validation.canPublish ? "Publish-ready" : "Not publish-ready"}
                        </span>

                        <span className="text-xs font-semibold text-neutral-600">
                          Issues: {Array.isArray(validation.issues) ? validation.issues.length : 0}
                        </span>
                      </div>

                      {Array.isArray(validation.issues) && validation.issues.length > 0 ? (
                        <div className="mt-3 max-h-56 overflow-auto rounded-2xl border bg-neutral-50 p-3">
                          <ul className="space-y-2">
                            {validation.issues.map((it, idx) => (
                              <li
                                key={`${it.code || "ISSUE"}-${idx}`}
                                className="rounded-xl bg-white p-3 ring-1 ring-black/5"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-xs font-extrabold text-[#0F2147]">
                                      {str(it.code)}{" "}
                                      <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-bold text-neutral-700">
                                        {str(it.severity || "low").toUpperCase()}
                                      </span>
                                    </div>
                                    <div className="mt-1 whitespace-pre-wrap text-xs font-semibold text-neutral-700">
                                      {str(it.message)}
                                    </div>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="mt-3 text-xs font-semibold text-neutral-700">
                          No issues reported.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 text-xs font-semibold text-neutral-600">
                      Run validation to confirm publish readiness.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right: actions rail */}
            <div className="border-t bg-neutral-50 md:col-span-4 md:border-l md:border-t-0">
              <div className="p-6">
                <div className="text-sm font-extrabold text-[#0F2147]">Launch actions</div>
                <div className="mt-1 text-xs font-semibold text-neutral-600">
                  Push drafts into appDb, then publish with one click.
                </div>

                <div className="mt-5 space-y-3">
                  <ActionToggle
                    checked={validateBeforePublish}
                    onChange={setValidateBeforePublish}
                    title="Validate before publish"
                    desc="Blocks publish when HIGH issues exist."
                  />
                  <ActionToggle
                    checked={autoPushBeforePublish}
                    onChange={setAutoPushBeforePublish}
                    title="Auto-push before publish"
                    desc="Ensures appDb bridge + variants are present before launch."
                  />
                </div>

                <div className="mt-6 grid gap-3">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => doPush({ dryRun: false }).then((d) => (d ? onDone?.(d) : null))}
                    className={cls(
                      "rounded-2xl px-5 py-3 text-sm font-extrabold text-white",
                      "bg-[#0F2147] shadow-sm ring-1 ring-black/5 transition",
                      "hover:bg-[#102a62] active:scale-[0.99]",
                      loading ? "opacity-60" : ""
                    )}
                  >
                    Push to appDb
                  </button>

                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => doPublish({ dryRun: false }).then((d) => (d ? onDone?.(d) : null))}
                    className={cls(
                      "rounded-2xl px-5 py-3 text-sm font-extrabold text-white",
                      canPublish === false ? "bg-amber-700 hover:bg-amber-800" : "bg-emerald-700 hover:bg-emerald-800",
                      "shadow-sm ring-1 ring-black/5 transition active:scale-[0.99]",
                      loading ? "opacity-60" : ""
                    )}
                  >
                    Publish now
                  </button>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => doPush({ dryRun: true })}
                      className={cls(
                        "rounded-2xl px-4 py-2.5 text-xs font-extrabold",
                        "bg-white text-[#0F2147] ring-1 ring-black/10 transition hover:bg-neutral-50",
                        loading ? "opacity-60" : ""
                      )}
                    >
                      Push (dry-run)
                    </button>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => doPublish({ dryRun: true })}
                      className={cls(
                        "rounded-2xl px-4 py-2.5 text-xs font-extrabold",
                        "bg-white text-[#0F2147] ring-1 ring-black/10 transition hover:bg-neutral-50",
                        loading ? "opacity-60" : ""
                      )}
                    >
                      Publish (dry-run)
                    </button>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border bg-white p-4">
                  <div className="text-xs font-extrabold text-[#0F2147]">Notes</div>
                  <ul className="mt-2 space-y-1 text-xs font-semibold text-neutral-700">
                    <li>Publishing uses Strapi write token (server-only).</li>
                    <li>Availability joins depend on appDb ProductVariant.strapiSizeId mappings.</li>
                    <li>No popups: statuses render inline near the CTAs.</li>
                  </ul>
                </div>

                <button
                  type="button"
                  onClick={() => fetchDetail()}
                  disabled={loading}
                  className={cls(
                    "mt-5 w-full rounded-2xl border bg-white px-5 py-3 text-sm font-extrabold text-[#0F2147]",
                    "ring-1 ring-black/5 transition hover:bg-neutral-50",
                    loading ? "opacity-60" : ""
                  )}
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t bg-white px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-semibold text-neutral-600">
                {loading ? "Working..." : "Ready."}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onClose?.()}
                  className="rounded-full bg-neutral-100 px-5 py-2.5 text-sm font-extrabold text-neutral-900 transition hover:bg-neutral-200"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────── small UI helpers ───────────────── */

function KpiCard({ label, value }) {
  return (
    <div className="rounded-2xl border bg-neutral-50 p-3">
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-neutral-600">
        {label}
      </div>
      <div className="mt-1 text-lg font-extrabold text-[#0F2147]">{value}</div>
    </div>
  );
}

function ActionToggle({ checked, onChange, title, desc }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4 ring-1 ring-black/5 hover:bg-neutral-50">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={!!checked}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <div className="min-w-0">
        <div className="text-xs font-extrabold text-[#0F2147]">{title}</div>
        <div className="mt-1 text-xs font-semibold text-neutral-600">{desc}</div>
      </div>
    </label>
  );
}
