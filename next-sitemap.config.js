// next-sitemap.config.js
/** @type {import('next-sitemap').IConfig} */

// Auto-pick site URL based on env (dev vs prod)
const isProd = process.env.NODE_ENV === 'production';
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (isProd ? 'https://www.thednalabstore.com' : 'http://localhost:3000');

module.exports = {
  siteUrl,
  generateRobotsTxt: true,
  outDir: 'public',
  sitemapBaseFileName: 'sitemap',

  exclude: [
    '/admin/*','/api/*','/internal/*','/draft/*','/private/*',
    '/preview*','/server-sitemap.xml','/sitemap-products.xml',
    '/sitemap-collections.xml','/sitemap-blog.xml',
    '/login','/signin','/signup','/logout','/account','/customer','/customer/*',
    '/profile','/orders','/cart','/checkout','/search','/info',
  ],

  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: ['/', '/_next/', '/_next/static/', '/static/', '/assets/', '/fonts/', '/images/'],
        disallow: [
          '/admin/','/api/','/internal/','/draft/','/private/','/preview',
          '/login','/signin','/signup','/logout','/account','/customer','/customer/','/profile','/orders',
          '/cart','/checkout','/search','/info',
          '/*?*utm_source=','/*?*utm_medium=','/*?*utm_campaign=','/*?*utm_term=','/*?*utm_content=',
          '/*?*gclid=','/*?*fbclid=','/*?*ref=','/*?*session=','/*?*preview=',
          '/*?*page=','/*?*sort=','/*?*filter=','/*?*q=',
        ],
      },
      { userAgent: 'Googlebot', allow: '/' },
      { userAgent: 'Mediapartners-Google', allow: '/' },
      { userAgent: 'bingbot', allow: '/' },
      { userAgent: 'Slurp', allow: '/' },
      { userAgent: 'AhrefsBot', disallow: '/' },
      { userAgent: 'SemrushBot', disallow: '/' },
      { userAgent: 'MJ12bot', disallow: '/' },
      { userAgent: 'BLEXBot', disallow: '/' },
      { userAgent: 'DotBot', disallow: '/' },
    ],
    additionalSitemaps: [
      `${siteUrl}/sitemap-products.xml`,
      `${siteUrl}/sitemap-collections.xml`,
      `${siteUrl}/sitemap-blog.xml`,
      `${siteUrl}/server-sitemap.xml`,
    ],
  },

  transform: async (config, path) => {
    let priority = 0.7, changefreq = 'weekly';
    if (path === '/') { priority = 1.0; changefreq = 'daily'; }
    else if (path.startsWith('/lookbook') || path.startsWith('/instagram')) {
      priority = 0.6; changefreq = 'weekly';
    }
    return {
      loc: path,
      changefreq,
      priority,
      lastmod: new Date().toISOString(),
      alternateRefs: config.alternateRefs ?? [],
    };
  },
};
