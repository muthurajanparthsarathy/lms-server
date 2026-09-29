// utils/batchResources.js
//
// Resources by Batch — the single place that decides WHERE a course's I Do /
// We Do / You Do material lives, and WHICH slice of it a given caller may see.
//
// ── The three scenarios ──────────────────────────────────────────────────────
//   1. Course WITHOUT batches            → course-level resources only.
//   2. Course WITH batches, shared       → one set, every batch sees it.
//   3. Course WITH batches, batch-wise   → one set per batch, per element.
//
// ── How it is stored ─────────────────────────────────────────────────────────
// The batch is its own level of the hierarchy, holding a complete I_Do /
// We_Do / You_Do set inside it:
//
//   node
//     ├── pedagogy                ← course-level / shared  (scenarios 1 & 2)
//     │     ├── I_Do   ├── We_Do   └── You_Do
//     └── batchPedagogy
//           ├── <batchId>         ← Batch A                (scenario 3)
//           │     ├── I_Do   ├── We_Do   └── You_Do
//           └── <batchId>         ← Batch B
//                 ├── I_Do   ├── We_Do   └── You_Do
//
// Batches are keyed by `_id` (from `Course-Structure.batchAndParticipants`),
// never by name — renaming a batch must not orphan its material.
//
// Two consequences worth stating, because everything else follows from them:
//
//   • `pedagogy` is untouched by this feature. Every course that exists today
//     keeps its material exactly where it was and keeps behaving as
//     course-level/shared, with nothing migrated. Only an element explicitly
//     ticked batch-wise in Course Setup ever reads or writes `batchPedagogy`.
//
//   • Callers never assemble paths themselves. Writes pick a container through
//     `resolvePedagogyTarget`; reads flatten one batch's container back onto
//     the plain `pedagogy` shape through `scopeNodePedagogy`, which also DROPS
//     `batchPedagogy` from the response — that is what keeps Batch B's
//     material out of a Batch A student's payload entirely, rather than merely
//     unrendered.

const { groupKey, groupLabel, groupBatchPart, sectionKey, sectionLabel } = require("./courseGroups");

const SECTIONS = ["I_Do", "We_Do", "You_Do"];

/** Normalizes a Map / Mongoose Map / plain object to entries. */
const toEntries = (map) => {
  if (!map) return [];
  if (map instanceof Map) return Array.from(map.entries());
  if (typeof map.toObject === "function") return Object.entries(map.toObject());
  return Object.entries(map);
};

/** Reads one key out of a Map or plain object. */
const mapGet = (map, key) => {
  if (!map) return undefined;
  if (typeof map.get === "function") return map.get(key);
  return map[key];
};

/**
 * Every batch on this course, as `{ id, name }`.
 *
 * Mirrors `getCourseBatches` in courseStructure.js: `batchAndParticipants` is
 * the truth once it exists, but a course mapped with batches whose Batches
 * page was never opened has only the picked NAMES and no containers yet.
 * Those are surfaced with a null id — they can be displayed and enrolled
 * into, but nothing can be filed under them until the container exists, which
 * `getCourseBatches` creates on first visit.
 */
const listCourseBatches = (course) => {
  if (!course) return [];

  const out = [];
  const seen = new Set();

  // Keyed by the whole group, not the bare name: a degree course's "Batch 1"
  // of Section A and of Section B are different groups, and `name` is the
  // label that says which ("Section A · Batch 1"). For every other service the
  // section is empty and this is the batch name, exactly as before. A group
  // the mapping sync archived is no longer in use and is not offered.
  for (const b of course.batchAndParticipants || []) {
    const raw = String(b?.batchName || "").trim();
    if (!raw || b?.archivedBySync) continue;
    // Only a sectioned entry keys on its section; every other batch keeps the
    // by-name de-duplication it always had.
    const key = String(b?.section || "").trim() ? groupKey("", b.section, raw) : raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: b?._id ? String(b._id) : null, name: groupLabel(b), section: String(b?.section || "") });
  }
  const seenNames = new Set(out.map((b) => b.name.toLowerCase()));

  for (const raw of [course.batch, ...(course.skillingBatches || []), ...(course.batches || [])]) {
    const name = String(raw || "").trim();
    if (!name || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());
    out.push({ id: null, name, section: "" });
  }

  return out;
};

const listCourseBatchNames = (course) => listCourseBatches(course).map((b) => b.name);

