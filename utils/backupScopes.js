// utils/backupScopes.js
//
// The SELECTION ENGINE for the Backup module. Pure planner: it resolves ids and
// returns a list of { collection, filter } steps. It never reads a document it
// is going to back up, never counts and never writes — services/backupService.js
// does all of that from the plan this file produces.
//
// The course expansion below is a READ-ONLY MIRROR of utils/cascadeDeleteCourses.js.
// That file is the live, tested dependency list for "everything that hangs off a
// course"; a backup must select exactly what the cascade would delete, so the
// collection list, the $or orphan sweeps and the string-vs-ObjectId handling are
// copied from it one for one. collectExerciseIdStrings is IMPORTED from it rather
// than re-implemented, so the two can never drift.
//
// Deltas from the cascade, all deliberate:
//   + lesson-glossaries  (courseId) — the cascade misses it; it is genuinely
//                        course-owned data and belongs in a backup.
//   + the course's own service mapping, reached through course.mappingId.
//   + lms-users matched by the EMBEDDED enrolment roster
//     (course.batchAndParticipants[].users[].user), not only by courses.courseId.
//   - lesson-text-maps / pptcaches: keyed by file URL only, global caches shared
//     across courses (the cascade deliberately keeps PptCache). Reproducible
//     derived data, so they are out of scope.
//
// Field-type traps honoured here (verified against the schemas):
//   - course-structures.mappingId and lms-servicemappings.courseId are STRINGS.
//   - studentworkspaces.courseId is a STRING.
//   - questionbanks is ONE doc per institution; questions[].courseId is a STRING.
//   - examsessions / studentquestionactivities / screenviolations /
//     proctormessages / questiondrafts carry NO courseId — they key on the STRING
//     _id of an exercise embedded in a node's pedagogy maps, so those ids must be
//     harvested from module1/submodule1/topic1/subtopic1 first.
//   - institute-holiday-calendars.instituteId is a STRING, either "<institutionId>"
//     or "<institutionId>__client__<clientId>".

const { AsyncLocalStorage } = require("node:async_hooks");
const mongoose = require("mongoose");
const { collectExerciseIdStrings } = require("./cascadeDeleteCourses");

// ── Resolved MongoDB collection names ────────────────────────────────────────
// Mongoose 7 defaults (lowercase + pluralize, names ending in a digit unchanged).
// Kept as constants so a typo is a one-place fix and the planner is not coupled
// to model-registration order.
const C = {
  institutions: "lms-institutions",
  clients: "lms-clientmanagements",
  mappings: "lms-servicemappings",
  users: "lms-users",
  roles: "roles",
  courses: "course-structures",
  legacyModuleTrees: "module-structure-demos",
  modules: "module1",
  subModules: "submodule1",
  topics: "topic1",
  subTopics: "subtopic1",
  levelViews: "level-views",
  pedagogyViews: "pedagogy-views",
  liveQuestions: "livequestions",
  studentResponses: "studentresponses",
  examSessions: "examsessions",
  questionActivities: "studentquestionactivities",
  screenViolations: "screenviolations",
  proctorMessages: "proctormessages",
  questionDrafts: "questiondrafts",
  retestRequests: "retestrequests",
  programCalendars: "program-calendars",
  calendarSchedules: "calendarschedules",
  attendance: "studentattendances",
  groups: "course-groups",
  activityLogs: "activitylogs",
  feedbacks: "feedbacks",
  glossaries: "lesson-glossaries",
  workspaces: "studentworkspaces",
  compiler: "compiler12",
  questionBanks: "questionbanks",
  holidayCalendars: "institute-holiday-calendars",
  degrees: "degrees",
  dynamicCourseCatalog: "course-structure-dynamics",
  pedagogyVocabulary: "pedagogystructuredynamics",
  bulkMessaging: "bulk_messaging_datas",
  individualMessaging: "individual_messaging_datas",
  externalAssessments: "externalassessments",
  externalParticipants: "externalparticipants",
  externalInvitations: "externalinvitations",
  externalAttempts: "externalattempts",
  institutionPermissions: "client-institutionpermissions",
  rolePermissions: "client-rolepermissions",
  subscriptions: "client-subscriptions",
  resourceSettings: "client-resourcesettings",
};

