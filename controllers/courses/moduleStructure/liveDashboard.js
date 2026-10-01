const mongoose = require("mongoose");

const Module1 = require("../../../models/Courses/moduleStructure/moduleModal");
const SubModule1 = require("../../../models/Courses/moduleStructure/subModuleModal");
const Topic1 = require("../../../models/Courses/moduleStructure/topicModal");
const SubTopic1 = require("../../../models/Courses/moduleStructure/subTopicModal");
const CourseStructure = require("../../../models/Courses/courseStructureModal");
const User = require("../../../models/UserModel");
const ExamSession = require("../../../models/Courses/moduleStructure/ExamSessionModel");
const ActivityLog = require("../../../models/ActivityLog");
const StudentQuestionActivity = require("../../../models/Courses/moduleStructure/StudentQuestionActivityModel");
const ProctorMessage = require("../../../models/Courses/moduleStructure/ProctorMessageModel");
const { pocCourseFilter } = require("../../../utils/pocScope");
const { isStudentUser } = require("../../../utils/batchResources");
const assignmentPresence = require("../../../utils/assignmentPresence");

// A batch's `users[]` is NOT a student list. Enrolling staff there is
// deliberate — a trainer serves several batches and attendance's role
// scoping counts on that membership (see enrollUsersToCourse) — so the Live
// Dashboard and every report generated from it must filter by ROLE
// themselves. Without this a trainer sat in the results table with no
// attempt, dragging down the completion figures and shipping in the export.
//
// `isStudentUser` reads the populated Role doc (originalRole / renameRole /
// roleValue). Legacy users store the role NAME as a plain string, which
// Mongoose leaves unpopulated — checked here too so a real learner is never
// dropped from their own report.
const isStudentParticipant = (u) => {
  if (isStudentUser(u)) return true;
  const raw = u && u.role;
  return typeof raw === "string" && raw.trim().toLowerCase() === "student";
};

const MODEL_BY_TYPE = {
  module: Module1, modules: Module1,
  submodule: SubModule1, submodules: SubModule1,
  topic: Topic1, topics: Topic1,
  subtopic: SubTopic1, subtopics: SubTopic1,
};
// Resources by Batch — an assessment may live in the shared You_Do or in a
// batch's own container; this merges both for _id-keyed lookups.
const { mergeSectionAcrossBatches } = require("../../../utils/pedagogyScope");

const ALL_MODELS = [Module1, SubModule1, Topic1, SubTopic1];

// Normalise a pedagogy section (Map or plain object) into [subcategory, exercises[]] pairs
function sectionEntries(section) {
  if (!section) return [];
  if (section instanceof Map) return Array.from(section.entries());
  if (typeof section === "object") return Object.entries(section);
  return [];
}

// Pedagogy sections this endpoint can report on, in search order.
//
// You_Do (proctored assessments) was the only one for a long time, because the
// Live Dashboard was only reachable from an assessment. It is now also the
// landing page for a We Do assignment's Review button, so the exercise lookup
// and the answer lookup below both have to cover We_Do as well. You_Do stays
// first so an id that somehow exists in both resolves the way it always did.
const DASHBOARD_SECTIONS = ["You_Do", "We_Do"];

// Normalise whatever the client sent (`tabType`/`category`) to a section name
// we actually search. Anything unrecognised means "search them all", which is
// the pre-existing behaviour for callers that send nothing.
function sectionsToSearch(category) {
  const c = String(category || "").trim();
  return DASHBOARD_SECTIONS.includes(c) ? [c] : DASHBOARD_SECTIONS;
}