/** Scenario 1 hinges on this: does the course run in batches at all? */
const courseUsesBatches = (course) => listCourseBatches(course).length > 0;

// ── Degree Program: the section level ───────────────────────────────────────
// A degree course's groups are sections, each optionally split into batches
// (utils/courseGroups.js). Course Setup decides, per section, whether a
// batch-wise element keeps ONE set for the whole section or one set per batch
// (`batchResources.perBatchSections`). So besides a batch's own container
// (`batchPedagogy.<batchId>`) there is a section's:
//
//   batchPedagogy
//     ├── <batchId>           ← Section A · Batch 1   (A splits per batch)
//     ├── <batchId>           ← Section A · Batch 2
//     └── section:b           ← Section B, all its batches
//
// Reading walks from the most specific container to the least — batch, then
// section, then shared — and takes the first that has anything for the
// element. That is what makes the agreed rules hold without migrations:
//   • a batch added later, or a section switched from "same" to "different",
//     starts out showing its section's (or the shared) material;
//   • a section switched back to "same" reads its section container only, so
//     the per-batch material is hidden, never deleted.
// Every other service has no sections, and resolves exactly as before.

const SECTION_TARGET_PREFIX = "section:";

/** The container key for a section's own material. Map keys may not hold
 *  "." or "$", and whitespace is normalised so "Section A" and "A" agree. */
const sectionContainerKey = (name) =>
  SECTION_TARGET_PREFIX + sectionKey(name).replace(/[.$\s]+/g, "_");

const isSectionTarget = (value) => String(value || "").startsWith(SECTION_TARGET_PREFIX);

/** The course's sections, from its (non-archived) sectioned groups, in order. */
const courseSections = (course) => {
  const map = new Map();
  for (const b of course?.batchAndParticipants || []) {
    const name = String(b?.section || "").trim();
    if (!name || b?.archivedBySync) continue;
    const k = sectionKey(name);
    if (!map.has(k)) map.set(k, { name, key: sectionContainerKey(name), batches: [] });
    if (b?._id) map.get(k).batches.push(b);
  }
  return map;
};

/**
 * Does this section keep one set of batch-wise material PER BATCH? Only when
 * resources differ at all, the section has more than one batch to split, and
 * Course Setup said so — or it is the course's only section, where "not the
 * same" can only mean its batches differ.
 */
const sectionSplitsByBatch = (course, sectionName, sections = courseSections(course)) => {
  const cfg = course?.batchResources || {};
  if (cfg.sameForAllBatches !== false) return false;
  const s = sections.get(sectionKey(sectionName));
  if (!s || s.batches.length < 2) return false;
  if (sections.size === 1) return true;
  return (cfg.perBatchSections || []).some((n) => sectionKey(n) === sectionKey(s.name));
};

// ── Degree Program: content sets ────────────────────────────────────────────
// Course Setup may put sections — or single batches of a section — on shared
// SETS (`batchResources.sets`: [{ section, batch, set }], batch "" for a whole
// section): Sections A and B on Set 1, Section C's Batch 1 and Batch 2 on Set
// 2, its Batch 3 on Set 3. Every group on a set reads and writes ONE
// container, `batchPedagogy["set:<n>"]`.
//
//   batchPedagogy
//     ├── set:1               ← Section A, Section B
//     ├── set:2               ← Section C · Batch 1, Section C · Batch 2
//     └── set:3               ← Section C · Batch 3
//
// Until a set has material of its own for an element, each of its groups
// keeps showing what it showed before sets — its batch's container (if its
// section was split), then its section's — so moving to sets never blanks a
// screen. A group no set lists (a section or batch added in Service Mapping
// since the last save) resolves exactly as it did before sets. A set's number
// never changes, so its material stays put when groups join or leave it.
// Program Calendars use the same assignments, from their own config
// (utils/calendarGroups.js).

const SET_TARGET_PREFIX = "set:";

const setContainerKey = (set) => SET_TARGET_PREFIX + String(set).trim().replace(/[.$\s]+/g, "_");

const isSetTarget = (value) => String(value || "").startsWith(SET_TARGET_PREFIX);

/** A config's set assignments — none unless it says "not the same". */
const activeSets = (cfg) =>
  cfg && cfg.sameForAllBatches === false && Array.isArray(cfg.sets)
    ? cfg.sets.filter((a) => a && String(a.section || "").trim() && String(a.set || "").trim())
    : [];

