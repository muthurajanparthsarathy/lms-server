const mongoose = require("mongoose");
const ServiceMapping = require("../models/ServiceMappingModel");
const ClientManagement = require("../models/ClientManagementModel");
const CourseStructure = require("../models/Courses/courseStructureModal");
const {
  cascadeDeleteCourses,
  collectMappingCourseIds,
  detachUsersFromMapping,
} = require("../utils/cascadeDeleteCourses");
const {
  pocMappingFilter,
  pocCourseFilter,
  scopeHasMapping,
  scopeHasClient,
} = require("../utils/pocScope");

// Canonical hierarchy levels. Order matters (top → bottom). New levels can be
// appended here (and in the client-side catalog) without any schema change.
const HIERARCHY_LEVELS = ["Batch", "Degree", "Department", "Semester", "Section"];

// ── Paginated mapping list ───────────────────────────────────────────────────
// A port of the workspace table's own `filteredRows` / `sortedRows` memos
// (app/lms/pages/servicemapping/page.tsx), so a given filter set selects the
// rows it always did.
//
// The whole path is an aggregation because two of its inputs are POPULATED
// fields: the search haystack includes client.clientCompany and every
// partnerInstitutions[].clientCompany, and the Client column sorts on the
// client's name. Neither is reachable from find().
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The page compares with `localeCompare(undefined, { numeric: true,
// sensitivity: 'base' })`. 'base' ignores case AND accents — collation
// strength ONE.
const MAPPING_COLLATION = { locale: "en", strength: 1, numericOrdering: true };

// How many service lines a client-grouped row carries (see `serviceList` in the
// grouped branch below). The workspace table draws one row per service under
// each client, so it needs the names — but a client with a hundred services
// must not turn one table page into a hundred rows or a fat payload. Past the
// cap the row still reports the true `services` count, and the table shows
// "+N more" pointing at Manage Services, which fetches the client's full list.
const SERVICE_LINE_CAP = 8;

// `levelValues` (components/workspaceShared.tsx) matches the level TRIMMED and
// LOWERCASED, so a plain equality on "degree" would miss "Degree" or " degree ".
const levelMatch = (level, value) => ({
  masterData: {
    $elemMatch: {
      level: new RegExp(`^\\s*${escapeRegex(level)}\\s*$`, "i"),
      values: value,
    },
  },
});

// ── Course Setup progress (`setup=1`) ────────────────────────────────────────
// A port of Course Setup's own whole-set derivations, which it could only make
// while it held every mapping: `groupCourses` (components/mappingTree.ts) and
// `courseStatusFor` / `progressFor` / `configuredCount`
// (app/lms/pages/coursestructure/page.tsx).
//
// It answers "how many of this mapping's courses already have a setup?", which
// the page turns into the row's status, its progress bar, and the four header
// tiles. NONE of it is derivable from one page of mappings — the tiles count
// the whole book of work, and the status is not a stored field at all, so a
// status filter or a progress sort over a paginated list has to be decided
// here.
//
// Deliberately plain JS over two projected reads rather than a $lookup: the
// matching rule below (path key → mapping key → client key, with the legacy
// fallbacks) is subtle enough that it must stay a line-for-line copy of the
// page's, and an aggregation rewrite of it would drift silently.
const normKey = (v) => String(v == null ? "" : v).trim().toLowerCase();

// ── Course → Phase → Batch, per mapping ─────────────────────────────────────
// What the Course Setup list's Phase and Batch filters offer and match on. A
// mapping can carry this in four shapes, and each one is read here the way the
// hierarchy screen reads it (components/mappingTree.ts):
//   • courseConfigurations — the placement wizard's current shape: phases and
//     training batches with ids, a batch naming its phase.
//   • degree courses (3–4 part path) — batches on the course itself, no phases.
//   • phase-first placement (no batchConfigs) — a 1-part path is the PHASE and
//     the course carries that phase's batches; pathless means no phases.
//   • batch-first (named batchConfigs) — a 1–2 part path is "Batch ▸ Phase";
//     a pathless course in a mapping where no course names a batch is legacy
//     data that runs in every configured batch. Mappings older than
//     batchConfigs name their batches in masterData instead.
// Returns Map<course key, { name, phases: Map<key, { name, batches }>, batches }>
// where the top-level `batches` are the ones not tied to any phase. Names keep
// the first spelling seen; keys are trimmed and lower-cased.
const STRUCTURE_PATH_SEP = " ▸ ";
function courseStructureOf(m) {
  const out = new Map();
  const clean = (v) => (v == null ? "" : String(v).trim());
  const courseEntry = (courseName) => {
    const name = clean(courseName);
    if (!name) return null;
    const key = name.toLowerCase();
    if (!out.has(key)) out.set(key, { name, phases: new Map(), batches: new Map() });
    return out.get(key);
  };
  const phaseEntry = (course, phaseName) => {
    const name = clean(phaseName);
    if (!name) return null;
    const key = name.toLowerCase();
    if (!course.phases.has(key)) course.phases.set(key, { name, batches: new Map() });
    return course.phases.get(key);
  };
  const addBatch = (target, batchName) => {
    const name = clean(batchName);
    if (name && !target.has(name.toLowerCase())) target.set(name.toLowerCase(), name);
  };
  const names = (arr) => (Array.isArray(arr) ? arr.map(clean).filter(Boolean) : []);
  const byOrder = (a, b) => (a.order || 0) - (b.order || 0);

  (m.courseConfigurations || []).forEach((cfg) => {
    const course = courseEntry(cfg && cfg.courseName);
    if (!course) return;
    const phaseById = new Map();
    if (cfg.phaseConfigEnabled) {
      [...(cfg.phases || [])].sort(byOrder).forEach((ph) => {
        const phase = phaseEntry(course, ph && ph.name);
        if (phase) phaseById.set(String(ph._id), phase);
      });
    }
    [...(cfg.trainingBatches || [])].sort(byOrder).forEach((b) => {
      if (b && b.phaseId) {
        const phase = phaseById.get(String(b.phaseId));
        if (phase) addBatch(phase.batches, b.name);
        return;
      }
      addBatch(course.batches, b && b.name);
    });
  });

  const levelValues = (level) => (m.masterData || [])
    .filter((md) => md && normKey(md.level) === level && !md.group)
    .flatMap((md) => names(md.values));
  const batchConfigs = (m.batchConfigs || []).filter((b) => clean(b && b.name));
  const phaseNames = new Set(levelValues("phase").map(normKey));
  const masterBatchNames = levelValues("batch");
  const partsOf = (path) => clean(path).split(STRUCTURE_PATH_SEP).map(clean).filter(Boolean);
  const courses = (m.courses || []).filter((c) => clean(c && c.courseName));
  // Decided once per mapping, as buildBatchTree does: a pathless course only
  // runs "everywhere" when no course in the mapping names a batch.
  const legacyEverywhere = !courses.some((c) => {
    const n = partsOf(c.path).length;
    return n === 1 || n === 2;
  });
  // A batch saved without a phase, in a batch that runs in phases, runs in
  // every one of them — so it is filed under each.
  const addBatchConfig = (course, batchName, phaseName) => {
    if (phaseName) {
      const phase = phaseEntry(course, phaseName);
      if (phase) addBatch(phase.batches, batchName);
      return;
    }
    const cfg = batchConfigs.find((b) => normKey(b.name) === normKey(batchName));
    const cfgPhases = names(cfg && cfg.phases);
    if (!cfgPhases.length) return addBatch(course.batches, batchName);
    cfgPhases.forEach((p) => addBatch(phaseEntry(course, p).batches, batchName));
  };

  courses.forEach((c) => {
    const course = courseEntry(c.courseName);
    const parts = partsOf(c.path);
    const own = names(c.batches);
    if (parts.length >= 3) {
      own.forEach((b) => addBatch(course.batches, b));
      return;
    }
    if (!batchConfigs.length && (phaseNames.size || own.length)) {
      // The oldest placement mappings saved the phase NAME as the course name
      // too (see courseConfigurationsFromLegacy). A "phase" that is just the
      // course's own name is no phase to pick, so its batches stand alone.
      if (parts.length === 1 && normKey(parts[0]) !== normKey(c.courseName)) {
        const phase = phaseEntry(course, parts[0]);
        own.forEach((b) => addBatch(phase.batches, b));
      } else {
        own.forEach((b) => addBatch(course.batches, b));
      }
      return;
    }
    own.forEach((b) => addBatch(course.batches, b));
    if (parts.length) {
      addBatchConfig(course, parts[0], parts[1] || null);
      return;
    }
    if (!legacyEverywhere) return;
    if (batchConfigs.length) batchConfigs.forEach((b) => addBatchConfig(course, b.name, null));
    else masterBatchNames.forEach((b) => addBatch(course.batches, b));
  });

  return out;
}

// Does this mapping's structure hold the picked course / phase / batch? Each
// argument is a lower-cased name, and an empty one means "any". A batch with no
// phase picked matches in any phase, or outside phases altogether.
const structureMatches = (structure, course, phase, batch) => {
  const courses = course
    ? [structure.get(course)].filter(Boolean)
    : [...structure.values()];
  return courses.some((c) => {
    if (phase) {
      const ph = c.phases.get(phase);
      return Boolean(ph) && (!batch || ph.batches.has(batch));
    }
    if (!batch) return true;
    return c.batches.has(batch) || [...c.phases.values()].some((ph) => ph.batches.has(batch));
  });
};

// The Phase / Batch filters' options: every mapping's structure (or just the
// picked clients') merged per course. Courses with neither phases nor batches
// are left out — there is nothing to pick under them.
const mergeCourseStructures = (progress, clientIds) => {
  const merged = new Map();
  progress.structureByMapping.forEach(({ clientId, structure }) => {
    if (clientIds && !clientIds.has(clientId)) return;
    structure.forEach((c, key) => {
      if (!merged.has(key)) merged.set(key, { name: c.name, phases: new Map(), batches: new Map() });
      const into = merged.get(key);
      c.batches.forEach((name, k) => { if (!into.batches.has(k)) into.batches.set(k, name); });
      c.phases.forEach((ph, pk) => {
        if (!into.phases.has(pk)) into.phases.set(pk, { name: ph.name, batches: new Map() });
        const phaseInto = into.phases.get(pk);
        ph.batches.forEach((name, k) => { if (!phaseInto.batches.has(k)) phaseInto.batches.set(k, name); });
      });
    });
  });
  return [...merged.values()]
    .filter((c) => c.phases.size || c.batches.size)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      course: c.name,
      phases: [...c.phases.values()].map((ph) => ({ name: ph.name, batches: [...ph.batches.values()] })),
      batches: [...c.batches.values()],
    }));
};

// Same four states, and the same order the list sorted them in.
const SETUP_STATUS_ORDER = {
  "not-started": 0,
  "in-progress": 1,
  configured: 2,
  "no-courses": 3,
};
const setupStatusOf = (p) => {
  if (!p || p.total === 0) return "no-courses";
  if (p.configured >= p.total) return "configured";
  if (p.configured === 0) return "not-started";
  return "in-progress";
};

