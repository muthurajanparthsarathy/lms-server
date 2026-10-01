// ─── Live Dashboard socket handlers ─────────────────────────────────────────
// Attached to the EXISTING io instance (see server.js). Never creates a new
// socket server. All teacher views for one assessment share the room
// `assessment_{assessmentId}_teachers`, so multiple teachers stay in sync.

const ExamSession = require("../models/Courses/moduleStructure/ExamSessionModel");
const StudentQuestionActivity = require("../models/Courses/moduleStructure/StudentQuestionActivityModel");
const User = require("../models/UserModel");
const assignmentPresence = require("./assignmentPresence");
// The stored-answer rules for a We Do row live with the dashboard GET.
// Required lazily, like the attempt gate below, so this module never loads
// the controller at boot.
let _dashboard = null;
function dashboardController() {
  if (!_dashboard) _dashboard = require("../controllers/courses/moduleStructure/liveDashboard");
  return _dashboard;
}
// Arm the resume-permission gate the moment a student's grace-flip fires.
// Imported lazily to avoid a require-cycle on server boot.
let _attemptGate = null;
function armGate(assessmentId, studentId) {
  try {
    if (!_attemptGate) _attemptGate = require("../controllers/courses/moduleStructure/attemptController");
    if (_attemptGate && typeof _attemptGate.armResumeGateOnDisconnect === "function") {
      return _attemptGate.armResumeGateOnDisconnect(assessmentId, studentId);
    }
  } catch (e) { /* ignore */ }
}

const room = (assessmentId) => `assessment_${assessmentId}_teachers`;

// Pending "went offline" timers, so a quick reconnect cancels the offline mark.
const offlineTimers = new Map(); // key: `${assessmentId}:${studentId}` → Timeout

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

// Stash the (assessmentId, studentId) this socket represents, so the native
// `disconnect` handler can run the same offline-cleanup as the cooperative
// `student:disconnected` event when the tab is killed without a clean emit.
function rememberStudent(socket, assessmentId, studentId) {
  if (!socket || !assessmentId || !studentId) return;
  socket.data = socket.data || {};
  socket.data.studentContext = { assessmentId, studentId };
}

// Mark the student offline and schedule the 30s grace before flipping
// inProgress → false. Shared by `student:disconnected` and the native
// `disconnect` handler so both paths self-heal identically.
async function scheduleOfflineFlip(io, assessmentId, studentId) {
  if (!assessmentId || !studentId) return;
  await ExamSession.updateOne(
    { assessmentId, studentId },
    { $set: { isOnline: false, lastActivityAt: new Date() } }
  );

  const key = `${assessmentId}:${studentId}`;
  if (offlineTimers.has(key)) clearTimeout(offlineTimers.get(key));
  const timer = setTimeout(async () => {
    offlineTimers.delete(key);
    const session = await ExamSession.findOne({ assessmentId, studentId });
    if (session && !session.isOnline && !session.submittedAt) {
      session.inProgress = false;
      await session.save();
      // Arm the resume-permission gate — student cannot re-enter without
      // trainer approval. Fire-and-forget; the arming broadcast is done
      // inside the controller so the dashboard sees it immediately.
      armGate(assessmentId, studentId);
      io.to(room(assessmentId)).emit("dashboard:student_update", {
        studentId, inProgress: false, isOnline: false,
        attemptStatus: session.status || 'active',
        terminationReason: session.terminationReason || null,
        lastActivity: fmtActivity(session.lastActivityAt),
      });
    }
  }, 30000);
  offlineTimers.set(key, timer);
}

async function getOrCreateSession(assessmentId, studentId, patch = {}) {
  let session = await ExamSession.findOne({ assessmentId, studentId });
  if (!session) {
    session = new ExamSession({ assessmentId, studentId, joinedAt: new Date(), ...patch });
  } else {
    Object.assign(session, patch);
  }
  // A submitted / terminated attempt cannot be resumed, so re-opening its page
  // (which re-emits student:joined) must not mark it attending again — the
  // dashboard reads `inProgress` as "Started" ahead of "Completed".
  if (session.submittedAt || (session.status && session.status !== "active")) {
    session.inProgress = false;
  }
  await session.save();
  return session;
}

