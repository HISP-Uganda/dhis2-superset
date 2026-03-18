/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * DHIS2 Period Format Utilities
 *
 * Converts DHIS2 period identifiers (ISO-ish codes) to human-readable labels.
 *
 * Reference:
 *   https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/introduction.html#webapi_date_perid_format
 *
 * Supported period types and their codes:
 *
 *   Daily            yyyyMMdd           20250101  → 1 January 2025
 *   Weekly (Mon)     yyyyWnn            2025W1    → Week 1, 2025
 *   Weekly Wed       yyyyWedWnn         2025WedW1 → Wednesday Week 1, 2025
 *   Weekly Thu       yyyyThuWnn         2025ThuW1 → Thursday Week 1, 2025
 *   Weekly Sat       yyyySatWnn         2025SatW1 → Saturday Week 1, 2025
 *   Weekly Sun       yyyySunWnn         2025SunW1 → Sunday Week 1, 2025
 *   Bi-weekly        yyyyBiWnn          2025BiW1  → Bi-week 1, 2025
 *   Monthly          yyyyMM             202501    → January 2025
 *   Bi-monthly       yyyyMMB            202501B   → January – February 2025
 *   Quarterly        yyyyQn             2025Q1    → January – March 2025
 *   Quarterly Apr    yyyyAprilQn        2025AprilQ1 → April – June 2025
 *   Quarterly Jul    yyyyJulyQn         2025JulyQ1  → July – September 2025
 *   Quarterly Oct    yyyyOctQn          2025OctQ1   → October – December 2025
 *   Six-monthly      yyyySn             2025S1    → January – June 2025
 *   Six-monthly Apr  yyyyAprilSn        2025AprilS1 → April – September 2025
 *   Six-monthly Nov  yyyyNovSn          2025NovS1   → November 2025 – April 2026
 *   Yearly           yyyy               2025      → 2025
 *   Financial Apr    yyyyApril          2025April → April 2025 – March 2026
 *   Financial Jul    yyyyJuly           2025July  → July 2025 – June 2026
 *   Financial Oct    yyyyOct            2025Oct   → October 2025 – September 2026
 *   Financial Nov    yyyyNov            2025Nov   → November 2025 – October 2026
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Short month abbreviations used in range labels. */
const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Build a human-readable month range like "January – March 2025" or
 * "November 2025 – April 2026" when the range wraps into the next year.
 *
 * @param startMonth  0-based start month index (0 = January).  May be ≥ 12
 *                    when a period type starts mid-year and the requested
 *                    period number pushes it beyond December — the function
 *                    normalises automatically.
 * @param count       Number of months in the range
 * @param year        Calendar year of the (un-normalised) start month
 * @param useShort    Use abbreviated month names (e.g. "Jan")
 */
function monthRange(
  startMonth: number,
  count: number,
  year: number,
  useShort = false,
): string {
  const names = useShort ? MONTHS_SHORT : MONTHS;

  // Normalise start month: startMonth may be ≥ 12 when e.g. OctQ2 gives 9+3=12
  const normStartYear = year + Math.floor(startMonth / 12);
  const normStartMonth = ((startMonth % 12) + 12) % 12;

  const endMonthAbs = normStartMonth + count - 1;
  const endMonth = endMonthAbs % 12;
  const endYear = normStartYear + Math.floor(endMonthAbs / 12);

  const startLabel = names[normStartMonth];
  const endLabel = names[endMonth];

  if (normStartYear === endYear) {
    return `${startLabel} – ${endLabel} ${normStartYear}`;
  }
  return `${startLabel} ${normStartYear} – ${endLabel} ${endYear}`;
}

/**
 * Convert a DHIS2 period identifier to a human-readable label.
 *
 * Returns the original string unchanged when the format is not recognised
 * so it is always safe to call.
 *
 * @example
 *   formatDHIS2Period('202501')      // "January 2025"
 *   formatDHIS2Period('2025Q1')      // "January – March 2025"
 *   formatDHIS2Period('2025S1')      // "January – June 2025"
 *   formatDHIS2Period('2025')        // "2025"
 *   formatDHIS2Period('2025April')   // "April 2025 – March 2026"
 *   formatDHIS2Period('20250115')    // "15 January 2025"
 *   formatDHIS2Period('2025W3')      // "Week 3, 2025"
 */
