/**
 * Earnings `time` (bmo / amc / null) and `timeExact` (ISO 8601 UTC), D11 + D48.
 * US market hours are 9:30–16:00 New York time; "bmo" = before 9:30, "amc" = from 16:00.
 * New York time is computed with Intl (America/New_York), so daylight saving time is handled
 * without a dependency.
 */

const NY = 'America/New_York';
const OPEN = 9 * 60 + 30; // minutes after midnight, ET
const CLOSE = 16 * 60;

/** Words that state the release time. "before market open", "after the close", "pre-market"… */
const BMO = /\b(before|prior to|ahead of) (the )?(u\.s\. )?(stock )?markets? (opens?|opening)\b|\bbefore (the )?(opening )?bell\b|\bpre-?market\b|\b(before|prior to) the open(ing)? of (the )?(trading|market)/i;
const AMC = /\bafter (the )?(u\.s\. )?(stock )?markets? (closes?|closed|closing)\b|\bafter (the )?(closing )?bell\b|\bafter the close\b|\bafter[- ]hours\b|\bpost-?market\b|\bafter the close of (the )?(trading|market)/i;

/** Timezones as written → an IANA zone (DST from the date) or a fixed offset in minutes. */
const ZONES = { et: NY, eastern: NY, 'eastern time': NY, ct: 'America/Chicago', central: 'America/Chicago', 'central time': 'America/Chicago',
  mt: 'America/Denver', pt: 'America/Los_Angeles', pacific: 'America/Los_Angeles', 'pacific time': 'America/Los_Angeles' };
const FIXED = { est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420, gmt: 0, utc: 0, bst: 60, cet: 60, cest: 120 };
const CLOCK = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?\s*\(?(eastern time|central time|pacific time|eastern|central|pacific|et|ct|mt|pt|est|edt|cst|cdt|mst|mdt|pst|pdt|gmt|utc|bst|cest|cet)\b/i;

/** Offset of `zone` from UTC, in minutes, at a UTC instant ("GMT-5" → -300). */
function zoneOffset(zone, utcMs) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName').value;
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/**
 * A UTC ISO time → the date and minutes after midnight in New York.
 * @param {string} iso
 * @returns {{ date: string, minutes: number }}
 */
export function etParts(iso) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso)).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const sideOfMarket = (minutes) => (minutes < OPEN ? 'bmo' : minutes >= CLOSE ? 'amc' : null);
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** "4:05 p.m. ET" → { minutes: 965, zone: "ET" }, or null. A time without a.m./p.m. needs "HH:MM" (24-hour). */
function parseClock(raw) {
  const m = raw.match(CLOCK);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ampm = m[3]?.toLowerCase().replace(/[.\s]/g, '');
  if (!ampm && m[2] === undefined) return null; // "3 ET" is not a time
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'pm' ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return { minutes: h * 60 + min, zone: m[4] };
}

/** Local wall time on `date` in `zone` → UTC ISO. */
function toUtc(date, minutes, zoneRaw) {
  const z = zoneRaw.toLowerCase();
  const [y, mo, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  if (z in FIXED) return new Date(wall - FIXED[z] * 60000).toISOString();
  // An IANA zone: guess with the offset at the wall time, then correct once (DST edges).
  let utc = wall - zoneOffset(ZONES[z], wall) * 60000;
  utc = wall - zoneOffset(ZONES[z], utc) * 60000;
  return new Date(utc).toISOString();
}

/**
 * The release time as written → { time, timeExact }.
 * - wording ("before the market opens") → bmo/amc;
 * - a clock time with a timezone + the proven results date → timeExact (UTC);
 * - with no wording, the clock time gives bmo/amc only for a US listing (D11).
 *
 * @param {string} raw e.g. "after market close", "4:05 p.m. ET"
 * @param {{ date?: string|null, usListing?: boolean }} ctx date = the proven earnings date (YYYY-MM-DD)
 * @returns {{ value: { time: string|null, timeExact: string|null }, rule: string } | { value: null, reason: string }}
 */
export function parseTime(raw, { date = null, usListing = false } = {}) {
  const word = BMO.test(raw) ? 'bmo' : AMC.test(raw) ? 'amc' : null;
  const clock = parseClock(raw);
  if (!word && !clock) return { value: null, reason: `no bmo/amc wording and no clock time with a timezone in "${raw}"` };

  const rules = [];
  if (word) rules.push(`wording → ${word}`);
  let timeExact = null;
  let time = word;
  if (clock) {
    if (date) {
      timeExact = toUtc(date, clock.minutes, clock.zone);
      rules.push(`${hhmm(clock.minutes)} ${clock.zone} on ${date} → ${timeExact}`);
    } else rules.push('timeExact null: no proven results date to put the clock time on');
    if (!time) {
      const et = timeExact ? etParts(timeExact).minutes : /^(et|eastern|eastern time|est|edt)$/i.test(clock.zone) ? clock.minutes : null;
      if (!usListing) rules.push('clock time not turned into bmo/amc: no proven US listing');
      else if (et === null) rules.push('clock time not turned into bmo/amc: no date to convert it to ET');
      else {
        time = sideOfMarket(et);
        rules.push(`${hhmm(et)} ET, US listing → ${time ?? 'null (during market hours)'}`);
      }
    }
  }
  if (!time && !timeExact) return { value: null, reason: rules.join('; ') };
  return { value: { time, timeExact }, rule: `parseTime: ${rules.join('; ')}` };
}

/**
 * D11 press-release rule: a company's own results release is the announcement, so its publish time
 * is the release time. The caller checks that it applies (press release, US listing, results reported today).
 * @param {string} publishedDate ISO UTC
 * @returns {{ value: string|null, rule: string }}
 */
export function timeFromPublishTime(publishedDate) {
  const { minutes } = etParts(publishedDate);
  const value = sideOfMarket(minutes);
  return { value, rule: `press release published ${hhmm(minutes)} ET → ${value ?? 'null (during market hours)'}` };
}
