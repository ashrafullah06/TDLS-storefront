// ✅ FILE: src/components/common/slidingmenubar.jsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * TDLS Sliding Menu Bar — Desktop preserved; Mobile restructured; True preload supported.
 * ----------------------------------------------------------------------------
 * ✅ LOCKED listing system:
 * Tier  →  Audience  →  Category  →  Products
 *
 * ✅ MUST:
 * - No synthetic "All" audience
 * - Only real audiences that have products in that Tier
 * - Only real categories inside Tier+Audience
 * - Only real products
 * - All items route to REAL pages (query URLs; collections page normalizes)
 */

const NAVBAR_HEIGHT = 96;
const TOP_SAFE_GAP = 44;
const TOP_CLICK_SHIELD_EXTRA = 64;

const MENU_WIDTH_DESKTOP = 1440;
const MENU_MAX_WIDTH = 1760;
const MENU_MIN_WIDTH = 320;

const DEFAULT_BOTTOM_FLOATING_BAR_HEIGHT = 88;
const BOTTOM_GAP = 10;

const Z_OVERLAY = 99998;
const Z_PANEL = 99999;
const Z_CLICK_SHIELD = 100000;

const PANEL_ID = "tdls-slidingmenubar-panel";
const LEGACY_PANEL_ID = "tdlc-slidingmenubar-panel";

const TIERS = [
  { name: "Limited Edition", slug: "limited-edition" },
  { name: "Premium Collection", slug: "premium-collection" },
  { name: "Signature Series", slug: "signature-series" },
  { name: "Heritage Collection", slug: "heritage-collection" },
];

/* ------------------------------ tiny utils ------------------------------ */

const isArr = (v) => Array.isArray(v);

function unwrapStrapiArray(v) {
  if (!v) return [];
  if (isArr(v)) return v;
  if (isArr(v?.data)) return v.data;
  if (v?.data && !isArr(v?.data)) return [v.data];
  return [];
}

function normalizeEntity(e) {
  if (!e) return null;
  if (e.attributes) return { id: e.id, ...e.attributes };
  return e;
}

function normSlug(input) {
  const raw = (input ?? "").toString().trim().toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/[?#].*$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleizeSlug(slug) {
  const s = (slug || "").toString().trim();
  if (!s) return "";
  return s.replace(/[-_]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function pickName(e) {
  const x = normalizeEntity(e) || {};
  return (x.name || x.title || x.label || x.slug || "").toString().trim();
}

function tierKey(s) {
  return (s || "").toString().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tierMatches(a, b) {
  const ak = tierKey(a);
  const bk = tierKey(b);
  return !!ak && ak === bk;
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function canUseLS() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/**
 * ✅ Only REAL products that have real pages:
 * - must have a slug
 * - must NOT be archived
 * - must NOT be disable_frontend
 * - if status exists, only allow Active (case-insensitive)
 */
function isProductVisible(pRaw) {
  const p = normalizeEntity(pRaw) || {};
  const slug = normSlug(p.slug || "");
  if (!slug) return false;

  if (p.disable_frontend === true) return false;
  if (p.is_archived === true) return false;

  const st = (p.status || "").toString().trim().toLowerCase();
  if (st && st !== "active") return false;

  return true;
}

/* ------------------------------ routing ------------------------------ */

function buildCollectionsHref({
  tier,
  audience,
  category,
  subCategory,
  genderGroup,
  ageGroup,
  page,
  pageSize,
}) {
  const t = normSlug(tier);
  const a = audience ? normSlug(audience) : "";
  const c = category ? normSlug(category) : "";
  const sc = subCategory ? normSlug(subCategory) : "";
  const gg = genderGroup ? normSlug(genderGroup) : "";
  const ag = ageGroup ? normSlug(ageGroup) : "";

  const qs = new URLSearchParams();
  if (t) qs.set("tier", t);
  if (a) qs.set("audience", a);
  if (c) qs.set("category", c);
  if (sc) qs.set("subCategory", sc);
  if (gg) qs.set("genderGroup", gg);
  if (ag) qs.set("ageGroup", ag);

  if (page != null && page !== "") qs.set("page", String(Math.max(1, Math.floor(Number(page) || 1))));
  if (pageSize != null && pageSize !== "")
    qs.set("pageSize", String(Math.max(10, Math.min(100, Math.floor(Number(pageSize) || 24)))));

  return `/collections${qs.toString() ? `?${qs.toString()}` : ""}`;
}

/* ------------------------------ UI helpers (UNCHANGED) ------------------------------ */

function Pill({ children, tone = "neutral", size = "md" }) {
  const tones = {
    neutral: { bg: "rgba(12,35,64,0.06)", fg: "#0c2340", bd: "rgba(12,35,64,0.10)" },
    gold: { bg: "rgba(191,167,80,0.20)", fg: "#0c2340", bd: "rgba(191,167,80,0.36)" },
    ink: { bg: "rgba(12,35,64,0.10)", fg: "#0c2340", bd: "rgba(12,35,64,0.18)" },
  };
  const t = tones[tone] || tones.neutral;
  const sz = size === "sm" ? { pad: "5px 9px", fs: 10 } : { pad: "6px 10px", fs: 11 };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: sz.pad,
        borderRadius: 999,
        border: `1px solid ${t.bd}`,
        background: t.bg,
        color: t.fg,
        fontWeight: 900,
        fontSize: sz.fs,
        letterSpacing: ".14em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        maxWidth: "100%",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
    </span>
  );
}

function TierTabs({ tiers, activeSlug, onPick, isMobile }) {
  const fs = isMobile ? "clamp(10px, 2.7vw, 11px)" : 12;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: isMobile ? 8 : 10,
        overflowX: "auto",
        overflowY: "hidden",
        WebkitOverflowScrolling: "touch",
        overscrollBehaviorX: "contain",
        touchAction: "pan-x",
        paddingBottom: 2,
        maxWidth: "100%",
      }}
    >
      {tiers.map((t) => {
        const active = normSlug(activeSlug) === normSlug(t.slug);
        return (
          <button
            key={t.slug}
            type="button"
            onClick={() => onPick(t.slug)}
            style={{
              flex: "0 0 auto",
              borderRadius: 999,
              padding: isMobile ? "7px 10px" : "9px 12px",
              border: active ? "1px solid rgba(12,35,64,0.55)" : "1px solid rgba(0,0,0,0.10)",
              background: active
                ? "linear-gradient(135deg, #0c2340 10%, #163060 100%)"
                : "linear-gradient(135deg, #ffffff 55%, #fbf7ec 100%)",
              color: active ? "#fffdf8" : "#0c2340",
              fontWeight: 900,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              boxShadow: active ? "0 14px 26px rgba(12,35,64,0.18)" : "0 10px 18px rgba(0,0,0,0.05)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontSize: fs,
            }}
            aria-pressed={active}
          >
            {t.name}
          </button>
        );
      })}
    </div>
  );
}

function Shell({ title, right, children }) {
  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(0,0,0,0.08)",
        background: "rgba(255,255,255,0.70)",
        boxShadow: "0 16px 34px rgba(0,0,0,0.07)",
        overflow: "hidden",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "10px 10px",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: "linear-gradient(135deg, rgba(255,255,255,0.92) 55%, rgba(247,243,231,0.92) 100%)",
        }}
      >
        <div
          style={{
            fontWeight: 900,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            fontSize: 12,
            color: "#0c2340",
          }}
        >
          {title}
        </div>
        {right || null}
      </div>
      {children}
    </div>
  );
}

function ScrollBody({ children, compact = false }) {
  return (
    <div
      style={{
        padding: compact ? 8 : 10,
        minHeight: 0,
        overflow: "auto",
        WebkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
        touchAction: "pan-y",
      }}
    >
      <div style={{ display: "grid", gap: compact ? 7 : 8 }}>{children}</div>
    </div>
  );
}

function Select({ value, onChange, options, placeholder, isMobile }) {
  const fs = isMobile ? "clamp(9px, 2.6vw, 10px)" : 11;
  return (
    <select
      value={value}
      onChange={onChange}
      style={{
        height: isMobile ? 34 : 34,
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.96)",
        boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
        padding: "0 10px",
        fontWeight: 900,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        fontSize: fs,
        color: "#0c2340",
        outline: "none",
        width: isMobile ? "100%" : "min(220px, 100%)",
        maxWidth: "100%",
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.slug} value={o.slug}>
          {o.name} ({o.count})
        </option>
      ))}
    </select>
  );
}