const SCOPES = ["client", "users", "course", "client-full", "institution"];
const SCOPES_REQUIRING_TARGET = ["client", "course", "client-full"];

// ── Small helpers ────────────────────────────────────────────────────────────

// A named error the controller turns into a 400/404 instead of a 500.
class BackupPlanError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "BackupPlanError";
    this.statusCode = statusCode;
  }
}

/**
 * The database a plan is being built against.
 *
 * Normally the live one. Restoring a DB-COPY backup, though, has to resolve
 * the plan against the BACKUP database instead: the whole point of that
 * restore is that the live database has lost the data, so resolving course
 * ids, module ids and exercise ids there would find nothing and produce an
 * empty plan.
 *
 * AsyncLocalStorage rather than a module-level `let`: this module is shared by
 * every concurrent request, and a plain variable set around an `await` would
 * leak one request's database into another's plan the moment two overlapped —
 * a backup running during a restore would silently read the wrong database.
 * ALS scopes the value to one async call tree, so that cannot happen.
 */
const dbScope = new AsyncLocalStorage();

const rawDb = () => {
  const scoped = dbScope.getStore();
  if (scoped) return scoped;
  const db = mongoose.connection && mongoose.connection.db;
  if (!db) throw new BackupPlanError("Database connection is not ready", 500);
  return db;
};

/** Run `fn` with every query in this module pointed at `db`. */
const withDatabase = (db, fn) => dbScope.run(db, fn);

const col = (name) => rawDb().collection(name);

const isValidId = (value) =>
  !!value && mongoose.Types.ObjectId.isValid(String(value));

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

/**
 * Match value for the `institution` FIELD.
 *
 * Verified against live data: course-structures holds `institution` as a raw
 * STRING on some documents (4 of 96 at the time of writing) while the schema and
 * every other collection use an ObjectId. A plain ObjectId equality silently
 * skips those documents — every existing controller has that blind spot, and a
 * backup that silently omits courses is worse than one that is slightly generous.
 * So the institution field is always matched as BOTH types. (`_id` lookups are
 * unaffected and stay strict ObjectIds.)
 */
const institutionMatch = (institution) => ({
  $in: [toObjectId(institution), String(institution)],
});

// Batch size for every cursor this file opens. Prep queries stream; nothing is
// ever pulled into memory as a whole collection.
const PREP_BATCH = 500;

// distinct() on the raw driver, with an empty-input short circuit so we never
// send a `{ $in: [] }` scan we already know matches nothing.
const distinctIds = async (name, field, filter) => {
  const values = await col(name).distinct(field, filter);
  return values.filter(Boolean);
};

// ── Course expansion (the helper 'course', 'client-full' and 'institution' share)

/**
 * Resolve every id a course's children are keyed by, streaming the node docs so
 * the pedagogy trees are never all resident at once.
 */
async function prepareCourseIds(courseIds) {
  const courseIdStrings = courseIds.map(String);

  const [moduleIds, subModuleIds, topicIds] = await Promise.all([
    distinctIds(C.modules, "_id", { courses: { $in: courseIds } }),
    distinctIds(C.subModules, "_id", { courses: { $in: courseIds } }),
    distinctIds(C.topics, "_id", { courses: { $in: courseIds } }),
  ]);

  // Exercise ids live inside pedagogy.I_Do / We_Do / You_Do on the node docs.
  // Harvest them in batches through a cursor: the pedagogy subtree is the
  // heaviest thing in the database and must not be materialised whole.
  const exerciseIdSet = new Set();
  for (const nodeCollection of [C.modules, C.subModules, C.topics, C.subTopics]) {
    const cursor = col(nodeCollection)
      .find({ courses: { $in: courseIds } }, { projection: { pedagogy: 1 } })
      .batchSize(PREP_BATCH);
    let buffer = [];
    // eslint-disable-next-line no-await-in-loop
    for await (const doc of cursor) {
      buffer.push(doc);
      if (buffer.length >= PREP_BATCH) {
        collectExerciseIdStrings(buffer).forEach((id) => exerciseIdSet.add(id));
        buffer = [];
      }
    }
    if (buffer.length) {
      collectExerciseIdStrings(buffer).forEach((id) => exerciseIdSet.add(id));
    }
  }

  const [liveQuestionIds, groupIds] = await Promise.all([
    distinctIds(C.liveQuestions, "_id", { courses: { $in: courseIds } }),
    distinctIds(C.groups, "_id", { course: { $in: courseIds } }),
  ]);

  // The authoritative enrolment roster is embedded on the course, and the
  // mapping a course belongs to is a STRING forward pointer.
  const rosterUserIds = new Set();
  const mappingIdStrings = new Set();
  const courseCursor = col(C.courses)
    .find(
      { _id: { $in: courseIds } },
      { projection: { "batchAndParticipants.users.user": 1, mappingId: 1 } }
    )
    .batchSize(PREP_BATCH);
  for await (const course of courseCursor) {
    (course.batchAndParticipants || []).forEach((batch) => {
      (batch.users || []).forEach((entry) => {
        if (entry && entry.user) rosterUserIds.add(String(entry.user));
      });
    });
    if (course.mappingId && isValidId(course.mappingId)) {
      mappingIdStrings.add(String(course.mappingId));
    }
  }

  return {
    courseIds,
    courseIdStrings,
    moduleIds,
    subModuleIds,
    topicIds,
    exerciseIds: [...exerciseIdSet],
    liveQuestionIds,
    groupIds,
    rosterUserIds: [...rosterUserIds].map(toObjectId),
    mappingIds: [...mappingIdStrings].map(toObjectId),
  };
}