/**
 * The set a group entry is on: its own batch's assignment, else its whole
 * section's. `split` says which, and so which older containers the group
 * falls back to. null when no assignment covers the entry.
 */
const setOfEntry = (sets, entry) => {
  const section = String(entry?.section || "").trim();
  if (!section || !sets.length) return null;
  const mine = sets.filter((a) => sectionKey(a.section) === sectionKey(section));
  const part = groupBatchPart(entry).toLowerCase();
  const own = part ? mine.find((a) => String(a.batch || "").trim().toLowerCase() === part) : null;
  if (own) return { set: String(own.set).trim(), split: true };
  const whole = mine.find((a) => !String(a.batch || "").trim());
  return whole ? { set: String(whole.set).trim(), split: false } : null;
};

/** What a group on a set read before sets: its batch's, then its section's. */
const olderKeysFor = (entry, split) => {
  const sKey = sectionContainerKey(entry.section);
  return split ? [String(entry._id), sKey] : [sKey];
};

/**
 * The containers a whole set reads from: its own, then whatever older
 * container EVERY group on it falls back to — so staff looking at a set see
 * what its students see. Sections A and B each had their own material, so a
 * new Set 1 of the two starts empty for staff; Section C's batches all read
 * Section C's, so their set shows it until it has its own.
 */
const setTargetKeys = (course, sets, target) => {
  const wanted = String(target).trim();
  const chains = [];
  for (const b of course?.batchAndParticipants || []) {
    if (!b?._id || b?.archivedBySync || !String(b?.section || "").trim()) continue;
    const on = setOfEntry(sets, b);
    if (on && setContainerKey(on.set) === wanted) chains.push(olderKeysFor(b, on.split));
  }
  if (!chains.length) return [wanted];
  return [wanted, ...chains[0].filter((k) => chains.every((c) => c.includes(k)))];
};

/**
 * The containers one group reads from under `sets`, most specific first, or
 * null when no set covers it (the caller then resolves it as before sets).
 */
const setKeysForEntry = (sets, entry) => {
  const on = setOfEntry(sets, entry);
  return on ? [setContainerKey(on.set), ...olderKeysFor(entry, on.split)] : null;
};

/**
 * What staff pick between: one target per set, named after its groups
 * ("Set 1 · Section A, Section B"), in set order; then each group no set
 * covers, as it resolved before sets — its batch when `splits(section)`, else
 * its section. A batch without a section (not a degree group) is itself.
 */
const groupTargets = (course, sets, splits) => {
  const bySet = new Map();
  const rest = [];
  const done = new Set();
  const sections = courseSections(course);
  const entries = new Map((course?.batchAndParticipants || []).filter((b) => b?._id).map((b) => [String(b._id), b]));
  for (const b of listCourseBatches(course)) {
    if (!b.section) { rest.push(b); continue; }
    const entry = b.id ? entries.get(b.id) : null;
    const on = entry ? setOfEntry(sets, entry) : null;
    if (on) {
      const id = setContainerKey(on.set);
      if (!bySet.has(id)) bySet.set(id, { set: on.set, members: [] });
      const label = on.split ? b.name : sectionLabel(b.section);
      const members = bySet.get(id).members;
      if (!members.includes(label)) members.push(label);
      continue;
    }
    if (splits(b.section)) { rest.push(b); continue; }
    const k = sectionKey(b.section);
    if (done.has(k)) continue;
    done.add(k);
    const s = sections.get(k);
    if (s) rest.push({ id: s.key, name: sectionLabel(s.name), section: s.name });
  }
  const setTargets = [...bySet.entries()]
    .sort((x, y) => (Number(x[1].set) || 0) - (Number(y[1].set) || 0))
    .map(([id, v]) => ({ id, name: `Set ${v.set} · ${v.members.join(", ")}`, section: "" }));
  return [...setTargets, ...rest];
};

/**
 * The containers a target reads from, most specific first; the first one is
 * where a write lands. A target is a batch id, or — for staff working on a
 * whole section or set — a section or set key. Shared is never listed: it is
 * every reader's last resort and is handled by the callers.
 */
