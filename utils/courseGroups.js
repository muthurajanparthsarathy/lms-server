// utils/courseGroups.js
//
// Degree Program student groups on a course.
//
// A Degree Program mapping keeps its courses per department + semester
// ("BE ▸ Civil ▸ 1") and, separately, how that department's students are split
// in that semester: sections, each optionally split into batches
// (`mapping.studentGroups`). A course therefore runs for every section/batch of
// its department + semester, and each one becomes an ENROLMENT GROUP on the
// course — an entry in `batchAndParticipants` carrying its `section`:
//
//   Section A: Batch 1, Batch 2   →  "Section A · Batch 1", "Section A · Batch 2"
//   Section B: (no batches)       →  "Section B"
//
// Each group's entry is NAMED IN FULL ("Section A · Batch 1") and also carries
// its `section`. "Batch 1" of A and of B are different students, and the whole
// enrolment path — drafts, pickers, save, the one-batch-per-student rule —
// identifies a batch by (phase, batchName). Full names keep that identity
// unique without teaching every one of those places about sections, and every
// screen that prints `batchName` shows which section a batch belongs to.
// Content and calendars are keyed by the entry's _id, so a rename moves
// nothing.
//
// Every other service has no sections: their batches carry section "" and
// nothing here applies to them.
//
// Mirrored on the client in app/lms/shared/courseGroups.ts; keep the two in
// step.

const PATH_SEP = " ▸ ";

const clean = (v) => String(v == null ? "" : v).trim();
const norm = (v) => clean(v).toLowerCase();
const parts = (path) => clean(path).split(PATH_SEP).map(clean).filter(Boolean);

/** "A" → "Section A"; a name that already says "Section …" is left alone. */
const sectionLabel = (name) => (/^section\s/i.test(clean(name)) ? clean(name) : `Section ${clean(name)}`);

/** Compare section names ignoring case and a leading "Section". */
const sectionKey = (name) => norm(name).replace(/^section\s+/, "");

