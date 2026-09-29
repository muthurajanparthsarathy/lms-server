// utils/calendarGroups.js
//
// Program Calendar per group — which calendar a batch follows.
//
// DEGREE PROGRAM ONLY. Course Setup answers, for a degree course, whether the
// Program Calendar is the same for every section
// (`programCalendarByBatch.sameForAllBatches`) and, if not, which calendar SET
// each section — or each batch of a section — follows (`sets`, exactly as for
// resources: see utils/batchResources.js). Groups on one set share a
// calendar. Courses saved before sets said, per section (`perBatchSections`),
// whether its batches share one calendar or each get their own; a group no set
// covers still resolves that way. A course with a single section splits by its
// batches.
//
// Every other service is untouched: a course without sections keeps ONE
// calendar per course (and phase), whatever its per-batch setting says —
// there, choosing a batch on the calendar page stays a view selector, as it
// always was.
//
// A calendar is stored with a `groupKey` (see ProgramCalendarModel): "" for the
// common calendar, a set key ("set:1"), a batch id, or a section key
// ("section:a" — the same keys Resources by Batch uses). A group that has no
// calendar of its own yet FOLLOWS the one it had before — its batch's, its
// section's, then the common calendar — so switching a course to per-group
// calendars, or to sets, never leaves a batch with nothing.

const { sectionKey, sectionLabel } = require("./courseGroups");
const {
  listCourseBatches,
  courseSections,
  sectionContainerKey,
  isSectionTarget,
  isSetTarget,
  activeSets,
  setKeysForEntry,
  setTargetKeys,
  groupTargets,
} = require("./batchResources");

const COMMON = "";

const configOf = (course) => (course && course.programCalendarByBatch) || {};

/** Are this course's calendars kept per group at all? Only a degree course
 *  (one whose groups carry sections) that said "not the same". */
const calendarsArePerGroup = (course) =>
  configOf(course).sameForAllBatches === false && courseSections(course).size > 0;

/** Does this section give each of its batches its own calendar? */
const calendarSplitsByBatch = (course, sectionName, sections = courseSections(course)) => {
  if (!calendarsArePerGroup(course)) return false;
  const s = sections.get(sectionKey(sectionName));
  if (!s || s.batches.length < 2) return false;
  if (sections.size === 1) return true;
  return (configOf(course).perBatchSections || []).some((n) => sectionKey(n) === sectionKey(s.name));
};

/** The calendar sets in force for this course (none unless per group). */
const calendarSets = (course) => (calendarsArePerGroup(course) ? activeSets(configOf(course)) : []);

/**
 * The calendar groups the Program Calendar page offers, as `{ id, name }`:
 * each calendar set, and any group no set covers. Empty when the course keeps
 * one calendar — there is nothing to pick. A course on sets always offers
 * them, even a single one, so staff edit the calendar its students follow.
 */
const listCalendarTargets = (course) => {
  if (!calendarsArePerGroup(course)) return [];
  const sections = courseSections(course);
  const sets = calendarSets(course);
  const out = groupTargets(course, sets, (name) => calendarSplitsByBatch(course, name, sections))
    .filter((t) => t.id)
    .map((t) => ({ id: t.id, name: t.name }));
  if (sets.length && out.some((t) => isSetTarget(t.id))) return out;
  return out.length > 1 ? out : [];
};

/**
 * The calendars to try for a target (a batch id, a set or section key, or ""),
 * most specific first and always ending with the common one. For a batch this
 * is where its calendar lives — its set's, or before sets its own or its
 * section's — and what it follows until that exists.
 */
const calendarKeysFor = (course, target) => {
  if (!calendarsArePerGroup(course)) return [COMMON];
  const t = String(target || "").trim();
  if (!t) return [COMMON];
  const sets = calendarSets(course);
  if (isSetTarget(t)) return [...setTargetKeys(course, sets, t), COMMON];
  if (isSectionTarget(t)) return [t, COMMON];
  const entry = ((course && course.batchAndParticipants) || []).find((b) => String(b && b._id) === t);
  if (!entry) return [COMMON];
  const section = String(entry.section || "").trim();
  // A batch without a section is not a degree group: the common calendar.
  if (!section) return [COMMON];
  const onSet = setKeysForEntry(sets, entry);
  if (onSet) return [...onSet, COMMON];
  const sKey = sectionContainerKey(section);
  return calendarSplitsByBatch(course, section) ? [t, sKey, COMMON] : [sKey, COMMON];
};

/** Is this a group key a calendar may be SAVED under for this course? */
const isValidCalendarKey = (course, key) => {
  const k = String(key || "").trim();
  if (!k) return true;
  return listCalendarTargets(course).some((t) => t.id === k);
};

/** From a course's calendars, the one a target follows (or null). */
const pickCalendar = (calendars, keys) => {
  for (const key of keys) {
    const hit = (calendars || []).find((c) => String((c && c.groupKey) || "") === key);
    if (hit) return hit;
  }
  return null;
};

/** A display name for a calendar key — also for the older section and batch
 *  calendars a set follows until it has its own. */
const calendarKeyLabel = (course, key) => {
  if (!key) return "Common calendar";
  const offered = listCalendarTargets(course).find((t) => t.id === key);
  if (offered) return offered.name;
  if (isSectionTarget(key)) {
    const s = Array.from(courseSections(course).values()).find((x) => x.key === key);
    if (s) return sectionLabel(s.name);
  }
  return listCourseBatches(course).find((b) => b.id === key)?.name || key;
};

module.exports = {
  COMMON,
  calendarsArePerGroup,
  listCalendarTargets,
  calendarKeysFor,
  isValidCalendarKey,
  pickCalendar,
  calendarKeyLabel,
};