const containerKeysFor = (course, target) => {
  const t = String(target || "").trim();
  if (!t) return [];
  const sets = activeSets(course?.batchResources);
  if (isSetTarget(t)) return setTargetKeys(course, sets, t);
  if (isSectionTarget(t)) return [t];
  const entry = (course?.batchAndParticipants || []).find((b) => String(b?._id) === t);
  const section = String(entry?.section || "").trim();
  if (!section) return [t];
  const onSet = setKeysForEntry(sets, entry);
  if (onSet) return onSet;
  const sKey = sectionContainerKey(section);
  return sectionSplitsByBatch(course, section) ? [t, sKey] : [sKey];
};

/**
 * What staff can pick in the Resources group bar: each content set, or —
 * before sets — every batch of a section that splits per batch, or the
 * section itself when it keeps one set. For a course without sections this
 * is simply its batches.
 */
const listResourceTargets = (course) => {
  const sections = courseSections(course);
  if (!sections.size) return listCourseBatches(course);
  return groupTargets(course, activeSets(course?.batchResources), (name) => sectionSplitsByBatch(course, name, sections));
};

/** Is `target` a set or section staff may pick on this course right now? A
 *  section that is on a set (or split per batch) is not: its material lives
 *  elsewhere, and filing more under it would reach no one first. */
const isOfferedTarget = (course, target) => {
  const wanted = String(target || "").trim();
  return !!wanted && listResourceTargets(course).some((t) => t.id === wanted);
};

/**
 * Is THIS element batch-wise for THIS course?
 *
 * All three conditions must hold. In particular a course with no batches can
 * never be batch-wise no matter what the stored config says — which is what
 * makes a course that had its batches removed fall back to course-level
 * cleanly instead of pointing at containers that no longer exist.
 */
const isBatchWiseSection = (course, section) => {
  if (!course || !SECTIONS.includes(section)) return false;
  if (!courseUsesBatches(course)) return false;
  const cfg = course.batchResources || {};
  if (cfg.sameForAllBatches !== false) return false;
  return (cfg.batchwiseElements || []).map(String).includes(section);
};

/**
 * Resolve a batch id from whatever the caller had to hand — an id, or a name.
 * Returns "" when it matches nothing on this course.
 */
const resolveBatchId = (course, batchIdOrName) => {
  const wanted = String(batchIdOrName || "").trim();
  if (!wanted) return "";
  const batches = listCourseBatches(course);
  const byId = batches.find((b) => b.id && b.id === wanted);
  if (byId) return byId.id;
  const byName = batches.find((b) => b.name.toLowerCase() === wanted.toLowerCase());
  if (byName) return byName.id || "";
  // A caller that only knew the bare batch name ("Batch 1") still resolves —
  // but only when exactly one group carries it; across sections it is
  // ambiguous and resolves to nothing rather than to the wrong students.
  const bare = (course.batchAndParticipants || []).filter(
    (b) => !b?.archivedBySync && String(b?.batchName || "").trim().toLowerCase() === wanted.toLowerCase()
  );
  return bare.length === 1 && bare[0]._id ? String(bare[0]._id) : "";
};

const getBatchName = (course, batchId) =>
  listCourseBatches(course).find((b) => b.id === String(batchId || ""))?.name || "";

/**
 * The batch a user is enrolled in on this course, as an id. "" for staff and
 * for anyone not enrolled. First match wins — a user enrolled twice is a data
 * problem, not something to resolve here.
 */
const getUserBatchId = (course, userId) => {
  if (!course || !userId) return "";
  const target = String(userId);
  for (const batch of course.batchAndParticipants || []) {
    const inBatch = (batch.users || []).some((u) => {
      const uid = u?.user?._id || u?.user;
      return uid && String(uid) === target;
    });
    if (inBatch) return batch?._id ? String(batch._id) : "";
  }
  return "";
};

// The Role model stores `originalRole` (the platform role) and `renameRole`
// (the institution's own label for it), and different call sites have
// historically written `roleName`/`roleValue` too. Check them all — a missed
// spelling here would hand a student the staff view of every batch.
const isStudentUser = (user) => {
  const role = user?.role;
  if (!role || typeof role !== "object") return false;
  const label = [role.originalRole, role.renameRole, role.roleName, role.roleValue]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return label.includes("student");
};

/**
 * Which batch a request is scoped to, as an id.
 *
 * A student's batch comes from their enrolment and NOTHING else — a
 * client-supplied batch is ignored for them, so "Batch A student asks for
 * Batch B" cannot succeed at any layer. Staff may pick any batch on the
 * course; naming none lands them on the first, so the Resources page opens on
 * something real rather than an empty screen. An unidentified caller gets no
 * batch at all: the `/getAll/courses-data` reads are open, and defaulting them
 * to "the first batch" would hand one batch's material to anyone holding a
 * course id.
 */
