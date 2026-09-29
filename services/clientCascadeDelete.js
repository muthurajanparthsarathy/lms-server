// Deleting a client, and everything that only existed because of it.
//
// Removing the client row on its own left the rest of the tenant behind:
// its service mappings still listed it, its courses still pointed at a
// clientId nothing resolved, and its students stayed in User Management with
// attendance, feedback and calendar rows hanging off them. The records were
// unreachable from the UI but still counted, still matched reports, and still
// blocked a client of the same name from being created cleanly.
//
// So a delete now walks the whole footprint:
//
//   client
//     ├── service mappings          (client, partnerInstitutions)
//     ├── courses                   (clientId, or a mapping of this client)
//     │     ├── module trees        (modules → sub-modules → topics → sub-topics)
//     │     ├── program calendar, calendar schedules
//     │     ├── attendance, feedback, retest requests
//     │     ├── participant groups, glossaries, question banks
//     │     └── workspaces, compiler runs, activity logs
//     ├── users                     (clientId, services[].clientId, mapping)
//     │     └── their exam sessions, proctor messages, screen violations,
//     │         question activity, responses, drafts, OTPs, notifications
//     └── print settings
//
// Two entry points, sharing one description of that footprint so the number
// the user is shown before confirming is produced by the same code that does
// the deleting: `countClientFootprint` (read-only) and `purgeClientFootprint`.
//
// NOT transactional. The deployment targets a standalone mongod, where
// sessions cannot open a transaction at all, so wrapping this would fail
// everywhere rather than protect anything. The order is therefore children
// first and the client row last: an interrupted purge leaves orphans that a
// re-run cleans up, never a live client whose data has been half removed.

const mongoose = require("mongoose");

const ServiceMapping = require("../models/ServiceMappingModel");
const CourseStructure = require("../models/Courses/courseStructureModal");
const User = require("../models/UserModel");

// Course-owned
const ModuleStructureDemo = require("../models/Courses/moduleStructureModal");
const Module1 = require("../models/Courses/moduleStructure/moduleModal");
const SubModule1 = require("../models/Courses/moduleStructure/subModuleModal");
const Topic1 = require("../models/Courses/moduleStructure/topicModal");
const SubTopic1 = require("../models/Courses/moduleStructure/subTopicModal");
const ProgramCalendar = require("../models/Courses/ProgramCalendarModel");
const CalendarSchedule = require("../models/Courses/CalendarScheduleModel");
const StudentAttendance = require("../models/Courses/StudentAttendanceModel");
const Feedback = require("../models/FeedbackModal");
const CourseGroup = require("../models/Courses/GroupParticipantsModal");
const RetestRequest = require("../models/Courses/RetestRequestModel");
const Glossary = require("../models/Courses/GlossaryModel");
const QuestionBank = require("../models/Courses/QuestionbankModal");
const StudentWorkspace = require("../models/StudentWorkspaceModel");
const ActivityLog = require("../models/ActivityLog");
const Compiler = require("../models/CompilerModel");

// User-owned
const ExamSession = require("../models/Courses/moduleStructure/ExamSessionModel");
const ProctorMessage = require("../models/Courses/moduleStructure/ProctorMessageModel");
const ScreenViolation = require("../models/Courses/moduleStructure/ScreenViolationModel");
const StudentQuestionActivity = require("../models/Courses/moduleStructure/StudentQuestionActivityModel");
const StudentResponse = require("../models/Courses/moduleStructure/StudentResponseSchema");
const QuestionDraft = require("../models/QuestionDraftModel");
const OTP = require("../models/OTPModel");
const NotificationCount = require("../models/NotificationCountModal");

// Client-owned
const PrintSetting = require("../models/dynamicContent/PrintSettingModels");

const toId = (v) => new mongoose.Types.ObjectId(String(v));

/**
 * Everything that belongs to this client, as id lists.
 *
 * Collected UP FRONT, before a single delete runs, because most of the child
 * collections are keyed by course or user rather than by client — once the
 * courses are gone there is no way left to find their attendance rows.
 */