async function getSetupProgress(institutionId, scope) {
  const oid = new mongoose.Types.ObjectId(String(institutionId));
  // Feeds the four header tiles and the Course filter's options, both of which
  // count the whole book of work — so for a POC "the whole book" has to mean
  // its own mappings and courses, not the institution's.
  const [mappings, setups] = await Promise.all([
    // createdAt-desc so the "first spelling wins" course-name dedupe below,
    // and the base order the derived sorts tie-break on, both match what the
    // page saw when it held the legacy list (which arrives in this order).
    ServiceMapping.find(
      { institution: oid, ...pocMappingFilter(scope) },
      // masterData / batchConfigs / courseConfigurations only feed the
      // Phase and Batch filters (courseStructureOf).
      { client: 1, courses: 1, masterData: 1, batchConfigs: 1, courseConfigurations: 1 }
    )
      .sort({ createdAt: -1 })
      .lean(),
    CourseStructure.find(
      { institution: oid, ...pocCourseFilter(scope) },
      { clientId: 1, mappingId: 1, coursePath: 1, courseName: 1 }
    ).lean(),
  ]);

  // The page's index, key for key. A record that HAS a path is indexed under
  // the path key ONLY, so it can never answer for a different placement; one
  // without a mapping id keeps the old client + name identity.
  const byKey = new Map();
  setups.forEach((c) => {
    const name = normKey(c.courseName);
    const id = String(c._id || "");
    if (!name || !id) return;
    const clientId = String(c.clientId || "").trim();
    const recordMappingId = String(c.mappingId || "").trim();
    const recordPath = normKey(c.coursePath);
    if (recordMappingId && recordPath) {
      byKey.set(`${clientId}::${recordMappingId}::${recordPath}::${name}`, id);
      return;
    }
    byKey.set(
      recordMappingId ? `${clientId}::${recordMappingId}::${name}` : `${clientId}::${name}`,
      id
    );
  });

  const setupIdFor = (clientId, mappingId, courseName, coursePath) => {
    const name = normKey(courseName);
    const path = normKey(coursePath);
    return (
      (path ? byKey.get(`${clientId}::${mappingId}::${path}::${name}`) : undefined) ||
      byKey.get(`${clientId}::${mappingId}::${name}`) ||
      byKey.get(`${clientId}::${name}`) ||
      null
    );
  };

  const byMapping = new Map();
  // Each mapping's Course → Phase → Batch, for the Phase / Batch filters.
  const structureByMapping = new Map();
  // DISTINCT record ids, not match hits: a legacy record (no mapping id)
  // answers for every same-named mapping through the fallback, and counting
  // hits would report one record as several configured courses.
  const configuredIds = new Set();
  const courseNames = new Map(); // lowercased → first spelling seen
  let totalCourses = 0;
  // A course has no active flag of its own; it inherits its mapping's. The
  // Course Setup tiles count them that way — courses under an inactive
  // mapping are not being delivered, whatever their setup progress says.
  let activeCourses = 0;
  const clientIds = new Set();

  mappings.forEach((m) => {
    const clientId = String(m.client || "");
    const mappingId = String(m._id);
    // groupCourses: one group per (path, name) — the same course at two places
    // is two setups; listed twice for one place it is one.
    const seen = new Set();
    const groups = [];
    (m.courses || []).forEach((c) => {
      const name = String((c && c.courseName) || "").trim();
      if (!name) return;
      const path = String((c && c.path) || "").trim();
      const key = `${path.toLowerCase()}::${name.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      groups.push({ name, path });
      if (!courseNames.has(name.toLowerCase())) courseNames.set(name.toLowerCase(), name);
    });

    let configured = 0;
    groups.forEach((g) => {
      const id = setupIdFor(clientId, mappingId, g.name, g.path);
      if (id) {
        configured++;
        configuredIds.add(id);
      }
    });
    // `names` rides along so a CLIENT row can union the course names of just
    // the mappings the filters selected. Storing them per mapping rather than
    // per client is what keeps that union honest: a client-wide list could not
    // be narrowed back down once a filter had excluded some of its mappings.
    byMapping.set(mappingId, {
      configured,
      total: groups.length,
      names: groups.map((g) => g.name),
    });
    structureByMapping.set(mappingId, { clientId, structure: courseStructureOf(m) });
    totalCourses += groups.length;
    if (clientId) clientIds.add(clientId);
    if (m.status !== "inactive") activeCourses += groups.length;
  });

  return {
    byMapping,
    structureByMapping,
    totalCourses,
    configuredCount: configuredIds.size,
    courseNames,
    activeCourses,
    clients: clientIds.size,
  };
}

// Every mapping id in the order the list's own comparator put them, so a
// derived sort can be applied with a positional $sort. The list sorted the
// FILTERED rows, but its comparator is stable over a createdAt-desc base and
// descending REVERSES the sorted array (ties included) — so ordering the whole
// set first and filtering after leaves every surviving pair in the same
// relative order.
const orderedSetupIds = (progress, key, dir) => {
  const valueOf = (id) => {
    const p = progress.byMapping.get(id) || { configured: 0, total: 0 };
    // The list's progress comparator: -1 for a mapping with no courses, so it
    // sorts below a genuine 0%.
    if (key === "progress") return p.total ? p.configured / p.total : -1;
    return SETUP_STATUS_ORDER[setupStatusOf(p)];
  };
  const ranked = [...progress.byMapping.keys()]
    .map((id, i) => ({ id, i, v: valueOf(id) }))
    .sort((a, b) => a.v - b.v || a.i - b.i);
  if (dir === "desc") ranked.reverse();
  return ranked.map((x) => x.id);
};

async function getMappingsPaginated(req, res, institutionId) {
  const {
    page, limit, search, status, year, client, service, serviceModel,
    degree, department, section, semester, sortKey, sortDir,
  } = req.query;

  const isExport = req.query.export === "1" || req.query.export === "true";
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const perPage = Math.min(isExport ? 5000 : 200, Math.max(1, parseInt(limit, 10) || 10));

  // Opt-in, because it costs two extra reads: only Course Setup shows setup
  // progress. Without it this endpoint behaves exactly as it did.
  const wantSetup = req.query.setup === "1" || req.query.setup === "true";
  const progress = wantSetup ? await getSetupProgress(institutionId, req.pocScope) : null;
  // Setup progress is keyed by MAPPING id, so it cannot rank or annotate rows
  // that are clients. Course Setup never groups, so the two are simply
  // exclusive rather than reconciled.
  const derivedSort = progress
    && req.query.groupBy !== "client"
    && (sortKey === "progress" || sortKey === "setupStatus");

  const match = { institution: new mongoose.Types.ObjectId(String(institutionId)) };
  // POC scope goes through `$and`, NOT onto `match._id`, because the
  // setupStatus filter below assigns `match._id` outright and would erase it.
  // Both constraints then apply — Mongo ANDs a top-level key with `$and`.
  //
  // This is also what neutralises a hand-crafted `?client=<someone else's id>`
  // further down: that only narrows, and the intersection with the POC's own
  // mapping ids stays empty.
  if (req.pocScope?.isPoc) {
    (match.$and = match.$and || []).push({ _id: { $in: req.pocScope.mappingIds } });
  }
  if (status) match.status = status;
  if (year) match.year = year;
  // A LIST of years, for the listing's multi-select year filter. `year` above
  // is the single-value form the reports still send, and yearFrom/yearTo below
  // is the span — all three are ANDed through `$and`, so a caller that somehow
  // sent two of them gets the intersection rather than one silently winning.
  // Only 4-digit values are honoured: the filter's own options come from the
  // data, so anything else arrived by hand.
  if (req.query.years) {
    let wanted = [];
    try {
      const parsed = JSON.parse(String(req.query.years));
      if (Array.isArray(parsed)) {
        wanted = parsed.map((v) => String(v).trim()).filter((v) => /^\d{4}$/.test(v));
      }
    } catch {
      // Malformed JSON is treated as no year filter, which is what an absent
      // parameter means — a 400 here would break the page on a stale URL.
      wanted = [];
    }
    if (wanted.length) {
      (match.$and = match.$and || []).push({ year: { $in: wanted } });
    }
  }
  if (req.query.yearFrom || req.query.yearTo) {
    const from = req.query.yearFrom ? String(req.query.yearFrom) : undefined;
    const to = req.query.yearTo ? String(req.query.yearTo) : undefined;
    if ((from && !/^\d{4}$/.test(from)) || (to && !/^\d{4}$/.test(to)) || (from && to && from > to)) {
      return res.status(400).json({ success: false, message: "Invalid reporting year range" });
    }
    (match.$and = match.$and || []).push({ year: {
      $regex: /^\d{4}$/,
      ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}),
    } });
  }
  if (service) match.service = service;
  // The mapping's OWN `status` above is active/inactive. `setupStatus` is the
  // derived configuration state, which exists only in the progress map — so it
  // is applied as the id set that carries it.
  if (progress && req.query.setupStatus) {
    const wanted = String(req.query.setupStatus);
    const ids = [...progress.byMapping.entries()]
      .filter(([, p]) => setupStatusOf(p) === wanted)
      .map(([id]) => new mongoose.Types.ObjectId(id));
    match._id = { $in: ids };
  }
  // One course NAME, matched against every course the mapping teaches. The
  // list compared trimmed-and-lowercased names for equality, so this is
  // anchored (not a substring) and tolerant of stored padding.
  if (req.query.course) {
    match.courses = {
      $elemMatch: {
        courseName: new RegExp(`^\\s*${escapeRegex(String(req.query.course).trim())}\\s*$`, "i"),
      },
    };
  }
  // Phase and batch under that course. Neither is a plain field — both are
  // read through courseStructureOf's four shapes — so they apply as the id set
  // that carries them. They need the structure getSetupProgress builds, which
  // only Course Setup (`setup=1`) asks for; without it they are ignored.
  const wantPhase = normKey(req.query.phase);
  const wantBatch = normKey(req.query.batch);
  if (progress && (wantPhase || wantBatch)) {
    const wantCourse = normKey(req.query.course);
    const ids = [...progress.structureByMapping.entries()]
      .filter(([, s]) => structureMatches(s.structure, wantCourse, wantPhase, wantBatch))
      .map(([id]) => new mongoose.Types.ObjectId(id));
    (match.$and = match.$and || []).push({ _id: { $in: ids } });
  }
  // Created-date cutoff as a timestamp, so the "last 7 days / this year"
  // vocabulary stays in the one place that owns it — the page. A mapping with
  // no createdAt is excluded, as it was client-side.
  const createdAfter = Number(req.query.createdAfter);
  if (Number.isFinite(createdAfter) && createdAfter > 0) {
    match.createdAt = { $gte: new Date(createdAfter) };
  }
  // `serviceModels` is an array; equality on an array field matches when ANY
  // element equals — the same as the page's `.includes()`.
  if (serviceModel) match.serviceModels = serviceModel;
  if (req.query.serviceModels) {
    try {
      const models = JSON.parse(req.query.serviceModels);
      if (!Array.isArray(models) || !models.length || models.length > 100 || models.some((model) => typeof model !== 'string' || !model.trim() || model.length > 200)) throw new Error('Invalid models');
      (match.$and = match.$and || []).push({ serviceModels: { $in: models } });
    } catch {
      return res.status(400).json({ success: false, message: "Invalid service-type selection" });
    }
  }
  if (client && mongoose.Types.ObjectId.isValid(client)) {
    match.client = new mongoose.Types.ObjectId(client);
  }
  if (req.query.clients) {
    try {
      const clients = JSON.parse(req.query.clients);
      if (!Array.isArray(clients) || !clients.length || clients.length > 1000 || clients.some((id) => typeof id !== 'string' || !mongoose.Types.ObjectId.isValid(id))) throw new Error('Invalid clients');
      (match.$and = match.$and || []).push({ client: { $in: clients.map((id) => new mongoose.Types.ObjectId(id)) } });
    } catch { return res.status(400).json({ success: false, message: 'Invalid client selection' }); }
  }
  // Each hierarchy filter is its own $elemMatch, so they must be $and-ed
  // rather than collapsed onto one `masterData` key.
  const hierarchy = [];
  if (degree) hierarchy.push(levelMatch("degree", degree));
  if (department) hierarchy.push(levelMatch("department", department));
  if (section) hierarchy.push(levelMatch("section", section));
  if (semester) hierarchy.push(levelMatch("semester", semester));
  // Merged, not assigned: a bare `match.$and = hierarchy` would drop the POC
  // scope constraint pushed above.
  if (hierarchy.length) match.$and = [...(match.$and || []), ...hierarchy];

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: ClientManagement.collection.name,
        localField: "client",
        foreignField: "_id",
        as: "_client",
        // clientId is the human-readable Client ID ("CLT-000023") the listing
        // shows in its own column.
        pipeline: [{ $project: { clientId: 1, clientCompany: 1, status: 1, type: 1, businessModel: 1 } }],
      },
    },
    {
      $lookup: {
        from: ClientManagement.collection.name,
        localField: "partnerInstitutions",
        foreignField: "_id",
        as: "_partners",
        pipeline: [{ $project: { clientCompany: 1, status: 1, type: 1, businessModel: 1 } }],
      },
    },
    // Empty records out: a mapping whose client no longer exists (deleted
    // from Client Management) or carries no name has nothing to show in the
    // Client Name column but a dash. Dropped here, before the count and the
    // grouping, so the page totals and pagination agree with what is listed.
    // The regex needs one non-space character, which an empty join, a null
    // name, "" and "   " all fail.
    { $match: { "_client.clientCompany": { $regex: /\S/ } } },
  ];

  // Business model (B2B / B2I / B2C) lives on the CLIENT, not the mapping, so
  // it can only be matched after the join above — unlike every filter in the
  // `match` object, which runs before it.
  if (req.query.businessModel) {
    pipeline.push({
      $match: { "_client.businessModel": String(req.query.businessModel) },
    });
  }
  if (req.query.businessModels) {
    try {
      const models = JSON.parse(req.query.businessModels);
      if (!Array.isArray(models) || !models.length || models.some((model) => !['B2B', 'B2I', 'B2C'].includes(model))) throw new Error('Invalid business models');
      pipeline.push({ $match: { '_client.businessModel': { $in: models } } });
    } catch { return res.status(400).json({ success: false, message: 'Invalid business-model selection' }); }
  }

  if (search && String(search).trim()) {
    // The page searched ONE joined string:
    //   [client.clientCompany, year, courseName,
    //    ...partnerInstitutions[].clientCompany]
    //     .filter(Boolean).join(' ').toLowerCase().includes(q)
    // so a query straddling two fields still has to match. A per-field $or
    // cannot reproduce that, so the haystack is assembled here exactly as the
    // page assembled it. No index is lost: an unanchored regex can never use
    // one anyway.
    const rx = new RegExp(escapeRegex(String(search).trim()), "i");
    // The pages have THREE mapping lists and they search DIFFERENT haystacks.
    // `searchScope=service` is the workspace's second list:
    //   `${service} ${serviceModels.join(' ')} ${year} ${serviceCode} ${courseName}`
    // — it carries serviceCode and does NOT include the client or partners.
    // `searchScope=setup` is Course Setup's:
    //   [clientName, serviceCode, service, year, ...models, ...courseNames]
    // — the only one that searches the courses the mapping TEACHES, which is
    // as common a way to find a mapping as its client or its code.
    // Anything else is the workspace table's, which does neither — and which
    // no longer searches `service` or `serviceModels` either: that table groups
    // by CLIENT and renders no service name, only a count, so a service hit
    // returned a row with nothing on it that explained the match.
    const scope = req.query.searchScope;
    const haystackParts = scope === "service"
      ? {
        $concatArrays: [
          ["$service"],
          { $ifNull: ["$serviceModels", []] },
          ["$year", "$serviceCode", "$courseName"],
        ],
      }
      : scope === "setup"
        ? {
          $concatArrays: [
            [
              { $first: "$_client.clientCompany" },
              "$serviceCode",
              "$service",
              "$year",
            ],
            { $ifNull: ["$serviceModels", []] },
            // The raw course list, NOT the page's deduped grouping: a repeated
            // name changes nothing for a substring test.
            { $ifNull: [{ $map: { input: "$courses", as: "c", in: "$$c.courseName" } }, []] },
          ],
        }
        : {
          // Default scope = the Service Mapping workspace table. It groups by
          // CLIENT and renders only three columns of substance: Client Name,
          // Business Model, and a Services (count + active) chip. The search
          // haystack must contain exactly what the reader can see — anything
          // more surfaces false positives that look like the search is broken.
          // Reported case: searching "Q" returned "Vaigai InfoTech" because a
          // hidden courseName under that client (e.g. "SQL basics") matched.
          //
          // Kept: client.clientCompany, client.businessModel, the mapping's
          //   service name, and its serviceModels[] entries — all of them
          //   drive rows the reader can point at in this view.
          // Dropped: year (no year column in this view), courseName (hidden),
          //   partner clientCompanies (never surfaced in this row's cells),
          //   any raw id/metadata (never was here, still isn't).
          $concatArrays: [
            [
              { $first: "$_client.clientCompany" },
              { $first: "$_client.businessModel" },
              "$service",
            ],
            { $ifNull: ["$serviceModels", []] },
          ],
        };
    pipeline.push({
      $addFields: {
        _hay: {
          $toLower: {
            $reduce: {
              input: {
                $filter: {
                  input: haystackParts,
                  cond: {
                    $and: [
                      { $ne: ["$$this", null] },
                      { $ne: ["$$this", ""] },
                    ],
                  },
                },
              },
              initialValue: "",
              in: {
                $cond: [
                  { $eq: ["$$value", ""] },
                  { $toString: "$$this" },
                  { $concat: ["$$value", " ", { $toString: "$$this" }] },
                ],
              },
            },
          },
        },
      },
    });
    pipeline.push({ $match: { _hay: rx } });
  }

  // ── Client-grouped mode ─────────────────────────────────────────────────────
  // The workspace's primary (table) view shows ONE row per CLIENT and paginates
  // on clients. Paginating mappings cannot serve it: a client's mappings
  // straddle page boundaries, so "25 mappings" is an unknown number of client
  // rows, and the page count would be wrong in a way no clamp can fix.
  // Grouping here makes the unit of pagination the unit the table draws.
  //
  // The aggregates are exactly what the row used to derive in the browser from
  // the full mappings array (`aggYearLabel`, `aggActiveCount`, `aggLastUpdated`
  // and the services count). The mappings themselves are still NOT pushed back:
  // returning every mapping nested under a grouped row would rebuild the very
  // payload the grouping exists to avoid. Manage Services fetches the one
  // client's mappings when it opens (getByClient).
  //
  // `serviceList` is the one exception, and a deliberately cheap one: the
  // workspace table now lists a client's services as rows underneath it
  // (client / business model span, one line per service), so it needs the
  // NAMES, not just a count. Five scalar fields per service, capped at
  // SERVICE_LINE_CAP per client — a bounded few hundred bytes a row, not the
  // masterData/courses/hierarchy payload a whole mapping carries. The cap is
  // safe because the row also reports `services` (the true total), so the
  // table can say "+N more" and send the reader to Manage Services.
  const groupByClient = req.query.groupBy === "client";
  if (groupByClient) {
    pipeline.push({
      $group: {
        _id: "$client",
        client: { $first: { $arrayElemAt: ["$_client", 0] } },
        services: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
        years: { $addToSet: "$year" },
        serviceList: {
          $push: {
            _id: "$_id",
            service: "$service",
            serviceModels: "$serviceModels",
            year: "$year",
            status: "$status",
          },
        },
        // Ids only, and only when setup progress is wanted — bounded by one
        // client's service count. `setup=1` folds these back into the row's
        // configured/total and its course-name list; they are stripped from
        // the response afterwards. NOT the mappings themselves: returning
        // those would rebuild the payload this grouping exists to avoid.
        ...(wantSetup ? { mappingIds: { $push: "$_id" } } : {}),
        // The Year column sorts on the earliest year, which is also the number
        // the row's "2023–2025" label starts from.
        minYear: { $min: "$year" },
        lastUpdated: { $max: { $ifNull: ["$updatedAt", "$createdAt"] } },
        createdAt: { $max: "$createdAt" },
      },
    });
    // Trim the pushed list AFTER grouping (the $group has to see every mapping
    // to count them) but BEFORE the sort/facet, so nothing downstream carries
    // the untrimmed array.
    pipeline.push({
      $addFields: { serviceList: { $slice: ["$serviceList", SERVICE_LINE_CAP] } },
    });
  }

  const dir = sortDir === "desc" ? -1 : 1;
  // Grouped rows no longer carry the per-mapping fields, so the sortable set
  // differs: the client table offers Client ID / Client / Services / Year /
  // Updated.
  const SORT_VALUE = groupByClient
    ? {
      clientId: "$client.clientId",
      client: "$client.clientCompany",
      services: "$services",
      year: "$minYear",
      updated: "$lastUpdated",
    }
    : {
      client: { $first: "$_client.clientCompany" },
      service: "$service",
      // The Model column sorts on the FIRST service model, not the whole array.
      model: { $first: "$serviceModels" },
      year: "$year",
      status: "$status",
      updated: "$updatedAt",
    };

  // TIES, and they are not a detail: sorting by Year, where nearly every row
  // carries the same value, is ALL tie-break — it alone decides which rows land
  // on page one.
  //
  // The two lists disagree about them. The workspace table sorts a list already
  // in createdAt-desc order and NEGATES its comparator for descending, so equal
  // keys keep newest-first in BOTH directions. Course Setup instead REVERSES
  // the sorted array, which flips the ties along with everything else — so its
  // descending ties run oldest-first. `sortTies=reverse` asks for the second;
  // the default is unchanged.
  const reverseTies =
    req.query.sortTies === "reverse" && dir === -1 && Boolean(SORT_VALUE[sortKey]);
  const tie = reverseTies ? { createdAt: 1, _id: 1 } : { createdAt: -1, _id: -1 };
  let sortStage = { createdAt: -1, _id: -1 };
  if (derivedSort) {
    // `progress` and `setupStatus` are not fields — they are computed from the
    // course-structure records. The whole institution is ranked in JS by the
    // list's own comparator and the rows are sorted by POSITION in that
    // ranking, which needs no tie-break: positions are unique.
    const ranking = orderedSetupIds(
      progress,
      sortKey === "progress" ? "progress" : "status",
      sortDir === "desc" ? "desc" : "asc"
    ).map((id) => new mongoose.Types.ObjectId(id));
    pipeline.push({ $addFields: { _sortVal: { $indexOfArray: [ranking, "$_id"] } } });
    sortStage = { _sortVal: 1 };
  } else if (SORT_VALUE[sortKey]) {
    pipeline.push({
      $addFields: { _sortVal: { $ifNull: [SORT_VALUE[sortKey], ""] } },
    });
    sortStage = { _sortVal: dir, ...tie };
  }

  pipeline.push({
    $facet: {
      rows: [
        { $sort: sortStage },
        { $skip: (pageNum - 1) * perPage },
        { $limit: perPage },
        { $project: { _hay: 0, _sortVal: 0 } },
      ],
      count: [{ $count: "n" }],
    },
  });

  const agg = ServiceMapping.aggregate(pipeline);
  if (SORT_VALUE[sortKey]) agg.collation(MAPPING_COLLATION);
  const [out] = await agg;
  const rows = out?.rows || [];
  const total = out?.count?.[0]?.n || 0;

  // Re-shape the joins back to what `populate` produced, so a row is
  // indistinguishable from one the legacy path returned. `setup=1` adds ONE
  // field: the row's own configured/total, which the page used to derive from
  // the full course-structure list it no longer holds per row.
  const data = rows.map((r) => {
    const { _client, _partners, mappingIds, ...rest } = r;
    const shaped = {
      ...rest,
      client: _client?.[0] || r.client || null,
      partnerInstitutions: _partners || [],
    };
    if (progress && !groupByClient) {
      shaped.setupProgress = progress.byMapping.get(String(r._id)) || { configured: 0, total: 0 };
    } else if (progress && groupByClient) {
      // Folded over the row's OWN mappingIds — the ones that survived `$match`
      // — so a filtered client row reports the services the filter selected
      // rather than the client's whole book. Course names are unioned here for
      // the same reason, and deduped case-insensitively keeping the first
      // spelling, which is the rule getSetupProgress already applies.
      let configured = 0;
      let total = 0;
      const names = new Map();
      (mappingIds || []).forEach((id) => {
        const p = progress.byMapping.get(String(id));
        if (!p) return;
        configured += p.configured;
        total += p.total;
        (p.names || []).forEach((n) => {
          const k = n.toLowerCase();
          if (!names.has(k)) names.set(k, n);
        });
      });
      shaped.setupProgress = { configured, total };
      shaped.courses = Array.from(names.values());
    }
    return shaped;
  });

  // The four header tiles. Every one of them counts the WHOLE book of work,
  // not the filtered rows and not the page — that is what the list showed, and
  // it is the reason these are computed over the institution rather than over
  // `data`.
  const stats = progress
    ? {
      mappings: progress.byMapping.size,
      courses: progress.totalCourses,
      configured: progress.configuredCount,
      pending: Math.max(0, progress.totalCourses - progress.configuredCount),
      clients: progress.clients,
      activeCourses: progress.activeCourses,
      inactiveCourses: Math.max(0, progress.totalCourses - progress.activeCourses),
    }
    : undefined;

  if (isExport) {
    return res.status(200).json({
      success: true, count: data.length, data, total,
      page: pageNum, limit: perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      ...(stats ? { stats } : {}),
    });
  }

  const facets = await getMappingFacets(institutionId, req.pocScope);
  if (progress) {
    // The Course filter's options. Deduped case-insensitively but shown with
    // the first spelling seen, exactly as the page built them.
    facets.courses = [...progress.courseNames.values()].sort((a, b) => a.localeCompare(b));
    // The Phase / Batch filters' options, narrowed to the picked clients the
    // same way the byClient facet narrows the others. `clients` was validated
    // above — a malformed value has already returned 400.
    let scopeClients = null;
    if (req.query.clients) scopeClients = new Set(JSON.parse(String(req.query.clients)).map(String));
    facets.courseStructure = mergeCourseStructures(progress, scopeClients);
  }

  return res.status(200).json({
    success: true,
    count: data.length,
    data,
    total,
    page: pageNum,
    limit: perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    facets,
    ...(stats ? { stats } : {}),
  });
}

