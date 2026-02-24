const variantCache = new Map<string, string[]>();
type ConverterFn = (input: string) => string;
type PinyinFn = (input: string, options: {
  type: 'array';
  toneType: 'none';
  nonZh: 'removed';
  v: true;
  pattern?: 'pinyin' | 'first';
  traditional: true;
}) => string[];

let toSimplified: ConverterFn | null = null;
let toPinyinArray: PinyinFn | null = null;
let convertersReady = false;
let converterVersion = 0;
let converterLoadPromise: Promise<void> | null = null;

const normalizeText = (input: string) => (
  input
    .normalize('NFKC')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim()
);

const getPinyinVariants = (input: string) => {
  if (!toPinyinArray) return [] as string[];
  const full = normalizeText(toPinyinArray(input, {
    type: 'array',
    toneType: 'none',
    nonZh: 'removed',
    v: true,
    pattern: 'pinyin',
    traditional: true,
  }).join(''));
  const initials = normalizeText(toPinyinArray(input, {
    type: 'array',
    toneType: 'none',
    nonZh: 'removed',
    v: true,
    pattern: 'first',
    traditional: true,
  }).join(''));
  return [full, initials].filter(Boolean);
};

export const getSearchVariants = (input: string) => {
  const normalized = normalizeText(input);
  if (!normalized) return [];
  const cacheKey = `${converterVersion}:${normalized}`;
  const cached = variantCache.get(cacheKey);
  if (cached) return cached;

  if (!convertersReady) {
    void preloadNameSearchConverters();
  }

  const variants = Array.from(new Set([
    normalized,
    convertersReady && toSimplified ? normalizeText(toSimplified(normalized)) : '',
    ...(convertersReady ? getPinyinVariants(normalized) : []),
  ])).filter(Boolean);
  variantCache.set(cacheKey, variants);
  return variants;
};

export const preloadNameSearchConverters = () => {
  if (convertersReady) return Promise.resolve();
  if (converterLoadPromise) return converterLoadPromise;
  converterLoadPromise = Promise.all([
    import('opencc-js/t2cn'),
    import('pinyin-pro'),
  ]).then(([t2cn, pinyinPro]) => {
    toSimplified = t2cn.Converter({ from: 'tw', to: 'cn' });
    toPinyinArray = ((input, options) => {
      const converted = pinyinPro.pinyin(input, options);
      return Array.isArray(converted) ? converted : [converted];
    }) as PinyinFn;
    convertersReady = true;
    converterVersion += 1;
  }).catch((error) => {
    console.warn('Failed to load name search converters:', error);
  });
  return converterLoadPromise;
};

export const createNameMatcher = (query: string) => {
  const queryVariants = getSearchVariants(query);
  return (candidate: string | null | undefined) => {
    if (!candidate || !queryVariants.length) return false;
    const candidateVariants = getSearchVariants(candidate);
    return queryVariants.some((queryVariant) => (
      candidateVariants.some((candidateVariant) => candidateVariant.includes(queryVariant))
    ));
  };
};

export const createExactNameMatcher = (query: string) => {
  const queryVariants = getSearchVariants(query);
  return (candidate: string | null | undefined) => {
    if (!candidate || !queryVariants.length) return false;
    const candidateVariants = getSearchVariants(candidate);
    return queryVariants.some((queryVariant) => candidateVariants.includes(queryVariant));
  };
};
