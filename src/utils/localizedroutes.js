const getLocalizedPath = (path, lang) => {
  if (lang === 'en') return `/en${path}`;
  if (lang === 'bn') return `/bn${path}`;
  return path;
};

export default getLocalizedPath;