/**
 * The filter dropdowns and header chips, which the page derived from the full
 * list. All are over EVERY mapping in the institution rather than the current
 * filter — which is what the page showed.
 */
async function getMappingFacets(institutionId, scope) {
  // Scoped for a POC as well: the `clients` facet returns every client company
  // name in the institution, so leaving it unscoped would leak the full client
  // list through the filter dropdown even when the rows themselves are scoped.
  const base = {
    institution: new mongoose.Types.ObjectId(String(institutionId)),
    ...pocMappingFilter(scope),
  };
  const [row] = await ServiceMapping.aggregate([
    { $match: base },
    {
      $lookup: {
        from: ClientManagement.collection.name,
        localField: "client",
        foreignField: "_id",
        as: "_client",
        pipeline: [{ $project: { clientCompany: 1, businessModel: 1 } }],
      },
    },
    // Same exclusion as the listing: mappings whose client is gone or unnamed
    // are not listed there, so they must not count in the tiles or offer a
    // blank entry in the Clients / year / model dropdowns either.
    { $match: { "_client.clientCompany": { $regex: /\S/ } } },
    {
      $facet: {
        years: [{ $group: { _id: "$year" } }],
        businessModels: [
          { $group: { _id: { $first: "$_client.businessModel" } } },
        ],
        services: [{ $group: { _id: "$service" } }],
        serviceModels: [{ $unwind: "$serviceModels" }, { $group: { _id: "$serviceModels" } }],
        modelsByBusiness: [
          { $unwind: "$serviceModels" },
          { $group: { _id: { $first: "$_client.businessModel" }, models: { $addToSet: "$serviceModels" } } },
        ],
        // Per business model AND service model: how many services carry it.
        // What the overview cards break their total down into ("B2B services
        // 18 — HTD: 2, TD: 3"). A mapping with two service models counts under
        // each, which is the question being asked: how many services carry
        // this model. Kept separate from `modelsByBusiness` (which is a plain
        // name list feeding the filter dropdowns) so neither shape has to bend
        // around the other.
        serviceModelCounts: [
          { $unwind: "$serviceModels" },
          {
            $group: {
              _id: {
                business: { $first: "$_client.businessModel" },
                model: "$serviceModels",
              },
              count: { $sum: 1 },
            },
          },
        ],
        // Per business model: how many SERVICES are mapped under it and how
        // many distinct clients hold them. The overview cards state both, and
        // neither is derivable from `byClient` — that facet carries each
        // client's distinct service NAMES, not a mapping count.
        byBusiness: [
          {
            $group: {
              _id: { $first: "$_client.businessModel" },
              services: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
              clients: { $addToSet: "$client" },
            },
          },
        ],
        clients: [
          {
            $group: {
              _id: "$client",
              name: { $first: { $first: "$_client.clientCompany" } },
            },
          },
        ],
        // What each client ACTUALLY has, so the page's Business model / Service
        // model / Year dropdowns can narrow to a client selection instead of
        // offering the whole institution. Grouped per client here rather than
        // recomputed per request: that selection changes on every checkbox, and
        // a round-trip per toggle would make the dropdowns flicker.
        byClient: [
          {
            $group: {
              _id: "$client",
              businessModel: { $first: { $first: "$_client.businessModel" } },
              // serviceModels and courses are themselves arrays on each
              // mapping, so these collect sets OF ARRAYS — flattened where they
              // are shaped below.
              serviceModels: { $addToSet: "$serviceModels" },
              years: { $addToSet: "$year" },
              services: { $addToSet: "$service" },
              courses: { $addToSet: "$courses.courseName" },
            },
          },
        ],
        // Every masterData entry, so the four hierarchy lists can be split out
        // by level below — one pass instead of four.
        levels: [
          { $unwind: "$masterData" },
          { $unwind: "$masterData.values" },
          {
            $group: {
              _id: { $toLower: { $trim: { input: "$masterData.level" } } },
              values: { $addToSet: "$masterData.values" },
            },
          },
        ],
        counts: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
              clients: { $addToSet: "$client" },
              models: { $addToSet: "$serviceModels" },
            },
          },
        ],
        // Per-year totals for the header sparklines. The page turns these into
        // CUMULATIVE series ("the book of work growing"), which it could only
        // do while it held every mapping — this is the one remaining reason it
        // needed the full list.
        byYear: [
          {
            $group: {
              _id: "$year",
              total: { $sum: 1 },
              active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
            },
          },
        ],
      },
    },
  ]);

  const flat = (arr) => (arr || []).map((x) => x._id).filter(Boolean);
  const byLevel = (name) => {
    const hit = (row?.levels || []).find((l) => l._id === name);
    return (hit?.values || []).filter(Boolean);
  };
  const c = row?.counts?.[0];

  return {
    // Newest year first, as the page sorted it.
    years: flat(row?.years).sort((a, b) => String(b).localeCompare(String(a))),
    services: flat(row?.services).sort(),
    serviceModels: flat(row?.serviceModels).sort(),
    businessModels: flat(row?.businessModels).sort(),
    modelsByBusiness: (row?.modelsByBusiness || []).filter((row) => row._id).map((row) => ({
      businessModel: row._id, models: row.models.filter(Boolean).sort(),
    })),
    byBusiness: (row?.byBusiness || []).filter((row) => row._id).map((row) => ({
      businessModel: row._id,
      services: row.services || 0,
      active: row.active || 0,
      clients: (row.clients || []).filter(Boolean).length,
    })),
    // Biggest first, so a card's breakdown leads with the model that carries
    // most of its work; ties fall back to the name for a stable order.
    serviceModelCounts: (row?.serviceModelCounts || [])
      .filter((x) => x._id?.business && x._id?.model)
      .map((x) => ({
        businessModel: x._id.business,
        model: x._id.model,
        count: x.count || 0,
      }))
      .sort((a, b) => b.count - a.count || String(a.model).localeCompare(String(b.model))),
    clients: (row?.clients || [])
      .filter((x) => x._id)
      .map((x) => [String(x._id), x.name || "Untitled"])
      .sort((a, b) => a[1].localeCompare(b[1])),
    byClient: (row?.byClient || [])
      .filter((x) => x._id)
      .map((x) => ({
        client: String(x._id),
        businessModel: x.businessModel || "",
        serviceModels: [...new Set((x.serviceModels || []).flat().filter(Boolean))].sort(),
        years: [...new Set((x.years || []).filter(Boolean).map(String))].sort(),
        services: [...new Set((x.services || []).filter(Boolean).map((s) => String(s).trim()).filter(Boolean))].sort(),
        courses: [...new Set((x.courses || []).flat().filter(Boolean).map((c) => String(c).trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b)),
      })),
    hierarchy: {
      degrees: byLevel("degree").sort(),
      departments: byLevel("department").sort(),
      sections: byLevel("section").sort(),
      // Semesters sort numerically — "Semester 10" after "Semester 9".
      semesters: byLevel("semester").sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true })),
    },
    // Ascending by year, matching the page's `years.sort()`.
    byYear: (row?.byYear || [])
      .filter((y) => y._id)
      .map((y) => ({ year: String(y._id), total: y.total, active: y.active }))
      .sort((a, b) => a.year.localeCompare(b.year)),
    counts: {
      total: c?.total || 0,
      active: c?.active || 0,
      clients: (c?.clients || []).filter(Boolean).length,
      models: [...new Set((c?.models || []).flat().filter(Boolean))].length,
    },
  };
}