// Find the embedded exercise by id, scanning the candidate pedagogy sections.
// Returns { exercise, subcategory, category } or null.
async function resolveExercise(exerciseId, nodeType, nodeId, category) {
  const sections = sectionsToSearch(category);

  const tryDoc = (doc) => {
    for (const section of sections) {
      // Resources by Batch — search the shared section AND every batch's own.
      // This resolves an exercise from its `_id`, which is unique, so the
      // owning batch does not change the answer; what matters is that a
      // batch-wise exercise is visible here at all. A plain
      // `doc.pedagogy[section]` would miss it and the live dashboard would
      // report the exercise as not found.
      for (const [subcategory, exercises] of mergeSectionAcrossBatches(doc, section)) {
        const arr = Array.isArray(exercises) ? exercises : (exercises && exercises._id ? [exercises] : []);
        const ex = arr.find((e) => e && e._id && e._id.toString() === exerciseId.toString());
        if (ex) return { exercise: ex, subcategory, category: section };
      }
    }
    return null;
  };

  const projection = ["title", "batchPedagogy", ...sections.map((s) => `pedagogy.${s}`)].join(" ");

  // Fast path: caller told us where it lives.
  if (nodeType && nodeId && MODEL_BY_TYPE[nodeType]) {
    const doc = await MODEL_BY_TYPE[nodeType]
      .findById(nodeId)
      .select(projection)
      .lean();
    const hit = doc && tryDoc(doc);
    if (hit) return hit;
  }

  // Fallback: scan every node type for a doc containing this exercise.
  // The filter needs `batchPedagogy` too: a node whose section is entirely
  // batch-wise has no `pedagogy.<section>` at all, so the original $exists
  // check would skip it and the scan would come back empty.
  for (const Model of ALL_MODELS) {
    const docs = await Model.find({
      $or: [
        ...sections.map((s) => ({ [`pedagogy.${s}`]: { $exists: true } })),
        { batchPedagogy: { $exists: true, $ne: null } },
      ],
    })
      .select(projection)
      .lean();
    for (const doc of docs) {
      const hit = tryDoc(doc);
      if (hit) return hit;
    }
  }
  return null;
}

// Titles may be stored as content-block arrays/objects ([{ id, type, value }])
// or HTML strings. Flatten to a plain string so the client can render it safely.
function plainText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (Array.isArray(v)) return v.map(plainText).filter(Boolean).join(" ").trim();
  if (typeof v === "object") return plainText(v.value ?? v.text ?? "");
  return String(v);
}

// Build lightweight question metadata from an exercise's questions[].
function questionMeta(exercise) {
  const qs = Array.isArray(exercise?.questions) ? exercise.questions : [];
  return qs.map((q, i) => {
    const title =
      plainText(q.mcqQuestionTitle) ||
      plainText(q.title) ||
      plainText(q.programmingQuestionTitle) ||
      `Question ${i + 1}`;
    return {
      id: (q._id || q.id || "").toString(),
      questionNo: `Q${i + 1}`,
      questionTitle: title,
      questionType: (q.questionType || (q.mcqQuestionType ? "mcq" : "") || "").toString(),
      marks: q.mcqQuestionScore ?? q.score ?? q.points ?? 0,
    };
  });
}

function totalQuestionsOf(exercise) {
  if (Array.isArray(exercise?.questions) && exercise.questions.length) return exercise.questions.length;
  return exercise?.exerciseInformation?.totalQuestions || 0;
}

// Scan a user's stored answers for this exercise, across every subcategory of
// the candidate sections. `answers` mirrors `pedagogy`: a We Do assignment's
// submissions live under `answers.We_Do`, so restricting this to You_Do (as it
// did while the dashboard was assessment-only) made every learner on a We Do
// assignment read as Not Started.
function findPersistedExerciseEntry(user, courseId, exerciseId, category) {
  const courseEntry = (user.courses || []).find(
    (c) => c.courseId && c.courseId.toString() === courseId.toString()
  );
  if (!courseEntry || !courseEntry.answers) return null;
  for (const section of sectionsToSearch(category)) {
    for (const [, exercises] of sectionEntries(courseEntry.answers[section])) {
      const arr = Array.isArray(exercises) ? exercises : [];
      const entry = arr.find((e) => e.exerciseId && e.exerciseId.toString() === exerciseId.toString());
      if (entry) return entry;
    }
  }
  return null;
}

// Has the learner finished this We Do assignment?
//
// Finishing is the full submit — the editor's Finish button posts
// `isTestSubmission`, which marks the entry `completed` and counts a test
// submission (answer.js). A single submitted question is NOT finished: the
// multi-file editor stores an answer on every per-question Submit (and on
// Run Testcase under Test Case grading), so "any answered question" used to
// read as Completed while the learner was still working on the rest.
//
// The SQL editor (programmingSettings.selectedModule "Database") is the one
// We Do editor with no Finish button, so there answering every question of
// the exercise is what finishing means.
const TERMINAL_QUESTION_STATUSES = new Set(["solved", "submitted", "evaluated", "completed"]);

