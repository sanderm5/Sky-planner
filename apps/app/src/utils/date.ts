/**
 * Date utility functions
 * Handles Norwegian timezone and date calculations
 */

/**
 * Gets current date/time in Norwegian timezone
 */
export function getNorwegianDate(): Date {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value || '0';

  return new Date(
    Number.parseInt(get('year'), 10),
    Number.parseInt(get('month'), 10) - 1,
    Number.parseInt(get('day'), 10),
    Number.parseInt(get('hour'), 10),
    Number.parseInt(get('minute'), 10),
    Number.parseInt(get('second'), 10)
  );
}

/**
 * Gets today's date at midnight in Norwegian timezone
 */
export function getNorwegianToday(): Date {
  const now = getNorwegianDate();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Formats a date to YYYY-MM-DD string
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Adds an interval to a date.
 * Positive values = months, negative values = days (e.g. -7 = 1 week)
 * Handles month overflow correctly: Jan 31 + 1 month = Feb 28 (not Mar 3)
 */
export function addMonthsToDate(dateStr: string, interval: number): string {
  const date = new Date(dateStr);

  if (interval < 0) {
    // Negative = days
    date.setDate(date.getDate() + Math.abs(interval));
  } else {
    // Positive = months
    const day = date.getDate();
    date.setMonth(date.getMonth() + interval);
    if (date.getDate() !== day) {
      date.setDate(0);
    }
  }

  return formatDate(date);
}

/**
 * Calculates the difference in days between two dates
 */
export function daysBetween(date1: Date | string, date2: Date | string): number {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;

  const diffTime = d2.getTime() - d1.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Checks if a date is in the past
 */
export function isPastDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  const today = getNorwegianToday();
  return date < today;
}

/**
 * Checks if a date is within N days from now
 */
export function isWithinDays(dateStr: string, days: number): boolean {
  const date = new Date(dateStr);
  const today = getNorwegianToday();
  const future = new Date(today);
  future.setDate(future.getDate() + days);

  return date >= today && date <= future;
}

/**
 * Gets Norwegian datetime string for database
 */
export function getNorwegianDateTimeString(): string {
  const date = getNorwegianDate();
  return date.toISOString().replace('T', ' ').substring(0, 19);
}
