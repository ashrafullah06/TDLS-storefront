// PATH: src/components/common/homepanel_all_products.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import MenuFlyout from "@/components/common/menuflyout";

/* ===================== UI TOKENS (kept aligned with BFBar) ===================== */
const PEARL_WHITE = "#faf9f6";
const NEUTRAL_TEXT = "#201D14";
const NEUTRAL_BORDER = "#e7e3da";
const ACCENT = "#bda04d";
const HOVER_TINT = "#E9F1FB";
const HOVER_TEXT = "#163060";

const SYS_FONT =
  "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const LUX_FONT = "'Playfair Display','Georgia',serif";

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

    // Proxy returns { ok: true, data: <rawStrapiJson> }
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

/* ===================== HELPERS (same robustness as BFBar) ===================== */
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
          (x) =>
            x?.attributes?.slug ||
            x?.slug ||
            x?.attributes?.name ||
            x?.name
        )
        .filter(Boolean)
        .map(normSlug);
    }
    const one =
      d?.attributes?.slug || d?.slug || d?.attributes?.name || d?.name || null;
    return one ? [normSlug(one)] : [];
  }

  const one =
    obj?.attributes?.slug || obj?.slug || obj?.attributes?.name || obj?.name || null;
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

  // Prefer precomputed lite arrays if present
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

/* ===================== MENU BUILDERS (copied from BFBar, unchanged) ===================== */
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

    if (children.length)
      options.push({ label: supLabel, href: `${prefix}${supSegment}`, children });
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
  const kids = buildKidsYoung(
    seasonal.filter((p) => hasAudience(p, "kids")),
    "kids",
    labels,
    kidsPrefix
  );
  if (kids.length) sections.push({ label: "Kids", href: kidsPrefix, children: kids });

  const youngPrefix = `/collections/${seasonalKey}/young`;
  const young = buildKidsYoung(
    seasonal.filter((p) => hasAudience(p, "young")),
    "young",
    labels,
    youngPrefix
  );
  if (young.length) sections.push({ label: "Young", href: youngPrefix, children: young });

  const accessoriesPrefix = `/collections/${seasonalKey}/accessories`;
  const accessories = buildAccessories(
    seasonal.filter((p) => hasAudience(p, "accessories")),
    labels,
    accessoriesPrefix
  );
  if (accessories.length)
    sections.push({ label: "Accessories", href: accessoriesPrefix, children: accessories });

  const menPrefix = `/collections/${seasonalKey}/men`;
  const men = buildMWHD(
    seasonal.filter((p) => hasAudience(p, "men")),
    "men",
    labels,
    menPrefix
  );
  if (men.length) sections.push({ label: "Men", href: menPrefix, children: men });

  const womenPrefix = `/collections/${seasonalKey}/women`;
  const women = buildMWHD(
    seasonal.filter((p) => hasAudience(p, "women")),
    "women",
    labels,
    womenPrefix
  );
  if (women.length) sections.push({ label: "Women", href: womenPrefix, children: women });

  const homePrefix = `/collections/${seasonalKey}/home-decor`;
  const home = buildMWHD(
    seasonal.filter((p) => hasAudience(p, "home-decor")),
    "home-decor",
    labels,
    homePrefix
  );
  if (home.length) sections.push({ label: "Home Décor", href: homePrefix, children: home });

  return sections;
}

/* ===================== LOCAL CACHE (lite products + taxonomies) ===================== */
const LS_DATA_KEY = "tdls:homepanel:allproducts:data:v1";
const LS_DATA_TS = "tdls:homepanel:allproducts:ts:v1";
const TTL_MS = 6 * 60 * 60 * 1000; // 6h
const LS_LAST_KEY = "tdls:homepanel:allproducts:last_audience:v1";

function readJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, val) {
  try {
    window.localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

function readTs(key) {
  try {
    return Number(window.localStorage.getItem(key) || "0");
  } catch {
    return 0;
  }
}

function writeTs(key) {
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {}
}

function isFresh(ts) {
  const t = Number(ts || 0);
  if (!Number.isFinite(t) || t <= 0) return false;
  return Date.now() - t < TTL_MS;
}

function toLiteProduct(p) {
  const node = p?.attributes ? { id: p.id, ...p.attributes, attributes: p.attributes } : p || {};
  return {
    id: node?.id,
    audience_categories_slugs: extractRelSlugs(node, "audience_categories"),
    categories_slugs: extractRelSlugs(node, "categories"),
    sub_categories_slugs: extractRelSlugs(node, "sub_categories"),
    super_categories_slugs: extractRelSlugs(node, "super_categories"),
    age_groups_slugs: extractRelSlugs(node, "age_groups"),
    gender_groups_slugs: extractRelSlugs(node, "gender_groups"),
  };
}

/* ===================== MAIN COMPONENT ===================== */
export default function HomePanelAllProducts({ onAfterNavigate }) {
  const [active, setActive] = useState(null); // { key, label }
  const [subOptions, setSubOptions] = useState([]);

  const [products, setProducts] = useState([]);
  const [ageGroups, setAgeGroups] = useState([]);
  const [categoriesList, setCategoriesList] = useState([]);
  const [audienceCategories, setAudienceCategories] = useState([]);
  const [fetchError, setFetchError] = useState(false);

  const optionsCacheRef = useRef(new Map());
  const [isMobile, setIsMobile] = useState(false);

  // Mobile UX: show audience list first, then a dedicated "options" pane
  const [mobilePane, setMobilePane] = useState("audience"); // "audience" | "options"
  const rightPaneRef = useRef(null);

  /* ------------------- Touch scroll guard (prevents accidental taps) ------------------- */
  const ignoreClickUntilRef = useRef(0);
  const gestureRef = useRef({ active: false, x: 0, y: 0, moved: false });

  const shouldIgnoreClick = () => Date.now() < (ignoreClickUntilRef.current || 0);

  const onPointerDownCapture = (e) => {
    if (!e || e.pointerType !== "touch") return;
    gestureRef.current.active = true;
    gestureRef.current.moved = false;
    gestureRef.current.x = typeof e.clientX === "number" ? e.clientX : 0;
    gestureRef.current.y = typeof e.clientY === "number" ? e.clientY : 0;
  };

  const onPointerMoveCapture = (e) => {
    if (!e || e.pointerType !== "touch") return;
    if (!gestureRef.current.active) return;

    const dx = Math.abs((typeof e.clientX === "number" ? e.clientX : 0) - gestureRef.current.x);
    const dy = Math.abs((typeof e.clientY === "number" ? e.clientY : 0) - gestureRef.current.y);

    // Small threshold: treat as scroll intent, then ignore the synthetic click
    if (dx > 8 || dy > 8) gestureRef.current.moved = true;
  };

  const onPointerUpCapture = (e) => {
    if (!e || e.pointerType !== "touch") return;
    const moved = Boolean(gestureRef.current.moved);
    gestureRef.current.active = false;

    // If user was scrolling, ignore click events that follow immediately (mobile browsers)
    if (moved) ignoreClickUntilRef.current = Date.now() + 320;
  };

  // detect mobile
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 768px)");
    const apply = () => setIsMobile(Boolean(mq?.matches));
    apply();
    if (!mq) return;
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // hydrate from cache instantly + background refresh
  useEffect(() => {
    if (typeof window === "undefined") return;

    const cached = readJson(LS_DATA_KEY);
    const ts = readTs(LS_DATA_TS);

    if (cached && typeof cached === "object") {
      const p = Array.isArray(cached.products) ? cached.products : [];
      const ag = Array.isArray(cached.ageGroups) ? cached.ageGroups : [];
      const c = Array.isArray(cached.categories) ? cached.categories : [];
      const ac = Array.isArray(cached.audienceCategories) ? cached.audienceCategories : [];

      if (p.length) setProducts(p);
      if (ag.length) setAgeGroups(ag);
      if (c.length) setCategoriesList(c);
      if (ac.length) setAudienceCategories(ac);
    }

    const stale = !isFresh(ts);

    let cancelled = false;
    if (!stale && cached) return;

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

        const nextProducts =
          ps.status === "fulfilled" && Array.isArray(ps.value)
            ? ps.value.map(toLiteProduct)
            : [];
        const nextAge =
          ags.status === "fulfilled" && Array.isArray(ags.value) ? ags.value : [];
        const nextCats =
          cats.status === "fulfilled" && Array.isArray(cats.value) ? cats.value : [];
        const nextAud =
          auds.status === "fulfilled" && Array.isArray(auds.value) ? auds.value : [];

        if (!nextProducts.length) setFetchError(true);

        if (nextProducts.length) setProducts(nextProducts);
        if (nextAge.length) setAgeGroups(nextAge);
        if (nextCats.length) setCategoriesList(nextCats);
        if (nextAud.length) setAudienceCategories(nextAud);

        writeJson(LS_DATA_KEY, {
          products: nextProducts.length ? nextProducts : products,
          ageGroups: nextAge.length ? nextAge : ageGroups,
          categories: nextCats.length ? nextCats : categoriesList,
          audienceCategories: nextAud.length ? nextAud : audienceCategories,
        });
        writeTs(LS_DATA_TS);
      } catch {
        if (!cancelled) setFetchError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const computeOptions = (key) => {
    const cache = optionsCacheRef.current;
    if (cache.has(key)) return cache.get(key);

    let options = [];

    if (["women", "men", "home-decor"].includes(key)) {
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

  // rebuild options cache when data changes + restore last audience
  useEffect(() => {
    optionsCacheRef.current.clear();

    const last = (() => {
      try {
        return String(window.localStorage.getItem(LS_LAST_KEY) || "").trim();
      } catch {
        return "";
      }
    })();

    if (!active && last) {
      const found = barItems.find((x) => normSlug(x.key) === normSlug(last));
      if (found) {
        setActive(found);
        setSubOptions(computeOptions(found.key));
        return;
      }
    }

    if (active) {
      setSubOptions(computeOptions(active.key));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, ageGroups, categoriesList, audienceCategories, barItems]);

  // keep mobile pane consistent when switching breakpoint
  useEffect(() => {
    if (!isMobile) {
      setMobilePane("audience");
      return;
    }
    if (active?.key) setMobilePane("options");
    else setMobilePane("audience");
  }, [isMobile, active?.key]);

  const toggleAudience = (item) => {
    if (shouldIgnoreClick()) return;
    if (!item?.key) return;

    if (active?.key === item.key) {
      if (isMobile) setMobilePane("options");
      return;
    }

    setActive(item);
    try {
      window.localStorage.setItem(LS_LAST_KEY, String(item.key));
    } catch {}

    const next = computeOptions(item.key);
    setSubOptions(next);

    if (isMobile) {
      setMobilePane("options");
      window.requestAnimationFrame(() => {
        try {
          rightPaneRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
        } catch {}
      });
    }
  };

  const activeHref = active?.key ? `/collections/${normSlug(active.key)}` : "/collections";

  return (
    <>
      <style>{`
        :root{
          --hpFly-radius: 18px;
          --hpFly-shadow: 0 18px 44px rgba(6,10,24,.12);
          --hpFly-maxw: 1240px;           /* bigger flyout */
          --hpFly-leftw: 280px;           /* more room for labels */
          --hpFly-minh: 480px;            /* bigger canvas */
          --hpFly-maxh: min(80vh, 820px); /* no overflow */
        }

        .hpFly-root{
          width: 100%;
          max-width: var(--hpFly-maxw);
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
          color: ${NEUTRAL_TEXT};
        }

        .hpFly-top{
          display:flex;
          align-items:center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 12px 10px;
          border: 1px solid rgba(231,227,218,.9);
          border-radius: var(--hpFly-radius);
          background: linear-gradient(180deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,.84) 100%);
          box-shadow: 0 16px 38px rgba(6,10,24,.10);
        }

        .hpFly-title{
          min-width: 0;
          font-family: ${LUX_FONT};
          font-weight: 900;
          font-size: 1.02rem;
          letter-spacing: .12em;
          text-transform: uppercase;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .hpFly-sub{
          margin-top: 2px;
          font-family: ${SYS_FONT};
          font-weight: 900;
          font-size: 10.5px;
          letter-spacing: .18em;
          text-transform: uppercase;
          opacity: .72;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .hpFly-link{
          flex: 0 0 auto;
          font-family: ${SYS_FONT};
          font-weight: 900;
          font-size: 11px;
          letter-spacing: .14em;
          text-transform: uppercase;
          color: ${HOVER_TEXT};
          text-decoration: none;
          padding: 9px 12px;
          border-radius: 999px;
          border: 1px solid rgba(22,48,96,.16);
          background: linear-gradient(180deg, rgba(255,255,255,.92) 0%, rgba(244,246,254,.92) 100%);
          box-shadow: 0 14px 30px rgba(6,10,24,.12);
          white-space: nowrap;
        }

        .hpFly-wrap{
          border: 1px solid rgba(231,227,218,.92);
          border-radius: var(--hpFly-radius);
          background: linear-gradient(180deg, rgba(255,255,255,.92) 0%, rgba(255,255,255,.86) 100%);
          box-shadow: var(--hpFly-shadow);
          overflow: hidden;
        }

        /* Bigger, more usable canvas */
        .hpFly-grid{
          display: grid;
          grid-template-columns: var(--hpFly-leftw) 1fr;
          min-height: var(--hpFly-minh);
          max-height: var(--hpFly-maxh);
        }

        .hpFly-left{
          border-right: 1px solid rgba(231,227,218,.88);
          background: linear-gradient(180deg, rgba(250,249,246,.95) 0%, rgba(255,255,255,.92) 100%);
          padding: 10px;
          overflow: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          touch-action: pan-y;
        }
        .hpFly-left::-webkit-scrollbar{ width: 0px; height: 0px; }

        .hpFly-right{
          padding: 12px;
          overflow-y: auto;
          overflow-x: hidden; /* prevent edge cutting / horizontal scroll */
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          touch-action: pan-y;
          background: rgba(255,255,255,.80);
          min-width: 0; /* critical for long labels */

          /* Ensure text never flips into vertical writing modes */
          writing-mode: horizontal-tb;
          text-orientation: mixed;
        }
        .hpFly-right::-webkit-scrollbar{ width: 0px; height: 0px; }

        /* Keep labels readable without affecting layout containers */
        .hpFly-right a,
        .hpFly-right button{
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: normal;
          hyphens: auto;
          min-width: 0;
          max-width: 100%;
        }

        .hpFly-kicker{
          font-family: ${SYS_FONT};
          font-size: 10.5px;
          font-weight: 900;
          letter-spacing: .18em;
          text-transform: uppercase;
          opacity: .72;
          padding: 2px 4px 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .hpFly-audBtn{
          width: 100%;
          text-align: left;
          border: 1px solid rgba(231,227,218,.92);
          background: ${PEARL_WHITE};
          border-radius: 14px;
          padding: 10px 10px;
          cursor: pointer;
          font-family: ${LUX_FONT};
          font-weight: 900;
          letter-spacing: .06em;
          text-transform: capitalize;
          color: ${NEUTRAL_TEXT};
          transition: background .16s ease, border-color .16s ease, transform .10s ease, color .16s ease;
          min-height: var(--tap-target-min, 44px);
          touch-action: manipulation;
        }
        .hpFly-audBtn[data-active="true"]{
          border-color: rgba(189,160,77,.95);
          color: ${ACCENT};
          background: linear-gradient(180deg, rgba(255,255,255,.96) 0%, rgba(248,246,238,.96) 100%);
          box-shadow: 0 14px 28px rgba(201,176,101,.14);
        }
        .hpFly-audBtn:hover{
          background: ${HOVER_TINT};
          border-color: rgba(189,160,77,.9);
          color: ${HOVER_TEXT};
          transform: translateY(-1px);
        }

        .hpFly-stack{
          display:flex;
          flex-direction:column;
          gap: 8px;
        }

        .hpFly-empty{
          font-family: ${SYS_FONT};
          font-weight: 800;
          color: #6b657a;
          text-align: center;
          padding: 16px 12px;
          border: 1px dashed rgba(231,227,218,.95);
          border-radius: 16px;
          background: rgba(255,255,255,.92);
        }

        /* ---------- Mobile: 2-step navigation (Audience -> Options) ---------- */
        .hpFly-mobileShell{
          display: flex;
          flex-direction: column;
          min-height: var(--hpFly-minh);
          max-height: min(86vh, 860px);
        }

        .hpFly-mobileHeader{
          position: sticky;
          top: 0;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 10px;
          border-bottom: 1px solid rgba(231,227,218,.88);
          background: linear-gradient(180deg, rgba(255,255,255,.96) 0%, rgba(255,255,255,.90) 100%);
          backdrop-filter: blur(10px);
        }

        .hpFly-backBtn{
          flex: 0 0 auto;
          border: 1px solid rgba(231,227,218,.92);
          background: rgba(250,249,246,.96);
          border-radius: 999px;
          padding: 9px 12px;
          font-family: ${SYS_FONT};
          font-weight: 900;
          font-size: 11px;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: ${HOVER_TEXT};
          cursor: pointer;
          touch-action: manipulation;
          white-space: nowrap;
        }

        .hpFly-mobileTitle{
          min-width: 0;
          flex: 1 1 auto;
          text-align: center;
          font-family: ${LUX_FONT};
          font-weight: 900;
          letter-spacing: .08em;
          text-transform: uppercase;
          font-size: .96rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .hpFly-chipRow{
          display: flex;
          gap: 8px;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 10px 10px 8px;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          touch-action: pan-x;
        }
        .hpFly-chipRow::-webkit-scrollbar{ width: 0px; height: 0px; }

        .hpFly-chip{
          flex: 0 0 auto;
          border: 1px solid rgba(231,227,218,.92);
          background: ${PEARL_WHITE};
          border-radius: 999px;
          padding: 10px 12px;
          font-family: ${SYS_FONT};
          font-weight: 900;
          font-size: 11px;
          letter-spacing: .12em;
          text-transform: uppercase;
          color: ${NEUTRAL_TEXT};
          cursor: pointer;
          max-width: 74vw;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          touch-action: manipulation;
        }
        .hpFly-chip[data-active="true"]{
          border-color: rgba(189,160,77,.95);
          color: ${ACCENT};
          background: linear-gradient(180deg, rgba(255,255,255,.96) 0%, rgba(248,246,238,.96) 100%);
          box-shadow: 0 10px 22px rgba(201,176,101,.14);
        }

        .hpFly-mobileBody{
          flex: 1 1 auto;
          overflow: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
          overflow-x: hidden;
          touch-action: pan-y;
        }

        .hpFly-mobileHint{
          font-family: ${SYS_FONT};
          font-weight: 900;
          font-size: 10px;
          letter-spacing: .18em;
          text-transform: uppercase;
          opacity: .72;
          padding: 10px 12px 6px;
        }

        @media (max-width: 768px){
          .hpFly-grid{ display: none; }
          .hpFly-top{ border-radius: 16px; }
          .hpFly-link{ padding: 9px 10px; font-size: 10.5px; }
        }

        @media (min-width: 769px){
          .hpFly-mobileShell{ display: none; }
        }

        @media (prefers-reduced-motion: reduce){
          .hpFly-audBtn{ transition: none; }
        }
      `}</style>

      <div className="hpFly-root">
        <div className="hpFly-top">
          <div style={{ minWidth: 0 }}>
            <div className="hpFly-sub">Collections</div>
            <div className="hpFly-title">{active?.label ? active.label : "Browse"}</div>
          </div>

          <Link className="hpFly-link" href={activeHref} prefetch>
            See all ↗
          </Link>
        </div>

        <div
          className="hpFly-wrap"
          onPointerDownCapture={onPointerDownCapture}
          onPointerMoveCapture={onPointerMoveCapture}
          onPointerUpCapture={onPointerUpCapture}
          onPointerCancelCapture={onPointerUpCapture}
          onClickCapture={(e) => {
            // If the user is scrolling on touch, ignore the synthetic click.
            if (shouldIgnoreClick()) {
              e.preventDefault?.();
              e.stopPropagation?.();
              return;
            }

            const a = e?.target?.closest?.("a");
            if (!a) return;
            const href = String(a.getAttribute("href") || "");
            if (!href.startsWith("/")) return;
            window.setTimeout(() => onAfterNavigate?.(), 0);
          }}
        >
          {/* =============== MOBILE: 2-step navigation (prevents hidden options) =============== */}
          <div className="hpFly-mobileShell" aria-label="Collections flyout (mobile)">
            {mobilePane === "audience" ? (
              <>
                <div className="hpFly-mobileHeader">
                  <div className="hpFly-mobileTitle">Choose Collection</div>
                  <button
                    type="button"
                    className="hpFly-backBtn"
                    onClick={() => {
                      if (shouldIgnoreClick()) return;
                      onAfterNavigate?.();
                    }}
                    aria-label="Close"
                  >
                    Close
                  </button>
                </div>

                <div className="hpFly-mobileBody">
                  <div className="hpFly-mobileHint">Tap a collection to view categories</div>

                  <div
                    className="hpFly-stack"
                    style={{
                      padding: 10,
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 8,
                    }}
                  >
                    {(barItems || []).map((item) => {
                      const isActive = active?.key === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className="hpFly-audBtn"
                          data-active={isActive ? "true" : "false"}
                          aria-pressed={isActive}
                          onClick={() => toggleAudience(item)}
                          style={{ textAlign: "center" }}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>

                  {fetchError ? (
                    <div style={{ padding: 10 }}>
                      <div className="hpFly-empty">We’ll be back shortly.</div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className="hpFly-mobileHeader">
                  <button
                    type="button"
                    className="hpFly-backBtn"
                    onClick={() => {
                      if (shouldIgnoreClick()) return;
                      setMobilePane("audience");
                    }}
                    aria-label="Back to collections"
                  >
                    ← Back
                  </button>

                  <div className="hpFly-mobileTitle">{active?.label || "Options"}</div>

                  <button
                    type="button"
                    className="hpFly-backBtn"
                    onClick={() => {
                      if (shouldIgnoreClick()) return;
                      onAfterNavigate?.();
                    }}
                    aria-label="Close"
                  >
                    Close
                  </button>
                </div>

                <div className="hpFly-chipRow" aria-label="Quick collection switch">
                  {(barItems || []).map((item) => {
                    const isActive = active?.key === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className="hpFly-chip"
                        data-active={isActive ? "true" : "false"}
                        aria-pressed={isActive}
                        onClick={() => toggleAudience(item)}
                        title={item.label}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>

                <div className="hpFly-mobileBody hpFly-right" ref={rightPaneRef}>
                  <div style={{ display: "flex", justifyContent: "flex-end", padding: "2px 2px 10px" }}>
                    <Link className="hpFly-link" href={activeHref} prefetch>
                      See all ↗
                    </Link>
                  </div>

                  {fetchError ? (
                    <div className="hpFly-empty">We’ll be back shortly.</div>
                  ) : active?.key ? (
                    subOptions?.length ? (
                      <MenuFlyout options={subOptions} />
                    ) : (
                      <div className="hpFly-empty">No options found.</div>
                    )
                  ) : (
                    <div className="hpFly-empty">Select a collection to view categories.</div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* =============== DESKTOP/TABLET: split layout preserved =============== */}
          <div className="hpFly-grid" aria-label="Collections flyout (desktop)">
            <div className="hpFly-left">
              <div className="hpFly-kicker">Choose</div>

              <div className="hpFly-stack" aria-label="Collections list">
                {(barItems || []).map((item) => {
                  const isActive = active?.key === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="hpFly-audBtn"
                      data-active={isActive ? "true" : "false"}
                      aria-pressed={isActive}
                      onClick={() => toggleAudience(item)}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="hpFly-right">
              {fetchError ? (
                <div className="hpFly-empty">We’ll be back shortly.</div>
              ) : active?.key ? (
                subOptions?.length ? (
                  <MenuFlyout options={subOptions} />
                ) : (
                  <div className="hpFly-empty">No options found.</div>
                )
              ) : (
                <div className="hpFly-empty">Select a collection to view categories.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