/**
 * THE course expansion. Given course ids (one for 'course', many for
 * 'client-full' / 'institution'), return every step needed to back the courses
 * up completely. Steps whose key list is empty are omitted rather than emitted
 * as a `{ $in: [] }` no-op.
 */
async function buildCourseSteps(courseIds, institution) {
  if (!courseIds.length) return [];

  const ids = await prepareCourseIds(courseIds);
  const steps = [];
  const push = (collection, filter) => steps.push({ collection, filter });
  const inCourses = { $in: ids.courseIds };

  // ── The course documents themselves
  push(C.courses, { _id: inCourses });

  // ── Content hierarchy (both the current and the legacy tree) + views.
  // The $or sweeps mirror the cascade: no controller validates that a child's
  // `courses` matches its parent's, so a mis-filed child is still caught
  // through its parent id.
  push(C.legacyModuleTrees, { courses: inCourses });
  push(C.modules, { courses: inCourses });
  push(
    C.subModules,
    ids.moduleIds.length
      ? { $or: [{ courses: inCourses }, { moduleId: { $in: ids.moduleIds } }] }
      : { courses: inCourses }
  );
  {
    const topicOr = [{ courses: inCourses }];
    if (ids.moduleIds.length) topicOr.push({ moduleId: { $in: ids.moduleIds } });
    if (ids.subModuleIds.length) topicOr.push({ subModuleId: { $in: ids.subModuleIds } });
    push(C.topics, topicOr.length > 1 ? { $or: topicOr } : topicOr[0]);
  }
  push(
    C.subTopics,
    ids.topicIds.length
      ? { $or: [{ courses: inCourses }, { topicId: { $in: ids.topicIds } }] }
      : { courses: inCourses }
  );
  push(C.levelViews, { courses: inCourses });
  push(C.pedagogyViews, { courses: inCourses });

  // ── Live questions and their responses (responses reach the course ONLY
  // through liveQuestion).
  if (ids.liveQuestionIds.length) {
    push(C.liveQuestions, { _id: { $in: ids.liveQuestionIds } });
    push(C.studentResponses, { liveQuestion: { $in: ids.liveQuestionIds } });
  }

  // ── Exam / proctoring / draft family: keyed on STRING exercise ids only.
  if (ids.exerciseIds.length) {
    const byAssessment = { assessmentId: { $in: ids.exerciseIds } };
    push(C.examSessions, byAssessment);
    push(C.questionActivities, byAssessment);
    push(C.screenViolations, byAssessment);
    push(C.proctorMessages, byAssessment);
    push(C.questionDrafts, { exerciseId: { $in: ids.exerciseIds } });
  }

  // ── Scheduling / operations / feedback
  push(C.retestRequests, { courseId: inCourses });
  push(C.programCalendars, { courseId: inCourses });
  push(C.calendarSchedules, { courseId: inCourses });
  push(C.attendance, { courseId: inCourses });
  push(C.groups, { course: inCourses });
  push(C.activityLogs, { courseId: inCourses });
  push(C.feedbacks, { courseId: inCourses });
  push(C.glossaries, { courseId: inCourses });

  // ── STRING courseId — ObjectIds in $in would match nothing here.
  push(C.workspaces, { courseId: { $in: ids.courseIdStrings } });

  // ── The mapping side: the STRING back-pointer on the mapping, plus the
  // mapping each course points at through its own STRING mappingId.
  {
    const mappingOr = [{ courseId: { $in: ids.courseIdStrings } }];
    if (ids.mappingIds.length) mappingOr.push({ _id: { $in: ids.mappingIds } });
    push(C.mappings, mappingOr.length > 1 ? { $or: mappingOr } : mappingOr[0]);
  }

  // ── People. Progress and final answers are EMBEDDED on the user document, so
  // the whole user doc is the unit of backup. Two routes to a participant:
  // the embedded courses[] entry, and the course's own roster.
  {
    const userOr = [{ "courses.courseId": inCourses }];
    if (ids.rosterUserIds.length) userOr.push({ _id: { $in: ids.rosterUserIds } });
    push(C.users, userOr.length > 1 ? { $or: userOr } : userOr[0]);
  }
  push(C.compiler, { "courses.courseId": inCourses });

  // Deliberately NOT selecting `questionbanks` here. It is ONE document per
  // INSTITUTION (models/Courses/QuestionbankModal.js) with every course's
  // questions embedded in one `questions[]` array — there is no per-course
  // document to select. A document-level filter on "questions.courseId in
  // <this course>" still captures the WHOLE bank doc, including every other
  // course's questions and the general bank. Restoring a course-scope backup
  // in overwrite mode would then replaceOne() that whole document and wipe
  // any edits made to OTHER courses' questions since the backup was taken.
  // It is master data covered wholesale by the institution scope instead
  // (INSTITUTION_SCOPED below); cascadeDeleteCourses.js makes the same call
  // and never deletes the bank when a course is removed.

  return steps;
}