const str = (v) => (v ? String(v).trim() : "");

// Mappings that carry partner institutions (existing clients where the sponsored
// training runs). CSR and COE are service models under B2B; the service-name check
// is kept for legacy mappings saved when CSR was a top-level business model.
const CSR_RE = /^\s*(csr|corporate[\s\-_]*social[\s\-_]*responsibility)\s*$/i;
const isCSR = (service) => CSR_RE.test(str(service));
const isCSRModel = (serviceModels) =>
  (Array.isArray(serviceModels) ? serviceModels : []).some((m) => CSR_RE.test(str(m)));
const isCOEModel = (serviceModels) =>
  (Array.isArray(serviceModels) ? serviceModels : []).some((m) =>
    /^\s*(coe|cent(er|re)[\s\-_]*of[\s\-_]*excellence)\s*$/i.test(str(m))
  );
const usesPartners = (service, serviceModels) =>
  isCSR(service) || isCSRModel(serviceModels) || isCOEModel(serviceModels);

// Normalize the batch configs (course batches; PRT department mode ties each
// batch to a degree + departments). Batches without a name are dropped.
const normalizeBatchConfigs = (batchConfigs) =>
  (Array.isArray(batchConfigs) ? batchConfigs : [])
    .map((b) => ({
      name: str(b && b.name),
      degree: str(b && b.degree),
      departments: uniq(cleanStrArray(b && b.departments)),
      // Phases are ordered stages, so duplicates are dropped but the order the
      // user entered them in is kept — unlike departments, which are a set.
      phases: cleanStrArray(b && b.phases),
    }))
    .filter((b) => b.name);