// ─── We Do assignment presence (see assignmentPresence.js) ─────────────────
//   • close grace      — the editor unmounted (Back, Finish). Short: it only
//                        absorbs a remount, e.g. React's dev double-mount.
//   • disconnect grace — the socket dropped (reload, flaky Wi-Fi). Long
//                        enough for the page to come back and re-announce.
//   • stale            — an open editor re-announces every 25 s (a background
//                        tab's timers may slow that to once a minute), so a
//                        tab silent this long is gone even without a
//                        disconnect.
const ASSIGNMENT_CLOSE_GRACE_MS = 3 * 1000;
const ASSIGNMENT_DISCONNECT_GRACE_MS = 15 * 1000;
const ASSIGNMENT_STALE_MS = 150 * 1000;

// The socket's own authenticated id wins; the payload id is the fallback for
// a socket that connected before the learner's token was stored.
function assignmentStudentId(socket, payload) {
  return String(socket.userId || (payload && payload.studentId) || "");
}

// After the grace, if no tab has the editor open again, drop the learner and
// send the dashboards their stored row — answers in progress, or the
// finished assignment — so "Started" falls back to what they actually left.
function scheduleAssignmentLeave(io, entry, delayMs) {
  if (entry.leaveTimer) clearTimeout(entry.leaveTimer);
  entry.leaveTimer = setTimeout(async () => {
    entry.leaveTimer = null;
    if (entry.sockets.size > 0) return;
    assignmentPresence.remove(entry);
    let stored = null;
    try {
      stored = await dashboardController().assignmentRowState(entry);
    } catch (e) {
      console.error("assignment leave state error:", e.message);
    }
    // Re-opened while the stored state was loading — that open already told
    // the dashboards "Started"; don't overwrite it.
    if (assignmentPresence.isAttending(entry.assessmentId, entry.studentId)) return;
    io.to(room(entry.assessmentId)).emit("dashboard:student_update", {
      studentId: entry.studentId,
      ...(stored || {}),
      inProgress: false,
      isOnline: false,
      lastActivity: fmtActivity(new Date()),
    });
  }, delayMs);
}

let assignmentSweepStarted = false;
function startAssignmentPresenceSweep(io) {
  if (assignmentSweepStarted) return;
  assignmentSweepStarted = true;
  setInterval(() => {
    const cutoff = Date.now() - ASSIGNMENT_STALE_MS;
    for (const entry of assignmentPresence.all()) {
      for (const [socketId, seenAt] of entry.sockets) {
        if (seenAt < cutoff) entry.sockets.delete(socketId);
      }
      if (entry.sockets.size === 0 && !entry.leaveTimer) scheduleAssignmentLeave(io, entry, 0);
    }
  }, 30 * 1000);
}

// Recompute completed/notAttempted from per-question activity, persist, broadcast.
async function recomputeAndBroadcast(io, assessmentId, studentId, extra = {}) {
  const session = await ExamSession.findOne({ assessmentId, studentId });
  if (!session) return;

  const completed = await StudentQuestionActivity.countDocuments({ assessmentId, studentId, status: "submitted" });
  const touched = await StudentQuestionActivity.countDocuments({ assessmentId, studentId, status: { $ne: "pending" } });
  const total = session.totalQuestions || 0;

  session.completedCount = completed;
  session.notAttemptedCount = Math.max(0, total - touched);
  await session.save();

  io.to(room(assessmentId)).emit("dashboard:student_update", {
    studentId,
    completed,
    yetToComplete: Math.max(0, total - completed),
    notAttempted: session.notAttemptedCount,
    completionPercent: total ? Math.round((completed / total) * 100) : 0,
    inProgress: session.inProgress,
    lastActivity: fmtActivity(session.lastActivityAt),
    // Recovery & Resume — carry the lifecycle fields on every broadcast so
    // the dashboard row can render the new Disconnected / Terminated pills
    // without a separate round-trip.
    isOnline: session.isOnline,
    attemptStatus: session.status || 'active',
    terminationReason: session.terminationReason || null,
    ...extra,
  });
}