const resolveViewerBatchId = (course, user, requestedBatch) => {
  if (!courseUsesBatches(course)) return "";
  if (!user) return "";
  if (isStudentUser(user)) return getUserBatchId(course, user._id || user.id);

  // A whole content set, or a whole section that keeps one set of material,
  // picked in the group bar.
  if (isSetTarget(requestedBatch) || isSectionTarget(requestedBatch)) {
    const wanted = String(requestedBatch).trim();
    if (isOfferedTarget(course, wanted)) return wanted;
  }

  const asked = resolveBatchId(course, requestedBatch);
  if (asked) return asked;

  const enrolled = getUserBatchId(course, user._id || user.id);
  if (enrolled) return enrolled;

  return listCourseBatches(course).find((b) => b.id)?.id || "";
};

/**
 * Where a write should land for one (section, batch) pair.
 *
 * Returns the container holding I_Do/We_Do/You_Do plus the mongoose path that
 * addresses it, because every caller needs both — the container to mutate and
 * the path to `markModified`, since Maps of Mixed do not track changes.
 *
 * A shared element always resolves to `pedagogy`, so "staff uploads once"
 * needs no special case at the call site. A batch-wise element resolves to
 * `batchPedagogy.<batchId>`, CREATING that container on first write. With no
 * batch resolvable it falls back to `pedagogy` rather than inventing a bucket
 * no reader would ever look in.
 */
const resolvePedagogyTarget = (entity, course, section, batchId) => {
  // A node that has never had a resource uploaded has no `pedagogy` subdoc at
  // all (the schema sets no default), so create it here rather than leaving
  // every caller to remember. This is the only function that hands out a
  // container, which makes it the only place that has to get this right.
  if (!entity.pedagogy) {
    entity.pedagogy = { I_Do: new Map(), We_Do: new Map(), You_Do: new Map() };
  }
  const shared = { container: entity.pedagogy, basePath: "pedagogy", batchId: "" };

  if (!isBatchWiseSection(course, section)) return shared;

  // Re-validate against the course rather than trusting the id. Callers reach
  // here through `resolveViewerBatchId`, which already checks — but this is
  // the function that CREATES a container, and an unchecked id would mint one
  // no reader could ever find. Cheap insurance against the next caller.
  let id;
  if (isSetTarget(batchId) || isSectionTarget(batchId)) {
    const wanted = String(batchId).trim();
    id = isOfferedTarget(course, wanted) ? wanted : "";
  } else {
    const batch = resolveBatchId(course, batchId);
    // A degree batch writes where its group's material lives: its set, or
    // its section when that keeps one set.
    id = batch ? containerKeysFor(course, batch)[0] : "";
  }
  if (!id) return shared;

  if (!entity.batchPedagogy) entity.batchPedagogy = new Map();

  let bucket = mapGet(entity.batchPedagogy, id);
  if (!bucket) {
    bucket = { I_Do: new Map(), We_Do: new Map(), You_Do: new Map() };
    if (typeof entity.batchPedagogy.set === "function") entity.batchPedagogy.set(id, bucket);
    else entity.batchPedagogy[id] = bucket;
    bucket = mapGet(entity.batchPedagogy, id);
  }

  return { container: bucket, basePath: `batchPedagogy.${id}`, batchId: id };
};

/**
 * Flatten ONE batch's view of a node onto the plain `pedagogy` shape.
 *
 * For a batch-wise element the batch's own set replaces the shared one; for a
 * shared element the shared set is returned as-is. `batchPedagogy` is stripped
 * from the result either way, so no response ever carries another batch's
 * material — "hidden" means absent, not just unrendered.
 *
 * The shared set is used as a fallback for a batch-wise element whose batch
 * has nothing of its own yet, so flipping a course from shared to batch-wise
 * does not look like every resource vanished overnight.
 */
