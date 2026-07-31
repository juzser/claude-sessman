/**
 * Parser for the ctime-style date strings produced by `ps -o lstart` and
 * stored verbatim in the session registry's `procStart` field, e.g.
 * "Fri Jul 31 02:11:55 2026".
 *
 * IMPORTANT (verified on the operator's machine, TZ=+07 "Indochina Time"):
 * the `procStart` field in ~/.claude/sessions/<pid>.json is rendered in
 * **UTC**, while a live `ps -o lstart` query on the very same machine
 * renders in **local** time. The two are not directly comparable as
 * strings, nor by naively feeding both through `new Date(str)` (which
 * treats an offset-less ctime string as local time in both cases). Always
 * pass the right `utc` flag: `{ utc: true }` for `procStart` values read
 * from the registry file, `{ utc: false }` for a freshly-queried live
 * `ps -o lstart` string.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// e.g. "Fri Jul 31 02:11:55 2026" or "Mon Jan  5 00:00:00 2026"
const CTIME_RE = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/;

export interface ParseCtimeOptions {
  /** Treat the string as UTC (registry `procStart`) vs local (live `ps` output). */
  utc: boolean;
}

export function parseCtime(input: string, options: ParseCtimeOptions): number | null {
  const match = CTIME_RE.exec(input.trim());
  if (!match) return null;

  const [, monthName, day, hour, minute, second, year] = match;
  const month = MONTHS.indexOf(monthName);
  if (month < 0) return null;

  const y = Number(year);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);

  const epoch = options.utc ? Date.UTC(y, month, d, h, mi, s) : new Date(y, month, d, h, mi, s).getTime();

  return Number.isNaN(epoch) ? null : epoch;
}