// ─── Server-authoritative timer sweep (Recovery & Resume) ─────────────────
// A safety net that catches attempts whose timer expired while the student's
// browser was closed (so no submitAnswer landed to trip the lazy check in
// answer.js:enforceAttemptExpiry). Runs every 30 s per server process; the
// query is index-supported by `(status, serverExpiresAt)` on ExamSession.
// Guarded by a module-level flag so multiple socket connections don't stack
// intervals.
let expirySweepStarted = false;
function startExpirySweep(io) {
  if (expirySweepStarted) return;
  expirySweepStarted = true;
  const SWEEP_MS = 30 * 1000;
  const sweep = async () => {
    try {
      const now = new Date();
      // Elapsed-time expiry (freeze at last submit). A session expires when:
      //   elapsedSec = max(0, (lastSubmittedAt || startedAt) - startedAt) / 1000
      //   elapsedSec >= totalDurationSeconds
      // Rows without totalDurationSeconds fall back to the legacy wall-clock
      // check on `serverExpiresAt` so pre-existing rows still get swept.
      const candidates = await ExamSession.find({
        status: "active",
        $or: [
          { totalDurationSeconds: { $gt: 0 } },
          { serverExpiresAt: { $ne: null } },
        ],
      });
      for (const s of candidates) {
        let expired = false;
        const total = Number(s.totalDurationSeconds);
        if (Number.isFinite(total) && total > 0 && s.startedAt) {
          const anchor = s.lastSubmittedAt || s.startedAt;
          const elapsedSec = Math.max(0, Math.floor((new Date(anchor).getTime() - new Date(s.startedAt).getTime()) / 1000));
          expired = elapsedSec >= total;
        } else if (s.serverExpiresAt && s.serverExpiresAt.getTime() <= now.getTime()) {
          expired = true;
        }
        if (!expired) continue;
        s.status = "terminated";
        s.terminationReason = "timer";
        s.submittedAt = now;
        s.inProgress = false;
        s.isOnline = false;
        await s.save();
        io.to(room(s.assessmentId)).emit("dashboard:student_update", {
          studentId: s.studentId,
          inProgress: false,
          isOnline: false,
          submitted: true,
          attemptStatus: 'terminated',
          terminationReason: 'timer',
          lastActivity: fmtActivity(s.lastActivityAt),
        });
      }
    } catch (e) {
      // Never let a sweep failure kill the interval — log and continue.
      console.error("[attempt.sweep] error:", e && e.message ? e.message : e);
    }
  };
  // Fire once on boot then every SWEEP_MS after. The initial call catches any
  // rows that expired while the server was down.
  setImmediate(sweep);
  setInterval(sweep, SWEEP_MS);
}

