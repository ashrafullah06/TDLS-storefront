// FILE: src/components/common/bottomfloatingbar.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X as CloseIcon } from "lucide-react";
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

/* ===================== CLIENT-SAFE FETCHERS (VIA PROXY) ===================== */
/**
 * We go through /api/strapi so:
 * - Same token / secret config
 * - Same shape as product page helpers: { ok, data }
 */
async function fetchFromStrapi(path) {
  try {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const q = encodeURIComponent(normalizedPath);

    const res = await fetch(`/api/strapi?path=${q}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
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
  // Robust for both shapes:
  // - { id, attributes: { ...flattened fields... } }
  // - { id, slug, ...flattened fields... }
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

/** ✅ NEW: fetch audience categories so newly created ones show automatically */
async function fetchAudienceCategoriesClient() {
  const payload = await fetchFromStrapi("/audience-categories?populate=*");
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
    el.dataset.flyoutHost = "tdlc";
    el.style.position = "fixed";
    el.style.inset = "0";
    el.style.zIndex = String(zIndex);
    el.style.pointerEvents = "none";
    document.body.appendChild(el);
    setHost(el);
    return () => document.body.removeChild(el);
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

  // Preferred: pre-flattened lists like audience_categories_slugs
  const pre = p[`${canonicalKey}_slugs`];
  const pre2 = p[`${canonicalKey}Slugs`];
  const fromPre = pickSlugs(pre);
  if (fromPre.length) return Array.from(new Set(fromPre));
  const fromPre2 = pickSlugs(pre2);
  if (fromPre2.length) return Array.from(new Set(fromPre2));

  // Try aliases (relations or arrays)
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
function buildMWHD(
  products,
  audSlug,
  labels,
  prefix = `/collections/${normSlug(audSlug)}`
) {
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

function buildKidsYoung(
  products,
  audSlug,
  labels,
  prefix = `/collections/${normSlug(audSlug)}`
) {
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

/* ===================== MAIN COMPONENT ===================== */
export default function BottomFloatingBar() {
  const [mounted, setMounted] = useState(false);

  const [active, setActive] = useState(null); // { key, label }
  const [subOptions, setSubOptions] = useState([]);

  const [products, setProducts] = useState([]);
  const [ageGroups, setAgeGroups] = useState([]);
  const [categoriesList, setCategoriesList] = useState([]);
  const [audienceCategories, setAudienceCategories] = useState([]); // ✅ NEW
  const [fetchError, setFetchError] = useState(false);

  const barRef = useRef(null);
  const panelRef = useRef(null);
  const [barH, setBarH] = useState(60);
  const optionsCacheRef = useRef(new Map());

  useEffect(() => setMounted(true), []);

  const normalizeProducts = (val) => {
    if (Array.isArray(val)) return val;
    if (val && Array.isArray(val.data)) {
      return val.data.map((n) => (n?.attributes ? { id: n.id, ...n.attributes } : n));
    }
    return [];
  };

  useEffect(() => {
    (async () => {
      try {
        setFetchError(false);
        const [ps, ags, cats, auds] = await Promise.allSettled([
          fetchProductsClient(),
          fetchAgeGroupsClient(),
          fetchCategoriesClient(),
          fetchAudienceCategoriesClient(), // ✅ NEW
        ]);

        if (ps.status === "fulfilled") {
          const normalized = normalizeProducts(ps.value);
          setProducts(Array.isArray(normalized) ? normalized : []);
        } else {
          setProducts([]);
          setFetchError(true);
        }

        if (ags.status === "fulfilled" && Array.isArray(ags.value)) setAgeGroups(ags.value);
        if (cats.status === "fulfilled" && Array.isArray(cats.value)) setCategoriesList(cats.value);

        // ✅ NEW (non-fatal if it fails)
        if (auds.status === "fulfilled" && Array.isArray(auds.value)) {
          setAudienceCategories(auds.value);
        } else {
          setAudienceCategories([]);
        }
      } catch {
        setProducts([]);
        setFetchError(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const measure = () => {
      if (!barRef.current) return;
      const h = barRef.current.offsetHeight || 60;
      setBarH(h);
      document.body.style.paddingBottom = `calc(${h}px + env(safe-area-inset-bottom))`;
    };
    const obs = new ResizeObserver(() => Promise.resolve().then(measure));
    if (barRef.current) obs.observe(barRef.current);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      try {
        obs.disconnect();
      } catch {}
      window.removeEventListener("resize", measure);
    };
  }, [mounted]);

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
      audienceCategories, // ✅ NEW (for name lookup when building extra tabs)
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
    // Existing tabs (keep order/UX exactly)
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

    // ✅ NEW: append any additional audience categories from Strapi
    // so newly created ones appear automatically (without disrupting existing layout).
    const baseKeys = new Set(base.map((x) => normSlug(x.key)));
    const extras = (audienceCategories || [])
      .map((a) => ({
        key: normSlug(a.slug),
        label: a.name || titleizeSlug(a.slug),
        order: typeof a.order === "number" ? a.order : undefined,
      }))
      .filter((x) => x.key && !baseKeys.has(x.key));

    // preserve Strapi ordering if provided, then alpha
    extras.sort((a, b) => {
      const ai = typeof a.order === "number" ? a.order : Infinity;
      const bi = typeof b.order === "number" ? b.order : Infinity;
      if (ai !== bi) return ai - bi;
      return a.label.localeCompare(b.label);
    });

    return base.concat(extras.map(({ key, label }) => ({ key, label })));
  }, [audienceCategories]);

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
    if (["women", "men", "home-decor"].includes(key)) {
      options = buildMWHD(products, key, labels);
    } else if (key === "accessories") {
      options = buildAccessories(products, labels);
    } else if (["kids", "young"].includes(key)) {
      options = buildKidsYoung(products, key, labels);
    } else if (["new-arrival", "on-sale", "monsoon", "summer", "winter"].includes(key)) {
      options = buildSeasonal(products, key, labels);
    } else {
      // ✅ NEW: any newly-created audience behaves like a normal audience tab (MWHD-style tree)
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

  if (!mounted) return null;

  return (
    <>
      {/* Bottom bar */}
      <div
        ref={barRef}
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 2147483647,
          background: PEARL_WHITE,
          borderTop: `1px solid ${NEUTRAL_BORDER}`,
        }}
        data-flyout="bar"
      >
        <nav
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px 10px 12px",
          }}
        >
          <div
            style={{
              maxWidth: "100vw",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            {barItems.map((item) => {
              const isActive = active?.key === item.key;
              const count = audienceCounts[item.key];
              const countSuffix = SHOW_COUNTS && count > 0 ? ` (${count})` : "";

              return (
                <button
                  key={item.key}
                  aria-label={item.label}
                  aria-expanded={isActive}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFlyout(item);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleFlyout(item);
                    }
                  }}
                  style={{
                    color: isActive ? ACCENT : NEUTRAL_TEXT,
                    fontFamily: "'Playfair Display', serif",
                    fontWeight: 700,
                    fontSize: FS_PILL,
                    letterSpacing: ".08em",
                    background: PEARL_WHITE,
                    border: `1px solid ${isActive ? ACCENT : NEUTRAL_BORDER}`,
                    borderRadius: 22,
                    padding: PAD_PILL,
                    lineHeight: 1.25,
                    cursor: "pointer",
                    textTransform: "capitalize",
                    whiteSpace: "nowrap",
                    transition:
                      "background .2s ease, color .18s ease, border-color .2s ease, transform .2s ease",
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = HOVER_TINT;
                    e.currentTarget.style.color = HOVER_TEXT;
                    e.currentTarget.style.borderColor = ACCENT;
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = PEARL_WHITE;
                    e.currentTarget.style.color = isActive ? ACCENT : NEUTRAL_TEXT;
                    e.currentTarget.style.borderColor = isActive ? ACCENT : NEUTRAL_BORDER;
                  }}
                >
                  {item.label}
                  <span aria-hidden="true">{countSuffix}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>

      {/* Flyout panel */}
      <Portal zIndex={2147483647}>
        {active && (
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            style={{
              pointerEvents: "auto",
              position: "fixed",
              left: 10,
              right: 10,
              bottom: `calc(${barH}px + env(safe-area-inset-bottom))`,
              margin: "0 auto",
              minHeight: 300,
              maxHeight: "72vh",
              background: PEARL_WHITE,
              borderRadius: `${RADIUS + 2}px ${RADIUS + 2}px 0 0`,
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              padding: "20px 20px",
              border: `1px solid ${NEUTRAL_BORDER}`,
              borderBottom: "none",
              boxShadow: "0 8px 40px rgba(0,0,0,12)",
            }}
            data-flyout="panel"
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                gap: 8,
              }}
            >
              <div
                style={{
                  fontFamily: "'Playfair Display', serif",
                  fontWeight: 800,
                  fontSize: "1.5rem",
                  color: NEUTRAL_TEXT,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                }}
              >
                {active.label}
              </div>

              <button
                aria-label="Close"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActive(null);
                }}
                style={{
                  background: "transparent",
                  border: `1px solid ${NEUTRAL_BORDER}`,
                  borderRadius: 12,
                  fontSize: 20,
                  cursor: "pointer",
                  color: NEUTRAL_TEXT,
                  padding: 8,
                  transition:
                    "background .18s ease, color .18s ease, border-color .2s ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = HOVER_TINT;
                  e.currentTarget.style.color = HOVER_TEXT;
                  e.currentTarget.style.borderColor = ACCENT;
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = NEUTRAL_TEXT;
                  e.currentTarget.style.borderColor = NEUTRAL_BORDER;
                }}
              >
                <CloseIcon size={24} stroke="currentColor" />
              </button>
            </div>

            {/* See all link */}
            <div style={{ marginBottom: 12 }}>
              <Link
                href={`/collections/${active.key}`}
                prefetch
                style={{
                  color: "#174099",
                  fontWeight: 800,
                  fontSize: "1rem",
                  textDecoration: "none",
                  letterSpacing: ".03em",
                }}
              >
                See all in {active.label} &rsaquo;
              </Link>
            </div>

            {/* Content */}
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
