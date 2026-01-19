// FILE: src/components/common/bottomfloatingbar.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X as CloseIcon, ChevronUp, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import MenuFlyout from "@/components/common/menuflyout";

/* ===================== DESIGN TOKENS ===================== */
const PEARL_WHITE = "#faf9f6";
const NEUTRAL_TEXT = "#201D14";
const NEUTRAL_BORDER = "#e7e3da";
const ACCENT = "#bda04d";
const HOVER_TINT = "#E9F1FB";
const HOVER_TEXT = "#163060";

const FS_PILL = "1.1rem";
const PAD_PILL = "12px 18px";
const RADIUS = 18;

const SHOW_COUNTS = true;

// Mobile presentation controls (kept for compatibility with existing logic)
const MOBILE_VISIBLE_PILLS = 8;
const MORE_KEY = "__more__";
const MORE_LABEL = "More";

/**
 * Tap-vs-scroll guard:
 * - Prevents accidental activation when user is trying to scroll on touch devices.
 * - Click is allowed only if the pointer didn't move beyond TAP_SLOP_PX.
 */
const TAP_SLOP_PX = 14;

/* ===================== CLIENT-SAFE FALLBACK FETCHERS (VIA PROXY) ===================== */
async function fetchFromStrapi(path) {
  try {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const q = encodeURIComponent(normalizedPath);

    const res = await fetch(`/api/strapi?path=${q}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "force-cache",
    });
    if (!res.ok) return null;

    const raw = await res.json().catch(() => null);
    if (!raw) return null;

    // Our proxy returns { ok: true, data: <rawStrapiJson> }
    const payload = raw?.ok ? raw.data : raw;
    return payload;
  } catch {
    return null;
  }
}

async function fetchProductsClient() {
  const payload = await fetchFromStrapi("/products?populate=*");
  if (!payload) return [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data.map((n) =>
    n?.attributes ? { id: n.id, ...n.attributes, attributes: n.attributes } : n
  );
}

async function fetchAgeGroupsClient() {
  const payload = await fetchFromStrapi("/age-groups?populate=*");
  if (!payload) return [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data
    .map((n) => {
      const a = n?.attributes || {};
      return {
        id: n?.id,
        slug: a.slug || a.name || "",
        name: a.name || a.slug || "",
        order: typeof a.order === "number" ? a.order : undefined,
      };
    })
    .filter((x) => x.slug && x.name);
}

async function fetchCategoriesClient() {
  const payload = await fetchFromStrapi("/categories?populate=*");
  if (!payload) return [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data
    .map((n) => {
      const a = n?.attributes || {};
      return {
        id: n?.id,
        slug: a.slug || a.name || "",
        name: a.name || a.slug || "",
        order: typeof a.order === "number" ? a.order : undefined,
      };
    })
    .filter((x) => x.slug && x.name);
}

async function fetchAudienceCategoriesClient() {
  // Use a heavier populate to avoid “missing audiences” when Strapi relations/settings differ between envs
  const payload =
    (await fetchFromStrapi(
      "/audience-categories?populate=*&pagination[pageSize]=500"
    )) ||
    (await fetchFromStrapi("/audience-categories?populate=*")) ||
    (await fetchFromStrapi("/audience-categories"));

  if (!payload) return [];
  const data = Array.isArray(payload.data) ? payload.data : [];
  return data
    .map((n) => {
      const a = n?.attributes || {};
      return {
        id: n?.id,
        slug: a.slug || a.name || "",
        name: a.name || a.slug || "",
        order: typeof a.order === "number" ? a.order : undefined,
      };
    })
    .filter((x) => x.slug && x.name);
}

/* ===================== PORTAL ===================== */
function Portal({ zIndex = 2147483647, children }) {
  const [host, setHost] = useState(null);

  useEffect(() => {
    const el = document.createElement("div");
    el.dataset.flyoutHost = "tdls";
    el.style.position = "fixed";
    el.style.left = "0";
    el.style.bottom = "0";

    // Critical: do NOT cover the whole viewport (prevents click-stealing),
    // but DO allow pointer events so the panel remains clickable.
    el.style.width = "0";
    el.style.height = "0";
    el.style.overflow = "visible";
    el.style.pointerEvents = "auto";

    el.style.zIndex = String(zIndex);

    document.body.appendChild(el);
    setHost(el);

    return () => {
      try {
        document.body.removeChild(el);
      } catch {}
    };
  }, [zIndex]);

  if (!host) return null;
  return createPortal(children, host);
}

/* ===================== HELPERS (robust slug + relation readers) ===================== */
const normSlug = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

function titleizeSlug(slug) {
  if (!slug) return "";
  return slug.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function pickSlugs(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.map(normSlug).filter(Boolean);

  if (obj?.data) {
    const d = obj.data;
    if (Array.isArray(d)) {
      return d
        .map(
          (x) => x?.attributes?.slug || x?.slug || x?.attributes?.name || x?.name
        )
        .filter(Boolean)
        .map(normSlug);
    }
    const one =
      d?.attributes?.slug ||
      d?.slug ||
      d?.attributes?.name ||
      d?.name ||
      null;
    return one ? [normSlug(one)] : [];
  }

  const one =
    obj?.attributes?.slug ||
    obj?.slug ||
    obj?.attributes?.name ||
    obj?.name ||
    null;
  return one ? [normSlug(one)] : [];
}

const FIELD_ALIASES = {
  audience_categories: [
    "audience_categories",
    "audience_category",
    "audiences",
    "audience",
    "audienceCategories",
  ],
  categories: [
    "categories",
    "category",
    "product_categories",
    "product_category",
    "categories_slugs",
    "category_slugs",
  ],
  sub_categories: [
    "sub_categories",
    "sub_category",
    "subCategories",
    "subcategory",
    "subCategory",
  ],
  super_categories: [
    "super_categories",
    "super_category",
    "superCategories",
    "supercategory",
    "superCategory",
  ],
  age_groups: ["age_groups", "age_group", "ageGroups", "ageGroup"],
  gender_groups: ["gender_groups", "gender_group", "genderGroups", "genderGroup"],
};

function extractRelSlugs(product, canonicalKey) {
  const p = product || {};

  const pre = p[`${canonicalKey}_slugs`];
  const pre2 = p[`${canonicalKey}Slugs`];
  const fromPre = pickSlugs(pre);
  if (fromPre.length) return Array.from(new Set(fromPre));
  const fromPre2 = pickSlugs(pre2);
  if (fromPre2.length) return Array.from(new Set(fromPre2));

  const aliases = FIELD_ALIASES[canonicalKey] || [canonicalKey];
  const out = [];
  for (const k of aliases) {
    const v = p?.[k];
    const slugs = pickSlugs(v);
    for (const s of slugs) out.push(s);
  }
  return Array.from(new Set(out.map(normSlug).filter(Boolean)));
}

function getLabelFromList(list, slug) {
  const target = normSlug(slug);
  const hit = list?.find?.((x) => normSlug(x.slug) === target);
  return hit?.name || titleizeSlug(slug);
}

function hasAudience(p, slug) {
  const target = normSlug(slug);
  return extractRelSlugs(p, "audience_categories").some((s) => s === target);
}

function orderIndexFor(list, slug, audience) {
  const target = normSlug(slug);
  const hit = list?.find?.((x) => normSlug(x.slug) === target);
  if (!hit) return Infinity;
  if (typeof hit.order === "number") return hit.order;
  const key = audience ? `order_${audience.replace(/-/g, "_")}` : null;
  if (key && typeof hit[key] === "number") return hit[key];
  return Infinity;
}

function sortByOrderThenAlpha(items, audience, labelsList) {
  return items.sort((a, b) => {
    const as = normSlug(a.slug || a);
    const bs = normSlug(b.slug || b);
    const ai = orderIndexFor(labelsList, as, audience);
    const bi = orderIndexFor(labelsList, bs, audience);
    if (ai !== bi) return ai - bi;
    const la = (a.label || getLabelFromList(labelsList, as)).toLowerCase();
    const lb = (b.label || getLabelFromList(labelsList, bs)).toLowerCase();
    return la.localeCompare(lb);
  });
}

const SEASON_BADGE_SLUGS = ["winter", "on-sale", "new-arrival", "monsoon", "summer"];
const BADGE_LABEL = {
  winter: "Winter",
  "on-sale": "Sale",
  "new-arrival": "New",
  monsoon: "Monsoon",
  summer: "Summer",
};

function badgesFromAudiences(product) {
  const set = new Set();
  const slugs = extractRelSlugs(product, "audience_categories");
  slugs.forEach((s) => {
    const k = normSlug(s);
    if (SEASON_BADGE_SLUGS.includes(k)) set.add(BADGE_LABEL[k]);
  });
  return set;
}

/* ===================== MENU BUILDERS ===================== */
function buildMWHD(products, audSlug, labels, prefix = `/collections/${normSlug(audSlug)}`) {
  const buckets = new Map(); // cat => sub => node
  products
    .filter((p) => hasAudience(p, audSlug))
    .forEach((p) => {
      const cats = extractRelSlugs(p, "categories");
      const subs = extractRelSlugs(p, "sub_categories");
      const bset = badgesFromAudiences(p);

      cats.forEach((cat) => {
        const catKey = normSlug(cat);
        if (!buckets.has(catKey)) buckets.set(catKey, new Map());
        const subMap = buckets.get(catKey);

        if (subs.length === 0) {
          if (!subMap.has(null)) subMap.set(null, { count: 0, badges: new Set() });
          const node = subMap.get(null);
          node.count += 1;
          bset.forEach((b) => node.badges.add(b));
        } else {
          subs.forEach((s) => {
            const subKey = normSlug(s);
            if (!subMap.has(subKey)) subMap.set(subKey, { count: 0, badges: new Set() });
            const node = subMap.get(subKey);
            node.count += 1;
            bset.forEach((b) => node.badges.add(b));
          });
        }
      });
    });

  const catSlugs = Array.from(buckets.keys()).map((slug) => ({ slug }));
  const sortedCats = sortByOrderThenAlpha(catSlugs, audSlug, labels.categories);

  const options = [];
  for (const { slug: cat } of sortedCats) {
    const subMap = buckets.get(cat);
    const entries = Array.from(subMap.entries());
    const hasSubs = entries.some(([s]) => s !== null);

    if (!hasSubs) {
      const node = subMap.get(null);
      options.push({
        label: getLabelFromList(labels.categories, cat),
        href: `${prefix}/${cat}`,
        badges: Array.from(node.badges),
      });
    } else {
      const subEntries = entries.filter(([s]) => s !== null);
      const sortedSubs = sortByOrderThenAlpha(
        subEntries.map(([s]) => ({ slug: s })),
        audSlug,
        labels.subCategories
      );
      options.push({
        label: getLabelFromList(labels.categories, cat),
        href: `${prefix}/${cat}`,
        children: sortedSubs.map(({ slug: s }) => {
          const node = subMap.get(s);
          return {
            label: getLabelFromList(labels.subCategories, s),
            href: `${prefix}/${cat}/${s}`,
            badges: Array.from(node.badges),
          };
        }),
      });
    }
  }
  return options;
}

function buildAccessories(products, labels, prefix = "/collections/accessories") {
  const superMap = new Map(); // super => cat => sub
  products
    .filter((p) => hasAudience(p, "accessories"))
    .forEach((p) => {
      const supers = extractRelSlugs(p, "super_categories");
      const cats = extractRelSlugs(p, "categories");
      const subs = extractRelSlugs(p, "sub_categories");
      const bset = badgesFromAudiences(p);

      (supers.length ? supers : [null]).forEach((sup) => {
        const supKey = sup ? normSlug(sup) : null;
        if (!superMap.has(supKey)) superMap.set(supKey, new Map());
        const catMap = superMap.get(supKey);

        (cats.length ? cats : [null]).forEach((cat) => {
          if (!cat) return;
          const catKey = normSlug(cat);
          if (!catMap.has(catKey)) catMap.set(catKey, new Map());
          const subMap = catMap.get(catKey);

          (subs.length ? subs : [null]).forEach((s) => {
            const subKey = s ? normSlug(s) : null;
            if (!subMap.has(subKey)) subMap.set(subKey, { count: 0, badges: new Set() });
            const node = subMap.get(subKey);
            node.count += 1;
            bset.forEach((b) => node.badges.add(b));
          });
        });
      });
    });

  const options = [];
  for (const [sup, catMap] of superMap.entries()) {
    const supLabel = sup ? getLabelFromList(labels.superCategories, sup) : "Accessories";
    const supSegment = sup ? `/${sup}` : "";
    const catEntries = Array.from(catMap.keys()).map((slug) => ({ slug }));
    const sortedCats = sortByOrderThenAlpha(catEntries, "accessories", labels.categories);

    const children = [];
    for (const { slug: cat } of sortedCats) {
      const subMap = catMap.get(cat);
      const subEntries = Array.from(subMap.entries()).filter(([s]) => s !== null);

      if (subEntries.length === 0) {
        const node = subMap.get(null) || { badges: new Set() };
        children.push({
          label: getLabelFromList(labels.categories, cat),
          href: `${prefix}${supSegment}/${cat}`,
          badges: Array.from(node.badges),
        });
      } else {
        const sortedSubs = sortByOrderThenAlpha(
          subEntries.map(([s]) => ({ slug: s })),
          "accessories",
          labels.subCategories
        );
        children.push({
          label: getLabelFromList(labels.categories, cat),
          href: `${prefix}${supSegment}/${cat}`,
          children: sortedSubs.map(({ slug: s }) => {
            const node = subMap.get(s);
            return {
              label: getLabelFromList(labels.subCategories, s),
              href: `${prefix}${supSegment}/${cat}/${s}`,
              badges: Array.from(node.badges),
            };
          }),
        });
      }
    }

    if (children.length) options.push({ label: supLabel, href: `${prefix}${supSegment}`, children });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

function buildKidsYoung(products, audSlug, labels, prefix = `/collections/${normSlug(audSlug)}`) {
  const tree = new Map(); // gender -> age -> cat -> sub
  products
    .filter((p) => hasAudience(p, audSlug))
    .forEach((p) => {
      const genders = extractRelSlugs(p, "gender_groups");
      const ages = extractRelSlugs(p, "age_groups");
      const cats = extractRelSlugs(p, "categories");
      const subs = extractRelSlugs(p, "sub_categories");
      const bset = badgesFromAudiences(p);

      const genderList = genders.length ? genders : ["unisex"];
      const ageList = ages.length ? ages : ["all-ages"];

      genderList.forEach((g) => {
        const gKey = normSlug(g);
        if (!tree.has(gKey)) tree.set(gKey, new Map());
        const ageMap = tree.get(gKey);

        ageList.forEach((a) => {
          const aKey = normSlug(a);
          if (!ageMap.has(aKey)) ageMap.set(aKey, new Map());
          const catMap = ageMap.get(aKey);

          (cats.length ? cats : [null]).forEach((cat) => {
            if (!cat) return;
            const catKey = normSlug(cat);
            if (!catMap.has(catKey)) catMap.set(catKey, new Map());
            const subMap = catMap.get(catKey);

            (subs.length ? subs : [null]).forEach((s) => {
              const subKey = s ? normSlug(s) : null;
              if (!subMap.has(subKey)) subMap.set(subKey, { count: 0, badges: new Set() });
              const node = subMap.get(subKey);
              node.count += 1;
              bset.forEach((b) => node.badges.add(b));
            });
          });
        });
      });
    });

  const genderOrder = [
    "unisex",
    "baby-girl",
    "baby-boy",
    "baby-unisex",
    "teen-girl",
    "teen-boy",
    "teen-unisex",
    "all-ages",
  ];

  const genderKeys = Array.from(tree.keys()).sort((a, b) => {
    const ai = genderOrder.indexOf(a);
    const bi = genderOrder.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b);
  });

  const out = [];
  for (const g of genderKeys) {
    const ageMap = tree.get(g);
    const ageKeys = sortByOrderThenAlpha(
      Array.from(ageMap.keys()).map((slug) => ({ slug })),
      audSlug,
      labels.ageGroups
    );

    const ageChildren = [];
    for (const { slug: age } of ageKeys) {
      const catMap = ageMap.get(age);
      const catKeys = sortByOrderThenAlpha(
        Array.from(catMap.keys()).map((slug) => ({ slug })),
        audSlug,
        labels.categories
      );

      const cats = [];
      for (const { slug: cat } of catKeys) {
        const subMap = catMap.get(cat);
        const entries = Array.from(subMap.entries());
        const hasSubs = entries.some(([s]) => s !== null);

        if (!hasSubs) {
          const node = subMap.get(null);
          cats.push({
            label: getLabelFromList(labels.categories, cat),
            href: `${prefix}/${g}/${age}/${cat}`,
            badges: Array.from(node.badges),
          });
        } else {
          const subEntries = entries.filter(([s]) => s !== null);
          const sortedSubs = sortByOrderThenAlpha(
            subEntries.map(([s]) => ({ slug: s })),
            audSlug,
            labels.subCategories
          );
          cats.push({
            label: getLabelFromList(labels.categories, cat),
            href: `${prefix}/${g}/${age}/${cat}`,
            children: sortedSubs.map(({ slug: s }) => {
              const node = subMap.get(s);
              return {
                label: getLabelFromList(labels.subCategories, s),
                href: `${prefix}/${g}/${age}/${cat}/${s}`,
                badges: Array.from(node.badges),
              };
            }),
          });
        }
      }

      if (cats.length) {
        ageChildren.push({
          label: getLabelFromList(labels.ageGroups, age),
          href: `${prefix}/${g}/${age}`,
          children: cats,
        });
      }
    }

    if (ageChildren.length) {
      ageChildren.sort((a, b) => a.label.localeCompare(b.label));
      out.push({
        label: getLabelFromList(labels.genderGroups, g),
        href: `${prefix}/${g}`,
        children: ageChildren,
      });
    }
  }

  return out;
}

function buildSeasonal(products, seasonSlug, labels) {
  const seasonalKey = normSlug(seasonSlug);
  const seasonal = products.filter((p) => hasAudience(p, seasonalKey));
  const sections = [];

  const kidsPrefix = `/collections/${seasonalKey}/kids`;
  const kids = buildKidsYoung(seasonal.filter((p) => hasAudience(p, "kids")), "kids", labels, kidsPrefix);
  if (kids.length) sections.push({ label: "Kids", href: kidsPrefix, children: kids });

  const youngPrefix = `/collections/${seasonalKey}/young`;
  const young = buildKidsYoung(seasonal.filter((p) => hasAudience(p, "young")), "young", labels, youngPrefix);
  if (young.length) sections.push({ label: "Young", href: youngPrefix, children: young });

  const accessoriesPrefix = `/collections/${seasonalKey}/accessories`;
  const accessories = buildAccessories(seasonal.filter((p) => hasAudience(p, "accessories")), labels, accessoriesPrefix);
  if (accessories.length) sections.push({ label: "Accessories", href: accessoriesPrefix, children: accessories });

  const menPrefix = `/collections/${seasonalKey}/men`;
  const men = buildMWHD(seasonal.filter((p) => hasAudience(p, "men")), "men", labels, menPrefix);
  if (men.length) sections.push({ label: "Men", href: menPrefix, children: men });

  const womenPrefix = `/collections/${seasonalKey}/women`;
  const women = buildMWHD(seasonal.filter((p) => hasAudience(p, "women")), "women", labels, womenPrefix);
  if (women.length) sections.push({ label: "Women", href: womenPrefix, children: women });

  const homePrefix = `/collections/${seasonalKey}/home-decor`;
  const home = buildMWHD(seasonal.filter((p) => hasAudience(p, "home-decor")), "home-decor", labels, homePrefix);
  if (home.length) sections.push({ label: "Home Décor", href: homePrefix, children: home });

  return sections;
}

/* ===================== LOCAL CACHE (audience list) ===================== */
const LS_AUD_KEY = "tdls:bfbar:audiences:v1";
const LS_AUD_TS = "tdls:bfbar:audiences_ts:v1";
const AUD_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function readAudCache() {
  try {
    const raw = window.localStorage.getItem(LS_AUD_KEY);
    const ts = Number(window.localStorage.getItem(LS_AUD_TS) || "0");
    const arr = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(arr)) return { ok: false, arr: [], ts: 0 };
    return { ok: true, arr, ts: Number.isFinite(ts) ? ts : 0 };
  } catch {
    return { ok: false, arr: [], ts: 0 };
  }
}

function writeAudCache(arr) {
  try {
    window.localStorage.setItem(LS_AUD_KEY, JSON.stringify(arr));
    window.localStorage.setItem(LS_AUD_TS, String(Date.now()));
  } catch {}
}

/* ===================== LOCAL CACHE (FULL BFBar NAV PAYLOAD) ===================== */
const LS_BF_PAYLOAD_KEY = "tdls:bfbar:payload_nav:v1";
const LS_BF_PAYLOAD_TS = "tdls:bfbar:payload_nav_ts:v1";
const BF_PAYLOAD_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function minifyProductsForNav(list = []) {
  if (!Array.isArray(list)) return [];
  const KEYS = [
    "audience_categories",
    "categories",
    "sub_categories",
    "super_categories",
    "age_groups",
    "gender_groups",
  ];

  return list
    .map((p) => {
      const base = p?.attributes ? { id: p.id, ...p.attributes, attributes: p.attributes } : p;
      const out = { id: base?.id ?? p?.id };

      for (const k of KEYS) {
        const slugs = extractRelSlugs(base, k);
        if (slugs.length) out[`${k}_slugs`] = slugs;
      }

      const hasUseful = Object.keys(out).length > 1;
      return hasUseful ? out : null;
    })
    .filter(Boolean);
}

function readBfPayloadCache() {
  try {
    const raw = window.localStorage.getItem(LS_BF_PAYLOAD_KEY);
    const ts = Number(window.localStorage.getItem(LS_BF_PAYLOAD_TS) || "0");
    const payload = raw ? JSON.parse(raw) : null;
    if (!payload || typeof payload !== "object") return { ok: false, payload: null, ts: 0 };
    return { ok: true, payload, ts: Number.isFinite(ts) ? ts : 0 };
  } catch {
    return { ok: false, payload: null, ts: 0 };
  }
}

function writeBfPayloadCache(payload) {
  try {
    const toStore = {
      products: minifyProductsForNav(payload?.products),
      ageGroups: Array.isArray(payload?.ageGroups) ? payload.ageGroups : [],
      categories: Array.isArray(payload?.categories) ? payload.categories : [],
      audienceCategories: Array.isArray(payload?.audienceCategories) ? payload.audienceCategories : [],
    };

    window.localStorage.setItem(LS_BF_PAYLOAD_KEY, JSON.stringify(toStore));
    window.localStorage.setItem(LS_BF_PAYLOAD_TS, String(Date.now()));

    // keep audience-only cache aligned too
    if (Array.isArray(toStore.audienceCategories) && toStore.audienceCategories.length) {
      writeAudCache(toStore.audienceCategories);
    }
  } catch {}
}

/* ===================== MAIN COMPONENT ===================== */
export default function BottomFloatingBar({ initialData }) {
  const [active, setActive] = useState(null); // { key, label }
  const [subOptions, setSubOptions] = useState([]);

  // “Catcher” state populated from server props (initialData)
  const [products, setProducts] = useState([]);
  const [ageGroups, setAgeGroups] = useState([]);
  const [categoriesList, setCategoriesList] = useState([]);
  const [audienceCategories, setAudienceCategories] = useState([]);
  const [fetchError, setFetchError] = useState(false);

  const barRef = useRef(null);
  const panelRef = useRef(null);
  const [barH, setBarH] = useState(60);
  const optionsCacheRef = useRef(new Map());

  const [isMobile, setIsMobile] = useState(false);

  // Mobile behavior:
  // - collapsed = minimal handle row (does NOT take half screen)
  // - expanded = grid of all pills (clamped height, scroll inside)
  const [mobileExpanded, setMobileExpanded] = useState(false); // default collapsed on mobile

  // Tap/scroll guards (prevents accidental click during swipe)
  const railGestureRef = useRef({
    active: false,
    moved: false,
    sx: 0,
    sy: 0,
    pointerId: null,
    pointerType: "mouse",
  });

  const panelGestureRef = useRef({
    active: false,
    moved: false,
    sx: 0,
    sy: 0,
    pointerId: null,
    pointerType: "mouse",
  });

  const beginGesture = (ref, e) => {
    if (!e || e.pointerType === "mouse") return;
    ref.current.active = true;
    ref.current.moved = false;
    ref.current.sx = e.clientX;
    ref.current.sy = e.clientY;
    ref.current.pointerId = e.pointerId;
    ref.current.pointerType = e.pointerType || "touch";
  };

  const moveGesture = (ref, e) => {
    if (!e || !ref.current.active) return;
    if (ref.current.pointerId != null && e.pointerId != null && ref.current.pointerId !== e.pointerId) return;

    const dx = Math.abs((e.clientX ?? 0) - (ref.current.sx ?? 0));
    const dy = Math.abs((e.clientY ?? 0) - (ref.current.sy ?? 0));
    if (dx + dy >= TAP_SLOP_PX) ref.current.moved = true;
  };

  const cancelGesture = (ref) => {
    // Treat cancel as "moved" so any late click is blocked
    ref.current.moved = true;
    ref.current.active = false;
    ref.current.pointerId = null;
    window.setTimeout(() => {
      ref.current.moved = false;
    }, 0);
  };

  const endGesture = (ref, e) => {
    if (ref.current.pointerId != null && e?.pointerId != null && ref.current.pointerId !== e.pointerId) return;
    ref.current.active = false;
    ref.current.pointerId = null;
    // Reset moved AFTER click has had a chance to fire (same tick)
    window.setTimeout(() => {
      ref.current.moved = false;
    }, 0);
  };

  const shouldBlockClick = (ref) => {
    const pt = ref.current.pointerType;
    if (pt === "mouse") return false;
    return Boolean(ref.current.moved);
  };

  // Detect mobile reliably
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 768px)");
    const apply = () => {
      const m = Boolean(mq?.matches);
      setIsMobile(m);
      // Desktop: expander irrelevant; keep rail always “expanded” visually via desktop CSS.
      // Mobile: keep user state as-is, but if switching from desktop to mobile first time, stay collapsed.
      setMobileExpanded((prev) => (m ? prev : false));
    };
    apply();
    if (!mq) return;
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // If flyout opens on mobile, auto-collapse the bar to prevent “bar + panel” covering the full screen.
  useEffect(() => {
    if (!isMobile) return;
    if (active) setMobileExpanded(false);
  }, [isMobile, active]);

  // ✅ Instant hydrate from local payload cache (so flyout feels “already loaded” on refresh)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const cached = readBfPayloadCache();
    if (!cached.ok || !cached.payload) return;

    const p = cached.payload;

    if (Array.isArray(p.products) && p.products.length) {
      setProducts((prev) => (Array.isArray(prev) && prev.length ? prev : p.products));
    }
    if (Array.isArray(p.ageGroups) && p.ageGroups.length) {
      setAgeGroups((prev) => (Array.isArray(prev) && prev.length ? prev : p.ageGroups));
    }
    if (Array.isArray(p.categories) && p.categories.length) {
      setCategoriesList((prev) => (Array.isArray(prev) && prev.length ? prev : p.categories));
    }
    if (Array.isArray(p.audienceCategories) && p.audienceCategories.length) {
      setAudienceCategories((prev) => {
        const prevArr = Array.isArray(prev) ? prev : [];
        return p.audienceCategories.length > prevArr.length ? p.audienceCategories : prevArr;
      });
    }
  }, []);

  // Populate from server-cached payload (primary “magnet” path)
  useEffect(() => {
    if (!initialData) return;

    setFetchError(false);
    const ps = Array.isArray(initialData.products) ? initialData.products : [];
    const ags = Array.isArray(initialData.ageGroups) ? initialData.ageGroups : [];
    const cats = Array.isArray(initialData.categories) ? initialData.categories : [];
    const auds = Array.isArray(initialData.audienceCategories) ? initialData.audienceCategories : [];

    setProducts(ps);
    setAgeGroups(ags);
    setCategoriesList(cats);
    setAudienceCategories(auds);

    // ✅ Write compact payload to cache so refresh/open feels instant
    if (typeof window !== "undefined") {
      writeBfPayloadCache({
        products: ps,
        ageGroups: ags,
        categories: cats,
        audienceCategories: auds,
      });
    }
  }, [initialData]);

  // Fallback only if initialData is missing (keeps non-breaking behavior)
  useEffect(() => {
    if (initialData) return;
    if (typeof window === "undefined") return;

    // ✅ If cache is fresh, do not re-fetch; BFBar is already “loaded with the website”
    const cached = readBfPayloadCache();
    const now = Date.now();
    const stale = !cached.ok || now - (cached.ts || 0) >= BF_PAYLOAD_TTL_MS;

    if (!stale) return;

    let cancelled = false;

    (async () => {
      try {
        setFetchError(false);

        const [ps, ags, cats, auds] = await Promise.allSettled([
          fetchProductsClient(),
          fetchAgeGroupsClient(),
          fetchCategoriesClient(),
          fetchAudienceCategoriesClient(),
        ]);

        if (cancelled) return;

        const psVal = ps.status === "fulfilled" ? (Array.isArray(ps.value) ? ps.value : []) : [];
        const agsVal = ags.status === "fulfilled" ? (Array.isArray(ags.value) ? ags.value : []) : [];
        const catsVal = cats.status === "fulfilled" ? (Array.isArray(cats.value) ? cats.value : []) : [];
        const audsVal = auds.status === "fulfilled" ? (Array.isArray(auds.value) ? auds.value : []) : [];

        if (ps.status === "fulfilled") setProducts(psVal);
        else {
          setProducts([]);
          setFetchError(true);
        }

        if (ags.status === "fulfilled") setAgeGroups(agsVal);
        if (cats.status === "fulfilled") setCategoriesList(catsVal);

        if (auds.status === "fulfilled") setAudienceCategories(audsVal);
        else setAudienceCategories([]);

        // ✅ Persist compact payload for next refresh (and for instant open)
        writeBfPayloadCache({
          products: psVal,
          ageGroups: agsVal,
          categories: catsVal,
          audienceCategories: audsVal,
        });
      } catch {
        if (cancelled) return;
        setProducts([]);
        setFetchError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [initialData]);

  // SWR refresh for audienceCategories EVEN when initialData exists (fixes “desktop missing audiences”)
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1) Instant from cache (if it adds more than we currently have)
    const cached = readAudCache();
    if (cached.ok && Array.isArray(cached.arr) && cached.arr.length) {
      setAudienceCategories((prev) => {
        const prevLen = Array.isArray(prev) ? prev.length : 0;
        return cached.arr.length > prevLen ? cached.arr : prev;
      });
    }

    // 2) Background refresh if stale
    const now = Date.now();
    const stale = !cached.ok || now - (cached.ts || 0) >= AUD_TTL_MS;

    if (!stale) return;

    let cancelled = false;
    fetchAudienceCategoriesClient()
      .then((arr) => {
        if (cancelled) return;
        if (!Array.isArray(arr) || arr.length === 0) return;

        setAudienceCategories((prev) => {
          const prevArr = Array.isArray(prev) ? prev : [];
          if (arr.length >= prevArr.length) return arr;

          const map = new Map();
          prevArr.forEach((x) => map.set(normSlug(x.slug), x));
          arr.forEach((x) => map.set(normSlug(x.slug), x));
          return Array.from(map.values());
        });

        writeAudCache(arr);

        // also keep payload cache aligned (audiences are part of it)
        const p = readBfPayloadCache();
        if (p.ok && p.payload) {
          writeBfPayloadCache({
            products: p.payload.products,
            ageGroups: p.payload.ageGroups,
            categories: p.payload.categories,
            audienceCategories: arr,
          });
        }
      })
      .catch(() => {})
      .finally(() => {});

    return () => {
      cancelled = true;
    };
  }, [initialData]);

  // Reserve safe click padding below body for bar height
  useEffect(() => {
    const prev = typeof document !== "undefined" ? document.body.style.paddingBottom : "";

    const measure = () => {
      if (!barRef.current) return;
      const h = barRef.current.offsetHeight || 60;
      setBarH(h);
      document.body.style.paddingBottom = `calc(${h}px + env(safe-area-inset-bottom))`;
    };

    const hasRO = typeof ResizeObserver !== "undefined";
    const obs = hasRO ? new ResizeObserver(() => Promise.resolve().then(measure)) : null;

    if (barRef.current && obs) obs.observe(barRef.current);
    window.addEventListener("resize", measure);
    measure();

    return () => {
      try {
        if (obs) obs.disconnect();
      } catch {}
      window.removeEventListener("resize", measure);
      try {
        document.body.style.paddingBottom = prev;
      } catch {}
    };
  }, []);

  // Focus panel when opened (prevents “dead” keyboard state)
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      try {
        panelRef.current?.focus?.();
      } catch {}
    }, 0);
    return () => window.clearTimeout(id);
  }, [active]);

  // Close on outside click + ESC
  useEffect(() => {
    if (!active) return;

    const closeOnOutsidePointerDown = (e) => {
      const path = e.composedPath ? e.composedPath() : [];
      if (barRef.current && path.includes(barRef.current)) return;
      if (panelRef.current && path.includes(panelRef.current)) return;
      setActive(null);
    };

    const closeOnEsc = (e) => {
      if (e.key === "Escape") setActive(null);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    document.addEventListener("keydown", closeOnEsc);

    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
      document.removeEventListener("keydown", closeOnEsc);
    };
  }, [active]);

  const labels = useMemo(
    () => ({
      ageGroups,
      categories: categoriesList,
      subCategories: categoriesList,
      superCategories: categoriesList,
      audienceCategories,
      genderGroups: [
        { slug: "unisex", name: "Unisex" },
        { slug: "baby-girl", name: "Baby Girl" },
        { slug: "baby-boy", name: "Baby Boy" },
        { slug: "baby-unisex", name: "Baby Unisex" },
        { slug: "teen-girl", name: "Teen Girl" },
        { slug: "teen-boy", name: "Teen Boy" },
        { slug: "teen-unisex", name: "Teen Unisex" },
        { slug: "all-ages", name: "All Ages" },
      ],
    }),
    [ageGroups, categoriesList, audienceCategories]
  );

  const barItems = useMemo(() => {
    const base = [
      { key: "women", label: "Women" },
      { key: "men", label: "Men" },
      { key: "kids", label: "Kids" },
      { key: "young", label: "Young" },
      { key: "home-decor", label: "Home Décor" },
      { key: "accessories", label: "Accessories" },
      { key: "new-arrival", label: "New Arrival" },
      { key: "on-sale", label: "On Sale" },
      { key: "monsoon", label: "Monsoon" },
      { key: "summer", label: "Summer" },
      { key: "winter", label: "Winter" },
    ];

    const baseKeys = new Set(base.map((x) => normSlug(x.key)));

    const extras = (audienceCategories || [])
      .map((a) => {
        const k = normSlug(a.slug);
        if (!k) return null;
        return {
          key: k,
          label: a.name || titleizeSlug(a.slug),
          order: typeof a.order === "number" ? a.order : undefined,
        };
      })
      .filter(Boolean)
      .filter((x) => x.key && !baseKeys.has(x.key));

    // De-dupe by key (prevents “missing” due to collisions)
    const map = new Map();
    extras.forEach((x) => map.set(normSlug(x.key), x));
    const deduped = Array.from(map.values());

    deduped.sort((a, b) => {
      const ai = typeof a.order === "number" ? a.order : Infinity;
      const bi = typeof b.order === "number" ? b.order : Infinity;
      if (ai !== bi) return ai - bi;
      return a.label.localeCompare(b.label);
    });

    return base.concat(deduped.map(({ key, label }) => ({ key, label })));
  }, [audienceCategories]);

  // Keep these derived values (non-breaking; may be used by other refactors)
  const { visibleItems, overflowItems } = useMemo(() => {
    const v = barItems.slice(0, MOBILE_VISIBLE_PILLS);
    const o = barItems.slice(MOBILE_VISIBLE_PILLS);
    return { visibleItems: v, overflowItems: o };
  }, [barItems]);

  const audienceCounts = useMemo(() => {
    if (!SHOW_COUNTS || !products?.length) return {};
    const map = Object.create(null);
    for (const item of barItems) map[item.key] = 0;
    for (const p of products) {
      const slugs = extractRelSlugs(p, "audience_categories");
      for (const s of slugs) {
        const k = normSlug(s);
        if (k in map) map[k] += 1;
      }
    }
    return map;
  }, [products, barItems]);

  const computeOptions = (key) => {
    const cache = optionsCacheRef.current;
    if (cache.has(key)) return cache.get(key);

    let options = [];

    if (key === MORE_KEY) {
      options = barItems.map((x) => ({
        label: x.label,
        href: `/collections/${normSlug(x.key)}`,
      }));
    } else if (["women", "men", "home-decor"].includes(key)) {
      options = buildMWHD(products, key, labels);
    } else if (key === "accessories") {
      options = buildAccessories(products, labels);
    } else if (["kids", "young"].includes(key)) {
      options = buildKidsYoung(products, key, labels);
    } else if (["new-arrival", "on-sale", "monsoon", "summer", "winter"].includes(key)) {
      options = buildSeasonal(products, key, labels);
    } else {
      options = buildMWHD(products, key, labels);
    }

    if (Array.isArray(options) && options.length > 0) cache.set(key, options);
    return options;
  };

  useEffect(() => {
    optionsCacheRef.current.clear();
    if (active) setSubOptions(computeOptions(active.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, ageGroups, categoriesList, audienceCategories]);

  const toggleFlyout = (item) => {
    if (active?.key === item.key) {
      setActive(null);
      return;
    }
    const options = computeOptions(item.key);
    setSubOptions(options);
    setActive(item);
  };

  const toggleMobileExpanded = () => {
    setMobileExpanded((v) => !v);
  };

  return (
    <>
      <style>{`
        /* ---------------- base shell ---------------- */
        .bfbar-shell{
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2147483647;
          background: ${PEARL_WHITE};
          border-top: 1px solid ${NEUTRAL_BORDER};
          overflow: visible; /* desktop wrap */
          -webkit-tap-highlight-color: transparent;
        }

        /* Desktop stays as-is (wrap, centered) */
        .bfbar-nav{
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8px 10px 12px;
          gap: 10px;
        }

        .bfbar-rail-wrap{
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Desktop rail: no clipping, allow rows */
        .bfbar-rail{
          max-width: 100%;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
          overflow: visible;
          min-width: 0;
        }

        .bfbar-pill{
          color: ${NEUTRAL_TEXT};
          font-family: 'Playfair Display', serif;
          font-weight: 700;
          font-size: ${FS_PILL};
          letter-spacing: .08em;
          background: ${PEARL_WHITE};
          border: 1px solid ${NEUTRAL_BORDER};
          border-radius: 22px;
          padding: ${PAD_PILL};
          line-height: 1.25;
          cursor: pointer;
          text-transform: capitalize;
          white-space: nowrap;
          transition: background .2s ease, color .18s ease, border-color .2s ease, transform .2s ease;
          min-height: var(--tap-target-min, 44px);
          max-width: 100%;
          touch-action: manipulation; /* improves tap behavior + reduces accidental scroll-capture issues */
          -webkit-tap-highlight-color: transparent;
        }
        .bfbar-pill[data-active="true"]{ color: ${ACCENT}; border-color: ${ACCENT}; }
        .bfbar-pill:hover{ background: ${HOVER_TINT}; color: ${HOVER_TEXT}; border-color: ${ACCENT}; }

        /* Mobile expander control */
        .bfbar-expander{
          display: none;
          flex: 0 0 auto;
          border: 1px solid ${NEUTRAL_BORDER};
          background: rgba(255,255,255,0.92);
          color: ${NEUTRAL_TEXT};
          border-radius: 14px;
          min-width: var(--tap-target-min, 44px);
          min-height: var(--tap-target-min, 44px);
          padding: 10px;
          cursor: pointer;
          transition: background .18s ease, color .18s ease, border-color .2s ease, transform .12s ease;
          box-shadow: 0 10px 24px rgba(0,0,0,0.06);
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .bfbar-expander:hover{
          background: ${HOVER_TINT};
          color: ${HOVER_TEXT};
          border-color: ${ACCENT};
          transform: translateY(-1px);
        }

        .bfbar-more{ display: none; }

        /* ---------------- MOBILE: handle + expand grid (never half-screen when collapsed) ---------------- */
        @media (max-width: 768px){
          .bfbar-shell{
            box-shadow: 0 -10px 28px rgba(0,0,0,0.06);
            overflow: hidden; /* IMPORTANT: allow smooth collapse without spilling */
          }

          /* default mobile nav: slim handle row */
          .bfbar-nav{
            justify-content: space-between;
            align-items: center;
            padding:
              8px
              calc(10px + env(safe-area-inset-right))
              calc(8px + env(safe-area-inset-bottom))
              calc(10px + env(safe-area-inset-left));
            gap: 10px;
          }

          .bfbar-expander{ display: inline-flex; align-items: center; justify-content: center; }

          /* rail becomes a scrollable grid ONLY when expanded; otherwise it collapses to ~0 height */
          .bfbar-rail{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
            align-items: stretch;
            justify-content: start;
            gap: 8px;
            width: 100%;
            overflow: auto;
            overflow-x: hidden;
            -webkit-overflow-scrolling: touch;
            overscroll-behavior: contain;

            /* critical: allow natural vertical pan gestures */
            touch-action: pan-y;

            padding-left: calc(6px + env(safe-area-inset-left));
            padding-right: calc(6px + env(safe-area-inset-right));
            padding-bottom: 10px;

            /* expanded height clamp: never exceed screen */
            max-height: min(32dvh, 280px);

            /* smooth open/close */
            transition: max-height .22s ease, padding .18s ease, opacity .16s ease;
            opacity: 1;
          }

          .bfbar-rail::-webkit-scrollbar{ width: 0px; height: 0px; }

          .bfbar-pill{
            font-size: 0.98rem;
            padding: 10px 12px;
            border-radius: 999px;
            width: 100%;
            text-align: center;
            letter-spacing: .06em;
          }

          /* COLLAPSED: rail goes essentially hidden (no “half-screen cover”),
             leaving only the handle row + expander visible. */
          .bfbar-shell[data-mobile-expanded="false"] .bfbar-rail{
            max-height: 0px;
            padding-top: 0px;
            padding-bottom: 0px;
            opacity: 0;
            pointer-events: none;
          }

          /* In collapsed mode, keep handle row extra tight */
          .bfbar-shell[data-mobile-expanded="false"] .bfbar-nav{
            padding-top: 8px;
            padding-bottom: calc(8px + env(safe-area-inset-bottom));
          }
        }

        @media (max-width: 420px){
          .bfbar-rail{
            grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
          }
          .bfbar-pill{
            font-size: 0.94rem;
            padding: 9px 10px;
          }
        }

        @media (max-width: 768px) and (orientation: landscape){
          .bfbar-rail{
            max-height: min(30dvh, 220px);
          }
        }

        /* ---------------- flyout panel (never full-screen with bar) ---------------- */
        .bfbar-panel{
          pointer-events: auto;
          position: fixed;

          left: max(8px, env(safe-area-inset-left));
          right: max(8px, env(safe-area-inset-right));

          margin: 0 auto;
          background: ${PEARL_WHITE};
          border-radius: ${RADIUS + 2}px ${RADIUS + 2}px 0 0;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 20px 20px;
          border: 1px solid ${NEUTRAL_BORDER};
          border-bottom: none;
          box-shadow: 0 8px 40px rgba(0,0,0,0.12);
          outline: none;
          contain: layout paint style;

          /* allow smooth scroll gestures without accidental activations */
          touch-action: pan-y;
          -webkit-overflow-scrolling: touch;

          /* desktop defaults */
          min-height: 300px;
          max-height: min(72dvh, 720px);
        }

        /* Mobile: hard guarantee = panel height <= viewport - bar height - top safe area */
        @media (max-width: 768px){
          .bfbar-panel{
            padding: 16px 14px;
            border-radius: 18px 18px 0 0;

            min-height: 220px;

            /* uses inline style var(--bfbar-h) */
            max-height: calc(100dvh - var(--bfbar-h, 60px) - 16px - env(safe-area-inset-top));
          }

          .bfbar-panel-title{
            font-size: 1.2rem !important;
            letter-spacing: .10em !important;
          }
        }

        .bfbar-close{
          background: transparent;
          border: 1px solid ${NEUTRAL_BORDER};
          border-radius: 12px;
          cursor: pointer;
          color: ${NEUTRAL_TEXT};
          padding: 10px;
          transition: background .18s ease, color .18s ease, border-color .2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: var(--tap-target-min, 44px);
          min-height: var(--tap-target-min, 44px);
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
        }
        .bfbar-close:hover{
          background: ${HOVER_TINT};
          color: ${HOVER_TEXT};
          border-color: ${ACCENT};
        }
      `}</style>

      <div
        ref={barRef}
        className="bfbar-shell"
        data-flyout="bar"
        data-mobile-expanded={isMobile && !mobileExpanded ? "false" : "true"}
      >
        <nav
          className="bfbar-nav"
          aria-label="Collections menu"
          onClick={(e) => {
            // UX: when collapsed, TAP on the bar area (not a pill) expands it.
            // Changed from pointerdown -> click so swipe-to-scroll doesn't trigger expansion.
            if (!isMobile) return;
            if (active) return;
            if (mobileExpanded) return;

            const t = e.target;
            if (t && typeof t.closest === "function" && t.closest("button")) return;
            setMobileExpanded(true);
          }}
        >
          <div className="bfbar-rail-wrap">
            <div
              className="bfbar-rail"
              // Capture gestures across the rail to suppress accidental activation during scroll.
              onPointerDownCapture={(e) => beginGesture(railGestureRef, e)}
              onPointerMoveCapture={(e) => moveGesture(railGestureRef, e)}
              onPointerUpCapture={(e) => endGesture(railGestureRef, e)}
              onPointerCancelCapture={() => cancelGesture(railGestureRef)}
              onClickCapture={(e) => {
                // If user was swiping/scrolling on touch, block any click on pills.
                if (shouldBlockClick(railGestureRef)) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
            >
              {(barItems || []).map((item) => {
                const isActive = active?.key === item.key;
                const count = audienceCounts[item.key];
                const countSuffix = SHOW_COUNTS && count > 0 ? ` (${count})` : "";

                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-label={item.label}
                    aria-expanded={isActive}
                    aria-haspopup="dialog"
                    onClick={(e) => {
                      // Do not let nav click (expand) run.
                      e.stopPropagation();
                      // Actual action remains unchanged.
                      toggleFlyout(item);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleFlyout(item);
                      }
                    }}
                    className="bfbar-pill"
                    data-active={isActive ? "true" : "false"}
                    style={{
                      color: isActive ? ACCENT : undefined,
                      borderColor: isActive ? ACCENT : undefined,
                    }}
                  >
                    {item.label}
                    <span aria-hidden="true">{countSuffix}</span>
                  </button>
                );
              })}

              {/* Kept for compatibility (features intact). Not needed now because mobile grid can show all items. */}
              {overflowItems.length > 0 && (
                <button
                  type="button"
                  aria-label={MORE_LABEL}
                  aria-expanded={active?.key === MORE_KEY}
                  aria-haspopup="dialog"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFlyout({ key: MORE_KEY, label: MORE_LABEL });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleFlyout({ key: MORE_KEY, label: MORE_LABEL });
                    }
                  }}
                  className="bfbar-pill bfbar-more"
                  data-active={active?.key === MORE_KEY ? "true" : "false"}
                  style={{
                    color: active?.key === MORE_KEY ? ACCENT : undefined,
                    borderColor: active?.key === MORE_KEY ? ACCENT : undefined,
                  }}
                >
                  {MORE_LABEL}
                </button>
              )}
            </div>
          </div>

          {/* Mobile-only expander */}
          <button
            type="button"
            className="bfbar-expander"
            aria-label={mobileExpanded ? "Collapse menu" : "Expand menu"}
            onClick={(e) => {
              if (!isMobile) return;
              e.preventDefault();
              e.stopPropagation();
              toggleMobileExpanded();
            }}
            onKeyDown={(e) => {
              if (!isMobile) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleMobileExpanded();
              }
            }}
          >
            {mobileExpanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </button>
        </nav>
      </div>

      <Portal zIndex={2147483647}>
        {active && (
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            className="bfbar-panel"
            style={{
              // Bottom is always the current bar height (collapsed on mobile when active)
              bottom: `calc(${barH}px + env(safe-area-inset-bottom))`,
              // Used by mobile max-height calc
              ["--bfbar-h"]: `${barH}px`,
            }}
            data-flyout="panel"
            // Capture gestures in the panel so MenuFlyout links/buttons don't trigger during scroll.
            onPointerDownCapture={(e) => beginGesture(panelGestureRef, e)}
            onPointerMoveCapture={(e) => moveGesture(panelGestureRef, e)}
            onPointerUpCapture={(e) => endGesture(panelGestureRef, e)}
            onPointerCancelCapture={() => cancelGesture(panelGestureRef)}
            onClickCapture={(e) => {
              // If user was swiping/scrolling, suppress accidental navigation from MenuFlyout CTAs.
              if (shouldBlockClick(panelGestureRef)) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                gap: 10,
              }}
            >
              <div
                className="bfbar-panel-title"
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 800,
                  fontSize: "1.5rem",
                  color: NEUTRAL_TEXT,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "78%",
                }}
              >
                {active.label}
              </div>

              <button
                type="button"
                aria-label="Close"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActive(null);
                }}
                className="bfbar-close"
              >
                <CloseIcon size={22} stroke="currentColor" />
              </button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Link
                href={active.key === MORE_KEY ? "/collections" : `/collections/${normSlug(active.key)}`}
                prefetch
                style={{
                  color: "#174099",
                  fontWeight: 800,
                  fontSize: "1rem",
                  textDecoration: "none",
                  letterSpacing: ".03em",
                }}
              >
                {active.key === MORE_KEY ? "Browse all collections ›" : `See all in ${active.label} ›`}
              </Link>
            </div>

            {fetchError ? (
              <div
                style={{
                  color: "#7a6f5a",
                  fontWeight: 700,
                  textAlign: "center",
                  padding: 28,
                  border: `1px dashed ${NEUTRAL_BORDER}`,
                  borderRadius: 14,
                  background: "#fffef9",
                  fontSize: "1.05rem",
                }}
              >
                We’ll be back shortly.
              </div>
            ) : subOptions.length > 0 ? (
              <MenuFlyout options={subOptions} />
            ) : (
              <div
                style={{
                  color: "#9a9a9a",
                  fontWeight: 700,
                  textAlign: "center",
                  padding: 24,
                  fontSize: "1.05rem",
                }}
              >
                No options found.
              </div>
            )}
          </div>
        )}
      </Portal>
    </>
  );
}

/* ===================== REPORT (WHAT CHANGED) =====================

1) Fixed “hyper sensitive” mobile interactions (root cause):
   - Previously: audience pills used onPointerDown + preventDefault, so even the start of a swipe could trigger instantly.
   - Now: activation happens on onClick (tap) instead of pointerdown, so swipe-to-scroll no longer triggers actions.

2) Added a production-grade tap-vs-scroll guard (no UI change):
   - Implemented gesture tracking (TAP_SLOP_PX = 14px) on:
     a) the audience pill rail container, and
     b) the flyout panel container (covers MenuFlyout CTAs too).
   - If the user’s finger moves beyond the slop threshold (i.e., they are scrolling), any click is suppressed via capture-phase preventDefault/stopPropagation.
   - This prevents accidental redirects while keeping taps fully responsive.

3) Kept everything else intact:
   - No changes to routing, menu-building logic, caching, payload warm-up, or desktop layout.
   - Visual design remains unchanged; only interaction sensitivity is normalized for mobile.

================================================================= */