function registerLiveDashboardHandlers(io, socket) {
  // Kick off the expiry sweep on the first socket registration — this is the
  // first place we have a reference to `io`. Guarded by expirySweepStarted so
  // subsequent connections don't stack intervals.
  startExpirySweep(io);
  startAssignmentPresenceSweep(io);

  // ── Teacher rooms ──────────────────────────────────────────────────────────
  socket.on("teacher:join_dashboard", ({ assessmentId }) => {
    if (!assessmentId) return;
    socket.join(room(assessmentId));
  });

  socket.on("teacher:leave_dashboard", ({ assessmentId }) => {
    if (!assessmentId) return;
    socket.leave(room(assessmentId));
  });

  // ── Student's private attempt room (Recovery & Resume permission gate) ─
  // Students join here so the server can push `attempt:resume_state` events
  // (trainer approved/rejected). The room name embeds the studentId so
  // approvals only reach the intended student.
  socket.on("student:join_attempt_room", ({ exerciseId }) => {
    try {
      const studentId = socket.userId ? String(socket.userId) : null;
      if (!exerciseId || !studentId) return;
      socket.join(`assessment_${exerciseId}_student_${studentId}`);
    } catch { /* ignore */ }
  });

  // ── Student joined ───────────────────────────────────────────────────────────
  socket.on("student:joined", async ({ assessmentId, studentId, totalQuestions }) => {
    try {
      if (!assessmentId || !studentId) return;
      rememberStudent(socket, assessmentId, studentId);
      // totalQuestions may arrive from a single section (smaller) or the whole
      // assessment (larger) — keep the largest so % is computed against the full set.
      const existing = await ExamSession.findOne({ assessmentId, studentId }).lean();
      const total = Math.max(
        existing?.totalQuestions || 0,
        typeof totalQuestions === "number" ? totalQuestions : 0
      );
      const session = await getOrCreateSession(assessmentId, studentId, {
        isOnline: true,
        inProgress: true,
        lastActivityAt: new Date(),
        ...(total > 0 ? { totalQuestions: total } : {}),
      });

      // Pull `profile` alongside the name/email so the dashboard row can
      // render the avatar the moment a learner joins mid-session — without
      // this, a late-joining student's row rendered as initials until the
      // trainer refreshed the whole page and the initial-load payload from
      // liveDashboard.js re-supplied the URL. `rollNumber` piggybacks for the
      // same reason (Reg No column).
      const user = await User.findById(studentId)
        .select("firstName lastName email profile rollNumber")
        .lean()
        .catch(() => null);
      const name = user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email : "Student";
      const completed = session.completedCount || 0;

      io.to(room(assessmentId)).emit("dashboard:student_joined", {
        id: studentId,
        studentName: name,
        email: user?.email || "",
        profile: user?.profile || null,
        studentDisplayId: user?.rollNumber || "",
        totalQuestions: total,
        completed,
        yetToComplete: Math.max(0, total - completed),
        notAttempted: session.notAttemptedCount ?? Math.max(0, total - completed),
        inProgress: session.inProgress,
        completionPercent: total ? Math.round((completed / total) * 100) : 0,
        lastActivity: fmtActivity(session.lastActivityAt),
        submitted: !!session.submittedAt,
      });
    } catch (e) {
      console.error("student:joined error:", e.message);
    }
  });

  // ── Answer saved ─────────────────────────────────────────────────────────────
  socket.on("student:answer_saved", async ({ assessmentId, studentId, questionId, answer, timeTakenSeconds }) => {
    try {
      if (!assessmentId || !studentId || !questionId) return;
      rememberStudent(socket, assessmentId, studentId);
      const session = await getOrCreateSession(assessmentId, studentId, { isOnline: true, inProgress: true, lastActivityAt: new Date() });

      const submittedAt = new Date();
      await StudentQuestionActivity.findOneAndUpdate(
        { examSessionId: session._id, questionId },
        {
          $set: {
            examSessionId: session._id,
            assessmentId, studentId, questionId,
            status: "submitted",
            answer: answer != null ? String(answer).slice(0, 5000) : null,
            submittedAt,
            timeTakenSeconds: timeTakenSeconds || 0,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      await recomputeAndBroadcast(io, assessmentId, studentId);

      // Details view: this question is now submitted.
      io.to(room(assessmentId)).emit("student:question_update", {
        studentId, questionId, status: "submitted",
        submittedAt: submittedAt.toISOString(),
        timeTakenSeconds: timeTakenSeconds || 0,
      });
    } catch (e) {
      console.error("student:answer_saved error:", e.message);
    }
  });

  // ── Question changed (navigation) ────────────────────────────────────────────
  socket.on("student:question_changed", async ({ assessmentId, studentId, toQuestionId }) => {
    try {
      if (!assessmentId || !studentId) return;
      rememberStudent(socket, assessmentId, studentId);
      const session = await getOrCreateSession(assessmentId, studentId, {
        isOnline: true, inProgress: true, lastActivityAt: new Date(), currentQuestionId: toQuestionId || null,
      });

      // Mark the question the student moved TO as in-progress (unless already submitted).
      if (toQuestionId) {
        const existing = await StudentQuestionActivity.findOne({ examSessionId: session._id, questionId: toQuestionId });
        if (!existing) {
          await StudentQuestionActivity.create({
            examSessionId: session._id, assessmentId, studentId, questionId: toQuestionId, status: "answered",
          });
        }
        if (!existing || existing.status !== "submitted") {
          io.to(room(assessmentId)).emit("student:question_update", {
            studentId, questionId: toQuestionId, status: "in_progress",
            submittedAt: null, timeTakenSeconds: existing?.timeTakenSeconds || 0,
          });
        }
      }

      io.to(room(assessmentId)).emit("dashboard:student_update", {
        studentId, inProgress: session.inProgress, lastActivity: fmtActivity(session.lastActivityAt),
      });
    } catch (e) {
      console.error("student:question_changed error:", e.message);
    }
  });

  // ── We Do assignment editor open (also its 25 s heartbeat) ─────────────────
  // A We Do assignment has no ExamSession; the editor reports itself here so
  // the dashboard shows the learner as Started while they work.
  socket.on("student:assignment_open", (payload = {}) => {
    try {
      const assessmentId = String(payload.assessmentId || "");
      const studentId = assignmentStudentId(socket, payload);
      if (!assessmentId || !studentId) return;
      const wasAttending = assignmentPresence.isAttending(assessmentId, studentId);
      assignmentPresence.touch(assessmentId, studentId, socket.id, payload);
      socket.data = socket.data || {};
      socket.data.assignments = socket.data.assignments || new Map();
      socket.data.assignments.set(`${assessmentId}:${studentId}`, { assessmentId, studentId });
      // Repeated on every heartbeat, so a dashboard that joined after the
      // first announcement still catches up.
      io.to(room(assessmentId)).emit("dashboard:student_update", {
        studentId,
        inProgress: true,
        isOnline: true,
        ...(wasAttending ? {} : { lastActivity: fmtActivity(new Date()) }),
      });
    } catch (e) {
      console.error("student:assignment_open error:", e.message);
    }
  });

  // ── We Do assignment editor closed (Back / Finish / navigated away) ────────
  socket.on("student:assignment_close", (payload = {}) => {
    try {
      const assessmentId = String(payload.assessmentId || "");
      const studentId = assignmentStudentId(socket, payload);
      if (!assessmentId || !studentId) return;
      if (socket.data && socket.data.assignments) {
        socket.data.assignments.delete(`${assessmentId}:${studentId}`);
      }
      const left = assignmentPresence.release(assessmentId, studentId, socket.id);
      if (left) scheduleAssignmentLeave(io, left, ASSIGNMENT_CLOSE_GRACE_MS);
    } catch (e) {
      console.error("student:assignment_close error:", e.message);
    }
  });

  // ── Submitted (guard duplicates) ─────────────────────────────────────────────
  socket.on("student:submitted", async ({ assessmentId, studentId }) => {
    try {
      if (!assessmentId || !studentId) return;
      const session = await ExamSession.findOne({ assessmentId, studentId });
      if (session && session.submittedAt) return; // already submitted → ignore

      const submittedSession = await getOrCreateSession(assessmentId, studentId, {
        submittedAt: new Date(), inProgress: false, isOnline: true, lastActivityAt: new Date(),
      });

      // Duration = submit − start, so the dashboard "Time Duration" fills in the
      // moment a student submits (rather than only after a full refetch).
      let durationSeconds = null;
      if (submittedSession?.joinedAt && submittedSession?.submittedAt) {
        const sec = Math.round(
          (new Date(submittedSession.submittedAt).getTime() - new Date(submittedSession.joinedAt).getTime()) / 1000
        );
        if (Number.isFinite(sec) && sec >= 0) durationSeconds = sec;
      }

      // Recompute every count from the per-question activity and broadcast them
      // together, so Completed / Yet To Complete / Not Attempted / % always agree.
      await recomputeAndBroadcast(io, assessmentId, studentId, { inProgress: false, submitted: true, durationSeconds });
    } catch (e) {
      console.error("student:submitted error:", e.message);
    }
  });

  // ── Disconnected (cooperative emit) → 30s grace, then mark not-in-progress ──
  socket.on("student:disconnected", async ({ assessmentId, studentId }) => {
    try {
      await scheduleOfflineFlip(io, assessmentId, studentId);
    } catch (e) {
      console.error("student:disconnected error:", e.message);
    }
  });

  // ── Native disconnect (hard tab close, network drop, browser kill) ─────────
  // The client can't always emit `student:disconnected` before the socket
  // tears down. The native `disconnect` event always fires, so we run the
  // same 30s offline-flip using the (assessmentId, studentId) we stashed on
  // the socket during earlier student events. If we never saw a student
  // event on this socket (it was a teacher socket, or never joined an
  // assessment), `studentContext` is undefined and the helper no-ops.
  socket.on("disconnect", async () => {
    try {
      // We Do editors this tab had open — a reload gets the grace to return.
      const assignments = socket.data && socket.data.assignments;
      for (const { assessmentId, studentId } of assignments ? assignments.values() : []) {
        const left = assignmentPresence.release(assessmentId, studentId, socket.id);
        if (left) scheduleAssignmentLeave(io, left, ASSIGNMENT_DISCONNECT_GRACE_MS);
      }
      const ctx = socket.data && socket.data.studentContext;
      if (!ctx) return;
      await scheduleOfflineFlip(io, ctx.assessmentId, ctx.studentId);
    } catch (e) {
      console.error("socket disconnect cleanup error:", e.message);
    }
  });

  // ── Reconnected → cancel offline timer, back online ─────────────────────────
  socket.on("student:reconnected", async ({ assessmentId, studentId }) => {
    try {
      if (!assessmentId || !studentId) return;
      rememberStudent(socket, assessmentId, studentId);
      const key = `${assessmentId}:${studentId}`;
      if (offlineTimers.has(key)) { clearTimeout(offlineTimers.get(key)); offlineTimers.delete(key); }

      const session = await ExamSession.findOne({ assessmentId, studentId });
      if (!session) return;
      session.isOnline = true;
      if (!session.submittedAt) session.inProgress = true;
      session.lastActivityAt = new Date();
      await session.save();

      io.to(room(assessmentId)).emit("dashboard:student_update", {
        studentId, inProgress: session.inProgress, isOnline: true,
        attemptStatus: session.status || 'active',
        terminationReason: session.terminationReason || null,
        lastActivity: fmtActivity(session.lastActivityAt),
      });
    } catch (e) {
      console.error("student:reconnected error:", e.message);
    }
  });
}

module.exports = { registerLiveDashboardHandlers };