export function formatDHIS2Period(period: string): string {
  if (!period || typeof period !== 'string') return period;
  const s = period.trim();

  // ------------------------------------------------------------------
  // Daily: yyyyMMdd  (exactly 8 digits)
  // ------------------------------------------------------------------
  const daily = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (daily) {
    const [, y, m, d] = daily;
    const monthIdx = parseInt(m, 10) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${parseInt(d, 10)} ${MONTHS[monthIdx]} ${y}`;
    }
  }

  // ------------------------------------------------------------------
  // Monthly: yyyyMM  (exactly 6 digits, month 01–12)
  // ------------------------------------------------------------------
  const monthly = s.match(/^(\d{4})(0[1-9]|1[0-2])$/);
  if (monthly) {
    const [, y, m] = monthly;
    return `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
  }

  // ------------------------------------------------------------------
  // Bi-monthly: yyyyMMB  (two-month blocks starting at odd months: 01,03,05…)
  // ------------------------------------------------------------------
  const bimonthly = s.match(/^(\d{4})(0[1-9]|1[0-2])B$/);
  if (bimonthly) {
    const [, y, m] = bimonthly;
    const startMonth = parseInt(m, 10) - 1;
    return monthRange(startMonth, 2, parseInt(y, 10));
  }

  // ------------------------------------------------------------------
  // Quarterly April: yyyyAprilQn  (must be checked before plain yyyyQn)
  // ------------------------------------------------------------------
  const qApril = s.match(/^(\d{4})AprilQ([1-4])$/);
  if (qApril) {
    const [, y, q] = qApril;
    const startMonth = 3 + (parseInt(q, 10) - 1) * 3; // 3 = April (0-based)
    return monthRange(startMonth, 3, parseInt(y, 10));
  }

  // Quarterly July
  const qJuly = s.match(/^(\d{4})JulyQ([1-4])$/);
  if (qJuly) {
    const [, y, q] = qJuly;
    const startMonth = 6 + (parseInt(q, 10) - 1) * 3;
    return monthRange(startMonth, 3, parseInt(y, 10));
  }

  // Quarterly October
  const qOct = s.match(/^(\d{4})OctQ([1-4])$/);
  if (qOct) {
    const [, y, q] = qOct;
    const startMonth = 9 + (parseInt(q, 10) - 1) * 3;
    return monthRange(startMonth, 3, parseInt(y, 10));
  }

  // Quarterly (standard Jan-based): yyyyQn
  const quarterly = s.match(/^(\d{4})Q([1-4])$/);
  if (quarterly) {
    const [, y, q] = quarterly;
    const startMonth = (parseInt(q, 10) - 1) * 3;
    return monthRange(startMonth, 3, parseInt(y, 10));
  }

  // ------------------------------------------------------------------
  // Six-monthly April: yyyyAprilSn  (must be before plain yyyySn)
  // ------------------------------------------------------------------
  const smApril = s.match(/^(\d{4})AprilS([12])$/);
  if (smApril) {
    const [, y, sn] = smApril;
    const startMonth = 3 + (parseInt(sn, 10) - 1) * 6;
    return monthRange(startMonth, 6, parseInt(y, 10));
  }

  // Six-monthly November
  const smNov = s.match(/^(\d{4})NovS([12])$/);
  if (smNov) {
    const [, y, sn] = smNov;
    const startMonth = 10 + (parseInt(sn, 10) - 1) * 6;
    return monthRange(startMonth, 6, parseInt(y, 10));
  }

  // Six-monthly (standard Jan-based): yyyySn
  const sixmonthly = s.match(/^(\d{4})S([12])$/);
  if (sixmonthly) {
    const [, y, sn] = sixmonthly;
    const startMonth = (parseInt(sn, 10) - 1) * 6;
    return monthRange(startMonth, 6, parseInt(y, 10));
  }

  // ------------------------------------------------------------------
  // Financial years  (must be before bare yyyy match)
  // ------------------------------------------------------------------
  const finApril = s.match(/^(\d{4})April$/);
  if (finApril) {
    const y = parseInt(finApril[1], 10);
    return `April ${y} – March ${y + 1}`;
  }

  const finJuly = s.match(/^(\d{4})July$/);
  if (finJuly) {
    const y = parseInt(finJuly[1], 10);
    return `July ${y} – June ${y + 1}`;
  }

  const finOct = s.match(/^(\d{4})Oct$/);
  if (finOct) {
    const y = parseInt(finOct[1], 10);
    return `October ${y} – September ${y + 1}`;
  }

  const finNov = s.match(/^(\d{4})Nov$/);
  if (finNov) {
    const y = parseInt(finNov[1], 10);
    return `November ${y} – October ${y + 1}`;
  }

  // ------------------------------------------------------------------
  // Yearly: yyyy  (exactly 4 digits — checked after all yyyy-prefixed ones)
  // ------------------------------------------------------------------
  if (/^\d{4}$/.test(s)) {
    return s; // "2025" is already human-readable
  }

  // ------------------------------------------------------------------
  // Weekly variants  (Wed/Thu/Sat/Sun first, then plain, then bi-weekly)
  // ------------------------------------------------------------------
  const weeklyVariant = s.match(/^(\d{4})(Wed|Thu|Sat|Sun)W(\d{1,2})$/);
  if (weeklyVariant) {
    const [, y, day, w] = weeklyVariant;
    const dayNames: Record<string, string> = {
      Wed: 'Wednesday',
      Thu: 'Thursday',
      Sat: 'Saturday',
      Sun: 'Sunday',
    };
    return `${dayNames[day]} Week ${parseInt(w, 10)}, ${y}`;
  }

  const biweekly = s.match(/^(\d{4})BiW(\d{1,2})$/);
  if (biweekly) {
    const [, y, w] = biweekly;
    return `Bi-week ${parseInt(w, 10)}, ${y}`;
  }

  const weekly = s.match(/^(\d{4})W(\d{1,2})$/);
  if (weekly) {
    const [, y, w] = weekly;
    return `Week ${parseInt(w, 10)}, ${y}`;
  }

  // ------------------------------------------------------------------
  // Unknown format — return as-is so it's always safe to call
  // ------------------------------------------------------------------
  return s;
}

/**
 * Return true when the string looks like any recognised DHIS2 period code.
 * Useful to auto-detect period columns when the metadata flag is absent.
 */
export function isDHIS2Period(value: string): boolean {
  return formatDHIS2Period(value) !== value;
}

/**
 * Build an Ant Design Select option label for a DHIS2 period value.
 *
 * Shows the human-readable label followed by the raw code in parentheses
 * so users can recognise both forms:
 *
 *   "January 2025  (202501)"
 *   "January – March 2025  (2025Q1)"
 *   "2025"  ← yearly stays as-is (no duplication)
 */
export function periodSelectLabel(raw: string): string {
  const label = formatDHIS2Period(raw);
  // Avoid "2025  (2025)"
  if (label === raw) return raw;
  return `${label}  (${raw})`;
}