// Courses the mapping covers. A Degree Program stores one entry per course per
// semester, keyed by `path` ("B.E ▸ CSE ▸ A ▸ 3"); other flows store a single
// entry with no path. Entries missing a course name are dropped — they carry no
// information and would show as blank rows in Course Setup.
const normalizeCourses = (courses) =>
  (Array.isArray(courses) ? courses : [])
    .map((c) => {
      const batchesEnabled = Boolean(c && c.batchesEnabled);
      return {
        category: str(c && c.category),
        courseName: str(c && c.courseName),
        path: str(c && c.path),
        batchesEnabled,
        // Names only mean something when the course opted into batches; keeping
        // them otherwise would resurrect them if the box is ticked again later.
        batches: batchesEnabled ? cleanStrArray(c && c.batches) : [],
      };
    })
    .filter((c) => c.courseName);
const cleanStrArray = (arr) =>
  Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];

const normalizeStudentGroups = (groups) =>
  (Array.isArray(groups) ? groups : []).map((group) => ({
    path: str(group && group.path),
    sections: (Array.isArray(group?.sections) ? group.sections : []).map((section) => ({
      name: str(section && section.name),
      batches: cleanStrArray(section && section.batches),
    })).filter((section) => section.name),
  })).filter((group) => group.path);

// ── Placement course configurations ─────────────────────────────────────────
// One configuration per course: which course, for which academic batch and
// semester, and how its training batches are organised.
//
// Everything the client sends is rebuilt here rather than trusted. Ids are the
// reason: a batch names its phase by id, so a payload could otherwise point a
// batch at a phase in a DIFFERENT configuration, or at one that does not exist,
// and the document would save happily with a dangling reference no reader could
// resolve. Phase ids are therefore re-minted server-side and batches re-pointed
// through a map built in the same pass — a batch can only ever reference a phase
// that was written beside it.
//
// `order` is assigned from array position rather than taken from the payload.
// Position IS the order the user sees; storing what the client claims would let
// the two disagree.
const toObjectId = (v) => {
  const raw = String(v == null ? "" : v);
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
};

// `existing` is what the document already holds, and it is how identity
// survives a save. The wizard stores training batches as plain names — there is
// nowhere in its state to keep an id — so an update would otherwise arrive with
// no ids at all and mint fresh ones for the whole subtree. Reopening a mapping
// and pressing Save without changing anything would then renumber every phase
// and batch, which is exactly what carrying ids is meant to prevent.
//
// Matching is positional, then by name: the wizard sends configurations, phases
// and batches in the order the user sees them, so position is the truth about
// which record is which. Name is the tie-break for a batch inside a phase, since
// two phases may each hold a "Batch I".
const reuseId = (candidates, index, name) => {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const byPosition = candidates[index];
  if (byPosition && normKey(byPosition.name) === normKey(name)) return byPosition._id;
  const byName = candidates.find((c) => normKey(c.name) === normKey(name));
  if (byName) return byName._id;
  // A renamed record at the same position is still that record — the user edited
  // its name, they did not replace it.
  return byPosition ? byPosition._id : null;
};

const normalizeCourseConfigurations = (configs, existing) =>
  (Array.isArray(configs) ? configs : [])
    .map((cfg, cfgIndex) => {
      const prior = (Array.isArray(existing) ? existing : [])[cfgIndex] || null;
      const priorPhases = (prior && prior.phases) || [];
      const priorBatches = (prior && prior.trainingBatches) || [];
      const phaseConfigEnabled = Boolean(cfg && cfg.phaseConfigEnabled);
      const batchesEnabled = Boolean(cfg && cfg.batchesEnabled);

      // Phases only exist while phase configuration is on. Off, they are not
      // saved as empty placeholders — absence is recorded as absence, which is
      // what lets a reader tell the two modes apart without a second flag.
      const phases = phaseConfigEnabled
        ? (Array.isArray(cfg && cfg.phases) ? cfg.phases : [])
            .map((ph, i) => ({
              _id: toObjectId(ph && ph._id)
                || reuseId(priorPhases, i, str(ph && ph.name))
                || new mongoose.Types.ObjectId(),
              // The id the CLIENT used for this phase, so its batches can be
              // re-pointed at the id we just minted. Never stored.
              clientId: String((ph && ph._id) || (ph && ph.id) || ""),
              name: str(ph && ph.name),
              order: i,
            }))
        : [];

      // A nameless phase is NOT dropped here. It used to be filtered out, which
      // took its batches with it (their phaseId no longer resolved) and returned
      // 200 — a save that quietly deleted a phase and everything under it. It is
      // now left in place so the validator below can refuse the whole write and
      // say which phase is at fault.

      // client phase id (and the real one) → the id actually written
      const phaseIdMap = new Map();
      phases.forEach((ph) => {
        if (ph.clientId) phaseIdMap.set(ph.clientId, ph._id);
        phaseIdMap.set(String(ph._id), ph._id);
      });

      // Counts how many batches of each parent have been seen, so a batch is
      // matched against the right sibling of the stored list.
      const sameParentSeen = new Map();
      const rawBatches = Array.isArray(cfg && cfg.trainingBatches) ? cfg.trainingBatches : [];
      const trainingBatches = (batchesEnabled || phaseConfigEnabled)
        ? rawBatches
            .map((b) => {
              // With phases OFF every batch hangs off the configuration itself,
              // whatever the payload claims — this is what stops a batch being
              // left pointing at a phase the user can no longer see.
              const phaseId = phaseConfigEnabled
                ? phaseIdMap.get(String((b && b.phaseId) || "")) || null
                : null;
              // Keep the id the batch came in with; failing that, the id the
              // batch ALREADY had under this same parent. Letting Mongoose mint a
              // fresh one on every write would make a batch a different record
              // each time it is saved — and identity is the whole reason these
              // carry ids: two phases may legitimately hold a "Batch I", and only
              // the id tells them apart.
              const siblings = priorBatches.filter(
                (pb) => String(pb.phaseId || "") === String(phaseId || "")
              );
              const siblingIndex = sameParentSeen.get(String(phaseId || "root")) || 0;
              sameParentSeen.set(String(phaseId || "root"), siblingIndex + 1);
              return {
                _id: toObjectId(b && b._id)
                  || reuseId(siblings, siblingIndex, str(b && b.name))
                  || new mongoose.Types.ObjectId(),
                name: str(b && b.name),
                phaseId,
                order: 0,
              };
            })
            // A phased configuration's batches MUST land on a phase. One that
            // cannot be resolved is dropped rather than silently re-parented to
            // the configuration, where it would look like a batch the user
            // never created.
            .filter((b) => b.name && (!phaseConfigEnabled || b.phaseId))
        : [];

      // Order runs within each parent, not across the whole list: Batch I of
      // Phase II is the first batch of that phase, not the third overall.
      const seen = new Map();
      trainingBatches.forEach((b) => {
        const key = String(b.phaseId || "root");
        const next = (seen.get(key) || 0);
        b.order = next;
        seen.set(key, next + 1);
      });

      return {
        _id: toObjectId(cfg && cfg._id) || (prior && prior._id) || new mongoose.Types.ObjectId(),
        courseName: str(cfg && cfg.courseName),
        courseCategory: str(cfg && cfg.courseCategory),
        academicBatch: str(cfg && cfg.academicBatch),
        semester: str(cfg && cfg.semester),
        phaseConfigEnabled,
        // Phases carry their own batches, so a phased configuration always has
        // batches regardless of what the batches checkbox said.
        batchesEnabled: phaseConfigEnabled ? true : batchesEnabled,
        phases: phases.map(({ clientId, ...ph }) => ph),
        trainingBatches,
      };
    })
    // A configuration with no course names nothing and would show as a blank
    // row wherever it is read.
    .filter((cfg) => cfg.courseName);

// Reject rather than silently repair: a batch pointing outside its own
// configuration is a client bug, and swallowing it would hide the bug while
// writing data no reader can resolve. Returns an error string, or "" when sound.
const validateCourseConfigurations = (configs) => {
  for (const cfg of configs) {
    const ids = new Set(cfg.phases.map((ph) => String(ph._id)));
    if (cfg.phaseConfigEnabled && cfg.phases.length === 0) {
      return `"${cfg.courseName}" has phase configuration enabled but no phases.`;
    }
    const nameless = cfg.phases.findIndex((ph) => !ph.name);
    if (nameless !== -1) {
      return `Phase ${nameless + 1} of "${cfg.courseName}" has no name.`;
    }
    for (const b of cfg.trainingBatches) {
      if (!cfg.phaseConfigEnabled && b.phaseId) {
        return `"${cfg.courseName}" has phases disabled but batch "${b.name}" still references one.`;
      }
      if (b.phaseId && !ids.has(String(b.phaseId))) {
        return `Batch "${b.name}" references a phase outside "${cfg.courseName}".`;
      }
    }
  }
  return "";
};