function isAssignmentFinished(entry, exercise) {
  if (!entry) return false;
  if (String(entry.status || "").toLowerCase() === "completed") return true;
  if ((entry.testSubmissions || 0) > 0) return true;
  if (exercise?.programmingSettings?.selectedModule !== "Database") return false;
  const questionIds = (exercise.questions || [])
    .map((q) => q && q._id && q._id.toString())
    .filter(Boolean);
  if (!questionIds.length) return false;
  const answered = new Set(
    (entry.questions || [])
      .filter((q) => q && q.questionId && TERMINAL_QUESTION_STATUSES.has(String(q.status || "").toLowerCase()))
      .map((q) => q.questionId.toString())
  );
  return questionIds.every((id) => answered.has(id));
}

// Seed a student's progress from persisted answers (best-known state before live events).
function seedProgressFromAnswers(entry, totalQuestions) {
  if (!entry) {
    return {
      completed: 0,
      yetToComplete: totalQuestions,
      notAttempted: totalQuestions,
      inProgress: false,
      completionPercent: 0,
      lastActivity: null,
      submitted: false,
    };
  }
  const answered = Array.isArray(entry.questions) ? entry.questions.length : 0;
  const completed = Math.min(answered, totalQuestions);
  const submitted = entry.status === "completed" || (entry.testSubmissions || 0) > 0;
  return {
    completed,
    yetToComplete: Math.max(0, totalQuestions - completed),
    notAttempted: Math.max(0, totalQuestions - completed),
    // No live ExamSession ⇒ student is not actively attending. Even if they
    // have saved answers from an earlier session, "Started" must mean a live
    // session is open right now (matches the frontend rule in StudentRow).
    inProgress: false,
    completionPercent: totalQuestions ? Math.round((completed / totalQuestions) * 100) : 0,
    lastActivity: entry.updatedAt || entry.createdAt || null,
    submitted,
  };
}

// Duration (seconds) a student spent on the assessment = submit − start.
// Prefer the live ExamSession (joinedAt → submittedAt); fall back to the
// authoritative closed `exercise_start` ActivityLog (details.duration); last
// resort, the persisted answer entry timestamps. Returns null when unknown.
function computeDurationSeconds({ session, activityDuration, entry }) {
  if (session && session.submittedAt && session.joinedAt) {
    const sec = Math.round(
      (new Date(session.submittedAt).getTime() - new Date(session.joinedAt).getTime()) / 1000
    );
    if (Number.isFinite(sec) && sec >= 0) return sec;
  }
  if (activityDuration != null && Number.isFinite(activityDuration)) {
    return Math.max(0, Math.round(activityDuration));
  }
  if (entry && entry.lastTestSubmittedAt && entry.createdAt) {
    const sec = Math.round(
      (new Date(entry.lastTestSubmittedAt).getTime() - new Date(entry.createdAt).getTime()) / 1000
    );
    if (Number.isFinite(sec) && sec >= 0) return sec;
  }
  return null;
}