const scopeNodePedagogy = (node, course, batchId) => {
  if (!node || typeof node !== "object") return node;

  // Most specific first: the batch, then (degree courses) its section.
  const buckets = containerKeysFor(course, batchId)
    .map((key) => mapGet(node.batchPedagogy, key))
    .filter(Boolean);
  const result = {};

  for (const section of SECTIONS) {
    const sharedEntries = Object.fromEntries(toEntries(node.pedagogy?.[section]));
    if (!isBatchWiseSection(course, section) || !buckets.length) {
      result[section] = sharedEntries;
      continue;
    }
    let chosen = sharedEntries;
    for (const bucket of buckets) {
      const own = Object.fromEntries(toEntries(bucket[section]));
      if (Object.keys(own).length > 0) { chosen = own; break; }
    }
    result[section] = chosen;
  }

  // The pedagogy schemas are `strict: false`, so anything else stored on them
  // is real data — dropping it here would be a silent loss.
  for (const [key, value] of toEntries(node.pedagogy)) {
    if (!SECTIONS.includes(key)) result[key] = value;
  }

  node.pedagogy = result;
  delete node.batchPedagogy;
  return node;
};

/** Walk a structured course payload and scope every node in it. */
const scopeCourseTreePedagogy = (node, course, batchId) => {
  if (!node || typeof node !== "object") return node;
  if (node.pedagogy || node.batchPedagogy) scopeNodePedagogy(node, course, batchId);
  for (const childKey of ["modules", "subModules", "topics", "subTopics"]) {
    if (Array.isArray(node[childKey])) {
      node[childKey].forEach((child) => scopeCourseTreePedagogy(child, course, batchId));
    }
  }
  return node;
};

/**
 * Everything the UI needs to render the section correctly, in one object.
 *
 * `mode` is what the client branches on:
 *   "no-batches" → hide the Resources-by-batch section entirely; everything is
 *                  course-level (this is the spec's "course without batches").
 *   "shared"     → batches exist but there is still nothing to pick; staff
 *                  upload once and every batch sees it.
 *   "batch-wise" → show the batch strip for the elements in
 *                  `batchwiseElements`; the rest stay shared.
 */
const buildResourceBatchContext = (course, user, requestedBatch) => {
  // What the group bar offers. For a degree course this is its sections and
  // batches as Course Setup split them; for every other course, its batches.
  const batches = listResourceTargets(course);
  const usesBatches = listCourseBatches(course).length > 0;
  const cfg = course?.batchResources || {};
  const sameForAllBatches = cfg.sameForAllBatches !== false;
  const batchwiseElements =
    usesBatches && !sameForAllBatches
      ? (cfg.batchwiseElements || []).map(String).filter((s) => SECTIONS.includes(s))
      : [];

  const student = !!user && isStudentUser(user);
  const viewerBatchId = resolveViewerBatchId(course, user, requestedBatch);
  // The bar highlights where this viewer's material actually lives: a degree
  // batch is working in its set, or in its section when that keeps one set.
  const activeBatchId = viewerBatchId && !isSectionTarget(viewerBatchId) && !isSetTarget(viewerBatchId)
    ? containerKeysFor(course, viewerBatchId)[0] || viewerBatchId
    : viewerBatchId;

  return {
    mode: !usesBatches ? "no-batches" : batchwiseElements.length === 0 ? "shared" : "batch-wise",
    usesBatches,
    sameForAllBatches,
    batchwiseElements,
    batches,
    activeBatchId,
    activeBatchName: batches.find((b) => b.id === activeBatchId)?.name || getBatchName(course, viewerBatchId),
    // A student never picks; staff pick only when something is batch-wise.
    canSelectBatch: !student && batchwiseElements.length > 0 && batches.some((b) => b.id),
    isStudent: student,
    // Surfaced so the client can explain an empty screen instead of showing one.
    enrolledBatchId: student ? getUserBatchId(course, user._id || user.id) : "",
    message: !usesBatches
      ? "This course does not use batches. Resources are managed at the course level."
      : batchwiseElements.length === 0
        ? "Course resources are shared — every batch sees the same material."
        : `Batch-wise resources: ${batchwiseElements.join(", ")}.`,
  };
};

module.exports = {
  SECTIONS,
  listCourseBatches,
  listResourceTargets,
  containerKeysFor,
  courseSections,
  sectionContainerKey,
  isSectionTarget,
  setContainerKey,
  isSetTarget,
  activeSets,
  setKeysForEntry,
  setTargetKeys,
  groupTargets,
  listCourseBatchNames,
  courseUsesBatches,
  isBatchWiseSection,
  resolveBatchId,
  getBatchName,
  getUserBatchId,
  isStudentUser,
  resolveViewerBatchId,
  resolvePedagogyTarget,
  scopeNodePedagogy,
  scopeCourseTreePedagogy,
  buildResourceBatchContext,
};
