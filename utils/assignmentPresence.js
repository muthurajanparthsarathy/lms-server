// ─── We Do assignment presence ──────────────────────────────────────────────
// Which learners have a We Do assignment editor open right now.
//
// A We Do assignment never opens an ExamSession, so the Live Dashboard had no
// live signal for it and guessed from stored answers alone — one saved answer
// read as "Completed" while the learner was still working in the editor. The
// editor now announces itself over the socket (liveDashboardSocket.js) and the
// dashboard reads an entry here as "Started".
//
// Kept in memory, like the offline timers in liveDashboardSocket.js: there is
// one socket server, and an open editor re-announces itself on every
// reconnect and heartbeat, so a server restart heals itself within seconds.

// `${assessmentId}:${studentId}` → {
//   sockets: Map<socketId, lastSeenMs>,  // one per open tab
//   courseId, nodeId, nodeType,          // where to read the stored answers
//   leaveTimer,                          // pending "left the editor" flip
// }
const editors = new Map();

const keyOf = (assessmentId, studentId) => `${String(assessmentId)}:${String(studentId)}`;

// Record (or refresh) one socket's open editor. Returns the entry.
function touch(assessmentId, studentId, socketId, context = {}) {
  const key = keyOf(assessmentId, studentId);
  let entry = editors.get(key);
  if (!entry) {
    entry = {
      assessmentId: String(assessmentId),
      studentId: String(studentId),
      sockets: new Map(),
      leaveTimer: null,
    };
    editors.set(key, entry);
  }
  if (entry.leaveTimer) {
    clearTimeout(entry.leaveTimer);
    entry.leaveTimer = null;
  }
  entry.sockets.set(socketId, Date.now());
  if (context.courseId) entry.courseId = String(context.courseId);
  if (context.nodeId) entry.nodeId = String(context.nodeId);
  if (context.nodeType) entry.nodeType = String(context.nodeType);
  return entry;
}

// Drop one socket's editor. Returns the entry when no tab has it open any
// more (the caller schedules the leave), otherwise null.
function release(assessmentId, studentId, socketId) {
  const entry = editors.get(keyOf(assessmentId, studentId));
  if (!entry) return null;
  entry.sockets.delete(socketId);
  return entry.sockets.size === 0 ? entry : null;
}

// Still attending — an editor is open, or one just closed and the short
// grace for a reload / reconnect has not run out yet.
function isAttending(assessmentId, studentId) {
  return editors.has(keyOf(assessmentId, studentId));
}

function remove(entry) {
  const key = keyOf(entry.assessmentId, entry.studentId);
  if (editors.get(key) === entry) editors.delete(key);
}

function all() {
  return Array.from(editors.values());
}

module.exports = { touch, release, isAttending, remove, all };