const uniq = (list) => {
  const seen = new Set();
  return list.filter((v) => {
    const k = norm(v);
    if (!v || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * The sections (and their batches) a degree course runs for, read from its
 * mapping. `coursePath` is the course's place in the mapping:
 *
 *   "BE ▸ Civil ▸ 1"       — the department + semester: every section of it
 *   "BE ▸ Civil ▸ A ▸ 1"   — an older mapping that put the course on one
 *                            section: that section only
 *
 * Anything shorter is not a degree placement (a phase, or a flat course) and
 * has no sections. Mappings saved before student groups existed name their
 * sections in masterData ("Section", grouped by "Degree ▸ Department"); those
 * are read as sections without batches, the same fallback the Service Mapping
 * wizard uses when it loads one.
 */
function sectionGroupsForCourse(mapping, coursePath) {
  const p = parts(coursePath);
  if (!mapping || p.length < 3) return [];
  const [degree, department] = p;
  const semester = p[p.length - 1];
  const onlySection = p.length >= 4 ? p[2] : null;

  const groupPath = [degree, department, semester].join(PATH_SEP);
  const stored = (mapping.studentGroups || []).find((g) => norm(g && g.path) === norm(groupPath));

  let sections;
  if (stored) {
    sections = (stored.sections || []).map((s) => ({
      section: clean(s && s.name),
      batches: uniq((s && s.batches ? s.batches : []).map(clean)),
    }));
  } else {
    const entry = (mapping.masterData || []).find(
      (m) => m && norm(m.level) === "section" && norm(m.group) === norm([degree, department].join(PATH_SEP))
    );
    sections = uniq(((entry && entry.values) || []).map(clean)).map((name) => ({ section: name, batches: [] }));
  }

  const seen = new Set();
  sections = sections.filter((s) => {
    const k = sectionKey(s.section);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (onlySection) {
    const hit = sections.find((s) => sectionKey(s.section) === sectionKey(onlySection));
    return [hit || { section: onlySection, batches: [] }];
  }
  return sections;
}

/** Every enrolment group those sections make: one per batch, or the section
 *  itself when it has none. `batch` is the batch's own name ("" for a whole
 *  section); `batchName` is the full name the entry is stored under. */
const groupsFromSections = (sections) =>
  (sections || []).flatMap((s) =>
    s.batches && s.batches.length
      ? s.batches.map((b) => ({ section: s.section, batch: b, batchName: `${sectionLabel(s.section)} · ${b}` }))
      : [{ section: s.section, batch: "", batchName: sectionLabel(s.section) }]
  );

/** A group's display name: "Section A · Batch 1", "Section B", or — for a
 *  batch with no section (every other service) — the batch name itself. An
 *  entry already stored under its full name is returned as it is. */
const groupLabel = (b) => {
  const section = clean(b && b.section);
  const name = clean(b && b.batchName);
  if (!section) return name;
  const prefix = sectionLabel(section);
  if (!name || norm(name) === norm(prefix)) return prefix;
  if (norm(name).startsWith(`${norm(prefix)} · `)) return name;
  return `${prefix} · ${name}`;
};

/** A group's own batch name — "Batch 1" of "Section A · Batch 1" — or ""
 *  for a whole section. A batch with no section is its own name. */
const groupBatchPart = (b) => {
  const section = clean(b && b.section);
  const name = clean(b && b.batchName);
  if (!section) return name;
  const prefix = sectionLabel(section);
  if (!name || norm(name) === norm(prefix)) return "";
  if (norm(name).startsWith(`${norm(prefix)} · `)) return clean(name.slice(prefix.length + 3));
  return name;
};

/** The key two batch entries are the same group by — their full name within
 *  a phase, so an entry stored as "Batch 1" in Section A and one stored as
 *  "Section A · Batch 1" are recognised as the same group. */
const groupKey = (phase, section, batchName) =>
  `${norm(phase)}::${norm(groupLabel({ section, batchName }))}`;

/**
 * Bring a course's enrolment groups in line with `sections`.
 *
 *   • a group the course lacks is created (empty);
 *   • an entry saved before sections existed — no section, no phase — whose
 *     name is exactly ONE wanted group's batch name is claimed by that group,
 *     so students already enrolled in it are not stranded in a batch no tab
 *     shows any more (the same adoption getCourseBatches does for phases);
 *   • a group the mapping no longer has is ARCHIVED, never deleted: its
 *     enrolments and uploads stay, it just stops being offered. It comes back
 *     if the mapping lists it again. Only groups this sync archived are
 *     restored — one a person archived by hand stays archived.
 *
 * Mutates `course.batchAndParticipants` in place and returns true when it
 * changed anything, so the caller decides whether to save.
 */
function syncSectionGroups(course, sections, createdBy) {
  if (!course) return false;
  if (!Array.isArray(course.batchAndParticipants)) course.batchAndParticipants = [];
  const entries = course.batchAndParticipants;
  const wanted = groupsFromSections(sections);
  const keyOf = (b) => groupKey(b.phase, b.section, b.batchName);
  let mutated = false;

  for (const b of entries) {
    if (clean(b.phase)) continue;
    if (clean(b.section)) {
      // A group stored under its bare batch name (as the first version of this
      // sync did) takes its full name.
      const full = groupLabel(b);
      if (full !== clean(b.batchName)) {
        b.batchName = full;
        mutated = true;
      }
      continue;
    }
    // An entry saved before sections existed, named by its bare batch name
    // ("Batch 2") or already by a group's full name.
    const claims = wanted.filter(
      (w) => norm(w.batchName) === norm(b.batchName) || (w.batch && norm(w.batch) === norm(b.batchName))
    );
    if (claims.length !== 1) continue;
    const target = groupKey("", claims[0].section, claims[0].batchName);
    if (entries.some((e) => e !== b && keyOf(e) === target)) continue;
    b.section = claims[0].section;
    b.batchName = claims[0].batchName;
    mutated = true;
  }

  const present = new Set(entries.map(keyOf));
  for (const w of wanted) {
    if (present.has(groupKey("", w.section, w.batchName))) continue;
    entries.push({
      batchName: w.batchName,
      section: w.section,
      phase: "",
      batchDescription: "",
      batchStartDate: null,
      batchEndDate: null,
      status: "active",
      users: [],
      ...(createdBy ? { createdBy } : {}),
    });
    mutated = true;
  }

  const wantedKeys = new Set(wanted.map((w) => groupKey("", w.section, w.batchName)));
  for (const b of entries) {
    if (!clean(b.section)) continue;
    if (wantedKeys.has(keyOf(b))) {
      if (b.status === "archived" && b.archivedBySync) {
        b.status = "active";
        b.archivedBySync = false;
        mutated = true;
      }
    } else if (b.status !== "archived") {
      b.status = "archived";
      b.archivedBySync = true;
      mutated = true;
    }
  }

  // The course's own department list feeds the enrolment Sections page, which
  // reads it off the record. A course set up at department level stored no
  // sections there, so they are filled in from the groups.
  const department = parts(course.coursePath)[1];
  const names = uniq((sections || []).map((s) => s.section));
  if (department && names.length) {
    if (!Array.isArray(course.departmentSections)) course.departmentSections = [];
    let dept = course.departmentSections.find((d) => norm(d && d.department) === norm(department));
    if (!dept) {
      course.departmentSections.push({ department, sections: [], semesters: [] });
      dept = course.departmentSections[course.departmentSections.length - 1];
      mutated = true;
    }
    const have = new Set((dept.sections || []).map(sectionKey));
    const missing = names.filter((n) => !have.has(sectionKey(n)));
    if (missing.length) {
      dept.sections = [...(dept.sections || []), ...missing];
      mutated = true;
    }
  }

  return mutated;
}

/**
 * Should this course take its groups from sections? Only a degree course
 * (its path names a department + semester) that has no batch list of its own:
 * an older course that carries its own batches keeps them as its groups.
 */
const usesSectionGroups = (course) =>
  parts(course && course.coursePath).length >= 3 && !((course && course.batches) || []).some((b) => clean(b));

module.exports = {
  syncSectionGroups,
  usesSectionGroups,
  PATH_SEP,
  sectionLabel,
  sectionKey,
  sectionGroupsForCourse,
  groupsFromSections,
  groupLabel,
  groupBatchPart,
  groupKey,
};
