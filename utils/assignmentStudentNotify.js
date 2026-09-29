// ─── "Assignment available" — the student notification ──────────────────────
//
// The Notifications step of the We Do assignment editor has Notify Student
// (ON/OFF) and Notify via (Dashboard / Gmail / WhatsApp). Until now those were
// stored and never read. This module is what reads them.
//
// WHEN. Once per assignment, at the first save after which it is complete AND
// allowed to be seen:
//
//   notify student ON + at least one channel ticked
//   start AND end date/time set, end still in the future
//   every configured question added (isExerciseFullyConfigured — the rule the
//     approvals flow already uses, which also checks name and marks), and at
//     least one question
//   visible to students — an approval workflow, if any, fully approved
//
// It hangs off the node models' save (see `assignmentNotifyPlugin`) rather
// than any one controller, because an assignment becomes complete through many
// doors — the settings save, each question added, a bulk upload, the final
// approval — and every one of them ends in `entity.save()`. The check runs on
// every save; once it passes, the assignment is stamped
// `studentNotification.sentAt` so it never passes again, and the
// Exercise-Notification-Log unique index guards against two racing saves.
//
// WHO. Course → the assignment's batch → the students enrolled in that batch.
// An assignment filed under one batch (`batchPedagogy.<batchId>`) reaches that
// batch only; a shared one (`pedagogy`) reaches every batch of the course,
// each student told their own batch. Never the whole institution, never staff,
// never someone not enrolled — and suspended/dropped enrolments are skipped.
//
// Assignments saved before the channel fields existed carry no channels, so
// they stay silent until re-saved from the editor — no surprise broadcast of
// old work the first time their topic is touched.

const { isExerciseFullyConfigured } = require("./exerciseReadiness");

// Only We Do holds typed exercise sub-documents; You Do is `Mixed` and keeps
// its own approval-time notification.
const TAB = "We_Do";

/** The student channels actually ticked, or null when none is. */
const studentChannels = (ex) => {
  const c = ex?.notificationSettings?.notifyStudentChannels;
  if (!c) return null;
  const channels = { dashboard: c.dashboard === true, gmail: c.gmail === true, whatsapp: c.whatsapp === true };
  return channels.dashboard || channels.gmail || channels.whatsapp ? channels : null;
};

const activeQuestions = (ex) =>
  (Array.isArray(ex?.questions) ? ex.questions : []).filter((q) => q && q.isActive !== false);

/**
 * Why this assignment must NOT be announced yet — or null when it is ready.
 * The reason string is for logs; nothing user-facing reads it.
 */
const assignmentNotifyBlocker = (ex, now = Date.now()) => {
  const { isExerciseStudentVisible } = require("./approvalWorkflow");
  if (!ex) return "no exercise";
  if (ex.notificationSettings?.notifyStudent !== true) return "notify student is off";
  if (!studentChannels(ex)) return "no notification channel selected";
  const start = ex.availabilityPeriod?.startDate;
  const end = ex.availabilityPeriod?.endDate;
  if (!start || !end) return "start/end date not set";
  if (new Date(end).getTime() <= now) return "already ended";
  if (activeQuestions(ex).length === 0) return "no questions yet";
  if (!isExerciseFullyConfigured(ex)) return "required questions incomplete";
  if (!isExerciseStudentVisible(ex)) return "awaiting approval";
  return null;
};

// ─── Message ────────────────────────────────────────────────────────────────
// Dates are stored in UTC; students read them in the institution's time zone.
const TIME_ZONE = process.env.NOTIFY_TIMEZONE || "Asia/Kolkata";