function Segmented({ value, onChange, items }) {
  const btnFs = "clamp(9px, 2.5vw, 10px)";
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.92)",
        boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
        overflow: "hidden",
      }}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            style={{
              flex: 1,
              height: 32,
              border: "none",
              background: active ? "linear-gradient(135deg, #0c2340 10%, #163060 100%)" : "transparent",
              color: active ? "#fffdf8" : "#0c2340",
              fontWeight: 900,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              fontSize: btnFs,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            aria-pressed={active}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function CompactRowButton({
  active,
  title,
  subLeft,
  badge,
  onClick,
  onNavigateHref,
  onNavigate,
  isDesktop,
  dense,
  onMouseEnter,
  onMouseLeave,
  onFocus,
}) {
  const titleFs = dense ? "clamp(9px, 2.6vw, 10px)" : 11;
  const subFs = dense ? "clamp(8px, 2.4vw, 9px)" : 10;
  const badgeFs = dense ? "clamp(8px, 2.4vw, 9px)" : 10;

  const baseStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dense ? 8 : 10,
    padding: dense ? "9px 9px" : "10px 10px",
    textDecoration: "none",
    borderRadius: 12,
    border: active ? "1px solid rgba(12,35,64,0.32)" : "1px solid rgba(0,0,0,0.06)",
    background: active
      ? "linear-gradient(135deg, rgba(12,35,64,0.10) 10%, rgba(191,167,80,0.14) 100%)"
      : "rgba(255,255,255,0.78)",
    boxShadow: active ? "0 10px 18px rgba(12,35,64,0.10)" : "0 8px 14px rgba(0,0,0,0.04)",
    color: "#0c2340",
    cursor: "pointer",
    minWidth: 0,
    width: "100%",
    textAlign: "left",
  };

  if (isDesktop && onNavigateHref) {
    return (
      <Link
        href={onNavigateHref}
        prefetch
        onClick={onNavigate}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        style={baseStyle}
      >
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontWeight: 900,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              fontSize: titleFs,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={title}
          >
            {title}
          </div>
          {subLeft ? (
            <div
              style={{
                fontWeight: 800,
                fontSize: subFs,
                color: "rgba(12,35,64,0.62)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={subLeft}
            >
              {subLeft}
            </div>
          ) : null}
        </div>

        {badge ? (
          <span
            style={{
              flexShrink: 0,
              padding: dense ? "4px 7px" : "4px 8px",
              borderRadius: 999,
              border: "1px solid rgba(12,35,64,0.14)",
              background: "rgba(12,35,64,0.06)",
              fontWeight: 900,
              fontSize: badgeFs,
              letterSpacing: ".10em",
              textTransform: "uppercase",
            }}
          >
            {badge}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      style={baseStyle}
      aria-pressed={active}
    >
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          style={{
            fontWeight: 900,
            letterSpacing: ".07em",
            textTransform: "uppercase",
            fontSize: titleFs,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={title}
        >
          {title}
        </div>
        {subLeft ? (
          <div
            style={{
              fontWeight: 800,
              fontSize: subFs,
              color: "rgba(12,35,64,0.62)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={subLeft}
          >
            {subLeft}
          </div>
        ) : null}
      </div>

      {badge ? (
        <span
          style={{
            flexShrink: 0,
            padding: dense ? "4px 7px" : "4px 8px",
            borderRadius: 999,
            border: "1px solid rgba(12,35,64,0.14)",
            background: "rgba(12,35,64,0.06)",
            fontWeight: 900,
            fontSize: badgeFs,
            letterSpacing: ".10em",
            textTransform: "uppercase",
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function MobileSelectRow({ active, title, subLeft, badge, onSelect, href, onNavigate }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch", width: "100%" }}>
      <button
        type="button"
        onClick={onSelect}
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 10px",
          borderRadius: 12,
          border: active ? "1px solid rgba(12,35,64,0.32)" : "1px solid rgba(0,0,0,0.06)",
          background: active
            ? "linear-gradient(135deg, rgba(12,35,64,0.10) 10%, rgba(191,167,80,0.14) 100%)"
            : "rgba(255,255,255,0.78)",
          boxShadow: active ? "0 10px 18px rgba(12,35,64,0.10)" : "0 8px 14px rgba(0,0,0,0.04)",
          color: "#0c2340",
          cursor: "pointer",
          minWidth: 0,
          textAlign: "left",
        }}
        aria-pressed={active}
      >
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <div
            style={{
              fontWeight: 900,
              letterSpacing: ".07em",
              textTransform: "uppercase",
              fontSize: "clamp(10px, 2.8vw, 11px)",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={title}
          >
            {title}
          </div>
          {subLeft ? (
            <div
              style={{
                fontWeight: 800,
                fontSize: "clamp(9px, 2.5vw, 10px)",
                color: "rgba(12,35,64,0.62)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={subLeft}
            >
              {subLeft}
            </div>
          ) : null}
        </div>

        {typeof badge === "number" ? (
          <span
            style={{
              flexShrink: 0,
              padding: "4px 8px",
              borderRadius: 999,
              border: "1px solid rgba(12,35,64,0.14)",
              background: "rgba(12,35,64,0.06)",
              fontWeight: 900,
              fontSize: 10,
              letterSpacing: ".10em",
              textTransform: "uppercase",
            }}
          >
            {badge}
          </span>
        ) : null}
      </button>

      {href ? (
        <Link
          href={href}
          prefetch
          onClick={(e) => {
            e.stopPropagation();
            onNavigate?.();
          }}
          onTouchStart={(e) => e.stopPropagation()}
          style={{
            flexShrink: 0,
            width: 74,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 12,
            border: "1px solid rgba(12,35,64,0.18)",
            background: "rgba(255,255,255,0.92)",
            boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
            color: "#0c2340",
            textDecoration: "none",
            fontWeight: 900,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            fontSize: 10,
          }}
        >
          Open
        </Link>
      ) : null}
    </div>
  );
}

function SuggestionsDropdown({ suggestions, activeIndex, onPick, width = 420 }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 42,
        right: 0,
        width,
        maxWidth: "min(520px, 92vw)",
        borderRadius: 16,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.96)",
        boxShadow: "0 22px 40px rgba(0,0,0,0.14)",
        overflow: "hidden",
        zIndex: Z_PANEL + 2,
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          background: "linear-gradient(135deg, rgba(255,255,255,0.98) 55%, rgba(247,243,231,0.96) 100%)",
        }}
      >
        <div
          style={{
            fontWeight: 900,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            fontSize: 11,
            color: "#0c2340",
          }}
        >
          Suggestions
        </div>
        <Pill tone="ink" size="sm">
          {suggestions.length}
        </Pill>
      </div>

      <div
        style={{
          maxHeight: 340,
          overflow: "auto",
          padding: 8,
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          touchAction: "pan-y",
        }}
      >
        {suggestions.map((s, idx) => {
          const active = idx === activeIndex;
          const tag = s.type === "PRODUCT" ? "Product" : s.type === "CATEGORY" ? "Category" : "Audience";
          return (
            <Link
              key={`${s.type}-${s.slug}-${idx}`}
              href={s.href}
              prefetch
              onMouseEnter={() => onPick?.({ type: "hover", idx })}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPick?.({ type: "click", idx, href: s.href });
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPick?.({ type: "click", idx, href: s.href });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 10px",
                borderRadius: 12,
                border: active ? "1px solid rgba(12,35,64,0.28)" : "1px solid rgba(0,0,0,0.06)",
                background: active
                  ? "linear-gradient(135deg, rgba(12,35,64,0.10) 10%, rgba(191,167,80,0.12) 100%)"
                  : "rgba(255,255,255,0.78)",
                textDecoration: "none",
                color: "#0c2340",
                boxShadow: active ? "0 10px 18px rgba(12,35,64,0.10)" : "0 8px 14px rgba(0,0,0,0.04)",
                cursor: "pointer",
                minWidth: 0,
              }}
            >
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                <div
                  style={{
                    fontWeight: 900,
                    letterSpacing: ".07em",
                    textTransform: "uppercase",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={s.name}
                >
                  {s.name}
                </div>
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 10,
                    color: "rgba(12,35,64,0.62)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={s.meta || ""}
                >
                  {s.meta || ""}
                </div>
              </div>

              <span
                style={{
                  flexShrink: 0,
                  padding: "5px 8px",
                  borderRadius: 999,
                  border: "1px solid rgba(12,35,64,0.14)",
                  background: "rgba(12,35,64,0.06)",
                  fontWeight: 900,
                  fontSize: 10,
                  letterSpacing: ".10em",
                  textTransform: "uppercase",
                }}
              >
                {tag}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function readCssVarPx(vars, fallbackPx) {
  try {
    const root = document.documentElement;
    for (const v of vars) {
      const raw = getComputedStyle(root).getPropertyValue(v);
      const n = parseInt((raw || "").toString().replace("px", "").trim(), 10);
      if (Number.isFinite(n) && n > 40 && n < 240) return n;
    }
  } catch {}
  return fallbackPx;
}

/* ------------------------------ data model (CLEAN) ------------------------------ */

const FETCH_TIMEOUT_MS = 16000;
const LS_KEY = "tdls:slidingmenubar:data:v10";
const LS_TS = "tdls:slidingmenubar:ts:v10";
const LS_TTL_MS = 6 * 60 * 60 * 1000;

// Shared with slidingmenubar.preloader.jsx.
// The small preloader can fetch before this large menu chunk is needed, then
// this module consumes that already-fetched payload without another request.
const PRELOAD_GLOBAL_KEY = "__TDLS_SMB_PRELOAD_STATE__";
const RAW_LS_KEY = "tdls:slidingmenubar:raw-products:v1";
const RAW_LS_TS = "tdls:slidingmenubar:raw-products-ts:v1";
const RAW_LS_TTL_MS = 6 * 60 * 60 * 1000;

let __menuPromise = null;
let __menuData = null;
let __menuLastGood = null;

function unwrapStrapiList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;

  // Strapi direct: { data: [...] }
  if (Array.isArray(payload?.data)) return payload.data;

  // Some wrappers: { data: { data: [...] } }
  if (payload?.data && Array.isArray(payload.data?.data)) return payload.data.data;

  // Proxy wrapper already unwrapped? (handled earlier) — keep conservative:
  if (payload?.ok && Array.isArray(payload?.data)) return payload.data;
  if (payload?.ok && payload?.data && Array.isArray(payload.data?.data)) return payload.data.data;

  return [];
}

/**
 * ✅ FIX (critical): if /api/strapi returns { ok:false, ... } it is NOT data.
 * Previously we treated it as “truthy” and stopped, causing: Audiences 0 / Categories 0.
 */
function unwrapProxyOk(raw) {
  if (!raw || typeof raw !== "object") return raw;

  if (Object.prototype.hasOwnProperty.call(raw, "ok")) {
    if (raw.ok === true) return raw.data ?? null;
    if (raw.ok === false) return null;
  }

  // Some error shapes: { error: ... } without data
  if (raw?.error && raw?.data == null) return null;

  return raw;
}

async function fetchFromStrapi(path) {
  const doFetch = async (url) => {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer =
      controller && typeof window !== "undefined"
        ? window.setTimeout(() => {
            try {
              controller.abort();
            } catch {}
          }, FETCH_TIMEOUT_MS)
        : null;

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller?.signal,
      });
      if (!res.ok) return null;

      const raw = await res.json().catch(() => null);
      const unwrapped = unwrapProxyOk(raw);
      if (unwrapped == null) return null;

      if (unwrapped?.error && unwrapped?.data == null) return null;
      return unwrapped;
    } catch {
      return null;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  };

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  // Encode the complete Strapi path so inner query-string '&' characters are
  // never interpreted as query params belonging to /api/strapi itself.
  const encoded = encodeURIComponent(normalizedPath);
  return doFetch(`/api/strapi?path=${encoded}`);
}

function splitRelationScalar(value) {
  if (value == null) return [];
  if (typeof value === "number") return [String(value)];
  if (typeof value !== "string") return [];

  const raw = value.trim();
  if (!raw) return [];

  if ((raw.startsWith("[") && raw.endsWith("]")) || (raw.startsWith("{") && raw.endsWith("}"))) {
    const parsed = safeJsonParse(raw);
    if (Array.isArray(parsed)) return parsed.flatMap(splitRelationScalar);
    if (parsed && typeof parsed === "object") {
      const candidate = parsed.slug ?? parsed.handle ?? parsed.key ?? parsed.uid ?? parsed.code ?? parsed.name ?? parsed.title;
      return candidate == null ? [] : splitRelationScalar(candidate);
    }
  }

  // Some optimized endpoints serialize slug arrays as comma/pipe separated text.
  if (raw.includes(",") || raw.includes("|")) {
    return raw
      .split(/[|,]/g)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  return [raw];
}

function relationValues(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(relationValues);
  if (typeof v === "string" || typeof v === "number") return splitRelationScalar(v);

  if (typeof v === "object") {
    if (Object.prototype.hasOwnProperty.call(v, "data")) return relationValues(v.data);
    if (Array.isArray(v.slugs)) return relationValues(v.slugs);
    if (Array.isArray(v.items)) return relationValues(v.items);
    return [v];
  }

  return [];
}

function entityStableId(entity, fallbackSlug = "") {
  const e = normalizeEntity(entity) || {};
  const candidate = e.id ?? e.documentId ?? e.document_id ?? e.uid ?? "";
  if (candidate !== "") return String(candidate);
  const slug = normSlug(fallbackSlug || e.slug || e.name || e.title || "");
  return slug ? `slug:${slug}` : "";
}

/**
 * Hardened relation slug extraction:
 * - Strapi v4/v5 relation objects
 * - flattened *_slugs arrays
 * - scalar, JSON-string, comma/pipe serialized slug lists
 */
function relSlugs(entity, keys) {
  const e = normalizeEntity(entity) || {};
  const out = [];

  for (const k of keys) {
    for (const raw of relationValues(e?.[k])) {
      if (raw == null) continue;

      if (typeof raw === "string" || typeof raw === "number") {
        const slug = normSlug(raw);
        if (slug) out.push(slug);
        continue;
      }

      const r = normalizeEntity(raw) || {};
      const candidates = relationValues(
        r.slug ?? r.handle ?? r.key ?? r.uid ?? r.code ?? r.name ?? r.title ?? r.label ?? r.slugs ?? []
      );
      for (const candidate of candidates) {
        const slug = normSlug(candidate);
        if (slug) out.push(slug);
      }
    }
  }

  return Array.from(new Set(out));
}

function relSlugNameMapFromProducts(products, relKeys) {
  const keys = Array.isArray(relKeys) ? relKeys : [relKeys];
  const m = new Map();

  for (const pRaw of products || []) {
    const p = normalizeEntity(pRaw) || {};

    for (const relKey of keys) {
      for (const raw of relationValues(p?.[relKey])) {
        if (raw == null) continue;

        if (typeof raw === "string" || typeof raw === "number") {
          const slug = normSlug(raw);
          if (slug && !m.has(slug)) m.set(slug, titleizeSlug(slug));
          continue;
        }

        const r = normalizeEntity(raw) || {};
        const slug = normSlug(r.slug || r.handle || r.key || r.uid || r.code || r.name || r.title || r.label || "");
        if (!slug) continue;
        const name = (r.name || r.title || r.label || "").toString().trim() || titleizeSlug(slug);
        if (!m.has(slug)) m.set(slug, name);
      }
    }
  }

  return m;
}

// Support both normal Strapi relations and the flattened `*_slugs` product
// shape returned by this project's optimized /api/strapi products endpoint.
const PRODUCT_TIER_KEYS = [
  "tiers",
  "tiers_slugs",
  "brand_tiers",
  "brand_tiers_slugs",
  "collection_tiers",
  "collection_tiers_slugs",
  "product_collections",
  "product_collections_slugs",
  "events_products_collections",
  "events_products_collections_slugs",
  "events_products_collection",
  "event_products_collections",
  "event_product_collections",
  "collections",
  "collections_slugs",
  "collection",
  "tier",
  "tier_slug",
  "tierSlug",
  "tier_slugs",
  "product_tiers",
  "product_tiers_slugs",
  "collection_slugs",
  "product_collection_slugs",
  "events_products_collection_slugs",
];

const PRODUCT_AUDIENCE_KEYS = [
  "audience_categories",
  "audience_categories_slugs",
  "audiences",
  "audiences_slugs",
  "audience_category",
  "audienceCategory",
  "audience_category_slugs",
  "audience_slugs",
];

const PRODUCT_CATEGORY_KEYS = [
  "categories",
  "categories_slugs",
  "category",
  "product_categories",
  "product_categories_slugs",
  "product_category",
  "category_slugs",
  "product_category_slugs",
];

const PRODUCT_SUBCATEGORY_KEYS = [
  "sub_categories",
  "sub_categories_slugs",
  "sub_category",
  "subCategories",
  "subCategory",
  "sub_category_slugs",
  "subCategorySlugs",
];

const PRODUCT_GENDER_KEYS = [
  "gender_groups",
  "gender_groups_slugs",
  "gender_group",
  "genderGroups",
  "genderGroup",
  "gender_group_slugs",
  "genderGroupSlugs",
];

const PRODUCT_AGE_KEYS = [
  "age_groups",
  "age_groups_slugs",
  "age_group",
  "ageGroups",
  "ageGroup",
  "age_group_slugs",
  "ageGroupSlugs",
];

function buildIndexFromAudienceSeed(audienceRowsStrapi) {
  const prodById = new Map();
  const audRows = [];

  for (const aRaw of audienceRowsStrapi || []) {
    const a = normalizeEntity(aRaw) || {};
    const aSlug = normSlug(a.slug || a.name || a.title || "");
    if (!aSlug) continue;

    const aName = (a.name || a.title || "").toString().trim() || titleizeSlug(aSlug);

    const aTierSlugs = relSlugs(a, PRODUCT_TIER_KEYS);

    // Product relation key can drift; accept only actual related product objects.
    const productRelationKeys = ["products", "items", "pieces", "product_list", "product_lists"];
    const mergedProducts = [];
    for (const k of productRelationKeys) {
      for (const rawProduct of relationValues(a?.[k])) {
        if (!rawProduct || typeof rawProduct !== "object") continue;
        const product = normalizeEntity(rawProduct);
        if (product) mergedProducts.push(product);
      }
    }

    const prods = mergedProducts.filter(isProductVisible);

    const productIds = [];
    for (const p of prods) {
      const productId = entityStableId(p, p?.slug);
      if (!productId) continue;
      productIds.push(productId);
      if (!prodById.has(productId)) prodById.set(productId, { ...p, __menuId: productId });
    }

    audRows.push({
      id: entityStableId(a, aSlug) || `aud-${aSlug}`,
      slug: aSlug,
      name: aName,
      tierSlugs: aTierSlugs,
      productIds: Array.from(new Set(productIds)),
    });
  }

  const products = Array.from(prodById.values());

  const productIndex = new Map();
  for (const p of products) {
    if (!isProductVisible(p)) continue;

    const slug = normSlug(p.slug || "");
    const productId = p.__menuId || entityStableId(p, slug);
    if (!productId || !slug) continue;

    const name = (p.name || p.title || "").toString().trim() || titleizeSlug(slug);

    const tierSlugs = relSlugs(p, PRODUCT_TIER_KEYS);
    const categorySlugs = relSlugs(p, PRODUCT_CATEGORY_KEYS);
    const subCategorySlugs = relSlugs(p, PRODUCT_SUBCATEGORY_KEYS);
    const genderGroupSlugs = relSlugs(p, PRODUCT_GENDER_KEYS);
    const ageGroupSlugs = relSlugs(p, PRODUCT_AGE_KEYS);

    productIndex.set(productId, {
      id: productId,
      slug,
      name,
      tierSlugs,
      categorySlugs,
      subCategorySlugs,
      genderGroupSlugs,
      ageGroupSlugs,
    });
  }

  const nameMaps = {
    categories: relSlugNameMapFromProducts(products, PRODUCT_CATEGORY_KEYS),
    subCategories: relSlugNameMapFromProducts(products, PRODUCT_SUBCATEGORY_KEYS),
    genderGroups: relSlugNameMapFromProducts(products, PRODUCT_GENDER_KEYS),
    ageGroups: relSlugNameMapFromProducts(products, PRODUCT_AGE_KEYS),
  };

  const validIds = new Set(Array.from(productIndex.keys()));
  const cleanedAudRows = (audRows || [])
    .map((a) => ({
      ...a,
      productIds: (a.productIds || []).filter((id) => validIds.has(id)),
    }))
    .filter((a) => (a.productIds || []).length > 0);

  return { audienceRows: cleanedAudRows, productIndex, nameMaps };
}

/**
 * ✅ STRICT Tier membership (NO GUESSING):
 * - If tier selected:
 *   - product must have a matching tier slug OR audience must have matching tier slug
 * - If neither has tier links → it does NOT belong to any tier
 */
function productBelongsToTier({ tier, productTierSlugs, audienceTierMatch }) {
  const t = normSlug(tier);
  if (!t) return true;

  const productTierMatch = (productTierSlugs || []).some((s) => tierMatches(t, s));

  // Product and audience tier relations are both real relations. A stale or
  // secondary product collection must not override a valid audience-tier link.
  return productTierMatch || !!audienceTierMatch;
}

function resolveNameFromMap(map, slug) {
  const s = normSlug(slug);
  if (!s) return "";
  return map?.get?.(s) || titleizeSlug(s);
}

function audienceTierVerdict({ audienceRow, tierSlug, productIndex }) {
  const ids = audienceRow?.productIds || [];
  if (!ids.length) return { ok: false, count: 0 };

  const aTierSlugs = audienceRow?.tierSlugs || [];
  const audienceTierMatch = aTierSlugs.length ? aTierSlugs.some((s) => tierMatches(tierSlug, s)) : false;

  let count = 0;
  for (const id of ids) {
    const p = productIndex.get(id);
    if (!p) continue;
    if (
      productBelongsToTier({
        tier: tierSlug,
        productTierSlugs: p.tierSlugs,
        audienceTierMatch,
      })
    ) {
      count += 1;
    }
  }
  return { ok: count > 0, count };
}

function deriveCategories({ tierSlug, audienceRow, productIndex, nameMaps }) {
  const ids = audienceRow?.productIds || [];
  const aTierSlugs = audienceRow?.tierSlugs || [];
  const audienceTierMatch = aTierSlugs.length ? aTierSlugs.some((s) => tierMatches(tierSlug, s)) : false;

  const counts = new Map();
  for (const id of ids) {
    const p = productIndex.get(id);
    if (!p) continue;

    if (
      !productBelongsToTier({
        tier: tierSlug,
        productTierSlugs: p.tierSlugs,
        audienceTierMatch,
      })
    )
      continue;

    for (const c of p.categorySlugs || []) counts.set(c, (counts.get(c) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([slug, count]) => ({ slug, name: resolveNameFromMap(nameMaps?.categories, slug), count }))
    .filter((x) => x.slug && x.count > 0)
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)));
}

function deriveProducts({ tierSlug, audienceRow, categorySlug, productIndex, filters }) {
  const ids = audienceRow?.productIds || [];
  const aTierSlugs = audienceRow?.tierSlugs || [];
  const audienceTierMatch = aTierSlugs.length ? aTierSlugs.some((s) => tierMatches(tierSlug, s)) : false;

  const cat = categorySlug ? normSlug(categorySlug) : "";
  const sc = normSlug(filters?.subCategory);
  const gg = normSlug(filters?.genderGroup);
  const ag = normSlug(filters?.ageGroup);

  const out = [];
  for (const id of ids) {
    const p = productIndex.get(id);
    if (!p) continue;

    if (
      !productBelongsToTier({
        tier: tierSlug,
        productTierSlugs: p.tierSlugs,
        audienceTierMatch,
      })
    )
      continue;

    if (cat && !(p.categorySlugs || []).includes(cat)) continue;
    if (sc && !(p.subCategorySlugs || []).includes(sc)) continue;
    if (gg && !(p.genderGroupSlugs || []).includes(gg)) continue;
    if (ag && !(p.ageGroupSlugs || []).includes(ag)) continue;

    out.push({ id: p.id, slug: p.slug, name: p.name });
  }

  return out.sort((x, y) => (x.name || "").localeCompare(y.name || ""));
}

function buildFacetOptions({ baseProducts, productIndex, nameMaps }) {
  const sub = new Map();
  const gg = new Map();
  const ag = new Map();

  for (const p of baseProducts || []) {
    const idx = p?.id ? productIndex.get(p.id) : null;
    if (!idx) continue;

    for (const s of idx.subCategorySlugs || []) sub.set(s, (sub.get(s) || 0) + 1);
    for (const s of idx.genderGroupSlugs || []) gg.set(s, (gg.get(s) || 0) + 1);
    for (const s of idx.ageGroupSlugs || []) ag.set(s, (ag.get(s) || 0) + 1);
  }

  const toArr = (m, mapNames) =>
    Array.from(m.entries())
      .map(([slug, count]) => ({ slug, name: resolveNameFromMap(mapNames, slug), count }))
      .filter((x) => x.slug && x.count > 0)
      .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)));

  return {
    subCategories: toArr(sub, nameMaps?.subCategories),
    genderGroups: toArr(gg, nameMaps?.genderGroups),
    ageGroups: toArr(ag, nameMaps?.ageGroups),
  };
}

/* ------------------------------ search helpers ------------------------------ */

function scoreMatch({ q, text }) {
  const qq = (q || "").trim().toLowerCase();
  const tt = (text || "").trim().toLowerCase();
  if (!qq || !tt) return -1;
  if (tt === qq) return 1000;
  if (tt.startsWith(qq)) return 900;
  const idx = tt.indexOf(qq);
  if (idx >= 0) return 700 - idx;
  return -1;
}

function makeSearchKey(name, slug) {
  return `${(name || "").toString()} ${(slug || "").toString()}`.trim();
}

/* ------------------------------ preload + cache (CLEAN) ------------------------------ */

function loadFromLocalStorage() {
  if (!canUseLS()) return null;
  const tsRaw = window.localStorage.getItem(LS_TS);
  const ts = tsRaw ? parseInt(tsRaw, 10) : 0;
  if (!Number.isFinite(ts) || ts <= 0) return null;
  if (Date.now() - ts > LS_TTL_MS) return null;

  const raw = window.localStorage.getItem(LS_KEY);
  if (!raw) return null;

  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") return null;

  const audienceRows = Array.isArray(parsed.audienceRows) ? parsed.audienceRows : [];
  const products = Array.isArray(parsed.products) ? parsed.products : [];

  const prodIndex = new Map();
  for (const p of products) {
    if (!p?.id || !p?.slug) continue;
    prodIndex.set(p.id, p);
  }

  const nameMaps = {
    categories: new Map(parsed?.nameMaps?.categories || []),
    subCategories: new Map(parsed?.nameMaps?.subCategories || []),
    genderGroups: new Map(parsed?.nameMaps?.genderGroups || []),
    ageGroups: new Map(parsed?.nameMaps?.ageGroups || []),
  };

  const cleanedAudienceRows = audienceRows
    .map((a) => ({
      ...a,
      productIds: Array.from(new Set(a?.productIds || [])).filter((id) => prodIndex.has(id)),
    }))
    .filter((a) => (a.productIds || []).length > 0);

  if (!cleanedAudienceRows.length || !prodIndex.size) return null;
  return { audienceRows: cleanedAudienceRows, productIndex: prodIndex, nameMaps, _fromCache: true };
}

function saveToLocalStorage({ audienceRows, productIndex, nameMaps }) {
  if (!canUseLS()) return;
  try {
    const products = Array.from(productIndex.values()).slice(0, 2600);
    window.localStorage.setItem(LS_TS, String(Date.now()));
    window.localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        audienceRows: (audienceRows || []).slice(0, 1200),
        products,
        nameMaps: {
          categories: Array.from((nameMaps?.categories || new Map()).entries()),
          subCategories: Array.from((nameMaps?.subCategories || new Map()).entries()),
          genderGroups: Array.from((nameMaps?.genderGroups || new Map()).entries()),
          ageGroups: Array.from((nameMaps?.ageGroups || new Map()).entries()),
        },
      })
    );
  } catch {}
}

function getSharedPreloadState() {
  if (typeof globalThis === "undefined") return null;

  const root = globalThis;
  if (!root[PRELOAD_GLOBAL_KEY]) {
    root[PRELOAD_GLOBAL_KEY] = {
      ok: false,
      inFlight: false,
      promise: null,
      rawOk: false,
      rawPayload: null,
      rawTs: 0,
      menuData: null,
      lastFailAt: 0,
      retryCount: 0,
    };
  }

  return root[PRELOAD_GLOBAL_KEY];
}

function rawRowsFromPayload(raw) {
  const payload = unwrapProxyOk(raw);
  if (!payload) return [];
  return unwrapStrapiList(payload).map(normalizeEntity).filter(Boolean);
}

function readPreloadedRawProducts() {
  if (typeof window === "undefined") return [];

  const state = getSharedPreloadState();
  if (state?.rawPayload) {
    const rows = rawRowsFromPayload(state.rawPayload);
    if (rows.length) return rows;
  }

  if (!canUseLS()) return [];

  try {
    const ts = Number(window.localStorage.getItem(RAW_LS_TS) || 0);
    if (!Number.isFinite(ts) || ts <= 0) return [];
    if (Date.now() - ts > RAW_LS_TTL_MS) return [];

    const text = window.localStorage.getItem(RAW_LS_KEY);
    if (!text) return [];

    const raw = safeJsonParse(text);
    const rows = rawRowsFromPayload(raw);
    if (!rows.length) return [];

    if (state) {
      state.rawOk = true;
      state.rawPayload = raw;
      state.rawTs = ts;
    }

    return rows;
  } catch {
    return [];
  }
}

async function fetchAudienceSeedFromStrapi() {
  const strict =
    "/audience-categories?pagination[pageSize]=500" +
    "&fields[0]=slug&fields[1]=name&fields[2]=title&fields[3]=order&fields[4]=priority" +
    "&populate[tiers][fields][0]=slug&populate[tiers][fields][1]=name&populate[tiers][fields][2]=title" +
    "&populate[products][fields][0]=slug&populate[products][fields][1]=name&populate[products][fields][2]=title&populate[products][fields][3]=status&populate[products][fields][4]=disable_frontend&populate[products][fields][5]=is_archived" +
    "&populate[products][populate][categories][fields][0]=slug&populate[products][populate][categories][fields][1]=name&populate[products][populate][categories][fields][2]=title" +
    "&populate[products][populate][sub_categories][fields][0]=slug&populate[products][populate][sub_categories][fields][1]=name&populate[products][populate][sub_categories][fields][2]=title" +
    "&populate[products][populate][gender_groups][fields][0]=slug&populate[products][populate][gender_groups][fields][1]=name&populate[products][populate][gender_groups][fields][2]=title" +
    "&populate[products][populate][age_groups][fields][0]=slug&populate[products][populate][age_groups][fields][1]=name&populate[products][populate][age_groups][fields][2]=title" +
    "&populate[products][populate][tiers][fields][0]=slug&populate[products][populate][tiers][fields][1]=name&populate[products][populate][tiers][fields][2]=title" +
    "&populate[products][populate][brand_tiers][fields][0]=slug&populate[products][populate][brand_tiers][fields][1]=name&populate[products][populate][brand_tiers][fields][2]=title" +
    "&populate[products][populate][collection_tiers][fields][0]=slug&populate[products][populate][collection_tiers][fields][1]=name&populate[products][populate][collection_tiers][fields][2]=title" +
    "&populate[products][populate][events_products_collections][fields][0]=slug&populate[products][populate][events_products_collections][fields][1]=name&populate[products][populate][events_products_collections][fields][2]=title" +
    "&populate[products][populate][product_collections][fields][0]=slug&populate[products][populate][product_collections][fields][1]=name&populate[products][populate][product_collections][fields][2]=title";

  let payload = await fetchFromStrapi(strict);
  let audRows = unwrapStrapiList(payload).map(normalizeEntity).filter(Boolean);
  if (audRows.length) return audRows;

  const safe1 = "/audience-categories?pagination[pageSize]=500&populate[products][populate]=*";
  payload = await fetchFromStrapi(safe1);
  audRows = unwrapStrapiList(payload).map(normalizeEntity).filter(Boolean);
  if (audRows.length) return audRows;

  const safe2 = "/audience-categories?pagination[pageSize]=500&populate=*";
  payload = await fetchFromStrapi(safe2);
  audRows = unwrapStrapiList(payload).map(normalizeEntity).filter(Boolean);
  return audRows;
}

async function fetchProductsFallback() {
  // First consume the payload already fetched by the boot preloader.
  // This is the critical hand-off that prevents a second request on menu click.
  const preloaded = readPreloadedRawProducts();
  if (preloaded.length) return preloaded;

  // Keep the primary request shallow and production-safe. These are the only
  // product/taxonomy fields required to build Tier → Audience → Category → Products.
  const strict =
    "/products?pagination[pageSize]=500" +
    "&fields[0]=slug&fields[1]=name&fields[2]=status&fields[3]=disable_frontend&fields[4]=is_archived" +
    "&populate[audience_categories][fields][0]=slug&populate[audience_categories][fields][1]=name" +
    "&populate[categories][fields][0]=slug&populate[categories][fields][1]=name" +
    "&populate[sub_categories][fields][0]=slug&populate[sub_categories][fields][1]=name" +
    "&populate[gender_groups][fields][0]=slug&populate[gender_groups][fields][1]=name" +
    "&populate[age_groups][fields][0]=slug&populate[age_groups][fields][1]=name" +
    "&populate[tiers][fields][0]=slug&populate[tiers][fields][1]=name" +
    "&populate[brand_tiers][fields][0]=slug&populate[brand_tiers][fields][1]=name" +
    "&populate[collection_tiers][fields][0]=slug&populate[collection_tiers][fields][1]=name" +
    "&populate[events_products_collections][fields][0]=slug&populate[events_products_collections][fields][1]=name" +
    "&populate[product_collections][fields][0]=slug&populate[product_collections][fields][1]=name";

  let payload = await fetchFromStrapi(strict);
  let rows = unwrapStrapiList(payload).map(normalizeEntity).filter(Boolean);
  if (rows.length) return rows;

  const safe = "/products?pagination[pageSize]=500&populate=*";
  payload = await fetchFromStrapi(safe);
  rows = unwrapStrapiList(payload).map(normalizeEntity).filter(Boolean);
  return rows;
}

function buildIndexFallbackFromProducts(products) {
  const audMap = new Map();
  const productIndex = new Map();
  const visibleProducts = [];

  for (const p0 of products || []) {
    const p = normalizeEntity(p0) || {};
    if (!isProductVisible(p)) continue;

    const slug = normSlug(p.slug || "");
    const productId = entityStableId(p, slug);
    if (!productId || !slug) continue;

    const name = (p.name || p.title || "").toString().trim() || titleizeSlug(slug);
    const tierSlugs = relSlugs(p, PRODUCT_TIER_KEYS);
    const categorySlugs = relSlugs(p, PRODUCT_CATEGORY_KEYS);
    const subCategorySlugs = relSlugs(p, PRODUCT_SUBCATEGORY_KEYS);
    const genderGroupSlugs = relSlugs(p, PRODUCT_GENDER_KEYS);
    const ageGroupSlugs = relSlugs(p, PRODUCT_AGE_KEYS);

    productIndex.set(productId, {
      id: productId,
      slug,
      name,
      tierSlugs,
      categorySlugs,
      subCategorySlugs,
      genderGroupSlugs,
      ageGroupSlugs,
    });
    visibleProducts.push(p);

    const audienceMeta = new Map();
    for (const key of PRODUCT_AUDIENCE_KEYS) {
      for (const rawAudience of relationValues(p?.[key])) {
        if (!rawAudience || typeof rawAudience !== "object") continue;
        const audience = normalizeEntity(rawAudience) || {};
        const audienceSlug = normSlug(audience.slug || audience.name || audience.title || audience.label || "");
        if (audienceSlug && !audienceMeta.has(audienceSlug)) audienceMeta.set(audienceSlug, audience);
      }
    }

    const audienceNames = relSlugNameMapFromProducts([p], PRODUCT_AUDIENCE_KEYS);
    const audienceSlugs = relSlugs(p, PRODUCT_AUDIENCE_KEYS);

    for (const aSlug of audienceSlugs) {
      if (!aSlug) continue;
      const audience = audienceMeta.get(aSlug) || {};
      const aName =
        (audience.name || audience.title || audience.label || "").toString().trim() ||
        audienceNames.get(aSlug) ||
        titleizeSlug(aSlug);
      const aTierSlugs = relSlugs(audience, PRODUCT_TIER_KEYS);

      const prev = audMap.get(aSlug);
      if (!prev) {
        audMap.set(aSlug, {
          id: entityStableId(audience, aSlug) || `aud-${aSlug}`,
          slug: aSlug,
          name: aName,
          tierSlugs: aTierSlugs,
          productIds: [productId],
        });
      } else {
        prev.productIds.push(productId);
        if (aTierSlugs.length) {
          prev.tierSlugs = Array.from(new Set([...(prev.tierSlugs || []), ...aTierSlugs]));
        }
      }
    }
  }

  const audienceRows = Array.from(audMap.values())
    .map((a) => ({
      ...a,
      productIds: Array.from(new Set(a.productIds)).filter((id) => productIndex.has(id)),
    }))
    .filter((a) => (a.productIds || []).length > 0);

  const nameMaps = {
    categories: relSlugNameMapFromProducts(visibleProducts, PRODUCT_CATEGORY_KEYS),
    subCategories: relSlugNameMapFromProducts(visibleProducts, PRODUCT_SUBCATEGORY_KEYS),
    genderGroups: relSlugNameMapFromProducts(visibleProducts, PRODUCT_GENDER_KEYS),
    ageGroups: relSlugNameMapFromProducts(visibleProducts, PRODUCT_AGE_KEYS),
  };

  return { audienceRows, productIndex, nameMaps };
}

function hasUsableBuiltMenu(data) {
  return (
    (data?.audienceRows?.length || 0) > 0 &&
    (data?.productIndex?.size || 0) > 0
  );
}

function publishBuiltMenu(data, { fromCache = false } = {}) {
  if (!hasUsableBuiltMenu(data)) return null;

  const built = { ...data, _fromCache: !!fromCache };
  __menuData = built;
  __menuLastGood = built;
  saveToLocalStorage(built);

  const state = getSharedPreloadState();
  if (state) {
    state.menuData = built;
    state.ok = true;
  }

  return built;
}

function buildMenuFromPreloadedRawProducts() {
  const rows = readPreloadedRawProducts();
  if (!rows.length) return null;

  const built = buildIndexFallbackFromProducts(rows);
  if (!hasUsableBuiltMenu(built)) return null;

  return publishBuiltMenu(built, { fromCache: true });
}

async function fetchAndBuildFresh() {
  // ✅ PRIMARY: Products-first (reliable Tier↔Audience↔Category join)
  let built = null;

  const prods = await fetchProductsFallback();
  if (prods && prods.length) {
    built = buildIndexFallbackFromProducts(prods || []);
  }

  // ✅ BACKUP: Audience seed (only if products fetch did not produce usable structure)
  const meaningfulPrimary =
    (built?.audienceRows?.length || 0) > 0 && (built?.productIndex?.size || 0) > 0;

  if (!meaningfulPrimary) {
    const audSeed = await fetchAudienceSeedFromStrapi();
    if (audSeed && audSeed.length) {
      built = buildIndexFromAudienceSeed(audSeed);
    }
  }

  const meaningful = (built?.audienceRows?.length || 0) > 0 && (built?.productIndex?.size || 0) > 0;
  if (meaningful) {
    return publishBuiltMenu(built, { fromCache: false });
  }

  const fallback = __menuLastGood || __menuData || loadFromLocalStorage();
  if (fallback?.audienceRows?.length && (fallback?.productIndex?.size || 0) > 0) return fallback;

  return {
    audienceRows: [],
    productIndex: new Map(),
    nameMaps: {
      categories: new Map(),
      subCategories: new Map(),
      genderGroups: new Map(),
      ageGroups: new Map(),
    },
  };
}

/**
 * Preload contract:
 * - use raw payload from the standalone preloader first
 * - then use processed localStorage cache
 * - if another standalone preload is in-flight, wait for that same promise
 * - only perform our own fetch when no usable preload/cache exists, or when a
 *   caller explicitly asks for a fresh background refresh
 */
async function preloadMenuDataOnce({ backgroundRefresh = true, fromPreloader = false } = {}) {
  // An in-module fetch/build already owns the work.
  if (__menuPromise) return __menuPromise;

  // Convert the standalone preloader's raw payload before touching the network.
  if (!__menuData) {
    const preloaded = buildMenuFromPreloadedRawProducts();
    if (preloaded) __menuData = preloaded;
  }

  // Processed cache is the second instant source.
  if (!__menuData) {
    const cached = loadFromLocalStorage();
    if (cached) {
      __menuData = cached;
      __menuLastGood = __menuLastGood || cached;

      const state = getSharedPreloadState();
      if (state) state.menuData = cached;
    }
  }

  // A normal menu consumer should never start a duplicate request while the
  // standalone preloader is already fetching/building the same data.
  if (!fromPreloader) {
    const state = getSharedPreloadState();
    if (!__menuData && state?.inFlight && state?.promise) {
      try {
        const sharedData = await state.promise;
        if (hasUsableBuiltMenu(sharedData)) {
          __menuData = sharedData;
          __menuLastGood = __menuLastGood || sharedData;
          return sharedData;
        }
      } catch {}

      // The shared preload may have published raw data before failing later.
      const preloadedAfterWait = buildMenuFromPreloadedRawProducts();
      if (preloadedAfterWait) return preloadedAfterWait;
    }
  }

  // If usable data is already present and no explicit refresh was requested,
  // return immediately. This is what makes opening the menu instant.
  if (__menuData && !backgroundRefresh) return __menuData;

  // If no data exists at all we must fetch, even when backgroundRefresh=false.
  __menuPromise = fetchAndBuildFresh()
    .then((fresh) => {
      if (hasUsableBuiltMenu(fresh)) {
        __menuData = fresh;
        __menuLastGood = fresh;
      }
      return fresh;
    })
    .catch(() => {
      const preloaded = buildMenuFromPreloadedRawProducts();
      const fallback = preloaded || __menuLastGood || __menuData || loadFromLocalStorage();
      __menuData =
        fallback ||
        ({
          audienceRows: [],
          productIndex: new Map(),
          nameMaps: {
            categories: new Map(),
            subCategories: new Map(),
            genderGroups: new Map(),
            ageGroups: new Map(),
          },
        });
      return __menuData;
    })
    .finally(() => {
      __menuPromise = null;
    });

  return __menuPromise;
}

export function warmSlidingMenuBar({ forceRefresh = true, fromPreloader = false } = {}) {
  return preloadMenuDataOnce({
    backgroundRefresh: !!forceRefresh,
    fromPreloader: !!fromPreloader,
  });
}

export function SlidingMenuBarPreloader() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Do not defer to requestIdleCallback. If this compatibility preloader is
    // mounted directly, begin warming immediately.
    try {
      void warmSlidingMenuBar({ forceRefresh: true });
    } catch {}
  }, []);

  return null;
}

// Auto-warm fallback for deployments that import this menu module directly.
// When the standalone small preloader owns an in-flight request, do not create
// a duplicate request from this larger module.
if (typeof window !== "undefined") {
  try {
    if (!window.__tdlsSlidingMenuBarAutoWarm) {
      window.__tdlsSlidingMenuBarAutoWarm = true;

      const shared = getSharedPreloadState();
      if (!shared?.inFlight && !shared?.promise) {
        void warmSlidingMenuBar({ forceRefresh: true }).catch(() => {});
      }

      document.addEventListener(
        "visibilitychange",
        () => {
          try {
            if (document.visibilityState !== "visible") return;
            const state = getSharedPreloadState();
            if (!state?.inFlight && !state?.promise) {
              void warmSlidingMenuBar({ forceRefresh: true }).catch(() => {});
            }
          } catch {}
        },
        { passive: true }
      );
    }
  } catch {}
}

/* ------------------------------ Component ------------------------------ */

export default function Slidingmenubar({ open, onClose }) {
  const router = useRouter();

  const [menuWidth, setMenuWidth] = useState(MENU_WIDTH_DESKTOP);
  const [isDesktop, setIsDesktop] = useState(false);

  const [tierSlug, setTierSlug] = useState(TIERS[0].slug);
  const [tierName, setTierName] = useState(TIERS[0].name);

  const [hoverAudienceSlug, setHoverAudienceSlug] = useState("");
  const [hoverCategorySlug, setHoverCategorySlug] = useState("");

  const [selectedSubCategory, setSelectedSubCategory] = useState("");
  const [selectedGenderGroup, setSelectedGenderGroup] = useState("");
  const [selectedAgeGroup, setSelectedAgeGroup] = useState("");

  const [q, setQ] = useState("");

  const [audienceRows, setAudienceRows] = useState([]);
  const [productIndex, setProductIndex] = useState(() => new Map());
  const [nameMaps, setNameMaps] = useState(() => ({
    categories: new Map(),
    subCategories: new Map(),
    genderGroups: new Map(),
    ageGroups: new Map(),
  }));
  const [hydrated, setHydrated] = useState(false);

  // ✅ new: keeps “Loading…” accurate even if an empty snapshot existed before
  const [loading, setLoading] = useState(true);

  const [bottomBarHeight, setBottomBarHeight] = useState(DEFAULT_BOTTOM_FLOATING_BAR_HEIGHT);

  const disabledNodesRef = useRef([]);

  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const searchWrapRef = useRef(null);

  const [mobileSection, setMobileSection] = useState("audiences"); // audiences | categories | products
  const panelRef = useRef(null);

  const panelTop = NAVBAR_HEIGHT + TOP_SAFE_GAP;
  const clickShieldHeight = panelTop + TOP_CLICK_SHIELD_EXTRA;

  const hoverTimersRef = useRef({ aud: null, cat: null });
  const scheduleHoverSelect = useCallback((kind, slug) => {
    if (typeof window === "undefined") return;
    const ms = 110;
    const key = kind === "aud" ? "aud" : "cat";
    if (hoverTimersRef.current[key]) window.clearTimeout(hoverTimersRef.current[key]);
    hoverTimersRef.current[key] = window.setTimeout(() => {
      if (kind === "aud") {
        setHoverAudienceSlug(slug);
        setHoverCategorySlug("");
        setSelectedSubCategory("");
        setSelectedGenderGroup("");
        setSelectedAgeGroup("");
      } else {
        setHoverCategorySlug(slug);
        setSelectedSubCategory("");
        setSelectedGenderGroup("");
        setSelectedAgeGroup("");
      }
    }, ms);
  }, []);

  const cancelHoverSelect = useCallback((kind) => {
    if (typeof window === "undefined") return;
    const key = kind === "aud" ? "aud" : "cat";
    if (hoverTimersRef.current[key]) window.clearTimeout(hoverTimersRef.current[key]);
    hoverTimersRef.current[key] = null;
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      if (hoverTimersRef.current.aud) window.clearTimeout(hoverTimersRef.current.aud);
      if (hoverTimersRef.current.cat) window.clearTimeout(hoverTimersRef.current.cat);
    };
  }, []);

  // VisualViewport CSS var (unchanged)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const vv = window.visualViewport;
    const setVH = () => {
      const h = vv?.height || window.innerHeight || 0;
      if (!h) return;
      document.documentElement.style.setProperty("--tdls-vh", `${h * 0.01}px`);
    };

    setVH();
    window.addEventListener("resize", setVH, { passive: true });
    vv?.addEventListener?.("resize", setVH, { passive: true });
    vv?.addEventListener?.("scroll", setVH, { passive: true });

    return () => {
      window.removeEventListener("resize", setVH);
      vv?.removeEventListener?.("resize", setVH);
      vv?.removeEventListener?.("scroll", setVH);
    };
  }, []);

  // ✅ Hydrate immediately from singleton/LS, then await fresh build (FIXED)
  useEffect(() => {
    let alive = true;

    // Instant snapshot: preloaded raw payload first, processed cache second.
    if (!__menuData) {
      const preloaded = buildMenuFromPreloadedRawProducts();
      if (preloaded) {
        __menuData = preloaded;
        __menuLastGood = __menuLastGood || preloaded;
      }
    }

    if (!__menuData) {
      const cached = loadFromLocalStorage();
      if (cached) {
        __menuData = cached;
        __menuLastGood = __menuLastGood || cached;
      }
    }

    if (__menuData && alive) {
      setAudienceRows(__menuData.audienceRows || []);
      setProductIndex(__menuData.productIndex || new Map());
      setNameMaps(
        __menuData.nameMaps || {
          categories: new Map(),
          subCategories: new Map(),
          genderGroups: new Map(),
          ageGroups: new Map(),
        }
      );
      setHydrated(true);

      const hasSnap =
        (__menuData?.audienceRows?.length || 0) > 0 && (__menuData?.productIndex?.size || 0) > 0;
      if (hasSnap) setLoading(false);
    }

    (async () => {
      try {
        setLoading(true);
        // Consume the preloaded/shared snapshot without forcing another request
        // merely because the customer opened the menu.
        const data = await preloadMenuDataOnce({ backgroundRefresh: false });
        if (!alive) return;

        setAudienceRows(data?.audienceRows || []);
        setProductIndex(data?.productIndex || new Map());
        setNameMaps(
          data?.nameMaps || {
            categories: new Map(),
            subCategories: new Map(),
            genderGroups: new Map(),
            ageGroups: new Map(),
          }
        );
        setHydrated(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    function handleResize() {
      const w = window.innerWidth;
      setIsDesktop(w >= 980);

      const target =
        w >= 1600
          ? Math.min(MENU_MAX_WIDTH, w - 16)
          : w >= 980
          ? Math.min(MENU_WIDTH_DESKTOP, w - 16)
          : Math.max(MENU_MIN_WIDTH, w - 16);

      setMenuWidth(Math.max(MENU_MIN_WIDTH, Math.min(target, w - 16)));
    }

    handleResize();
    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const n = readCssVarPx(
      ["--tdls-bottom-floating-bar-height", "--tdlc-bottom-floating-bar-height", "--bottom-floating-bar-height"],
      DEFAULT_BOTTOM_FLOATING_BAR_HEIGHT
    );
    setBottomBarHeight(n);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const body = document.body;
    const html = document.documentElement;

    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyPadRight = body.style.paddingRight;

    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;

    body.style.overflow = "hidden";
    html.style.overflow = "hidden";

    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      body.style.paddingRight = prevBodyPadRight;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    const selectors = [
      "nav",
      "header",
      "#navbar",
      ".navbar",
      ".topbar",
      ".site-header",
      ".header",
      ".sticky-header",
      ".fixed-header",
      "[data-navbar]",
      "[data-header]",
      "[role='navigation']",
      "#__next > header",
      "body > header",
      "body > nav",
    ];

    const nodes = [];
    for (const sel of selectors) document.querySelectorAll(sel).forEach((el) => el && nodes.push(el));
    const uniqNodes = Array.from(new Set(nodes));

    const stored = [];
    for (const el of uniqNodes) {
      try {
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < clickShieldHeight) {
          stored.push({ el, prev: el.style.pointerEvents });
          el.style.pointerEvents = "none";
        }
      } catch {}
    }
    disabledNodesRef.current = stored;

    return () => {
      for (const it of disabledNodesRef.current || []) {
        if (!it?.el) continue;
        it.el.style.pointerEvents = it.prev || "";
      }
      disabledNodesRef.current = [];
    };
  }, [open, clickShieldHeight]);

  const handleClose = useCallback(() => {
    setShowSuggest(false);
    setSuggestIndex(0);

    setQ("");
    setHoverAudienceSlug("");
    setHoverCategorySlug("");
    setSelectedSubCategory("");
    setSelectedGenderGroup("");
    setSelectedAgeGroup("");
    setMobileSection("audiences");
    onClose?.();
  }, [onClose]);

  // ✅ Close only on true outside tap (unchanged)
  useEffect(() => {
    if (!open) return;

    let active = null;

    const isInsidePanel = (evt) => {
      const panelEl = panelRef.current || document.getElementById(PANEL_ID) || document.getElementById(LEGACY_PANEL_ID);
      if (!panelEl) return false;

      const t = evt?.target;
      if (panelEl === t) return true;
      if (t && panelEl.contains(t)) return true;

      const path = typeof evt?.composedPath === "function" ? evt.composedPath() : null;
      if (path && Array.isArray(path) && path.includes(panelEl)) return true;

      return false;
    };

    const onPointerDownCapture = (e) => {
      if (!e?.isPrimary) return;
      const startedInside = isInsidePanel(e);
      active = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        moved: false,
        startedInside,
        pointerType: e.pointerType || "mouse",
      };
    };

    const onPointerMoveCapture = (e) => {
      if (!active || e.pointerId !== active.id) return;
      const dx = (e.clientX ?? 0) - active.x;
      const dy = (e.clientY ?? 0) - active.y;
      const movePx = active.pointerType === "touch" ? 16 : 10;
      if (dx * dx + dy * dy >= movePx * movePx) active.moved = true;
    };

    const onPointerUpCapture = (e) => {
      if (!active || e.pointerId !== active.id) return;
      const endedInside = isInsidePanel(e);
      const shouldClose = !active.startedInside && !endedInside && !active.moved;
      active = null;
      if (shouldClose) handleClose();
    };

    const onPointerCancelCapture = () => {
      active = null;
    };

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    document.addEventListener("pointermove", onPointerMoveCapture, true);
    document.addEventListener("pointerup", onPointerUpCapture, true);
    document.addEventListener("pointercancel", onPointerCancelCapture, true);

    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      document.removeEventListener("pointermove", onPointerMoveCapture, true);
      document.removeEventListener("pointerup", onPointerUpCapture, true);
      document.removeEventListener("pointercancel", onPointerCancelCapture, true);
    };
  }, [open, handleClose]);

  const switchTier = useCallback((nextTierSlug) => {
    const s = normSlug(nextTierSlug);
    const t = TIERS.find((x) => x.slug === s) || TIERS[0];

    setTierSlug(t.slug);
    setTierName(t.name);

    setShowSuggest(false);
    setSuggestIndex(0);

    setQ("");
    setHoverAudienceSlug("");
    setHoverCategorySlug("");
    setSelectedSubCategory("");
    setSelectedGenderGroup("");
    setSelectedAgeGroup("");
    setMobileSection("audiences");
  }, []);

  // ✅ Audience list for tier (STRICT)
  const audiencesForTier = useMemo(() => {
    const tier = normSlug(tierSlug);
    const out = [];

    for (const a of audienceRows || []) {
      const slug = normSlug(a?.slug);
      if (!slug) continue;
      const name = (a?.name || "").toString().trim() || titleizeSlug(slug);

      const verdict = audienceTierVerdict({
        audienceRow: a,
        tierSlug: tier,
        productIndex,
      });

      if (!verdict.ok) continue;
      out.push({ slug, name, count: verdict.count, raw: a });
    }

    return out.sort((x, y) => (y.count !== x.count ? y.count - x.count : x.name.localeCompare(y.name)));
  }, [audienceRows, tierSlug, productIndex]);

  const filteredAudiences = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return audiencesForTier;
    return audiencesForTier.filter((a) => a.name.toLowerCase().includes(qq) || a.slug.includes(qq));
  }, [q, audiencesForTier]);

  const flyAudienceSlug = useMemo(() => {
    const list = (filteredAudiences && filteredAudiences.length ? filteredAudiences : audiencesForTier) || [];
    const first = list?.[0]?.slug || "";
    const candidate = hoverAudienceSlug || first;
    if (!candidate) return "";
    return list.some((x) => x.slug === candidate) ? candidate : first;
  }, [hoverAudienceSlug, filteredAudiences, audiencesForTier]);

  const flyAudience = useMemo(() => {
    if (!flyAudienceSlug) return null;
    return audiencesForTier.find((a) => a.slug === flyAudienceSlug) || null;
  }, [audiencesForTier, flyAudienceSlug]);

  const categories = useMemo(() => {
    if (!flyAudience?.raw) return [];
    return deriveCategories({
      tierSlug,
      audienceRow: flyAudience.raw,
      productIndex,
      nameMaps,
    });
  }, [flyAudience, tierSlug, productIndex, nameMaps]);

  const filteredCategories = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(qq) || c.slug.includes(qq));
  }, [q, categories]);

  const flyCategorySlug = useMemo(() => {
    const list = (filteredCategories && filteredCategories.length ? filteredCategories : categories) || [];
    const first = list?.[0]?.slug || "";
    const candidate = hoverCategorySlug || first;
    if (!candidate) return "";
    return list.some((x) => x.slug === candidate) ? candidate : first;
  }, [hoverCategorySlug, filteredCategories, categories]);

  const filters = useMemo(
    () => ({ subCategory: selectedSubCategory, genderGroup: selectedGenderGroup, ageGroup: selectedAgeGroup }),
    [selectedSubCategory, selectedGenderGroup, selectedAgeGroup]
  );

  const baseProductsForFacets = useMemo(() => {
    if (!flyAudience?.raw) return [];
    return deriveProducts({
      tierSlug,
      audienceRow: flyAudience.raw,
      categorySlug: flyCategorySlug,
      productIndex,
      filters: { subCategory: "", genderGroup: "", ageGroup: "" },
    });
  }, [flyAudience, tierSlug, flyCategorySlug, productIndex]);

  const facetOptions = useMemo(
    () => buildFacetOptions({ baseProducts: baseProductsForFacets, productIndex, nameMaps }),
    [baseProductsForFacets, productIndex, nameMaps]
  );

  // Never keep a refinement that no longer belongs to the active
  // Tier + Audience + Category branch. This prevents silent zero-result states.
  useEffect(() => {
    if (selectedSubCategory && !facetOptions.subCategories.some((x) => x.slug === selectedSubCategory)) {
      setSelectedSubCategory("");
    }
    if (selectedGenderGroup && !facetOptions.genderGroups.some((x) => x.slug === selectedGenderGroup)) {
      setSelectedGenderGroup("");
    }
    if (selectedAgeGroup && !facetOptions.ageGroups.some((x) => x.slug === selectedAgeGroup)) {
      setSelectedAgeGroup("");
    }
  }, [
    facetOptions,
    selectedSubCategory,
    selectedGenderGroup,
    selectedAgeGroup,
  ]);

  const products = useMemo(() => {
    if (!flyAudience?.raw) return [];
    return deriveProducts({
      tierSlug,
      audienceRow: flyAudience.raw,
      categorySlug: flyCategorySlug,
      productIndex,
      filters,
    });
  }, [flyAudience, tierSlug, flyCategorySlug, productIndex, filters]);

  const filteredProducts = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return products;
    return products.filter((p) => p.name.toLowerCase().includes(qq) || p.slug.includes(qq));
  }, [q, products]);

  // Tier-wide (for suggestions)
  const tierAllProducts = useMemo(() => {
    const map = new Map();
    for (const a of audiencesForTier || []) {
      if (!a?.raw) continue;
      const list = deriveProducts({
        tierSlug,
        audienceRow: a.raw,
        categorySlug: "",
        productIndex,
        filters: { subCategory: "", genderGroup: "", ageGroup: "" },
      });
      for (const p of list || []) if (p?.slug && !map.has(p.slug)) map.set(p.slug, p);
    }
    return Array.from(map.values()).sort((x, y) => (x.name || "").localeCompare(y.name || ""));
  }, [audiencesForTier, tierSlug, productIndex]);

  const tierAllCategories = useMemo(() => {
    const m = new Map();
    for (const a of audiencesForTier || []) {
      if (!a?.raw) continue;
      const cats = deriveCategories({ tierSlug, audienceRow: a.raw, productIndex, nameMaps });
      for (const c of cats || []) {
        if (!c?.slug) continue;
        const prev = m.get(c.slug);
        if (!prev) {
          m.set(c.slug, {
            slug: c.slug,
            name: c.name || resolveNameFromMap(nameMaps?.categories, c.slug),
            count: c.count || 0,
            bestAudienceSlug: a.slug,
            bestAudienceCount: c.count || 0,
          });
        } else {
          prev.count += c.count || 0;
          if ((c.count || 0) > (prev.bestAudienceCount || 0)) {
            prev.bestAudienceCount = c.count || 0;
            prev.bestAudienceSlug = a.slug;
          }
        }
      }
    }
    return Array.from(m.values()).sort((x, y) =>
      y.count !== x.count ? y.count - x.count : (x.name || "").localeCompare(y.name || "")
    );
  }, [audiencesForTier, tierSlug, productIndex, nameMaps]);

  const suggestions = useMemo(() => {
    const qq = q.trim();
    if (!qq) return [];

    const ql = qq.toLowerCase();

    const aud = (audiencesForTier || [])
      .map((a) => ({
        type: "AUDIENCE",
        slug: a.slug,
        name: a.name,
        href: buildCollectionsHref({ tier: tierSlug, audience: a.slug }),
        score: Math.max(scoreMatch({ q: ql, text: makeSearchKey(a.name, a.slug) }), 0) + (a.count || 0) * 0.5,
        meta: `${a.count || 0} products`,
      }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 6);

    const cat = (tierAllCategories || [])
      .map((c) => {
        const audSlug = c.bestAudienceSlug || audiencesForTier?.[0]?.slug || "";
        return {
          type: "CATEGORY",
          slug: c.slug,
          name: c.name || resolveNameFromMap(nameMaps?.categories, c.slug),
          href: buildCollectionsHref({ tier: tierSlug, audience: audSlug, category: c.slug }),
          score: Math.max(scoreMatch({ q: ql, text: makeSearchKey(c.name, c.slug) }), 0) + (c.count || 0) * 0.25,
          meta: `${c.count || 0} products`,
        };
      })
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 6);

    const prod = (tierAllProducts || [])
      .map((p) => ({
        type: "PRODUCT",
        slug: p.slug,
        name: p.name || titleizeSlug(p.slug),
        href: `/product/${p.slug}`,
        score: Math.max(scoreMatch({ q: ql, text: makeSearchKey(p.name, p.slug) }), 0),
        meta: p.slug,
      }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 10);

    return [...aud, ...cat, ...prod].slice(0, 14);
  }, [q, audiencesForTier, tierAllCategories, tierAllProducts, tierSlug, nameMaps]);

  const showRefine =
    (facetOptions.subCategories?.length || 0) > 0 ||
    (facetOptions.genderGroups?.length || 0) > 0 ||
    (facetOptions.ageGroups?.length || 0) > 0;

  if (!open) return <span aria-hidden="true" style={{ display: "none" }} />;

  const panelBottom = bottomBarHeight + BOTTOM_GAP;
  const headerIsMobile = !isDesktop;

  const panelMaxHeightStyle = headerIsMobile
    ? { maxHeight: `calc((var(--tdls-vh, 1vh) * 100) - ${panelTop + panelBottom}px)` }
    : null;

  const goViewAllHref = flyAudienceSlug
    ? buildCollectionsHref({
        tier: tierSlug,
        audience: flyAudienceSlug,
        category: flyCategorySlug,
        subCategory: selectedSubCategory,
        genderGroup: selectedGenderGroup,
        ageGroup: selectedAgeGroup,
      })
    : "";

  const showLoadingHint = loading && !(audienceRows?.length || 0) && productIndex.size === 0;

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: clickShieldHeight,
          zIndex: Z_CLICK_SHIELD,
          background: "transparent",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: bottomBarHeight,
          zIndex: Z_OVERLAY,
          background: "rgba(10, 14, 24, 0.38)",
          backdropFilter: "blur(7px)",
          WebkitBackdropFilter: "blur(7px)",
          touchAction: "manipulation",
        }}
      />

      <div
        id={PANEL_ID}
        data-legacy-id={LEGACY_PANEL_ID}
        ref={panelRef}
        style={{
          position: "fixed",
          top: panelTop,
          left: headerIsMobile ? 8 : "auto",
          right: 8,
          bottom: panelBottom,
          width: headerIsMobile ? "auto" : menuWidth,
          maxWidth: "calc(100vw - 16px)",
          zIndex: Z_PANEL,
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #fffdf8 55%, #fbf6ea 100%)",
          border: "1px solid rgba(255,255,255,0.26)",
          boxShadow: "0 32px 90px rgba(0,0,0,0.32)",
          borderRadius: 28,
          overflow: "hidden",
          pointerEvents: "auto",
          isolation: "isolate",
          touchAction: "pan-x pan-y",
          ...(panelMaxHeightStyle || {}),
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        {/* Header */}
        <div
          style={{
            padding: headerIsMobile ? "8px 10px" : "10px 12px",
            borderBottom: "1px solid rgba(0,0,0,0.08)",
            background: "linear-gradient(135deg, #ffffff 55%, #f7f3e7 100%)",
            display: "flex",
            flexDirection: headerIsMobile ? "column" : "row",
            gap: headerIsMobile ? 8 : 10,
            alignItems: headerIsMobile ? "stretch" : "center",
            justifyContent: "space-between",
            minWidth: 0,
          }}
        >
          {headerIsMobile ? (
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Pill tone="gold" size="sm">
                      {tierName}
                    </Pill>
                    <Pill tone="ink" size="sm">
                      {filteredProducts.length}
                    </Pill>
                    {flyAudienceSlug ? <Pill size="sm">{titleizeSlug(flyAudienceSlug)}</Pill> : null}
                    {flyCategorySlug ? <Pill size="sm">{titleizeSlug(flyCategorySlug)}</Pill> : null}
                    {showLoadingHint ? (
                      <Pill tone="neutral" size="sm">
                        Loading…
                      </Pill>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleClose}
                  style={{
                    borderRadius: 999,
                    height: 34,
                    minWidth: 82,
                    padding: "0 12px",
                    border: "1px solid rgba(0,0,0,0.10)",
                    background: "rgba(255,255,255,0.92)",
                    boxShadow: "0 10px 18px rgba(0,0,0,0.06)",
                    color: "#0c2340",
                    fontWeight: 900,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontSize: "clamp(9px, 2.6vw, 10px)",
                    lineHeight: "34px",
                    flexShrink: 0,
                    alignSelf: "flex-start",
                  }}
                  aria-label="Close menu"
                >
                  Close
                </button>
              </div>

              <div style={{ minWidth: 0 }}>
                <TierTabs tiers={TIERS} activeSlug={tierSlug} onPick={switchTier} isMobile />
              </div>

              <Segmented
                value={mobileSection}
                onChange={setMobileSection}
                items={[
                  { value: "audiences", label: "Audiences" },
                  { value: "categories", label: "Categories" },
                  { value: "products", label: "Products" },
                ]}
              />
            </div>
          ) : (
            <>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Pill tone="gold">{tierName}</Pill>
                  <Pill tone="ink">{filteredProducts.length}</Pill>
                  {flyAudienceSlug ? <Pill>{titleizeSlug(flyAudienceSlug)}</Pill> : null}
                  {flyCategorySlug ? <Pill>{titleizeSlug(flyCategorySlug)}</Pill> : null}
                  {showLoadingHint ? <Pill>Loading…</Pill> : null}
                </div>

                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, minWidth: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TierTabs tiers={TIERS} activeSlug={tierSlug} onPick={switchTier} isMobile={false} />
                  </div>

                  <div ref={searchWrapRef} style={{ position: "relative", flexShrink: 0 }}>
                    <input
                      value={q}
                      onChange={(e) => {
                        setQ(e.target.value);
                        setShowSuggest(true);
                        setSuggestIndex(0);
                      }}
                      onFocus={() => {
                        if (q.trim()) setShowSuggest(true);
                      }}
                      onBlur={() => {
                        window.setTimeout(() => setShowSuggest(false), 120);
                      }}
                      onKeyDown={(e) => {
                        if (!q.trim()) return;

                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setShowSuggest(true);
                          setSuggestIndex((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setShowSuggest(true);
                          setSuggestIndex((i) => Math.max(i - 1, 0));
                        } else if (e.key === "Enter") {
                          const top = suggestions[suggestIndex] || suggestions[0];
                          if (top?.href) {
                            e.preventDefault();
                            router.push(top.href);
                            handleClose();
                          }
                        } else if (e.key === "Escape") {
                          setShowSuggest(false);
                        }
                      }}
                      placeholder="Search…"
                      style={{
                        width: "clamp(160px, 18vw, 300px)",
                        height: 36,
                        borderRadius: 14,
                        padding: "0 12px",
                        border: "1px solid rgba(0,0,0,0.10)",
                        outline: "none",
                        background: "#ffffff",
                        boxShadow: "0 10px 20px rgba(0,0,0,0.05)",
                        fontWeight: 800,
                        letterSpacing: ".04em",
                        color: "#0c2340",
                      }}
                    />

                    {showSuggest && q.trim() && suggestions.length ? (
                      <SuggestionsDropdown
                        suggestions={suggestions}
                        activeIndex={suggestIndex}
                        onPick={({ type, idx, href }) => {
                          if (type === "hover") setSuggestIndex(idx);
                          if (type === "click" && href) {
                            setShowSuggest(false);
                            router.push(href);
                            handleClose();
                          }
                        }}
                        width={420}
                      />
                    ) : null}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClose}
                style={{
                  borderRadius: 999,
                  height: 44,
                  minWidth: 92,
                  padding: "0 16px",
                  border: "1px solid rgba(0,0,0,0.10)",
                  background: "rgba(255,255,255,0.92)",
                  boxShadow: "0 10px 18px rgba(0,0,0,0.06)",
                  color: "#0c2340",
                  fontWeight: 900,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  fontSize: 11,
                  lineHeight: "44px",
                }}
                aria-label="Close menu"
              >
                Close
              </button>
            </>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, padding: 10, overflow: "hidden" }}>
          {isDesktop ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(210px, 260px) minmax(240px, 320px) 1fr",
                gap: 10,
                height: "100%",
                minHeight: 0,
              }}
            >
              <Shell
                title={`Audiences · ${filteredAudiences.length}`}
                right={<Pill tone="ink">{filteredAudiences.reduce((acc, a) => acc + (a.count || 0), 0)}</Pill>}
              >
                <ScrollBody>
                  {filteredAudiences.length ? (
                    filteredAudiences.map((a) => (
                      <CompactRowButton
                        key={a.slug}
                        title={a.name}
                        subLeft={`${a.count} product${a.count === 1 ? "" : "s"}`}
                        badge={a.count}
                        active={a.slug === flyAudienceSlug}
                        isDesktop
                        dense={false}
                        onNavigateHref={buildCollectionsHref({
                          tier: tierSlug,
                          audience: a.slug,
                          genderGroup: selectedGenderGroup,
                          ageGroup: selectedAgeGroup,
                        })}
                        onNavigate={handleClose}
                        onClick={() => {}}
                        onMouseEnter={() => scheduleHoverSelect("aud", a.slug)}
                        onMouseLeave={() => cancelHoverSelect("aud")}
                        onFocus={() => scheduleHoverSelect("aud", a.slug)}
                      />
                    ))
                  ) : (
                    <div style={{ padding: 10 }}>
                      <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", color: "#0c2340" }}>
                        {showLoadingHint ? "Loading options…" : "No audiences in this tier yet."}
                      </div>
                      <div style={{ marginTop: 8, fontWeight: 800, color: "rgba(12,35,64,0.70)" }}>
                        {showLoadingHint ? "Fetching from Strapi…" : "Check tier/audience/product relations in Strapi."}
                      </div>
                    </div>
                  )}
                </ScrollBody>
              </Shell>

              <Shell
                title={
                  flyAudience?.name ? `Categories · ${flyAudience.name} · ${filteredCategories.length}` : `Categories · ${filteredCategories.length}`
                }
              >
                <ScrollBody>
                  {filteredCategories.length ? (
                    filteredCategories.map((c) => (
                      <CompactRowButton
                        key={c.slug}
                        title={c.name}
                        subLeft={`${c.count} product${c.count === 1 ? "" : "s"}`}
                        badge={c.count}
                        active={c.slug === flyCategorySlug}
                        isDesktop
                        dense={false}
                        onNavigateHref={buildCollectionsHref({
                          tier: tierSlug,
                          audience: flyAudienceSlug,
                          category: c.slug,
                          subCategory: selectedSubCategory,
                          genderGroup: selectedGenderGroup,
                          ageGroup: selectedAgeGroup,
                        })}
                        onNavigate={handleClose}
                        onClick={() => {}}
                        onMouseEnter={() => scheduleHoverSelect("cat", c.slug)}
                        onMouseLeave={() => cancelHoverSelect("cat")}
                        onFocus={() => scheduleHoverSelect("cat", c.slug)}
                      />
                    ))
                  ) : (
                    <div style={{ padding: 10 }}>
                      <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", color: "#0c2340" }}>
                        {flyAudienceSlug ? "No categories in this audience/tier." : "Pick an audience."}
                      </div>
                      <div style={{ marginTop: 8, fontWeight: 800, color: "rgba(12,35,64,0.70)" }}>
                        Try a different audience or tier.
                      </div>
                    </div>
                  )}
                </ScrollBody>
              </Shell>

              {/* Products column */}
              <div style={{ minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    borderRadius: 18,
                    border: "1px solid rgba(0,0,0,0.08)",
                    background: "linear-gradient(135deg, rgba(255,255,255,0.92) 55%, rgba(247,243,231,0.92) 100%)",
                    boxShadow: "0 16px 34px rgba(0,0,0,0.07)",
                    padding: "10px 10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                    <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", fontSize: 12, color: "#0c2340" }}>
                      Products
                    </div>
                    <Pill tone="ink">{filteredProducts.length}</Pill>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {showRefine ? (
                      <>
                        {facetOptions.subCategories.length ? (
                          <Select
                            value={selectedSubCategory}
                            onChange={(e) => setSelectedSubCategory(e.target.value)}
                            options={facetOptions.subCategories}
                            placeholder="Subcategory"
                            isMobile={false}
                          />
                        ) : null}

                        {facetOptions.genderGroups.length ? (
                          <Select
                            value={selectedGenderGroup}
                            onChange={(e) => setSelectedGenderGroup(e.target.value)}
                            options={facetOptions.genderGroups}
                            placeholder="Gender"
                            isMobile={false}
                          />
                        ) : null}

                        {facetOptions.ageGroups.length ? (
                          <Select
                            value={selectedAgeGroup}
                            onChange={(e) => setSelectedAgeGroup(e.target.value)}
                            options={facetOptions.ageGroups}
                            placeholder="Age"
                            isMobile={false}
                          />
                        ) : null}

                        {selectedSubCategory || selectedGenderGroup || selectedAgeGroup ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSubCategory("");
                              setSelectedGenderGroup("");
                              setSelectedAgeGroup("");
                            }}
                            style={{
                              height: 34,
                              padding: "0 10px",
                              borderRadius: 12,
                              border: "1px solid rgba(0,0,0,0.10)",
                              background: "rgba(255,255,255,0.96)",
                              boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
                              fontWeight: 900,
                              letterSpacing: ".10em",
                              textTransform: "uppercase",
                              fontSize: 11,
                              cursor: "pointer",
                              color: "#0c2340",
                            }}
                          >
                            Clear Refine
                          </button>
                        ) : null}
                      </>
                    ) : null}

                    {flyAudienceSlug ? (
                      <Link
                        href={goViewAllHref}
                        onClick={handleClose}
                        style={{
                          textDecoration: "none",
                          height: 34,
                          padding: "0 12px",
                          borderRadius: 999,
                          border: "1px solid rgba(12,35,64,0.22)",
                          background: "linear-gradient(135deg, #0c2340 10%, #163060 100%)",
                          boxShadow: "0 14px 24px rgba(12,35,64,0.14)",
                          color: "#fffdf8",
                          fontWeight: 900,
                          letterSpacing: ".12em",
                          textTransform: "uppercase",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          whiteSpace: "nowrap",
                        }}
                      >
                        View All →
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    borderRadius: 18,
                    border: "1px solid rgba(0,0,0,0.08)",
                    background: "rgba(255,255,255,0.70)",
                    boxShadow: "0 16px 34px rgba(0,0,0,0.07)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      overflow: "auto",
                      padding: 10,
                      WebkitOverflowScrolling: "touch",
                      overscrollBehavior: "contain",
                      touchAction: "pan-y",
                    }}
                  >
                    {filteredProducts.length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {filteredProducts.map((p) => (
                          <Link
                            key={p.slug}
                            href={`/product/${p.slug}`}
                            onClick={handleClose}
                            title={p.name}
                            style={{
                              textDecoration: "none",
                              borderRadius: 14,
                              padding: "10px 10px",
                              border: "1px solid rgba(0,0,0,0.06)",
                              background: "rgba(255,255,255,0.82)",
                              boxShadow: "0 8px 14px rgba(0,0,0,0.04)",
                              color: "#0c2340",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              minHeight: 50,
                              minWidth: 0,
                            }}
                          >
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                              <div
                                style={{
                                  fontWeight: 900,
                                  letterSpacing: ".06em",
                                  textTransform: "uppercase",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  fontSize: 12,
                                  lineHeight: 1.15,
                                }}
                              >
                                {p.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  fontWeight: 800,
                                  color: "rgba(12,35,64,0.60)",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {p.slug}
                              </div>
                            </div>

                            <span
                              style={{
                                flexShrink: 0,
                                padding: "5px 8px",
                                borderRadius: 999,
                                border: "1px solid rgba(12,35,64,0.14)",
                                background: "rgba(12,35,64,0.06)",
                                fontWeight: 900,
                                fontSize: 10,
                                letterSpacing: ".10em",
                                textTransform: "uppercase",
                              }}
                            >
                              Open
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div style={{ padding: 12 }}>
                        <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", color: "#0c2340" }}>
                          {showLoadingHint ? "Loading products…" : "No pieces match these filters right now."}
                        </div>
                        <div style={{ marginTop: 8, fontWeight: 800, color: "rgba(12,35,64,0.70)" }}>
                          {showLoadingHint ? "Fetching from Strapi…" : "Try a different audience/category, clear refine, or clear search."}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Mobile sectioned UI — unchanged */
            <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <div ref={searchWrapRef} style={{ position: "relative" }}>
                <input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setShowSuggest(true);
                    setSuggestIndex(0);
                  }}
                  onFocus={() => {
                    if (q.trim()) setShowSuggest(true);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => setShowSuggest(false), 120);
                  }}
                  onKeyDown={(e) => {
                    if (!q.trim()) return;

                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setShowSuggest(true);
                      setSuggestIndex((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setShowSuggest(true);
                      setSuggestIndex((i) => Math.max(i - 1, 0));
                    } else if (e.key === "Enter") {
                      const top = suggestions[suggestIndex] || suggestions[0];
                      if (top?.href) {
                        e.preventDefault();
                        router.push(top.href);
                        handleClose();
                      }
                    } else if (e.key === "Escape") {
                      setShowSuggest(false);
                    }
                  }}
                  placeholder="Search…"
                  style={{
                    width: "100%",
                    height: 38,
                    borderRadius: 14,
                    padding: "0 12px",
                    border: "1px solid rgba(0,0,0,0.10)",
                    outline: "none",
                    background: "#ffffff",
                    boxShadow: "0 10px 20px rgba(0,0,0,0.05)",
                    fontWeight: 900,
                    letterSpacing: ".04em",
                    color: "#0c2340",
                    fontSize: "clamp(10px, 2.9vw, 12px)",
                    textTransform: "uppercase",
                  }}
                />

                {showSuggest && q.trim() && suggestions.length ? (
                  <SuggestionsDropdown
                    suggestions={suggestions}
                    activeIndex={suggestIndex}
                    onPick={({ type, idx, href }) => {
                      if (type === "hover") setSuggestIndex(idx);
                      if (type === "click" && href) {
                        setShowSuggest(false);
                        router.push(href);
                        handleClose();
                      }
                    }}
                    width={"min(520px, 92vw)"}
                  />
                ) : null}
              </div>

              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: 10 }}>
                {mobileSection === "audiences" ? (
                  <Shell
                    title={`Audiences · ${filteredAudiences.length}`}
                    right={<Pill tone="ink">{filteredAudiences.reduce((acc, a) => acc + (a.count || 0), 0)}</Pill>}
                  >
                    <ScrollBody>
                      {filteredAudiences.length ? (
                        filteredAudiences.map((a) => (
                          <MobileSelectRow
                            key={a.slug}
                            title={a.name}
                            subLeft={`${a.count} product${a.count === 1 ? "" : "s"}`}
                            badge={a.count}
                            active={a.slug === flyAudienceSlug}
                            onSelect={() => {
                              setHoverAudienceSlug(a.slug);
                              setHoverCategorySlug("");
                              setSelectedSubCategory("");
                              setSelectedGenderGroup("");
                              setSelectedAgeGroup("");
                              setMobileSection("categories");
                            }}
                            href={buildCollectionsHref({
                              tier: tierSlug,
                              audience: a.slug,
                              genderGroup: selectedGenderGroup,
                              ageGroup: selectedAgeGroup,
                            })}
                            onNavigate={handleClose}
                          />
                        ))
                      ) : (
                        <div style={{ padding: 10 }}>
                          <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", color: "#0c2340" }}>
                            {showLoadingHint ? "Loading options…" : "No audiences in this tier yet."}
                          </div>
                          <div style={{ marginTop: 8, fontWeight: 800, color: "rgba(12,35,64,0.70)" }}>
                            {showLoadingHint ? "Fetching from Strapi…" : "Check tier/audience/product relations in Strapi."}
                          </div>
                        </div>
                      )}
                    </ScrollBody>
                  </Shell>
                ) : null}

                {mobileSection === "categories" ? (
                  <Shell
                    title={
                      flyAudience?.name ? `Categories · ${flyAudience.name} · ${filteredCategories.length}` : `Categories · ${filteredCategories.length}`
                    }
                    right={
                      <button
                        type="button"
                        onClick={() => setMobileSection("audiences")}
                        style={{
                          height: 28,
                          padding: "0 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(0,0,0,0.10)",
                          background: "rgba(255,255,255,0.92)",
                          boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
                          fontWeight: 900,
                          letterSpacing: ".12em",
                          textTransform: "uppercase",
                          fontSize: 10,
                          cursor: "pointer",
                          color: "#0c2340",
                        }}
                      >
                        Back
                      </button>
                    }
                  >
                    <ScrollBody>
                      {filteredCategories.length ? (
                        filteredCategories.map((c) => (
                          <MobileSelectRow
                            key={c.slug}
                            title={c.name}
                            subLeft={`${c.count} product${c.count === 1 ? "" : "s"}`}
                            badge={c.count}
                            active={c.slug === flyCategorySlug}
                            onSelect={() => {
                              setHoverCategorySlug(c.slug);
                              setSelectedSubCategory("");
                              setSelectedGenderGroup("");
                              setSelectedAgeGroup("");
                              setMobileSection("products");
                            }}
                            href={buildCollectionsHref({
                              tier: tierSlug,
                              audience: flyAudienceSlug,
                              category: c.slug,
                              subCategory: selectedSubCategory,
                              genderGroup: selectedGenderGroup,
                              ageGroup: selectedAgeGroup,
                            })}
                            onNavigate={handleClose}
                          />
                        ))
                      ) : (
                        <div style={{ padding: 10 }}>
                          <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", color: "#0c2340" }}>
                            {flyAudienceSlug ? "No categories in this audience/tier." : "Pick an audience."}
                          </div>
                          <div style={{ marginTop: 8, fontWeight: 800, color: "rgba(12,35,64,0.70)" }}>
                            Try a different audience or tier.
                          </div>
                        </div>
                      )}
                    </ScrollBody>
                  </Shell>
                ) : null}

                {mobileSection === "products" ? (
                  <>
                    <div
                      style={{
                        borderRadius: 18,
                        border: "1px solid rgba(0,0,0,0.08)",
                        background: "linear-gradient(135deg, rgba(255,255,255,0.92) 55%, rgba(247,243,231,0.92) 100%)",
                        boxShadow: "0 16px 34px rgba(0,0,0,0.07)",
                        padding: "10px 10px",
                        display: "grid",
                        gridTemplateColumns: "1fr",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", fontSize: 12, color: "#0c2340" }}>
                            Products
                          </div>
                          <Pill tone="ink" size="sm">
                            {filteredProducts.length}
                          </Pill>
                        </div>

                        <button
                          type="button"
                          onClick={() => setMobileSection("categories")}
                          style={{
                            height: 32,
                            padding: "0 12px",
                            borderRadius: 999,
                            border: "1px solid rgba(0,0,0,0.10)",
                            background: "rgba(255,255,255,0.92)",
                            boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
                            fontWeight: 900,
                            letterSpacing: ".12em",
                            textTransform: "uppercase",
                            fontSize: 10,
                            cursor: "pointer",
                            color: "#0c2340",
                          }}
                        >
                          Back
                        </button>
                      </div>

                      {showRefine ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          {facetOptions.subCategories.length ? (
                            <Select
                              value={selectedSubCategory}
                              onChange={(e) => setSelectedSubCategory(e.target.value)}
                              options={facetOptions.subCategories}
                              placeholder="Subcategory"
                              isMobile
                            />
                          ) : null}

                          {facetOptions.genderGroups.length ? (
                            <Select
                              value={selectedGenderGroup}
                              onChange={(e) => setSelectedGenderGroup(e.target.value)}
                              options={facetOptions.genderGroups}
                              placeholder="Gender"
                              isMobile
                            />
                          ) : null}

                          {facetOptions.ageGroups.length ? (
                            <Select
                              value={selectedAgeGroup}
                              onChange={(e) => setSelectedAgeGroup(e.target.value)}
                              options={facetOptions.ageGroups}
                              placeholder="Age"
                              isMobile
                            />
                          ) : null}

                          {selectedSubCategory || selectedGenderGroup || selectedAgeGroup ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedSubCategory("");
                                setSelectedGenderGroup("");
                                setSelectedAgeGroup("");
                              }}
                              style={{
                                height: 34,
                                padding: "0 10px",
                                borderRadius: 12,
                                border: "1px solid rgba(0,0,0,0.10)",
                                background: "rgba(255,255,255,0.96)",
                                boxShadow: "0 10px 18px rgba(0,0,0,0.05)",
                                fontWeight: 900,
                                letterSpacing: ".10em",
                                textTransform: "uppercase",
                                fontSize: 11,
                                cursor: "pointer",
                                color: "#0c2340",
                              }}
                            >
                              Clear Refine
                            </button>
                          ) : null}
                        </div>
                      ) : null}

                      {flyAudienceSlug ? (
                        <Link
                          href={goViewAllHref}
                          onClick={handleClose}
                          style={{
                            textDecoration: "none",
                            height: 34,
                            padding: "0 12px",
                            borderRadius: 999,
                            border: "1px solid rgba(12,35,64,0.22)",
                            background: "linear-gradient(135deg, #0c2340 10%, #163060 100%)",
                            boxShadow: "0 14px 24px rgba(12,35,64,0.14)",
                            color: "#fffdf8",
                            fontWeight: 900,
                            letterSpacing: ".12em",
                            textTransform: "uppercase",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            whiteSpace: "nowrap",
                          }}
                        >
                          View All →
                        </Link>
                      ) : null}
                    </div>

                    <div
                      style={{
                        flex: 1,
                        minHeight: 0,
                        borderRadius: 18,
                        border: "1px solid rgba(0,0,0,0.08)",
                        background: "rgba(255,255,255,0.70)",
                        boxShadow: "0 16px 34px rgba(0,0,0,0.07)",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          minHeight: 0,
                          overflow: "auto",
                          padding: 10,
                          WebkitOverflowScrolling: "touch",
                          overscrollBehavior: "contain",
                          touchAction: "pan-y",
                        }}
                      >
                        {filteredProducts.length ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {filteredProducts.map((p) => (
                              <Link
                                key={p.slug}
                                href={`/product/${p.slug}`}
                                onClick={handleClose}
                                title={p.name}
                                style={{
                                  textDecoration: "none",
                                  borderRadius: 14,
                                  padding: "10px 10px",
                                  border: "1px solid rgba(0,0,0,0.06)",
                                  background: "rgba(255,255,255,0.82)",
                                  boxShadow: "0 8px 14px rgba(0,0,0,0.04)",
                                  color: "#0c2340",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 10,
                                  minHeight: 50,
                                  minWidth: 0,
                                }}
                              >
                                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                                  <div
                                    style={{
                                      fontWeight: 900,
                                      letterSpacing: ".06em",
                                      textTransform: "uppercase",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      fontSize: 12,
                                      lineHeight: 1.15,
                                    }}
                                  >
                                    {p.name}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 800,
                                      color: "rgba(12,35,64,0.60)",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {p.slug}
                                  </div>
                                </div>

                                <span
                                  style={{
                                    flexShrink: 0,
                                    padding: "5px 8px",
                                    borderRadius: 999,
                                    border: "1px solid rgba(12,35,64,0.14)",
                                    background: "rgba(12,35,64,0.06)",
                                    fontWeight: 900,
                                    fontSize: 10,
                                    letterSpacing: ".10em",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  Open
                                </span>
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <div style={{ padding: 12 }}>
                            <div style={{ fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", color: "#0c2340" }}>
                              {showLoadingHint ? "Loading products…" : "No pieces match these filters right now."}
                            </div>
                            <div style={{ marginTop: 8, fontWeight: 800, color: "rgba(12,35,64,0.70)" }}>
                              {showLoadingHint ? "Fetching from Strapi…" : "Try a different audience/category, clear refine, or clear search."}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
