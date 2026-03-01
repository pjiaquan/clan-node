export type GraphSettings = {
  repelGap: number;
  spouseGap: number;
  expandShiftStepX: number;
  expandShiftStepY: number;
  initialOrbitBaseRadius: number;
  initialOrbitStepRadius: number;
  ySnapThreshold: number;
  yReleaseThreshold: number;
  xSnapThreshold: number;
  xReleaseThreshold: number;
  spouseSnapThreshold: number;
  spouseReleaseThreshold: number;
  minDragDistanceForAutoLink: number;
  nearGapXThreshold: number;
  nearCenterYThreshold: number;
  autoSpouseMinOverlapRatio: number;
  autoSpouseMinVerticalOverlapRatio: number;
  showBirthTimeOnNode: boolean;
};

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  repelGap: 24,
  spouseGap: 0,
  expandShiftStepX: 200,
  expandShiftStepY: 140,
  initialOrbitBaseRadius: 150,
  initialOrbitStepRadius: 30,
  ySnapThreshold: 26,
  yReleaseThreshold: 34,
  xSnapThreshold: 12,
  xReleaseThreshold: 18,
  spouseSnapThreshold: 20,
  spouseReleaseThreshold: 28,
  minDragDistanceForAutoLink: 10,
  nearGapXThreshold: 10,
  nearCenterYThreshold: 10,
  autoSpouseMinOverlapRatio: 0.32,
  autoSpouseMinVerticalOverlapRatio: 0.45,
  showBirthTimeOnNode: false,
};

const STORAGE_KEY = 'clan.graphSettings';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toFiniteNumber = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
};

const toBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  }
  return fallback;
};

const sanitizeGraphSettings = (value?: Partial<GraphSettings> | null): GraphSettings => {
  const source = {
    ...DEFAULT_GRAPH_SETTINGS,
    ...(value ?? {}),
  };

  const ySnapThreshold = clamp(toFiniteNumber(source.ySnapThreshold, DEFAULT_GRAPH_SETTINGS.ySnapThreshold), 4, 200);
  const yReleaseThreshold = Math.max(
    ySnapThreshold,
    clamp(toFiniteNumber(source.yReleaseThreshold, DEFAULT_GRAPH_SETTINGS.yReleaseThreshold), 4, 220)
  );
  const xSnapThreshold = clamp(toFiniteNumber(source.xSnapThreshold, DEFAULT_GRAPH_SETTINGS.xSnapThreshold), 4, 200);
  const xReleaseThreshold = Math.max(
    xSnapThreshold,
    clamp(toFiniteNumber(source.xReleaseThreshold, DEFAULT_GRAPH_SETTINGS.xReleaseThreshold), 4, 220)
  );
  const spouseSnapThreshold = clamp(
    toFiniteNumber(source.spouseSnapThreshold, DEFAULT_GRAPH_SETTINGS.spouseSnapThreshold),
    0,
    240
  );
  const spouseReleaseThreshold = Math.max(
    spouseSnapThreshold,
    clamp(toFiniteNumber(source.spouseReleaseThreshold, DEFAULT_GRAPH_SETTINGS.spouseReleaseThreshold), 0, 260)
  );

  return {
    repelGap: clamp(Math.round(toFiniteNumber(source.repelGap, DEFAULT_GRAPH_SETTINGS.repelGap)), 0, 240),
    spouseGap: clamp(Math.round(toFiniteNumber(source.spouseGap, DEFAULT_GRAPH_SETTINGS.spouseGap)), 0, 240),
    expandShiftStepX: clamp(Math.round(toFiniteNumber(source.expandShiftStepX, DEFAULT_GRAPH_SETTINGS.expandShiftStepX)), 20, 1200),
    expandShiftStepY: clamp(Math.round(toFiniteNumber(source.expandShiftStepY, DEFAULT_GRAPH_SETTINGS.expandShiftStepY)), 20, 1200),
    initialOrbitBaseRadius: clamp(
      Math.round(toFiniteNumber(source.initialOrbitBaseRadius, DEFAULT_GRAPH_SETTINGS.initialOrbitBaseRadius)),
      40,
      1600
    ),
    initialOrbitStepRadius: clamp(
      Math.round(toFiniteNumber(source.initialOrbitStepRadius, DEFAULT_GRAPH_SETTINGS.initialOrbitStepRadius)),
      0,
      500
    ),
    ySnapThreshold,
    yReleaseThreshold,
    xSnapThreshold,
    xReleaseThreshold,
    spouseSnapThreshold,
    spouseReleaseThreshold,
    minDragDistanceForAutoLink: clamp(
      toFiniteNumber(source.minDragDistanceForAutoLink, DEFAULT_GRAPH_SETTINGS.minDragDistanceForAutoLink),
      0,
      200
    ),
    nearGapXThreshold: clamp(
      toFiniteNumber(source.nearGapXThreshold, DEFAULT_GRAPH_SETTINGS.nearGapXThreshold),
      0,
      200
    ),
    nearCenterYThreshold: clamp(
      toFiniteNumber(source.nearCenterYThreshold, DEFAULT_GRAPH_SETTINGS.nearCenterYThreshold),
      0,
      200
    ),
    autoSpouseMinOverlapRatio: clamp(
      toFiniteNumber(source.autoSpouseMinOverlapRatio, DEFAULT_GRAPH_SETTINGS.autoSpouseMinOverlapRatio),
      0.05,
      1
    ),
    autoSpouseMinVerticalOverlapRatio: clamp(
      toFiniteNumber(source.autoSpouseMinVerticalOverlapRatio, DEFAULT_GRAPH_SETTINGS.autoSpouseMinVerticalOverlapRatio),
      0.05,
      1
    ),
    showBirthTimeOnNode: toBoolean(source.showBirthTimeOnNode, DEFAULT_GRAPH_SETTINGS.showBirthTimeOnNode),
  };
};

const getStorageKey = (username?: string | null) => {
  const normalizedUsername = username?.trim();
  return normalizedUsername ? `${STORAGE_KEY}.${normalizedUsername}` : STORAGE_KEY;
};

export const loadGraphSettings = (username?: string | null): GraphSettings => {
  try {
    const userStorageKey = getStorageKey(username);
    let raw = localStorage.getItem(userStorageKey);
    if (!raw && userStorageKey !== STORAGE_KEY) {
      raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        localStorage.setItem(userStorageKey, raw);
      }
    }
    if (!raw) {
      return DEFAULT_GRAPH_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<GraphSettings>;
    return sanitizeGraphSettings(parsed);
  } catch (error) {
    console.warn('Failed to load graph settings:', error);
    return DEFAULT_GRAPH_SETTINGS;
  }
};

export const saveGraphSettings = (settings: GraphSettings, username?: string | null): GraphSettings => {
  const normalized = sanitizeGraphSettings(settings);
  try {
    localStorage.setItem(getStorageKey(username), JSON.stringify(normalized));
  } catch (error) {
    console.warn('Failed to persist graph settings:', error);
  }
  return normalized;
};

export const resetGraphSettings = (username?: string | null): GraphSettings => {
  try {
    localStorage.removeItem(getStorageKey(username));
  } catch (error) {
    console.warn('Failed to reset graph settings:', error);
  }
  return DEFAULT_GRAPH_SETTINGS;
};

export const normalizeGraphSettings = sanitizeGraphSettings;