// ── Reading a mapping saved BEFORE course configurations existed ────────────
// The old placement shape put phase names in masterData ("Phase") and hung the
// batches off each course, with the phase's NAME doubling as the course name and
// as the stored path. Nothing is migrated in place: this derives the new shape on
// read so an old mapping opens correctly, and the next save writes it properly.
const courseConfigurationsFromLegacy = (mapping) => {
  const doc = mapping && typeof mapping.toObject === "function" ? mapping.toObject() : mapping;
  if (!doc) return [];
  if (Array.isArray(doc.courseConfigurations) && doc.courseConfigurations.length) {
    return doc.courseConfigurations;
  }
  const courses = Array.isArray(doc.courses) ? doc.courses : [];
  if (!courses.length) return [];

  const phaseEntry = (Array.isArray(doc.masterData) ? doc.masterData : []).find(
    (m) => m && String(m.level).toLowerCase() === "phase"
  );
  const phaseNames = cleanStrArray(phaseEntry && phaseEntry.values);

  const mkBatches = (names, phaseId) =>
    cleanStrArray(names).map((name, i) => ({
      _id: new mongoose.Types.ObjectId(),
      name,
      phaseId: phaseId || null,
      order: i,
    }));

  // Phased: one course per phase, the phase name doubling as the course name.
  if (phaseNames.length) {
    const phases = phaseNames.map((name, i) => ({
      _id: new mongoose.Types.ObjectId(),
      name,
      order: i,
    }));
    const trainingBatches = [];
    phases.forEach((ph) => {
      const course = courses.find((c) => normKey(c.path || c.courseName) === normKey(ph.name));
      if (course && course.batchesEnabled) {
        trainingBatches.push(...mkBatches(course.batches, ph._id));
      }
    });
    const first = courses[0] || {};
    return [
      {
        _id: new mongoose.Types.ObjectId(),
        courseName: str(first.courseName) || phaseNames[0],
        courseCategory: str(first.category || doc.category),
        academicBatch: str(doc.year),
        semester: "",
        phaseConfigEnabled: true,
        batchesEnabled: true,
        phases,
        trainingBatches,
      },
    ];
  }

  // Unphased: each course carried its own batches directly.
  return courses.map((c) => ({
    _id: new mongoose.Types.ObjectId(),
    courseName: str(c.courseName),
    courseCategory: str(c.category || doc.category),
    academicBatch: str(doc.year),
    semester: "",
    phaseConfigEnabled: false,
    batchesEnabled: Boolean(c.batchesEnabled),
    phases: [],
    trainingBatches: c.batchesEnabled ? mkBatches(c.batches, null) : [],
  }));
};
const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

// Step 3 (Resources) of the wizard. Mirrors a course's own `resourcesType`
// shape so the default can be copied onto a new course verbatim. Keys are
// whitelisted — anything else sent is dropped rather than saved.
const FILE_RESOURCE_KEYS = ["video", "ppt", "pdf", "image", "zip"];
const SIMPLE_RESOURCE_KEYS = ["url", "aiChat", "aiSummary", "notes", "ai", "autoQuestionGenerate"];

const normalizeResourceConfig = (cfg) => {
  const src = cfg && typeof cfg === "object" ? cfg : {};
  const out = {};
  FILE_RESOURCE_KEYS.forEach((k) => {
    const v = src[k] && typeof src[k] === "object" ? src[k] : {};
    out[k] = {
      enabled: Boolean(v.enabled),
      maxSize: Number.isFinite(Number(v.maxSize)) ? Number(v.maxSize) : 0,
      aiChat: Boolean(v.aiChat),
      aiSummary: Boolean(v.aiSummary),
      notes: Boolean(v.notes),
      allowedFormats: cleanStrArray(v.allowedFormats),
    };
  });
  SIMPLE_RESOURCE_KEYS.forEach((k) => {
    const v = src[k] && typeof src[k] === "object" ? src[k] : {};
    out[k] = { enabled: Boolean(v.enabled) };
  });
  return out;
};

const normalizeResourceDefaults = (resourceDefaults) => {
  const src = resourceDefaults && typeof resourceDefaults === "object" ? resourceDefaults : {};
  return {
    iDo: normalizeResourceConfig(src.iDo),
    weDo: normalizeResourceConfig(src.weDo),
    youDo: normalizeResourceConfig(src.youDo),
  };
};

// Case-insensitive level lookup so "degree" / "Degree" both resolve.
const canonicalLevel = (level) =>
  HIERARCHY_LEVELS.find((l) => l.toLowerCase() === str(level).toLowerCase()) || str(level);

// Normalize the hierarchy config coming from the wizard into a full, ordered
// array covering every known level (unknown extra levels are kept at the end).
const normalizeHierarchy = (hierarchy) => {
  const byLevel = {};
  (Array.isArray(hierarchy) ? hierarchy : []).forEach((h) => {
    const level = canonicalLevel(h && h.level);
    if (!level) return;
    byLevel[level] = {
      level,
      enabled: Boolean(h.enabled || h.mandatory),
      mandatory: Boolean(h.mandatory),
    };
  });
  const known = HIERARCHY_LEVELS.map(
    (level) => byLevel[level] || { level, enabled: false, mandatory: false }
  );
  const extras = Object.values(byLevel).filter((h) => !HIERARCHY_LEVELS.includes(h.level));
  return [...known, ...extras];
};

// Keep master data only for enabled levels, values cleaned + deduped.
// Entries may carry a `group` (parent-level value) — e.g. departments per
// degree — so uniqueness is per (level, group) pair.
const normalizeMasterData = (masterData, hierarchy) => {
  const enabled = new Set(hierarchy.filter((h) => h.enabled).map((h) => h.level));
  const seen = new Set();
  return (Array.isArray(masterData) ? masterData : [])
    .map((m) => ({
      level: canonicalLevel(m && m.level),
      group: str(m && m.group) || undefined,
      values: uniq(cleanStrArray(m && m.values)),
    }))
    .filter((m) => {
      const key = `${m.level}::${m.group || ""}`;
      if (!m.level || !enabled.has(m.level) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

// Validate + resolve the partner institutions for a mapping. Returns
// { partners } — a deduped id array for CSR/COE mappings, or [] when the mapping
// doesn't use partners — or { error } with a status + message. Guarantees each
// partner is a real client in the same institution and is never the corporate
// client itself, so Client Management stays the single source with no duplication.
const resolvePartnerInstitutions = async ({ service, serviceModels, partnerInstitutions, clientId, institutionId }) => {
  if (!usesPartners(service, serviceModels)) return { partners: [] };
  const raw = Array.isArray(partnerInstitutions)
    ? partnerInstitutions
    : partnerInstitutions
      ? [partnerInstitutions]
      : [];
  const ids = uniq(raw.map((p) => str(p)));
  if (!ids.length) {
    return { error: { status: 400, message: "At least one partner institution is required" } };
  }
  for (const id of ids) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return { error: { status: 400, message: "Invalid partner institution" } };
    }
    if (String(id) === String(clientId)) {
      return { error: { status: 400, message: "Partner institution must be different from the corporate client" } };
    }
  }
  const count = await ClientManagement.countDocuments({ _id: { $in: ids }, institution: institutionId });
  if (count !== ids.length) {
    return { error: { status: 404, message: "One or more partner institutions not found" } };
  }
  return { partners: ids };
};

// ─── Legacy sync ──────────────────────────────────────────────────────────────
// Rebuild the client's embedded `services` array (legacy shape) from all of its
// service mappings, so existing consumers (Add Course Structure cascade, user
// listings, …) keep working unchanged. The ServiceMapping collection is the
// source of truth; client.services is a derived read model.

const mappingToLegacyEntry = (m) => {
  const md = {};
  const grouped = {}; // grouped[level][parentValue] = values (e.g. departments per degree)
  (m.masterData || []).forEach((e) => {
    const level = canonicalLevel(e.level);
    if (e.group) {
      grouped[level] = grouped[level] || {};
      grouped[level][e.group] = cleanStrArray(e.values);
    } else {
      md[level] = cleanStrArray(e.values);
    }
  });
  const degrees = md["Degree"] || [];
  const batches = md["Batch"] || [];

  // Sections and Semesters are stored GROUPED in the mapping — sections by the
  // full "Degree ▸ Department" path, semesters by degree — so they must be read
  // from `grouped`, not the flat `md`. (Reading them as flat left every
  // department showing "None configured".)
  const PATH_SEP = " ▸ ";
  const unionOf = (obj) =>
    Object.values(obj || {}).reduce((acc, v) => acc.concat(v), []);

  const sectionsFor = (deg, dept) => {
    const g = grouped["Section"];
    if (g) {
      return g[`${deg}${PATH_SEP}${dept}`] || g[dept] || [];
    }
    return md["Section"] || [];
  };
  const semestersFor = (deg) => {
    const g = grouped["Semester"];
    if (g) return g[deg] || (deg ? [] : unionOf(g));
    return md["Semester"] || [];
  };

  // Departments for a given degree: prefer the per-degree grouping; fall back
  // to the flat list (mapping saved before grouping existed).
  const departmentsForDegree = (deg) => {
    if (grouped["Department"]) return grouped["Department"][deg] || [];
    return md["Department"] || [];
  };
  const flatDepartments =
    md["Department"] ||
    Object.values(grouped["Department"] || {}).reduce((acc, v) => acc.concat(v), []);

  const toDeptBlocks = (names, deg) =>
    names.map((d) => ({
      department: d,
      sections: [...sectionsFor(deg, d)],
      semesters: [...semestersFor(deg)],
    }));

  // Degree-style mapping → degreePrograms blocks (one per batch × degree,
  // each carrying that degree's own departments).
  let degreePrograms = [];
  if (degrees.length) {
    const batchKeys = batches.length ? batches : [""];
    degreePrograms = batchKeys.flatMap((b) =>
      degrees.map((deg) => ({
        batch: b,
        degree: deg,
        departments: toDeptBlocks(departmentsForDegree(deg), deg),
      }))
    );
  } else if (flatDepartments.length) {
    degreePrograms = [{ batch: batches[0] || "", degree: "", departments: toDeptBlocks(flatDepartments, "") }];
  }

  return {
    service: m.service,
    year: m.year || "",
    serviceModals: cleanStrArray(m.serviceModels),
    // Batch-only mappings behave like the old company-style batches
    batches: degreePrograms.length ? [] : batches,
    degreePrograms,
  };
};

const syncClientServices = async (clientId) => {
  const mappings = await ServiceMapping.find({ client: clientId }).sort({ createdAt: 1 });
  const services = mappings.map(mappingToLegacyEntry);
  // updateOne to skip full-document validation on old client docs
  await ClientManagement.updateOne({ _id: clientId }, { $set: { services } });
};

// ─── Lazy migration ───────────────────────────────────────────────────────────
// Clients that still carry embedded services but have no mappings yet were
// configured through the old Client Management tab. Import those entries into
// the ServiceMapping collection once, so they show up (and stay editable) here.

const DEGREE_MODEL_RE = /degree/i;

// ─── Service code (human-readable id like "b2i-deg-be-1") ─────────────────────
// Format: <business model>-<service model>-<degree>-<n>, all lowercase. Business
// model from the service name, service model from the first selected model, degree
// from master data (degree flows only, dropped otherwise), and <n> the next unused
// index for that exact prefix (per-prefix numbering, scoped to the institution).
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]/g, "");
const businessModelAbbr = (service) => {
  const s = str(service);
  if (/business[\s\-_]*to[\s\-_]*institut|b2i/i.test(s)) return "b2i";
  if (/business[\s\-_]*to[\s\-_]*business|b2b/i.test(s)) return "b2b";
  if (/business[\s\-_]*to[\s\-_]*consumer|b2c/i.test(s)) return "b2c";
  return slug(s).slice(0, 3);
};
// First 3 letters of the first word — "Degree Program" → "deg", "CSR" → "csr".
const modelAbbr = (serviceModels) => {
  const first = cleanStrArray(serviceModels)[0] || "";
  return slug(first.split(/\s+/)[0] || "").slice(0, 3);
};
// The degree name from master data, e.g. "B.E" → "be"; "" for non-degree flows.
const degreeAbbr = (masterData) => {
  const deg = (Array.isArray(masterData) ? masterData : []).find(
    (m) => str(m && m.level).toLowerCase() === "degree"
  );
  const first = (deg && Array.isArray(deg.values) ? deg.values : []).find(Boolean) || "";
  return slug(first);
};
// Everything before the trailing "-<n>"; "" when nothing identifies the mapping yet.
const serviceCodePrefix = ({ service, serviceModels, masterData }) =>
  [businessModelAbbr(service), modelAbbr(serviceModels), degreeAbbr(masterData)]
    .filter(Boolean)
    .join("-");