async function collectClientScope(institutionId, clientId) {
  const client = toId(clientId);
  // Institution scoping is applied wherever the collection carries it. A few
  // of these (exam sessions, proctor messages) are keyed only by student, and
  // are reached through the user ids instead.
  const inst = institutionId ? { institution: toId(institutionId) } : {};

  const mappings = await ServiceMapping.find({ ...inst, client })
    .select("_id")
    .lean();
  const mappingIds = mappings.map((m) => m._id);
  // Course-Structure stores mappingId as a STRING, not a ref.
  const mappingIdStrings = mappingIds.map(String);

  // A course belongs to the client either directly or through one of its
  // mappings — older courses were written before clientId was stamped on them.
  const courseOr = [{ clientId: client }];
  if (mappingIdStrings.length) courseOr.push({ mappingId: { $in: mappingIdStrings } });
  const courses = await CourseStructure.find({ ...inst, $or: courseOr })
    .select("_id")
    .lean();
  const courseIds = courses.map((c) => c._id);

  // Same for users: the legacy single-service fields, the newer `services`
  // array, and the mapping they were enrolled through.
  const userOr = [{ clientId: client }, { "services.clientId": client }];
  if (mappingIds.length) userOr.push({ serviceMappingId: { $in: mappingIds } });
  const candidates = await User.find({ ...inst, $or: userOr })
    .select("_id clientId services.clientId")
    .lean();

  // A user who ALSO belongs to another client is not this client's to delete.
  // The `services` array exists precisely so one person can be enrolled under
  // several clients, and destroying a shared account to clean up one of them
  // would take the other client's student with it. Those accounts are kept and
  // merely detached (see purgeClientFootprint).
  const userIds = [];
  const sharedUserIds = [];
  candidates.forEach((u) => {
    const otherClients = new Set();
    if (u.clientId && String(u.clientId) !== String(client)) {
      otherClients.add(String(u.clientId));
    }
    (u.services || []).forEach((svc) => {
      if (svc?.clientId && String(svc.clientId) !== String(client)) {
        otherClients.add(String(svc.clientId));
      }
    });
    if (otherClients.size) sharedUserIds.push(u._id);
    else userIds.push(u._id);
  });

  // The module tree hangs off the course by its top level only; every level
  // below is keyed by its parent, so the ids have to be walked down.
  const modules = courseIds.length
    ? await Module1.find({ courses: { $in: courseIds } }).select("_id").lean()
    : [];
  const moduleIds = modules.map((m) => m._id);

  const subModules = moduleIds.length
    ? await SubModule1.find({ moduleId: { $in: moduleIds } }).select("_id").lean()
    : [];
  const subModuleIds = subModules.map((s) => s._id);

  const topicOr = [];
  if (moduleIds.length) topicOr.push({ moduleId: { $in: moduleIds } });
  if (subModuleIds.length) topicOr.push({ subModuleId: { $in: subModuleIds } });
  const topics = topicOr.length
    ? await Topic1.find({ $or: topicOr }).select("_id").lean()
    : [];
  const topicIds = topics.map((t) => t._id);

  return {
    institutionId: institutionId ? toId(institutionId) : null,
    clientId: client,
    mappingIds,
    courseIds,
    userIds,
    sharedUserIds,
    moduleIds,
    subModuleIds,
    topicIds,
  };
}

/**
 * The footprint as a list of {label, model, filter} deletions.
 *
 * One table drives both the preview and the purge — a count the user is shown
 * and a delete that removed something else would be worse than no preview at
 * all. Entries whose id list is empty are dropped rather than run with an
 * empty `$in`, which would match nothing but still cost a round trip.
 */
function buildDeleteOperations(scope) {
  const { clientId, mappingIds, courseIds, userIds, moduleIds, subModuleIds, topicIds } = scope;
  // Several collections store the foreign id as a STRING (question banks,
  // workspaces, exam sessions and the proctoring records), so both shapes are
  // offered wherever the column's type is a string.
  const courseIdStrings = courseIds.map(String);
  const userIdStrings = userIds.map(String);

  const ops = [];
  const add = (label, model, filter, ids) => {
    if (!model) return;
    if (ids && ids.length === 0) return;
    ops.push({ label, model, filter });
  };

  // ── Under the courses ──────────────────────────────────────────────────
  add("subTopics", SubTopic1, { topicId: { $in: topicIds } }, topicIds);
  add("topics", Topic1, { _id: { $in: topicIds } }, topicIds);
  add("subModules", SubModule1, { _id: { $in: subModuleIds } }, subModuleIds);
  add("modules", Module1, { _id: { $in: moduleIds } }, moduleIds);
  add("moduleStructures", ModuleStructureDemo, { courses: { $in: courseIds } }, courseIds);
  add("programCalendars", ProgramCalendar, { courseId: { $in: courseIds } }, courseIds);
  add("calendarSchedules", CalendarSchedule, { courseId: { $in: courseIds } }, courseIds);
  add("participantGroups", CourseGroup, { course: { $in: courseIds } }, courseIds);
  add("glossaries", Glossary, { courseId: { $in: courseIds } }, courseIds);
  add("questionBanks", QuestionBank, { courseId: { $in: courseIdStrings } }, courseIds);

  // ── Records that belong to a course OR to one of the client's users ────
  // Attendance, feedback and retests are written per (course, student). A row
  // is in scope if EITHER side is being deleted: this client's student sitting
  // in another client's course leaves a record that would otherwise point at a
  // user id that no longer resolves.
  const courseOrUser = (courseField, userField, idsA, idsB) => {
    const or = [];
    if (idsA.length) or.push({ [courseField]: { $in: idsA } });
    if (idsB.length) or.push({ [userField]: { $in: idsB } });
    return or.length ? { $or: or } : null;
  };

  const attendanceFilter = courseOrUser("courseId", "studentId", courseIds, userIds);
  if (attendanceFilter) add("attendance", StudentAttendance, attendanceFilter);

  const feedbackFilter = courseOrUser("courseId", "studentId", courseIds, userIds);
  if (feedbackFilter) add("feedback", Feedback, feedbackFilter);

  const retestFilter = courseOrUser("courseId", "studentId", courseIds, userIds);
  if (retestFilter) add("retestRequests", RetestRequest, retestFilter);

  const workspaceFilter = courseOrUser("courseId", "userId", courseIdStrings, userIds);
  if (workspaceFilter) add("workspaces", StudentWorkspace, workspaceFilter);

  const compilerFilter = courseOrUser("courseId", "userId", courseIds, userIds);
  if (compilerFilter) add("compilerRuns", Compiler, compilerFilter);

  const activityFilter = courseOrUser("courseId", "userId", courseIds, userIds);
  if (activityFilter) add("activityLogs", ActivityLog, activityFilter);

  // ── Under the users ────────────────────────────────────────────────────
  // The proctoring collections store studentId as a plain String.
  add("examSessions", ExamSession, { studentId: { $in: userIdStrings } }, userIds);
  add("proctorMessages", ProctorMessage, { studentId: { $in: userIdStrings } }, userIds);
  add("screenViolations", ScreenViolation, { studentId: { $in: userIdStrings } }, userIds);
  add("questionActivity", StudentQuestionActivity, { studentId: { $in: userIdStrings } }, userIds);
  add("studentResponses", StudentResponse, { student: { $in: userIds } }, userIds);
  add("questionDrafts", QuestionDraft, { userId: { $in: userIds } }, userIds);
  add("otps", OTP, { userId: { $in: userIds } }, userIds);
  add("notifications", NotificationCount, { userId: { $in: userIds } }, userIds);

  // ── The client's own records, last ─────────────────────────────────────
  add("courses", CourseStructure, { _id: { $in: courseIds } }, courseIds);
  add("users", User, { _id: { $in: userIds } }, userIds);
  add("serviceMappings", ServiceMapping, { _id: { $in: mappingIds } }, mappingIds);
  add("printSettings", PrintSetting, { clientId });

  return ops;
}