// ── Target resolution ────────────────────────────────────────────────────────

async function loadClient(institution, clientId) {
  if (!isValidId(clientId)) throw new BackupPlanError("Invalid client id");
  const client = await col(C.clients).findOne(
    { _id: toObjectId(clientId), institution: institutionMatch(institution) },
    { projection: { clientCompany: 1 } }
  );
  if (!client) throw new BackupPlanError("Client not found for this institution", 404);
  return client;
}

async function loadCourse(institution, courseId) {
  if (!isValidId(courseId)) throw new BackupPlanError("Invalid course id");
  const course = await col(C.courses).findOne(
    { _id: toObjectId(courseId), institution: institutionMatch(institution) },
    { projection: { courseName: 1, courseCode: 1 } }
  );
  if (!course) throw new BackupPlanError("Course not found for this institution", 404);
  return course;
}

/**
 * Every course id owned by a client. Three routes, unioned, because live data
 * drifts (cascadeDeleteCourses.js:101-118 documents the same union):
 *   1. course.clientId          — the direct link (autoEnrollUser.js:193)
 *   2. course.mappingId STRING  — legacy courses can carry a mapping but a stale
 *                                 clientId
 *   3. mapping.courseId STRING  — an older mapping points at its auto-created
 *                                 course while that course still has mappingId ""
 * Route 3 is re-checked against the institution so a drifted back-pointer can
 * never pull a foreign tenant's course into the backup.
 */
async function collectClientCourseIds(institution, clientId, mappings) {
  const institutionId = institutionMatch(institution);
  const clientObjectId = toObjectId(clientId);
  const ids = new Set();

  const byClient = await distinctIds(C.courses, "_id", {
    institution: institutionId,
    clientId: clientObjectId,
  });
  byClient.forEach((id) => ids.add(String(id)));

  const mappingIdStrings = mappings.map((m) => String(m._id));
  if (mappingIdStrings.length) {
    const byMapping = await distinctIds(C.courses, "_id", {
      institution: institutionId,
      mappingId: { $in: mappingIdStrings },
    });
    byMapping.forEach((id) => ids.add(String(id)));
  }

  const backPointers = mappings
    .map((m) => m.courseId)
    .filter((value) => isValidId(value))
    .map(toObjectId);
  if (backPointers.length) {
    const verified = await distinctIds(C.courses, "_id", {
      institution: institutionId,
      _id: { $in: backPointers },
    });
    verified.forEach((id) => ids.add(String(id)));
  }

  return [...ids].map(toObjectId);
}