// "28 Sep 2026". Assembled from parts: en-GB spells September "Sept".
const formatDate = (d) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day} ${parts.month} ${parts.year}`;
};
const formatTime = (d) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
const formatWhen = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : `${formatDate(d)}, ${formatTime(d)}`;
};

const totalMarksOf = (ex) => {
  if (ex.isGraded === false) return "Not graded";
  const info = ex.exerciseInformation || {};
  const total = Number(info.totalMarks) || (Number(info.totalMarksMCQ) || 0) + (Number(info.totalMarksProgramming) || 0);
  return String(total);
};

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const clientBaseUrl = () => {
  try {
    return require("config").get("BASE_URL");
  } catch {
    return process.env.BASE_URL || "http://localhost:3000";
  }
};

/** Everything a student is told, for one batch. */
const buildDetails = ({ exercise, courseName, batchName, courseId }) => ({
  assignmentName: exercise.exerciseInformation?.exerciseName || "Assignment",
  courseName: courseName || "your course",
  batchName: batchName || "—",
  start: formatWhen(exercise.availabilityPeriod?.startDate),
  end: formatWhen(exercise.availabilityPeriod?.endDate),
  marks: totalMarksOf(exercise),
  questions: String(activeQuestions(exercise).length),
  link: `${clientBaseUrl()}/lms/pages/courses/coursesdetailedview/${courseId}`,
});

const detailLines = (d) => [
  `Course: ${d.courseName}`,
  `Batch: ${d.batchName}`,
  `Start: ${d.start}`,
  `End: ${d.end}`,
  `Marks: ${d.marks}`,
  `Questions: ${d.questions}`,
];

const emailHtml = (d) => {
  const row = (label, value) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap">${label}</td>` +
    `<td style="padding:6px 0;color:#0f172a;font-weight:600">${escapeHtml(value)}</td></tr>`;
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
      <h2 style="margin:0 0 4px">${escapeHtml(d.assignmentName)} is now available</h2>
      <p style="margin:0 0 16px;color:#475569">A new assignment has been published for your batch.</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${row("Course", d.courseName)}
        ${row("Batch", d.batchName)}
        ${row("Start", d.start)}
        ${row("End", d.end)}
        ${row("Marks", d.marks)}
        ${row("Questions", d.questions)}
      </table>
      <p style="margin:20px 0 0">
        <a href="${escapeHtml(d.link)}" style="background:#e8640c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open course</a>
      </p>
    </div>`;
};

// ─── Recipients ─────────────────────────────────────────────────────────────
/**
 * Course → batch(es) → enrolled students. `batchId` "" means a shared
 * assignment: every batch of the course. Each student appears once, with the
 * first batch they were found in.
 *
 * `batchId` is the `batchPedagogy` key the assignment is filed under. For most
 * courses that is one batch's _id, but a Degree Program course also files
 * material under a whole section ("section:<name>") or a content set
 * ("set:<n>") — see utils/batchResources.js. The assignment is for every group
 * whose material lives there: whose most specific container (where its writes
 * land, `containerKeysFor(...)[0]`) is that key. For a plain batch that is the
 * batch itself, exactly as before.
 */
async function resolveRecipients(courseId, batchId) {
  const CourseStructure = require("../models/Courses/courseStructureModal");
  const { isStudentUser, containerKeysFor } = require("./batchResources");
  const { groupLabel } = require("./courseGroups");

  const course = await CourseStructure.findById(courseId)
    .select("courseName batchAndParticipants batchResources")
    .populate({
      path: "batchAndParticipants.users.user",
      select: "_id email phone firstName lastName role",
      populate: { path: "role", select: "originalRole renameRole roleName roleValue" },
    })
    .lean();
  if (!course) return { courseName: "", recipients: [] };

  const key = String(batchId || "");
  // A group the mapping sync archived (Degree Program) is no longer in use.
  const batches = (course.batchAndParticipants || []).filter((b) =>
    b && !b.archivedBySync &&
    (key ? Boolean(b._id) && containerKeysFor(course, String(b._id))[0] === key : true)
  );
  const seen = new Set();
  const recipients = [];
  for (const batch of batches) {
    for (const enrolment of batch.users || []) {
      if (enrolment.status && enrolment.status !== "active") continue;
      const user = enrolment.user;
      if (!user?._id || !isStudentUser(user)) continue;
      const id = String(user._id);
      if (seen.has(id)) continue;
      seen.add(id);
      // "Section A · Batch 1" for a degree group; the plain batch name otherwise.
      recipients.push({ user, batchId: String(batch._id), batchName: groupLabel(batch) });
    }
  }
  return { courseName: course.courseName, recipients };
}

// ─── Send ───────────────────────────────────────────────────────────────────
/**
 * Claim the one-time send, resolve the batch's students and notify them on
 * every ticked channel. Never throws to the caller — it runs after the save
 * has already succeeded, so a failure here is logged, not surfaced.
 */
async function sendAssignmentAvailable({ courseId, entityType, entityId, subcategory, batchId, exercise }) {
  const ExerciseNotificationLog = require("../models/Courses/ExerciseNotificationLogModel");
  const channels = studentChannels(exercise);
  if (!courseId || !channels) return;

  let log;
  try {
    log = await ExerciseNotificationLog.create({
      exerciseId: String(exercise._id),
      scopeKey: batchId || "shared",
      courseId, entityType, entityId, subcategory,
      exerciseName: exercise.exerciseInformation?.exerciseName,
      channels,
    });
  } catch (err) {
    if (err?.code === 11000) return; // already announced by another save
    throw err;
  }

  const { courseName, recipients } = await resolveRecipients(courseId, batchId);
  const delivered = { dashboard: 0, gmail: 0, whatsapp: 0 };
  let whatsappSkippedReason;

  // Group by batch so each student is told their own batch.
  const byBatch = new Map();
  for (const r of recipients) {
    if (!byBatch.has(r.batchId)) byBatch.set(r.batchId, { batchName: r.batchName, users: [] });
    byBatch.get(r.batchId).users.push(r.user);
  }

  for (const [bId, { batchName, users }] of byBatch) {
    const d = buildDetails({ exercise, courseName, batchName, courseId });
    const title = `${d.assignmentName} is now available`;
    const lines = detailLines(d);

    if (channels.dashboard) {
      const User = require("../models/UserModel");
      const now = new Date();
      const notification = {
        title,
        message: lines.join("\n"),
        type: "info",
        relatedEntity: "assignment",
        relatedEntityId: exercise._id,
        isRead: false,
        metadata: {
          kind: "assignment_available",
          courseId: String(courseId),
          exerciseId: String(exercise._id),
          batchId: bId,
          redirectUrl: `/lms/pages/courses/coursesdetailedview/${courseId}`,
        },
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      };
      // One write for the whole batch, newest first — as addNotification does.
      const res = await User.updateMany(
        { _id: { $in: users.map((u) => u._id) } },
        { $push: { notifications: { $each: [notification], $position: 0 } } }
      );
      delivered.dashboard += res.modifiedCount || 0;
    }

    if (channels.gmail) {
      const { sendEmail } = require("./sendEmail");
      const html = emailHtml(d);
      for (const u of users) {
        if (!u.email) continue;
        const r = await sendEmail({ receiverEmails: u.email, subject: title, body: html });
        if (r?.success) delivered.gmail += 1;
      }
    }

    if (channels.whatsapp) {
      const { sendWhatsApp } = require("./sendWhatsApp");
      const text = [`*${title}*`, ...lines, d.link].join("\n");
      const templateParams = [d.assignmentName, d.courseName, d.batchName, d.start, d.end, d.marks, d.questions];
      for (const u of users) {
        const r = await sendWhatsApp(u.phone, { text, templateParams });
        if (r.success) delivered.whatsapp += 1;
        else if (r.skipped) { whatsappSkippedReason = r.error; break; }
      }
    }
  }

  log.recipients = recipients.length;
  log.delivered = delivered;
  if (whatsappSkippedReason) log.whatsappSkippedReason = whatsappSkippedReason;
  await log.save();
  console.log(
    `[assignment-notify] "${exercise.exerciseInformation?.exerciseName}" course=${courseId} ` +
    `scope=${batchId || "shared"} students=${recipients.length} ` +
    `dashboard=${delivered.dashboard} gmail=${delivered.gmail} whatsapp=${delivered.whatsapp}` +
    (whatsappSkippedReason ? ` (whatsapp skipped: ${whatsappSkippedReason})` : "")
  );
}

// ─── The save hook ──────────────────────────────────────────────────────────
/**
 * Mongoose plugin for the four node models (Module / SubModule / Topic /
 * SubTopic). Before each save it finds We Do assignments that have just
 * become ready, stamps them, and after the save succeeds sends for them.
 */
function assignmentNotifyPlugin(schema, { entityType }) {
  schema.pre("save", function (next) {
    try {
      const due = [];
      const visit = (weDo, batchId, basePath) => {
        if (!weDo || typeof weDo.forEach !== "function") return;
        weDo.forEach((list, subcategory) => {
          if (!Array.isArray(list)) return;
          let stamped = false;
          for (const ex of list) {
            if (!ex) continue;
            const sent = typeof ex.get === "function" ? ex.get("studentNotification") : ex.studentNotification;
            if (sent?.sentAt) continue;
            if (assignmentNotifyBlocker(ex)) continue;
            const stamp = { sentAt: new Date(), batchId };
            if (typeof ex.set === "function") ex.set("studentNotification", stamp);
            else ex.studentNotification = stamp;
            stamped = true;
            due.push({ exercise: typeof ex.toObject === "function" ? ex.toObject() : ex, subcategory, batchId });
          }
          // Change tracking inside a Map of arrays is unreliable (the
          // controllers markModified these paths by hand too).
          if (stamped) this.markModified(`${basePath}.${TAB}.${subcategory}`);
        });
      };
      visit(this.pedagogy?.[TAB], "", "pedagogy");
      if (this.batchPedagogy && typeof this.batchPedagogy.forEach === "function") {
        this.batchPedagogy.forEach((bp, bId) => visit(bp?.[TAB], String(bId), `batchPedagogy.${bId}`));
      }
      this.$locals.assignmentNotifications = due;
    } catch (err) {
      // Never block a save over a notification.
      console.warn("[assignment-notify] pre-save check failed:", err.message);
    }
    next();
  });

  schema.post("save", function (doc) {
    const due = doc.$locals?.assignmentNotifications;
    if (!due || due.length === 0) return;
    doc.$locals.assignmentNotifications = [];
    for (const item of due) {
      sendAssignmentAvailable({ courseId: doc.courses, entityType, entityId: doc._id, ...item })
        .catch((err) => console.warn("[assignment-notify] send failed:", err.message));
    }
  });
}

module.exports = {
  assignmentNotifyPlugin,
  assignmentNotifyBlocker,
  sendAssignmentAvailable,
  resolveRecipients,
  buildDetails,
  detailLines,
};