/** What a delete WOULD remove. Read-only — safe to call on every dialog open. */
async function countClientFootprint(scope) {
  const counts = {};
  for (const op of buildDeleteOperations(scope)) {
    const n = await op.model.countDocuments(op.filter);
    counts[op.label] = (counts[op.label] || 0) + n;
  }
  return counts;
}

/**
 * Run the deletions.
 *
 * `keepUserIds` protects specific accounts from the user sweep — the person
 * performing the delete above all. Signing yourself out mid-request by
 * deleting your own record is a failure mode with no recovery path.
 */
async function purgeClientFootprint(scope, { keepUserIds = [] } = {}) {
  const keep = keepUserIds.map(String).filter(Boolean);
  const deleted = {};

  for (const op of buildDeleteOperations(scope)) {
    let filter = op.filter;
    if (op.label === "users" && keep.length) {
      filter = { ...filter, _id: { $in: scope.userIds, $nin: keep.map(toId) } };
    }
    const res = await op.model.deleteMany(filter);
    deleted[op.label] = (deleted[op.label] || 0) + (res.deletedCount || 0);
  }

  // ── Detach, don't delete ───────────────────────────────────────────────
  // Records that belong to SOMEONE ELSE but mention what was just removed.
  // Another client's CSR mapping naming this one as a partner institution is
  // still that client's mapping; a cross-client enrolment is still the other
  // course's batch. Both just lose the reference.
  const pulledPartners = await ServiceMapping.updateMany(
    { partnerInstitutions: scope.clientId },
    { $pull: { partnerInstitutions: scope.clientId } }
  );
  deleted.partnerReferencesCleared = pulledPartners.modifiedCount || 0;

  // Shared accounts keep existing, minus their tie to this client: the
  // services entry, and the legacy single-service fields when those pointed
  // here. Left alone they would show a client that no longer exists.
  if (scope.sharedUserIds && scope.sharedUserIds.length) {
    const detached = await User.updateMany(
      { _id: { $in: scope.sharedUserIds } },
      { $pull: { services: { clientId: scope.clientId } } }
    );
    await User.updateMany(
      { _id: { $in: scope.sharedUserIds }, clientId: scope.clientId },
      { $unset: { clientId: "", clientName: "", serviceMappingId: "" } }
    );
    deleted.sharedUsersDetached = detached.modifiedCount || 0;
  }

  if (scope.userIds.length) {
    const removable = scope.userIds.filter((id) => !keep.includes(String(id)));
    if (removable.length) {
      const pulled = await CourseStructure.updateMany(
        { "batchAndParticipants.users.user": { $in: removable } },
        { $pull: { "batchAndParticipants.$[].users": { user: { $in: removable } } } }
      );
      deleted.enrolmentsCleared = pulled.modifiedCount || 0;
    }
  }

  return deleted;
}

module.exports = {
  collectClientScope,
  countClientFootprint,
  purgeClientFootprint,
};