async function loadClientMappings(institution, clientId) {
  const clientObjectId = toObjectId(clientId);
  // `institution` is optional on lms-servicemappings and is missing on some
  // legacy rows, so the client link (which is required) is the scoping key —
  // the client itself has already been proven to belong to this institution.
  return col(C.mappings)
    .find({ client: clientObjectId }, { projection: { courseId: 1 } })
    .toArray();
}

// The client document + its mappings. Partner rows (CSR/COE engagements
// delivered at this client but owned by another) are included so the client's
// own view of its engagements survives a restore.
function buildClientSteps(institution, clientId) {
  const clientObjectId = toObjectId(clientId);
  return [
    {
      collection: C.clients,
      filter: { _id: clientObjectId, institution: institutionMatch(institution) },
    },
    {
      collection: C.mappings,
      filter: {
        $or: [{ client: clientObjectId }, { partnerInstitutions: clientObjectId }],
      },
    },
  ];
}

// Users of a client. Derived from UserModel.js:752/770 (there is no existing
// controller query for it): a user can hold several memberships at once, the
// legacy single one on clientId and any number in the services[] array.
/**
 * Every user id on the roster of ANY course in the institution — the
 * institution-wide counterpart of collectClientRosterUserIds below. Streamed
 * with a cursor rather than distinct(), since the roster is a nested array
 * field (batchAndParticipants.users.user) across every course in a tenant
 * that could hold tens of thousands of documents.
 */
async function collectInstitutionRosterUserIds(institution) {
  const roster = new Set();
  const cursor = col(C.courses)
    .find(
      { institution: institutionMatch(institution) },
      { projection: { "batchAndParticipants.users.user": 1 } }
    )
    .batchSize(PREP_BATCH);
  for await (const course of cursor) {
    (course.batchAndParticipants || []).forEach((batch) => {
      (batch.users || []).forEach((entry) => {
        if (entry && entry.user) roster.add(String(entry.user));
      });
    });
  }
  return [...roster].map(toObjectId);
}

/**
 * Every user id on the roster of any course belonging to this client.
 *
 * Needed because a user's OWN document frequently does not name the client:
 * on live data `clientId` and `services[]` are both unset for learners, and the
 * only record that they belong to the client is the embedded roster on the
 * client's courses. Selecting users by clientId alone therefore returns nothing
 * for a client whose courses have participants.
 */
async function collectClientRosterUserIds(institution, clientId, mappings) {
  const courseIds = await collectClientCourseIds(institution, clientId, mappings);
  if (!courseIds.length) return [];

  const roster = new Set();
  const cursor = col(C.courses)
    .find(
      { _id: { $in: courseIds } },
      { projection: { "batchAndParticipants.users.user": 1 } }
    )
    .batchSize(PREP_BATCH);
  for await (const course of cursor) {
    (course.batchAndParticipants || []).forEach((batch) => {
      (batch.users || []).forEach((entry) => {
        if (entry && entry.user) roster.add(String(entry.user));
      });
    });
  }
  return [...roster].map(toObjectId);
}

/**
 * Users belonging to a client, by all three routes.
 *
 * The roster branch carries NO institution filter, matching buildCourseSteps:
 * a roster id is already proven to belong to this client's own course, and
 * learners on live data carry an institution that does not always match the
 * course's. Filtering it would reintroduce the very hole this branch closes.
 */
function buildClientUsersStep(institution, clientId, rosterUserIds = []) {
  const clientObjectId = toObjectId(clientId);
  const institutionId = institutionMatch(institution);
  const or = [
    { institution: institutionId, clientId: clientObjectId },
    { institution: institutionId, "services.clientId": clientObjectId },
  ];
  if (rosterUserIds.length) or.push({ _id: { $in: rosterUserIds } });
  return { collection: C.users, filter: { $or: or } };
}

// ── Institution-wide selection ───────────────────────────────────────────────

