export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when the string is a real calendar date, not just YYYY-MM-DD shaped. */
export function isValidCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
