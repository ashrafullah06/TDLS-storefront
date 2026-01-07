// src/lib/site.js
/**
 * Hybrid utility module (JS + JSDoc types).
 * - Works as plain JS (no TS syntax).
 * - Provides strong types when used in TS or with checkJs.
 */

/** @type {boolean} */
export const isProd = process.env.NODE_ENV === 'production';

/**
 * Resolve the public base URL for links in sitemaps, etc.
 * @param {string | undefined} [fallbackHost] e.g., "http://localhost:3000"
 * @returns {string}
 */
export const getBaseUrl = (fallbackHost) =>
  process.env.NEXT_PUBLIC_SITE_URL ||
  (isProd ? 'https://www.thednalabstore.com' : (fallbackHost || 'http://localhost:3000'));

/** @type {string} */
export const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * @typedef {Object} XmlItem
 * @property {string} loc
 * @property {string} [lastmod]
 * @property {string} [changefreq]
 * @property {number} [priority]
 */

/**
 * Convert URL entries to a sitemap XML string.
 * @param {XmlItem[]} items
 * @returns {string}
 */
export const toXml = (items) => {
  const safe = Array.isArray(items) ? items : [];
  const nodes = safe.map((i) => {
    const parts = [
      `<loc>${i.loc}</loc>`,
      i.lastmod ? `<lastmod>${i.lastmod}</lastmod>` : '',
      i.changefreq ? `<changefreq>${i.changefreq}</changefreq>` : '',
      typeof i.priority === 'number' ? `<priority>${i.priority}</priority>` : '',
    ].filter(Boolean).join('');
    return `<url>${parts}</url>`;
  }).join('');
  return `${xmlHeader}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${nodes}</urlset>`;
};

/**
 * Mask a secret/token for safe display (e.g., in /health).
 * @param {string | undefined | null} token
 * @returns {string}
 */
export const mask = (token) => {
  if (!token) return '';
  const t = String(token);
  return t.length <= 8 ? '****' : `${t.slice(0, 4)}…${t.slice(-4)}`;
};
