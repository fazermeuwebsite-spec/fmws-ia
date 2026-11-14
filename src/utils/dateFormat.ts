const pad2 = (n: number) => String(n).padStart(2, '0');

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Formats any date string (YYYY-MM-DD, ISO timestamp, or DD-MM-YYYY / DD/MM/YYYY)
 * strictly as DD-MM-YYYY (dia-mês-ano), avoiding UTC midnight off-by-one shifts.
 */
export function formatDateBR(value?: string | Date | null, fallback = ''): string {
  if (!value) return fallback;

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return fallback;
    return `${pad2(value.getDate())}-${pad2(value.getMonth() + 1)}-${value.getFullYear()}`;
  }

  const raw = String(value).trim();
  if (!raw) return fallback;

  // Exact YYYY-MM-DD (never shift via UTC Date parsing)
  const isoDateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const [, yyyy, mm, dd] = isoDateOnly;
    return `${dd}-${mm}-${yyyy}`;
  }

  // Already DD-MM-YYYY or DD/MM/YYYY
  const brMatch = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (brMatch) {
    const [, dd, mm, yyyy] = brMatch;
    return `${dd}-${mm}-${yyyy}`;
  }

  // Full ISO timestamp or date-time string
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    return `${pad2(parsed.getDate())}-${pad2(parsed.getMonth() + 1)}-${parsed.getFullYear()}`;
  }

  const isoPrefix = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoPrefix) {
    const [, yyyy, mm, dd] = isoPrefix;
    return `${dd}-${mm}-${yyyy}`;
  }

  return raw;
}

/**
 * Formats an ISO timestamp or Date as "DD-MM-YYYY HH:mm" (or with seconds).
 */
export function formatDateTimeBR(
  value?: string | Date | null,
  options?: { includeSeconds?: boolean; fallback?: string }
): string {
  const fallback = options?.fallback ?? '';
  if (!value) return fallback;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || /^\d{2}[-/]\d{2}[-/]\d{4}$/.test(trimmed)) {
      return formatDateBR(trimmed, fallback);
    }
  }

  const dt = value instanceof Date ? value : new Date(value);
  if (isNaN(dt.getTime())) {
    return formatDateBR(value, fallback);
  }

  const datePart = `${pad2(dt.getDate())}-${pad2(dt.getMonth() + 1)}-${dt.getFullYear()}`;
  const timePart = options?.includeSeconds
    ? `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`
    : `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;

  return `${datePart} ${timePart}`;
}

/**
 * Converts user-entered DD-MM-YYYY / DD/MM/YYYY or YYYY-MM-DD into canonical YYYY-MM-DD storage format.
 * Returns empty string if incomplete or invalid.
 */
export function parseBrDateToIso(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const br = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]);
    if (!isValidCalendarDate(year, month, day)) return '';
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (!isValidCalendarDate(year, month, day)) return '';
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  return '';
}

export function getLocalIsoDate(offsetDays = 0): string {
  const d = new Date();
  if (offsetDays !== 0) {
    d.setDate(d.getDate() + offsetDays);
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