// Collections that carry a plain `institution` ObjectId and can be swept directly.
const INSTITUTION_SCOPED = [
  C.clients,
  C.roles,
  C.users,
  C.courses,
  C.legacyModuleTrees,
  C.modules,
  C.subModules,
  C.topics,
  C.subTopics,
  C.levelViews,
  C.pedagogyViews,
  C.liveQuestions,
  C.glossaries,
  C.groups,
  C.questionBanks,
  C.dynamicCourseCatalog,
  C.degrees,
  C.pedagogyVocabulary,
  C.bulkMessaging,
  C.individualMessaging,
  C.externalAssessments,
  C.institutionPermissions,
  C.rolePermissions,
  C.subscriptions,
];

async function buildInstitutionSteps(institution) {
  // The tenant FIELD is matched as both types (see institutionMatch); the
  // institution's own document is still addressed by a strict _id.
  const institutionId = institutionMatch(institution);
  const institutionIdString = String(institution);
  const steps = [
    { collection: C.institutions, filter: { _id: toObjectId(institution) } },
  ];

  INSTITUTION_SCOPED.forEach((collection) => {
    steps.push({ collection, filter: { institution: institutionId } });
  });

  // Mappings: `institution` is optional on the schema, so union it with the
  // client link to catch legacy rows that never got the field.
  const clientIds = await distinctIds(C.clients, "_id", { institution: institutionId });
  steps.push({
    collection: C.mappings,
    filter: clientIds.length
      ? { $or: [{ institution: institutionId }, { client: { $in: clientIds } }] }
      : { institution: institutionId },
  });

  // instituteId is a STRING: "<institutionId>" for the institution calendar and
  // "<institutionId>__client__<clientId>" for per-client ones. The id is hex, so
  // it is safe to interpolate into the anchor.
  steps.push({
    collection: C.holidayCalendars,
    filter: { instituteId: { $regex: `^${institutionIdString}(__client__|$)` } },
  });

  // client-resourcesettings is reachable either by the ObjectId or by its
  // String `scope` key.
  steps.push({
    collection: C.resourceSettings,
    filter: {
      $or: [{ institution: institutionId }, { scope: institutionIdString }],
    },
  });

  // External assessment children reach the institution only through `assessment`.
  const assessmentIds = await distinctIds(C.externalAssessments, "_id", {
    institution: institutionId,
  });
  if (assessmentIds.length) {
    const byAssessment = { assessment: { $in: assessmentIds } };
    steps.push({ collection: C.externalParticipants, filter: byAssessment });
    steps.push({ collection: C.externalInvitations, filter: byAssessment });
    steps.push({ collection: C.externalAttempts, filter: byAssessment });
  }

  // Everything that hangs off the institution's courses (exam sessions,
  // attendance, feedback, workspaces, compiler entries, …) comes from the same
  // course expansion the 'course' scope uses — no duplicated logic.
  const courseIds = await distinctIds(C.courses, "_id", { institution: institutionId });
  const courseSteps = await buildCourseSteps(courseIds, institution);
  steps.push(...courseSteps);

  return steps;
}

// ── Step de-duplication ──────────────────────────────────────────────────────

/**
 * A collection may be reached from several directions (lms-users from the client
 * link, the embedded courses[] entry and the roster; lms-servicemappings from the
 * client and from the course back-pointer). Collapse those into one step per
 * collection by OR-ing the filters, so every document is written exactly once.
 */
function dedupeSteps(steps) {
  const order = [];
  const byCollection = new Map();

  steps.forEach(({ collection, filter }) => {
    if (!byCollection.has(collection)) {
      byCollection.set(collection, []);
      order.push(collection);
    }
    byCollection.get(collection).push(filter || {});
  });

  return order.map((collection) => {
    const filters = byCollection.get(collection);
    // A `{}` filter already selects the whole collection; OR-ing anything onto
    // it is noise.
    if (filters.some((f) => !f || Object.keys(f).length === 0)) {
      return { collection, filter: {} };
    }
    if (filters.length === 1) return { collection, filter: filters[0] };

    // Flatten nested $or so the final filter stays a single, index-friendly level.
    const branches = [];
    const seen = new Set();
    filters.forEach((filter) => {
      const parts =
        Object.keys(filter).length === 1 && Array.isArray(filter.$or)
          ? filter.$or
          : [filter];
      parts.forEach((part) => {
        const key = JSON.stringify(part);
        if (!seen.has(key)) {
          seen.add(key);
          branches.push(part);
        }
      });
    });
    return {
      collection,
      filter: branches.length === 1 ? branches[0] : { $or: branches },
    };
  });
}

