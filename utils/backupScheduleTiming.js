// utils/backupScheduleTiming.js
//
// When does a schedule fire next?
//
// Kept separate from the model and the cron runner because this is the only
// part with real edge cases — month ends, DST, "every 2 days" being relative
// rather than absolute — and it is pure, so it can be reasoned about and
// tested without a database or a clock.
//
// Everything is computed in the SERVER's local timezone, which is what the
// admin sees in the picker. `time` is a wall-clock "HH:mm".

const FREQUENCIES = ["daily", "every2days", "weekly", "monthly"];

/** "HH:mm" -> { hours, minutes }; falls back to 02:00 on anything malformed. */
function parseTime(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || "").trim());
  if (!match) return { hours: 2, minutes: 0 };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23) return { hours: 2, minutes: 0 };
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return { hours: 2, minutes: 0 };
  return { hours, minutes };
}

const atTime = (date, hours, minutes) => {
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

/** Days in the month `date` falls in. */
const daysInMonth = (date) =>
  new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

/**
 * The next time this schedule should run, strictly AFTER `from`.
 *
 * @param {object} schedule  { frequency, time, dayOfWeek, dayOfMonth }
 * @param {Date}   from      the moment to search forward from (usually now,
 *                           or the run that just finished)
 */
function computeNextRunAt(schedule, from) {
  const { hours, minutes } = parseTime(schedule.time);
  const base = from instanceof Date && !Number.isNaN(from.getTime()) ? from : new Date();
  const frequency = FREQUENCIES.includes(schedule.frequency) ? schedule.frequency : "daily";

  if (frequency === "daily") {
    const today = atTime(base, hours, minutes);
    return today > base ? today : atTime(addDays(base, 1), hours, minutes);
  }

  if (frequency === "every2days") {
    // Relative to `from`, which the runner passes as the last run — that is
    // what makes the gap two days rather than "even-numbered dates", where
    // the 31st→1st rollover would produce two runs on consecutive days.
    const today = atTime(base, hours, minutes);
    return today > base ? today : atTime(addDays(base, 2), hours, minutes);
  }

  if (frequency === "weekly") {
    const target = Number.isInteger(schedule.dayOfWeek) ? schedule.dayOfWeek : 1;
    let delta = (target - base.getDay() + 7) % 7;
    let candidate = atTime(addDays(base, delta), hours, minutes);
    // Same weekday but the time has already passed today -> next week.
    if (candidate <= base) candidate = atTime(addDays(candidate, 7), hours, minutes);
    return candidate;
  }

  // monthly
  const wanted = Number.isInteger(schedule.dayOfMonth) ? schedule.dayOfMonth : 1;
  const build = (year, month) => {
    // Clamp so "the 31st" still fires in a 30-day month (and in February)
    // rather than rolling into the next month, which is what a raw
    // setDate(31) would do.
    const lastDay = new Date(year, month + 1, 0).getDate();
    const day = Math.min(wanted, lastDay);
    const next = new Date(year, month, day);
    return atTime(next, hours, minutes);
  };

  const thisMonth = build(base.getFullYear(), base.getMonth());
  if (thisMonth > base) return thisMonth;
  return build(base.getFullYear(), base.getMonth() + 1);
}

/** Human summary for the overview card, e.g. "Weekly · Monday · 02:00". */
function describeSchedule(schedule) {
  if (!schedule || !schedule.enabled) return "Not scheduled";
  const { hours, minutes } = parseTime(schedule.time);
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  switch (schedule.frequency) {
    case "every2days":
      return `Every 2 days · ${clock}`;
    case "weekly":
      return `Weekly · ${days[schedule.dayOfWeek ?? 1]} · ${clock}`;
    case "monthly": {
      const day = schedule.dayOfMonth ?? 1;
      const suffix =
        day % 10 === 1 && day !== 11
          ? "st"
          : day % 10 === 2 && day !== 12
            ? "nd"
            : day % 10 === 3 && day !== 13
              ? "rd"
              : "th";
      return `Monthly · ${day}${suffix} · ${clock}`;
    }
    default:
      return `Daily · ${clock}`;
  }
}

module.exports = {
  FREQUENCIES,
  parseTime,
  computeNextRunAt,
  describeSchedule,
  daysInMonth,
};
