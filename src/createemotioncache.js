// src/createemotioncache.js

import createCache from '@emotion/cache';

// You can customize the key if you want (default 'css' is common)
export default function createEmotionCache() {
  return createCache({ key: 'css', prepend: true });
}
