export type PartialDateParts = {
  year: string;
  month: string;
  day: string;
};

const PARTIAL_DATE_RE = /^(\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/;

const sanitizeNumberString = (value: string): string => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return String(parsed);
};

const clampInt = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, value))
);

export const parsePartialDate = (value: string | null | undefined): PartialDateParts => {
  if (!value) return { year: '', month: '', day: '' };
  const trimmed = value.trim();
  const match = trimmed.match(PARTIAL_DATE_RE);
  if (!match) {
    const fallback = new Date(trimmed);
    if (Number.isNaN(fallback.getTime())) {
      return { year: '', month: '', day: '' };
    }
    return {
      year: String(fallback.getFullYear()),
      month: String(fallback.getMonth() + 1),
      day: String(fallback.getDate()),
    };
  }
  return {
    year: sanitizeNumberString(match[1] || ''),
    month: sanitizeNumberString(match[2] || ''),
    day: sanitizeNumberString(match[3] || ''),
  };
};

const getMaxDay = (year: number, month: number): number => (
  new Date(year, month, 0).getDate()
);

export const clampDay = (year: string, month: string, day: string): string => {
  const dayNum = Number.parseInt(day, 10);
  if (!Number.isFinite(dayNum) || dayNum <= 0) return '';
  const yearNum = Number.parseInt(year, 10);
  const monthNum = Number.parseInt(month, 10);
  if (!Number.isFinite(yearNum) || !Number.isFinite(monthNum)) return String(dayNum);
  if (yearNum < 1 || monthNum < 1 || monthNum > 12) return String(dayNum);
  const maxDay = getMaxDay(yearNum, monthNum);
  return String(clampInt(dayNum, 1, maxDay));
};

export const composePartialDate = (parts: PartialDateParts): string => {
  const yearNum = Number.parseInt(parts.year, 10);
  if (!Number.isFinite(yearNum) || yearNum < 1 || yearNum > 9999) {
    return '';
  }
  const year = String(yearNum).padStart(4, '0');

  const monthNum = Number.parseInt(parts.month, 10);
  if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
    return year;
  }
  const month = String(monthNum).padStart(2, '0');

  const dayNumRaw = Number.parseInt(parts.day, 10);
  if (!Number.isFinite(dayNumRaw) || dayNumRaw < 1) {
    return `${year}-${month}`;
  }
  const dayMax = getMaxDay(yearNum, monthNum);
  const day = String(clampInt(dayNumRaw, 1, dayMax)).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isFullDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);