// ── The planner ──────────────────────────────────────────────────────────────

/**
 * buildPlan({ scope, targetId, institution })
 *   -> { scope, targetId, targetName, steps: [{ collection, filter }] }
 *
 * Throws BackupPlanError (with .statusCode) for a bad scope, a missing target or
 * a target that does not belong to the caller's institution. `institution` is
 * always the caller's own (req.user.institution) — it is never taken from a body.
 */
async function buildPlan({ scope, targetId, institution }) {
  if (!institution) {
    throw new BackupPlanError("User institution not found", 400);
  }
  if (!SCOPES.includes(scope)) {
    throw new BackupPlanError(
      `Invalid scope. Expected one of: ${SCOPES.join(", ")}`
    );
  }
  if (SCOPES_REQUIRING_TARGET.includes(scope) && !targetId) {
    throw new BackupPlanError(`A targetId is required for the "${scope}" scope`);
  }

  let targetName = "";
  let steps = [];

  switch (scope) {
    case "client": {
      const client = await loadClient(institution, targetId);
      targetName = client.clientCompany || "Client";
      // "the client document + its service mappings ONLY" — no users, no courses.
      steps = buildClientSteps(institution, targetId);
      break;
    }

    case "users": {
      if (targetId) {
        const client = await loadClient(institution, targetId);
        targetName = `Users of ${client.clientCompany || "client"}`;
        // The roster is resolved here (unlike 'client-full', where the course
        // steps already contribute it) because otherwise this scope returns
        // nobody for a client whose learners carry no clientId of their own.
        const mappings = await loadClientMappings(institution, targetId);
        const rosterUserIds = await collectClientRosterUserIds(
          institution,
          targetId,
          mappings
        );
        steps = [buildClientUsersStep(institution, targetId, rosterUserIds)];
      } else {
        targetName = "All institution users";
        // Same reasoning as the client branch above: a learner's own document
        // frequently carries no `institution` field, so the plain institution
        // filter alone misses anyone reachable only through a course roster —
        // and "all institution users" is exactly the scope where that gap is
        // most visible, since the narrower client-scoped backup already closes
        // it for its own client.
        const rosterUserIds = await collectInstitutionRosterUserIds(institution);
        const userOr = [{ institution: institutionMatch(institution) }];
        if (rosterUserIds.length) userOr.push({ _id: { $in: rosterUserIds } });
        steps = [{ collection: C.users, filter: { $or: userOr } }];
      }
      break;
    }

    case "course": {
      const course = await loadCourse(institution, targetId);
      targetName = course.courseName || course.courseCode || "Course";
      steps = await buildCourseSteps([toObjectId(targetId)], institution);
      break;
    }

    case "client-full": {
      const client = await loadClient(institution, targetId);
      targetName = `${client.clientCompany || "Client"} (full)`;
      const mappings = await loadClientMappings(institution, targetId);
      const courseIds = await collectClientCourseIds(institution, targetId, mappings);

      steps = [
        ...buildClientSteps(institution, targetId),
        // Per-client holiday calendar: instituteId is the composite STRING key.
        {
          collection: C.holidayCalendars,
          filter: { instituteId: `${String(institution)}__client__${String(targetId)}` },
        },
        buildClientUsersStep(institution, targetId),
        ...(await buildCourseSteps(courseIds, institution)),
      ];
      break;
    }

    case "institution": {
      const institutionDoc = await col(C.institutions).findOne(
        { _id: toObjectId(institution) },
        { projection: { inst_name: 1 } }
      );
      targetName = (institutionDoc && institutionDoc.inst_name) || "Institution";
      steps = await buildInstitutionSteps(institution);
      break;
    }

    default:
      throw new BackupPlanError("Invalid scope");
  }

  return {
    scope,
    targetId: targetId ? String(targetId) : "",
    targetName,
    steps: dedupeSteps(steps),
  };
}

module.exports = {
  buildPlan,
  buildCourseSteps,
  dedupeSteps,
  institutionMatch,
  withDatabase,
  BackupPlanError,
  SCOPES,
  SCOPES_REQUIRING_TARGET,
  COLLECTIONS: C,
};