// Highest <n> already stored for this exact prefix (0 when the prefix is unused).
// Taken as max-of-existing rather than a count so a deleted mapping never causes a
// collision the way a plain count could.
const maxServiceCodeIndex = async (institutionId, prefix) => {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = await ServiceMapping.find(
    { institution: institutionId, serviceCode: new RegExp(`^${escaped}-\\d+$`) },
    { serviceCode: 1 }
  ).lean();
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.serviceCode).slice(prefix.length + 1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
};
// Hands out codes for mappings that are not saved yet. Each prefix is seeded from
// the stored max once and then counted in memory, so a batch written in one go
// (the legacy migration below) can never give two mappings the same index.
const makeServiceCodeAllocator = (institutionId) => {
  const used = new Map(); // prefix → last index handed out
  return async (mapping) => {
    const prefix = serviceCodePrefix(mapping);
    if (!prefix) return "";
    if (!used.has(prefix)) used.set(prefix, await maxServiceCodeIndex(institutionId, prefix));
    const n = used.get(prefix) + 1;
    used.set(prefix, n);
    return `${prefix}-${n}`;
  };
};
// Assign the service code as soon as the mapping is created (step 1 of Map Service
// — client + business + service model), so it is generated and saved from the very
// first save. A degree flow's degree is only picked at step 2, so a step-1 code is
// "<bm>-<model>-<n>" (e.g. b2i-deg-1); once the degree arrives the code is UPGRADED
// to the full "<bm>-<model>-<degree>-<n>" (b2i-deg-be-1) and then stays stable.
// Returns the code to store, or the existing one unchanged.
const ensureServiceCode = async ({ institutionId, existingCode, service, serviceModels, masterData }) => {
  const models = cleanStrArray(serviceModels);
  const prefix = serviceCodePrefix({ service, serviceModels: models, masterData });
  if (!prefix) return str(existingCode);
  const existing = str(existingCode);
  if (existing) {
    // Already the code for this exact prefix — keep it stable.
    if (existing.startsWith(`${prefix}-`)) return existing;
    // Keep it otherwise too, UNLESS a degree flow that got its code at step 1
    // (before the degree) has now gained the degree — then upgrade to the full one.
    const isDegreeFlow = models.some((m) => DEGREE_MODEL_RE.test(m));
    if (!(isDegreeFlow && degreeAbbr(masterData))) return existing;
  }
  return `${prefix}-${(await maxServiceCodeIndex(institutionId, prefix)) + 1}`;
};

const legacyEntryToMappingDoc = (client, s) => {
  const programs = Array.isArray(s.degreePrograms) ? s.degreePrograms : [];
  const degrees = uniq(programs.map((p) => str(p.degree)));
  const allDepartments = programs.flatMap((p) => (Array.isArray(p.departments) ? p.departments : []));
  const departments = uniq(allDepartments.map((d) => str(d.department)));
  const sections = uniq(allDepartments.flatMap((d) => cleanStrArray(d.sections)));
  const semesters = uniq(allDepartments.flatMap((d) => cleanStrArray(d.semesters)));
  const batches = uniq([...cleanStrArray(s.batches), ...programs.map((p) => str(p.batch))]);

  const serviceModels = cleanStrArray(s.serviceModals);
  const isDegreeModel = serviceModels.some((mName) => DEGREE_MODEL_RE.test(mName));

  const valuesByLevel = {
    Degree: degrees,
    Department: departments,
    Batch: batches,
    Semester: semesters,
    Section: sections,
  };

  const hierarchy = HIERARCHY_LEVELS.map((level) => {
    const mandatory = isDegreeModel && (level === "Degree" || level === "Department");
    return {
      level,
      enabled: mandatory || (valuesByLevel[level] || []).length > 0,
      mandatory,
    };
  });

  const masterData = HIERARCHY_LEVELS.filter(
    (level) => level !== "Department" && (valuesByLevel[level] || []).length > 0
  ).map((level) => ({ level, values: valuesByLevel[level] }));

  // Departments keep their per-degree association (grouped entries) so the
  // old nesting (ME belongs to B.E, not to every degree) survives the import.
  const deptsByDegree = {};
  programs.forEach((p) => {
    const deg = str(p.degree);
    (Array.isArray(p.departments) ? p.departments : []).forEach((d) => {
      const name = str(d.department);
      if (!name) return;
      const key = deg || "";
      deptsByDegree[key] = deptsByDegree[key] || [];
      if (!deptsByDegree[key].includes(name)) deptsByDegree[key].push(name);
    });
  });
  Object.entries(deptsByDegree).forEach(([deg, names]) => {
    masterData.push(deg ? { level: "Department", group: deg, values: names } : { level: "Department", values: names });
  });

  return {
    institution: client.institution,
    client: client._id,
    service: str(s.service),
    year: str(s.year),
    serviceModels,
    hierarchy,
    masterData,
    status: "active",
    createdBy: "migrated-from-client-management",
  };
};

const migrateLegacyServices = async (institutionId) => {
  const clients = await ClientManagement.find({
    institution: institutionId,
    "services.0": { $exists: true },
  }).lean();
  if (!clients.length) return;

  const mapped = await ServiceMapping.distinct("client", { institution: institutionId });
  const mappedSet = new Set(mapped.map((id) => id.toString()));

  const docs = [];
  clients.forEach((client) => {
    if (mappedSet.has(client._id.toString())) return; // already managed here
    (client.services || []).forEach((s) => {
      if (str(s.service)) docs.push(legacyEntryToMappingDoc(client, s));
    });
  });
  if (!docs.length) return;
  // Codes are assigned here too. These mappings never pass through Map Service, so
  // without this they would sit at "—" in the Service Mapping / Course Setup lists
  // forever — and would come back code-less after any one-time backfill.
  const nextServiceCode = makeServiceCodeAllocator(institutionId);
  for (const doc of docs) {
    doc.serviceCode = await nextServiceCode(doc);
  }
  await ServiceMapping.insertMany(docs);
};

// ─── Controller ───────────────────────────────────────────────────────────────