function fmtActivity(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

// ─── GET /api/assessment/live-dashboard ──────────────────────────────────────
exports.getLiveDashboard = async (req, res) => {
  try {
    // `category` (or the `tabType` the Live Dashboard URL already carries)
    // says which pedagogy section to look in — "You_Do" for a proctored
    // assessment, "We_Do" for an assignment. Absent means "search both",
    // which is what every pre-existing caller relied on.
    const { assessmentId, courseId, nodeId, nodeType, category, tabType } = req.query;
    const requestedCategory = category || tabType;
    if (!assessmentId) {
      return res.status(400).json({ message: [{ key: "error", value: "assessmentId is required" }] });
    }
    if (!courseId) {
      return res.status(400).json({ message: [{ key: "error", value: "courseId is required" }] });
    }

    const resolved = await resolveExercise(assessmentId, nodeType, nodeId, requestedCategory);
    const exercise = resolved?.exercise || null;
    // The section the exercise ACTUALLY lives in — trust the lookup over the
    // query string, which can be stale or absent on a hand-typed deep link.
    const resolvedCategory = resolved?.category || requestedCategory || "You_Do";
    const totalQuestions = totalQuestionsOf(exercise);
    const assessmentName = exercise?.exerciseInformation?.exerciseName || "Assessment";
    const startDate = exercise?.availabilityPeriod?.startDate || null;
    const endDate = exercise?.availabilityPeriod?.endDate || null;

    // Enrolled students = the course's participants, MINUS the staff who sit
    // in the same batches (see isStudentParticipant).
    const course = await CourseStructure.findById(courseId)
      .select("courseName batchAndParticipants")
      // rollNumber + userId are both needed for the report's Reg. No. column:
      // rollNumber is the trainer-entered register number (Add User form),
      // userId is the auto-generated per-institution series (e.g. PSG0001)
      // that every user always has. We prefer rollNumber but fall back to
      // userId so the column never renders "—" for a valid learner.
      // `role` rides along for the student filter below.
      .populate({
        path: "batchAndParticipants.users.user",
        model: "LMS-User",
        select: "_id email firstName lastName profile rollNumber userId role",
        populate: { path: "role", model: "Role", select: "originalRole renameRole roleValue" },
      })
      .lean();

    const flatUsers = (course?.batchAndParticipants || [])
      .flatMap((batch) => batch.users || [])
      .map((p) => p.user)
      .filter((u) => u && u._id)
      .filter(isStudentParticipant);
    // A user may sit in several batches — list them once only.
    const participants = Array.from(
      new Map(flatUsers.map((u) => [u._id.toString(), u])).values()
    );


    // Live sessions for this assessment, keyed by studentId.
    const sessions = await ExamSession.find({ assessmentId }).lean();

    // ── Self-heal stale sessions ────────────────────────────────────────────
    // A student who closed their tab abruptly (no clean disconnect, no socket
    // event) can leave a session row with inProgress: true forever. Anything
    // that hasn't reported activity in 60s and hasn't submitted is treated as
    // offline + not-in-progress. We persist the flip so the next read agrees
    // and patch the in-memory copy so this response reflects it immediately.
    const STALE_MS = 60 * 1000;
    const staleCutoff = Date.now() - STALE_MS;
    const staleIds = [];
    for (const s of sessions) {
      const lastTs = s.lastActivityAt ? new Date(s.lastActivityAt).getTime() : 0;
      if (s.inProgress && !s.submittedAt && lastTs < staleCutoff) {
        s.inProgress = false;
        s.isOnline = false;
        staleIds.push(s._id);
      }
    }
    if (staleIds.length) {
      await ExamSession.updateMany(
        { _id: { $in: staleIds } },
        { $set: { inProgress: false, isOnline: false } }
      );
    }

    const sessionByStudent = new Map(sessions.map((s) => [s.studentId.toString(), s]));

    // For seeding from persisted answers we need the full user docs.
    const userIds = participants.map((u) => u._id);
    const users = await User.find({ _id: { $in: userIds } }).select("courses").lean();
    const userById = new Map(users.map((u) => [u._id.toString(), u]));

    // Authoritative per-attempt duration from the closed `exercise_start` logs
    // (set on test submit by trackAssignmentDuration). Keyed by studentId, most
    // recent closed log wins. Used as the duration source / fallback below.
    const durationLogs = await ActivityLog.find({
      userId: { $in: userIds },
      action: "exercise_start",
      "details.exerciseId": String(assessmentId),
      "details.duration": { $ne: null },
    })
      .select("userId details.duration createdAt")
      .sort({ createdAt: -1 })
      .lean();
    const durationByStudent = new Map();
    for (const log of durationLogs) {
      const sid = log.userId.toString();
      if (!durationByStudent.has(sid)) durationByStudent.set(sid, log.details?.duration);
    }

  const students = participants.map((u) => {
  const id = u._id.toString();

  const name =
    `${u.firstName || ""} ${u.lastName || ""}`.trim() ||
    u.email ||
    "Student";

  const session = sessionByStudent.get(id);

  const basicStudentInfo = {
    id,
    studentName: name,
    email: u.email || "",
    profile: u.profile || null,
    // Prefer trainer-entered rollNumber; fall back to the auto-generated
    // per-institution userId series (PSG0001 etc.) so the Reg. No. column
    // never renders "—" for a legitimately enrolled learner.
    studentDisplayId: u.rollNumber || u.userId || "",
  };
  if (session) {
    const completed = session.completedCount || 0;

    return {
      ...basicStudentInfo,

      totalQuestions: session.totalQuestions || totalQuestions,

      completed,

      yetToComplete: Math.max(
        0,
        (session.totalQuestions || totalQuestions) - completed
      ),

      notAttempted:
        session.notAttemptedCount ??
        Math.max(
          0,
          (session.totalQuestions || totalQuestions) - completed
        ),

      inProgress: !!session.inProgress,

      completionPercent:
        session.totalQuestions || totalQuestions
          ? Math.round(
              (completed / (session.totalQuestions || totalQuestions)) * 100
            )
          : 0,

      lastActivity: fmtActivity(session.lastActivityAt),

      submitted: !!session.submittedAt,

      durationSeconds: computeDurationSeconds({
        session,
        activityDuration: durationByStudent.get(id),
      }),

      isOnline: !!session.isOnline,

      attemptStatus:
        session.status ||
        (session.submittedAt ? "submitted" : "active"),

      terminationReason:
        session.terminationReason || null,
    };
  }

  const entry = findPersistedExerciseEntry(
    userById.get(id) || {},
    courseId,
    assessmentId,
    resolvedCategory
  );

  const seed = seedProgressFromAnswers(
    entry,
    totalQuestions
  );

  return {
    ...basicStudentInfo,

    totalQuestions,

    completed: seed.completed,

    yetToComplete: seed.yetToComplete,

    notAttempted: seed.notAttempted,

    inProgress: seed.inProgress,

    completionPercent: seed.completionPercent,

    lastActivity: fmtActivity(seed.lastActivity),

    submitted: seed.submitted,

    durationSeconds: computeDurationSeconds({
      activityDuration: durationByStudent.get(id),
      entry,
    }),

    // ── attemptStatus for non-proctored (We Do) work ────────────────────────
    // The client only prints "Completed" for `attemptStatus === 'submitted'`,
    // and deliberately so: on a You Do assessment the only trustworthy finish
    // signal is ExamSession.status, written once by finaliseAttempt. A We Do
    // assignment never opens an ExamSession at all, so that rule would pin
    // every assignment row to "Started" forever. For We_Do — and ONLY We_Do,
    // so You Do keeps its stricter rule — the stored answer doc is the
    // authority, and only a finished assignment counts (isAssignmentFinished).
    //
    // Only the finished case is set. Leaving `attemptStatus` off otherwise
    // lets the client's existing fallbacks decide between Started (some
    // questions answered) and Not Started, which is already correct here.
    ...(resolvedCategory === "We_Do" && isAssignmentFinished(entry, exercise)
      ? { attemptStatus: "submitted" }
      : {}),
  };
});

    // We Do — a learner with the assignment editor open right now is
    // attending, whatever their stored answers say. The client reads
    // `inProgress` as "Started" ahead of any stored completion.
    if (resolvedCategory === "We_Do") {
      for (const row of students) {
        if (assignmentPresence.isAttending(assessmentId, row.id)) {
          row.inProgress = true;
          row.isOnline = true;
        }
      }
    }

    return res.status(200).json({
      assessmentName,
      courseName: course?.courseName || "",
      startDate,
      endDate,
      totalStudents: students.length,
      students,
    });
  } catch (err) {
    console.error("getLiveDashboard error:", err);
    return res.status(500).json({ message: [{ key: "error", value: `Internal server error: ${err.message}` }] });
  }
};

// One learner's stored We Do row, by the same rules getLiveDashboard applies.
// The socket layer broadcasts it when a learner leaves the assignment editor,
// so the row drops from "Started" to what they actually left behind — answers
// in progress, or the finished assignment — without the trainer refreshing.
exports.assignmentRowState = async ({ assessmentId, studentId, courseId, nodeId, nodeType }) => {
  if (!assessmentId || !studentId || !courseId) return null;
  const resolved = await resolveExercise(assessmentId, nodeType, nodeId, "We_Do");
  if (!resolved || resolved.category !== "We_Do") return null;
  const user = await User.findById(studentId).select("courses").lean();
  const entry = user ? findPersistedExerciseEntry(user, courseId, assessmentId, "We_Do") : null;
  const seed = seedProgressFromAnswers(entry, totalQuestionsOf(resolved.exercise));
  return {
    completed: seed.completed,
    yetToComplete: seed.yetToComplete,
    notAttempted: seed.notAttempted,
    completionPercent: seed.completionPercent,
    submitted: seed.submitted,
    ...(isAssignmentFinished(entry, resolved.exercise) ? { attemptStatus: "submitted" } : {}),
  };
};

// ─── GET /api/assessment/student-details ─────────────────────────────────────
exports.getStudentDetails = async (req, res) => {
  try {
    const { assessmentId, studentId, nodeId, nodeType } = req.query;
    if (!assessmentId || !studentId) {
      return res.status(400).json({ message: [{ key: "error", value: "assessmentId and studentId are required" }] });
    }

    const resolved = await resolveExercise(assessmentId, nodeType, nodeId);
    const exercise = resolved?.exercise || null;
    const meta = questionMeta(exercise);
    const totalQuestions = meta.length || totalQuestionsOf(exercise);
    const assessmentName = exercise?.exerciseInformation?.exerciseName || "Assessment";

    const student = await User.findById(studentId).select("firstName lastName email courses").lean();
    const studentName = student
      ? `${student.firstName || ""} ${student.lastName || ""}`.trim() || student.email
      : "Student";

    // Live per-question activity (preferred), keyed by questionId.
    const activities = await StudentQuestionActivity.find({ assessmentId, studentId }).lean();
    const actByQ = new Map(activities.map((a) => [a.questionId.toString(), a]));

    // Persisted answers fallback (per-question status).
    const entry = student ? findPersistedExerciseEntry(student, exercise && resolved ? (req.query.courseId || "") : "", assessmentId) : null;
    const persistedByQ = new Map(
      (entry?.questions || []).map((q) => [q.questionId?.toString(), q])
    );

    const questions = meta.map((m) => {
      const live = actByQ.get(m.id);
      if (live) {
        return {
          id: m.id,
          questionNo: m.questionNo,
          questionTitle: m.questionTitle,
          questionType: m.questionType,
          marks: m.marks,
          status: live.status === "submitted" ? "submitted" : live.status === "answered" ? "in_progress" : "pending",
          submittedAt: live.submittedAt ? new Date(live.submittedAt).toISOString() : null,
          timeTakenSeconds: live.timeTakenSeconds || 0,
        };
      }
      const p = persistedByQ.get(m.id);
      const answered = !!p;
      return {
        id: m.id,
        questionNo: m.questionNo,
        questionTitle: m.questionTitle,
        questionType: m.questionType,
        marks: m.marks,
        status: answered ? "submitted" : "pending",
        submittedAt: p?.submittedAt ? new Date(p.submittedAt).toISOString() : null,
        timeTakenSeconds: 0,
      };
    });

    const completed = questions.filter((q) => q.status === "submitted").length;

    return res.status(200).json({
      studentName,
      email: student?.email || "",
      assessmentName,
      totalQuestions,
      completed,
      yetToComplete: Math.max(0, totalQuestions - completed),
      completionPercent: totalQuestions ? Math.round((completed / totalQuestions) * 100) : 0,
      questions,
    });
  } catch (err) {
    console.error("getStudentDetails error:", err);
    return res.status(500).json({ message: [{ key: "error", value: `Internal server error: ${err.message}` }] });
  }
};

// ─── Proctor ↔ Student messages ─────────────────────────────────────────────
// Chat history for one (assessment, student) thread. A student loads their own
// thread (studentId defaults to the authed user); a proctor may pass any
// studentId to read that thread.
exports.getMessages = async (req, res) => {
  try {
    const { assessmentId } = req.query;
    const studentId = req.query.studentId || String(req.user._id);
    if (!assessmentId) {
      return res.status(400).json({ success: false, message: "assessmentId is required" });
    }
    const messages = await ProctorMessage.find({
      assessmentId: String(assessmentId),
      studentId: String(studentId),
    })
      .sort({ createdAt: 1 })
      .lean();

    const unread = messages.reduce((n, m) => n + (m.read ? 0 : 1), 0);
    return res.status(200).json({ success: true, messages, unread });
  } catch (err) {
    console.error("getMessages error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Mark a student's thread as read (called when they open the chat panel).
exports.markMessagesRead = async (req, res) => {
  try {
    const { assessmentId } = req.body || {};
    const studentId = (req.body && req.body.studentId) || String(req.user._id);
    if (!assessmentId) {
      return res.status(400).json({ success: false, message: "assessmentId is required" });
    }
    await ProctorMessage.updateMany(
      { assessmentId: String(assessmentId), studentId: String(studentId), read: false },
      { $set: { read: true } }
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("markMessagesRead error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Live Dashboard list — one row per You_Do assessment across every course the
// caller can see. Scoping is applied via `req.pocScope` (populated by the
// attachPocScope middleware on the route) so POC users only see courses they
// own; every other role gets an unrestricted filter.
exports.getLiveSessionsList = async (req, res) => {
  try {
    const scope = req.pocScope || null;
    const { courseId, status } = req.query;

    // 1) Courses the caller can see.
    const courseFilter = {
      ...(courseId ? { _id: courseId } : {}),
      ...pocCourseFilter(scope),
    };
    const courses = await CourseStructure.find(courseFilter)
      .select("_id courseName courseImage batchAndParticipants")
      .lean();
    if (!courses.length) {
      return res.status(200).json({ sessions: [], counts: { all: 0, live: 0, scheduled: 0, completed: 0 } });
    }

    const courseById = new Map(courses.map((c) => [c._id.toString(), c]));
    const courseIds = courses.map((c) => c._id);

    // Deduped participant count per course (a user in multiple batches counts
    // once). Computed once so per-assessment rows can look it up in O(1).
    //
    // STUDENTS only — a batch's users[] also holds the trainers assigned to
    // it, and counting them made every assessment card overstate its cohort
    // against the learner list the dashboard actually shows. The roles are
    // resolved in ONE read for every course on the page rather than per row.
    const enrolledIdsOf = (course) => {
      const ids = new Set();
      for (const b of course.batchAndParticipants || []) {
        for (const u of b.users || []) {
          const uid = u?.user?.toString ? u.user.toString() : u?.user;
          if (uid) ids.add(String(uid));
        }
      }
      return ids;
    };
    const allEnrolledIds = new Set();
    for (const c of courses) {
      for (const id of enrolledIdsOf(c)) allEnrolledIds.add(id);
    }
    const enrolledUsers = allEnrolledIds.size
      ? await User.find({ _id: { $in: [...allEnrolledIds] } })
          .select("_id role")
          .populate({ path: "role", model: "Role", select: "originalRole renameRole roleValue" })
          .lean()
      : [];
    const studentIds = new Set(
      enrolledUsers.filter(isStudentParticipant).map((u) => String(u._id))
    );

    const participantCountByCourse = new Map();
    for (const c of courses) {
      let n = 0;
      for (const id of enrolledIdsOf(c)) if (studentIds.has(id)) n += 1;
      participantCountByCourse.set(c._id.toString(), n);
    }

    // 2) All pedagogy-carrying nodes for those courses. Only the fields we
    //    walk — `pedagogy.You_Do`, `batchPedagogy` (for batch-wise scope),
    //    `courses`, `title`. Skipping the huge `resources` / `pages` / etc.
    //    keeps this query fast even on a large tenant.
    const nodeProjection = "title courses pedagogy.You_Do batchPedagogy";
    const [modules, subModules, topics, subTopics] = await Promise.all([
      Module1.find({ courses: { $in: courseIds } }).select(nodeProjection).lean(),
      SubModule1.find({ courses: { $in: courseIds } }).select(nodeProjection).lean(),
      Topic1.find({ courses: { $in: courseIds } }).select(nodeProjection).lean(),
      SubTopic1.find({ courses: { $in: courseIds } }).select(nodeProjection).lean(),
    ]);

    // 3) Walk every node's You_Do (across shared + batch-wise containers) and
    //    collect a raw session row per exercise. `mergeSectionAcrossBatches`
    //    already handles the Map / batchPedagogy fan-out.
    //
    //    Deduped on the exercise's _id: batch-wise exercises can appear under
    //    multiple containers; we keep the first hit's metadata so counts don't
    //    double.
    const sessionsById = new Map();
    const nodeGroups = [
      { list: modules, kind: "module" },
      { list: subModules, kind: "submodule" },
      { list: topics, kind: "topic" },
      { list: subTopics, kind: "subtopic" },
    ];
    for (const group of nodeGroups) {
      for (const node of group.list) {
        const courseIdStr = node.courses ? String(node.courses) : "";
        const course = courseById.get(courseIdStr);
        if (!course) continue;
        for (const [subcategory, exercises] of mergeSectionAcrossBatches(node, "You_Do")) {
          const arr = Array.isArray(exercises)
            ? exercises
            : (exercises && exercises._id ? [exercises] : []);
          for (const ex of arr) {
            if (!ex || !ex._id) continue;
            const exId = ex._id.toString();
            if (sessionsById.has(exId)) continue;
            const questions = Array.isArray(ex.questions) ? ex.questions : [];
            sessionsById.set(exId, {
              id: exId,
              title: (ex.exerciseInformation && ex.exerciseInformation.exerciseName) || "Assessment",
              subcategory: subcategory || "",
              nodeType: group.kind,
              nodeId: node._id.toString(),
              nodeTitle: plainText(node.title) || "",
              courseId: courseIdStr,
              courseName: course.courseName || "",
              courseImage: course.courseImage || null,
              participantCount: participantCountByCourse.get(courseIdStr) || 0,
              totalQuestions: questions.length,
              totalMarks: questions.reduce((sum, q) => sum + (q?.mcqQuestionScore || q?.score || q?.points || 0), 0),
              startDate: ex?.availabilityPeriod?.startDate || null,
              endDate: ex?.availabilityPeriod?.endDate || null,
              createdAt: ex?.createdAt || null,
              updatedAt: ex?.updatedAt || null,
              // Author lookup — the exercise stores the creator as an EMAIL
              // string on `createdByEmail` / `createdBy` (see exercise write
              // paths in exerciseAndQuestion.js). No populated user doc lives
              // on the exercise itself; the client renders the local part as
              // a friendly name and shows the email on hover.
              createdBy: String(ex?.createdByEmail || ex?.createdBy || "").trim() || null,
              submittedCount: 0,
              inProgressCount: 0,
              terminatedCount: 0,
            });
          }
        }
      }
    }

    // 4) Live counts — one ExamSession aggregation covers every collected id.
    if (sessionsById.size) {
      const ids = Array.from(sessionsById.keys());
      const rollups = await ExamSession.aggregate([
        { $match: { assessmentId: { $in: ids } } },
        {
          $group: {
            _id: { assessmentId: "$assessmentId", status: "$status" },
            n: { $sum: 1 },
          },
        },
      ]);
      for (const r of rollups) {
        const row = sessionsById.get(r._id.assessmentId);
        if (!row) continue;
        if (r._id.status === "submitted") row.submittedCount += r.n;
        else if (r._id.status === "active") row.inProgressCount += r.n;
        else if (r._id.status === "terminated") row.terminatedCount += r.n;
      }
    }

    // 5) Lifecycle status. Derived so the client doesn't need to reason about
    //    dates. Rules mirror `deriveAssessmentState` on the frontend for the
    //    detail header — 'live' has priority when there's live activity right
    //    now regardless of the availability window, otherwise it's a straight
    //    date comparison.
    const now = Date.now();
    const rows = Array.from(sessionsById.values()).map((s) => {
      const start = s.startDate ? new Date(s.startDate).getTime() : null;
      const end = s.endDate ? new Date(s.endDate).getTime() : null;
      let derivedStatus = "scheduled";
      if (s.inProgressCount > 0) derivedStatus = "live";
      else if (end && end < now) derivedStatus = "completed";
      else if (start && start <= now && (!end || end >= now)) derivedStatus = "live";
      else if (start && start > now) derivedStatus = "scheduled";
      return { ...s, status: derivedStatus };
    });

    // Rollup counts BEFORE the status filter so the tabs above the table can
    // show accurate per-bucket totals irrespective of the current selection.
    const counts = { all: rows.length, live: 0, scheduled: 0, completed: 0 };
    for (const r of rows) {
      if (r.status === "live") counts.live++;
      else if (r.status === "scheduled") counts.scheduled++;
      else if (r.status === "completed") counts.completed++;
    }

    const filtered = status && status !== "all"
      ? rows.filter((r) => r.status === status)
      : rows;

    // Newest first — updatedAt if we have it (batch-wise exercises sometimes
    // don't), else the availability start, else the createdAt fallback.
    filtered.sort((a, b) => {
      const at = new Date(a.updatedAt || a.startDate || a.createdAt || 0).getTime();
      const bt = new Date(b.updatedAt || b.startDate || b.createdAt || 0).getTime();
      return bt - at;
    });

    return res.status(200).json({ sessions: filtered, counts });
  } catch (err) {
    console.error("getLiveSessionsList error:", err);
    return res.status(500).json({
      message: [{ key: "error", value: `Internal server error: ${err.message}` }],
    });
  }
};