const serviceMappingController = {
  // Create a client → service mapping
  createMapping: async (req, res) => {
    try {
      const institutionId = req.user.institution;
      const {
        client, partnerInstitutions, service, year, serviceModels, hierarchy, masterData, status,
        courseName, category, courses, studentGroups, prtMode, batchConfigs, courseId, courseCode, resourceDefaults,
        courseConfigurations,
      } = req.body;

      if (!client || !mongoose.Types.ObjectId.isValid(client)) {
        return res.status(400).json({ success: false, message: "A valid client is required" });
      }
      if (!str(service)) {
        return res.status(400).json({ success: false, message: "Service is required" });
      }

      const clientDoc = await ClientManagement.findOne({
        _id: client,
        institution: institutionId,
      });
      if (!clientDoc) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }

      const { partners, error: partnerError } = await resolvePartnerInstitutions({
        service,
        serviceModels,
        partnerInstitutions,
        clientId: client,
        institutionId,
      });
      if (partnerError) {
        return res.status(partnerError.status).json({ success: false, message: partnerError.message });
      }

      const cleanHierarchy = normalizeHierarchy(hierarchy);
      const cleanMasterData = normalizeMasterData(masterData, cleanHierarchy);
      // Generated here (step 1), never taken from the client. A degree flow gets a
      // step-1 code without the degree; the update that supplies the degree upgrades
      // it to the full code.
      const serviceCode = await ensureServiceCode({
        institutionId,
        existingCode: "",
        service,
        serviceModels,
        masterData: cleanMasterData,
      });
      // Built and checked BEFORE the write: the whole structure goes in as one
      // document, so the only way to keep it consistent is to refuse an
      // inconsistent one up front.
      // Nothing exists yet on create, so there are no ids to carry forward.
      const cleanCourseConfigurations = normalizeCourseConfigurations(courseConfigurations, []);
      const configError = validateCourseConfigurations(cleanCourseConfigurations);
      if (configError) {
        return res.status(400).json({ success: false, message: configError });
      }

      const mapping = await ServiceMapping.create({
        institution: institutionId,
        client,
        partnerInstitutions: partners,
        service: str(service),
        year: str(year),
        serviceModels: cleanStrArray(serviceModels),
        hierarchy: cleanHierarchy,
        masterData: cleanMasterData,
        serviceCode,
        courseName: str(courseName),
        category: str(category),
        courses: normalizeCourses(courses),
        studentGroups: normalizeStudentGroups(studentGroups),
        resourceDefaults: normalizeResourceDefaults(resourceDefaults),
        prtMode: prtMode === "general" || prtMode === "department" ? prtMode : "",
        batchConfigs: normalizeBatchConfigs(batchConfigs),
        courseConfigurations: cleanCourseConfigurations,
        courseId: str(courseId),
        courseCode: str(courseCode),
        status: status === "inactive" ? "inactive" : "active",
        createdBy: req.user.email,
      });

      await syncClientServices(client);

      res.status(201).json({
        success: true,
        message: "Service mapped successfully",
        data: mapping,
      });
    } catch (error) {
      console.error("Error creating service mapping:", error);
      res.status(500).json({
        success: false,
        message: "Error creating service mapping",
        error: error.message,
      });
    }
  },

  // All mappings for the institution (client populated for the list view).
  // Also lazily imports legacy client.services entries the first time.
  getAllMappings: async (req, res) => {
    try {
      const institutionId = req.user.institution;

      // ── Paginated mode (opt-in via `page`) ────────────────────────────────
      // Deliberately placed BEFORE the migration below. That migration writes
      // to every legacy mapping and runs on each call to this endpoint; with
      // the list paginated it would fire again on every page click, turning a
      // one-off backfill into per-request write traffic. The unpaginated path
      // still triggers it, so the backfill keeps happening exactly as often as
      // a full list read did.
      if (req.query.page !== undefined) {
        return await getMappingsPaginated(req, res, institutionId);
      }

      // Skipped for a POC: this is a bulk WRITE across every legacy mapping in
      // the institution, and a read-only principal must not trigger writes on
      // other clients' records just by opening a list.
      if (!req.pocScope?.isPoc) {
        try {
          await migrateLegacyServices(institutionId);
        } catch (migrationError) {
          console.error("Legacy service migration failed:", migrationError);
        }
      }

      // Read-only path — .lean() is the biggest cheap win on the BM hot path
      // (mappings embed 4-level nested masterData/hierarchy/courses/batchConfigs
      // subdocs; full Mongoose hydration was pure overhead). populate works
      // with lean.
      const mappings = await ServiceMapping.find({
        institution: institutionId,
        ...pocMappingFilter(req.pocScope),
      })
        .populate("client", "clientCompany status type businessModel")
        .populate("partnerInstitutions", "clientCompany status type businessModel")
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({
        success: true,
        count: mappings.length,
        data: mappings,
      });
    } catch (error) {
      console.error("Error fetching service mappings:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching service mappings",
        error: error.message,
      });
    }
  },

  // Single mapping by id
  getMappingById: async (req, res) => {
    try {
      const institutionId = req.user.institution;
      const { mappingId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(mappingId)) {
        return res.status(400).json({ success: false, message: "Invalid mapping ID format" });
      }

      // Membership test rather than a merged filter — the query below already
      // pins `_id`, so spreading a scope filter in would overwrite one of them.
      // Reuses the existing 404 so an out-of-scope id looks like a missing one.
      if (!scopeHasMapping(req.pocScope, mappingId)) {
        return res.status(404).json({ success: false, message: " not found" });
      }

      const mapping = await ServiceMapping.findOne({
        _id: mappingId,
        institution: institutionId,
      })
        .populate("client", "clientCompany status type businessModel")
        .populate("partnerInstitutions", "clientCompany status type businessModel");

      if (!mapping) {
        return res.status(404).json({ success: false, message: " not found" });
      }

      // A mapping saved before course configurations existed carries its phases
      // in masterData and its batches on the course. Derive the new shape on the
      // way out so the wizard opens it correctly; the document is NOT rewritten
      // here — the next save does that, and a read stays a read.
      const data = mapping.toObject();
      data.courseConfigurations = courseConfigurationsFromLegacy(mapping);

      res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("Error fetching service mapping:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching service mapping",
        error: error.message,
      });
    }
  },

  // All mappings of one client
  getMappingsByClient: async (req, res) => {
    try {
      const institutionId = req.user.institution;
      const { clientId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(clientId)) {
        return res.status(400).json({ success: false, message: "Invalid client ID format" });
      }

      // `clientId` is caller-supplied, so this is the direct URL-manipulation
      // path: a POC asking for a client outside its scope gets an empty list,
      // not that client's services. Empty rather than 404 because the caller
      // may legitimately not know the id is out of scope.
      if (!scopeHasClient(req.pocScope, clientId)) {
        return res.status(200).json({ success: true, count: 0, data: [] });
      }

      const mappings = await ServiceMapping.find({
        institution: institutionId,
        client: clientId,
      })
        .populate("client", "clientCompany status type businessModel")
        .populate("partnerInstitutions", "clientCompany status type businessModel")
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({ success: true, count: mappings.length, data: mappings });
    } catch (error) {
      console.error("Error fetching client mappings:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching client mappings",
        error: error.message,
      });
    }
  },

  // Update a mapping
  updateMapping: async (req, res) => {
    try {
      const institutionId = req.user.institution;
      const { mappingId } = req.params;
      const updateData = req.body;

      if (!mongoose.Types.ObjectId.isValid(mappingId)) {
        return res.status(400).json({ success: false, message: "Invalid mapping ID format" });
      }

      const mapping = await ServiceMapping.findOne({
        _id: mappingId,
        institution: institutionId,
      });
      if (!mapping) {
        return res.status(404).json({ success: false, message: " not found" });
      }

      if (updateData.service !== undefined) {
        if (!str(updateData.service)) {
          return res.status(400).json({ success: false, message: "Service is required" });
        }
        mapping.service = str(updateData.service);
      }
      if (updateData.year !== undefined) mapping.year = str(updateData.year);
      if (updateData.serviceModels !== undefined) {
        mapping.serviceModels = cleanStrArray(updateData.serviceModels);
      }
      if (updateData.hierarchy !== undefined) {
        mapping.hierarchy = normalizeHierarchy(updateData.hierarchy);
      }
      if (updateData.masterData !== undefined) {
        mapping.masterData = normalizeMasterData(updateData.masterData, mapping.hierarchy);
      }
      if (updateData.courseName !== undefined) mapping.courseName = str(updateData.courseName);
      if (updateData.category !== undefined) mapping.category = str(updateData.category);
      if (updateData.courses !== undefined) mapping.courses = normalizeCourses(updateData.courses);
      if (updateData.studentGroups !== undefined) mapping.studentGroups = normalizeStudentGroups(updateData.studentGroups);
      if (updateData.resourceDefaults !== undefined) {
        mapping.resourceDefaults = normalizeResourceDefaults(updateData.resourceDefaults);
      }
      if (updateData.prtMode !== undefined) {
        mapping.prtMode =
          updateData.prtMode === "general" || updateData.prtMode === "department"
            ? updateData.prtMode
            : "";
      }
      if (updateData.batchConfigs !== undefined) {
        mapping.batchConfigs = normalizeBatchConfigs(updateData.batchConfigs);
      }
      if (updateData.courseConfigurations !== undefined) {
        const nextConfigs = normalizeCourseConfigurations(
          updateData.courseConfigurations,
          mapping.courseConfigurations
        );
        const configError = validateCourseConfigurations(nextConfigs);
        if (configError) {
          return res.status(400).json({ success: false, message: configError });
        }
        mapping.courseConfigurations = nextConfigs;
      }
      if (updateData.courseId !== undefined) mapping.courseId = str(updateData.courseId);
      if (updateData.courseCode !== undefined) mapping.courseCode = str(updateData.courseCode);
      if (updateData.status !== undefined) {
        mapping.status = updateData.status === "inactive" ? "inactive" : "active";
      }

      // Re-resolve the partner institutions whenever the service or the partners
      // themselves change. `mapping.service` already reflects this update above, so a
      // mapping switched away from CSR/COE drops its partners, and one switched to a
      // partner service must now supply at least one valid partner.
      if (
        updateData.partnerInstitutions !== undefined ||
        updateData.service !== undefined ||
        updateData.serviceModels !== undefined
      ) {
        const nextPartners =
          updateData.partnerInstitutions !== undefined
            ? updateData.partnerInstitutions
            : mapping.partnerInstitutions;
        const { partners, error: partnerError } = await resolvePartnerInstitutions({
          service: mapping.service,
          serviceModels: mapping.serviceModels,
          partnerInstitutions: nextPartners,
          clientId: mapping.client,
          institutionId,
        });
        if (partnerError) {
          return res.status(partnerError.status).json({ success: false, message: partnerError.message });
        }
        mapping.partnerInstitutions = partners;
      }

      // Assign the service code once the mapping first becomes complete (e.g. a
      // degree flow whose degree arrives on this save). Existing codes never change.
      mapping.serviceCode = await ensureServiceCode({
        institutionId,
        existingCode: mapping.serviceCode,
        service: mapping.service,
        serviceModels: mapping.serviceModels,
        masterData: mapping.masterData,
      });

      mapping.updatedBy = req.user.email;
      await mapping.save();
      await syncClientServices(mapping.client);

      res.status(200).json({
        success: true,
        message: " updated successfully",
        data: mapping,
      });
    } catch (error) {
      console.error("Error updating service mapping:", error);
      res.status(500).json({
        success: false,
        message: "Error updating service mapping",
        error: error.message,
      });
    }
  },

  // Delete a mapping — and EVERYTHING it owns. The mapping's courses, their
  // module/topic trees, pedagogy and level views, exams and answers, live
  // questions, retests, calendars, schedules, attendance, groups, feedback,
  // activity logs, code workspaces and per-user submissions all cascade; user
  // ACCOUNTS survive with their mapping linkage unset. (Before this, only the
  // mapping doc was removed and all of that was orphaned forever.)
  deleteMapping: async (req, res) => {
    try {
      const institutionId = req.user.institution;
      const { mappingId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(mappingId)) {
        return res.status(400).json({ success: false, message: "Invalid mapping ID format" });
      }

      // Look up first, delete LAST: the cascade needs the still-existing
      // mapping to collect its course ids, and a mid-cascade failure must
      // leave the mapping visible so the delete can simply be retried.
      const mapping = await ServiceMapping.findOne({
        _id: mappingId,
        institution: institutionId,
      });
      if (!mapping) {
        return res.status(404).json({ success: false, message: " not found" });
      }

      const courseIds = await collectMappingCourseIds(mapping);
      const cascade = await cascadeDeleteCourses(courseIds);
      const usersDetached = await detachUsersFromMapping(mapping._id);

      await ServiceMapping.deleteOne({ _id: mapping._id });

      // Mandatory, and specifically AFTER the delete: rebuilds the client's
      // derived services[] from the remaining mappings (writes [] when none).
      // Skipping it lets migrateLegacyServices re-import this mapping from
      // the stale snapshot with a fresh service code.
      await syncClientServices(mapping.client);

      res.status(200).json({
        success: true,
        message: " deleted successfully",
        cascade: { ...cascade, usersDetached },
      });
    } catch (error) {
      console.error("Error deleting service mapping:", error);
      res.status(500).json({
        success: false,
        message: "Error deleting service mapping",
        error: error.message,
      });
    }
  },

  // Toggle active / inactive status
  toggleMappingStatus: async (req, res) => {
    try {
      const institutionId = req.user.institution;
      const { mappingId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(mappingId)) {
        return res.status(400).json({ success: false, message: "Invalid mapping ID format" });
      }

      const mapping = await ServiceMapping.findOne({
        _id: mappingId,
        institution: institutionId,
      });
      if (!mapping) {
        return res.status(404).json({ success: false, message: " not found" });
      }

      mapping.status = mapping.status === "active" ? "inactive" : "active";
      mapping.updatedBy = req.user.email;
      await mapping.save();

      res.status(200).json({
        success: true,
        message: ` ${mapping.status === "active" ? "activated" : "deactivated"} successfully`,
        data: { mappingId: mapping._id, status: mapping.status },
      });
    } catch (error) {
      console.error("Error toggling service mapping status:", error);
      res.status(500).json({
        success: false,
        message: "Error toggling service mapping status",
        error: error.message,
      });
    }
  },
};

module.exports = serviceMappingController;
// Exposed for scripts/backfillServiceCodes.js so a one-off backfill mints ids
// through exactly the same path the app uses. Not a route handler.
module.exports.ensureServiceCode = ensureServiceCode;
// Exposed for scripts/verifyCourseSetupPagination.js, which replays Course
// Setup's own filter/sort predicate over the full list and asserts this
// endpoint selects the same rows. Not route handlers.
module.exports.getMappingsPaginated = getMappingsPaginated;
module.exports.getSetupProgress = getSetupProgress;
module.exports.setupStatusOf = setupStatusOf;
