const mongoose = require("mongoose");

// ── Sub-schema: a single time slot in the daily template ──
// kind === 'session' is a teaching block; kind === 'break' is a recess.
const DaySlotSchema = new mongoose.Schema(
  {
    slotId: { type: String }, // client-side uid (kept so the UI can re-key cleanly)
    kind: {
      type: String,
      enum: ["session", "break"],
      default: "session",
    },
    name: { type: String, default: "" },
    startTime: { type: String, default: "" }, // "HH:mm" (24h)
    endTime: { type: String, default: "" }, // "HH:mm" (24h)
    trainer: { type: String, default: "" }, // optional, session only
    sessionType: { type: String, default: "" }, // optional, session only
  },
  { _id: false }
);

// ── Sub-schema: a single holiday / leave day ──
const HolidaySchema = new mongoose.Schema(
  {
    holidayId: { type: String }, // client-side uid
    name: { type: String, default: "Holiday" },
    date: { type: String, default: "" }, // "YYYY-MM-DD" — stored as string to avoid TZ shifts
    duration: {
      type: String,
      enum: ["full", "first-half", "second-half"],
      default: "full",
    },
  },
  { _id: false }
);

// ── Sub-schema: an actual-calendar deviation (cancelled session day) ──
const DeviationSchema = new mongoose.Schema(
  {
    deviationId: { type: String }, // client-side uid
    date: { type: String, default: "" }, // "YYYY-MM-DD" — the cancelled day
    reason: { type: String, default: "" },
    // Which batches the cancellation hits — batchAndParticipants subdoc ids.
    // EMPTY means all batches: that is both the pre-batch legacy meaning and
    // the explicit "applies to everyone" answer, so old records need no
    // migration. A non-empty list is what lets one batch's end date drift
    // (b2 loses a day, b2 alone ends later) while the others hold.
    appliesTo: { type: [String], default: [] },
  },
  { _id: false }
);

// ── Sub-schema: a scheduled assessment day block ──
const AssessmentDaySchema = new mongoose.Schema(
  {
    asmtId: { type: String },         // client-side uid
    name: { type: String, default: "Assessment" },
    date: { type: String, default: "" },  // "YYYY-MM-DD" — start date of the block
    days: { type: Number, default: 1 },   // how many consecutive calendar days it occupies
  },
  { _id: false }
);

// ── Main schema: one program calendar per course ──
// Stores ONLY the calendar configuration (start/end, sessions, holidays) plus a
// lightweight snapshot of course identity. Modules/topics/subtopics are NOT stored
// here — they are loaded dynamically from their own collections.
const ProgramCalendarSchema = new mongoose.Schema(
  {
    // ── Course identity ──
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course-Structure",
      required: true,
      index: true,
    },
    // One calendar per course PER PHASE. A placement course runs its phases on
    // their own schedules, so "one calendar per course" — which this field
    // replaced as the uniqueness rule — could not express them.
    //
    // By NAME, like the module's: phase ids are not stable across reads. "" is
    // a calendar saved before phases, or a course that has none; a phased
    // course adopts such a calendar under its FIRST phase rather than stranding
    // it (see saveProgramCalendar).
    phase: { type: String, default: "", trim: true },
    // WHICH GROUP this calendar is for, when Course Setup gives groups their
    // own calendars (`programCalendarByBatch.sameForAllBatches === false`):
    //   ""              the course's common calendar — every calendar saved
    //                   before this field, and every course that keeps one;
    //   "<batchId>"     one batch's own calendar;
    //   "section:<key>" a Degree Program section's, shared by its batches.
    // A group without its own reads its section's, then the common one — see
    // utils/calendarGroups.js.
    groupKey: { type: String, default: "", trim: true },
    courseName: { type: String, default: "" },
    courseCode: { type: String, default: "" },
    // Lightweight course meta snapshot (not the hierarchy)
    courseDetails: {
      category: { type: String, default: "" },
      courseLevel: { type: String, default: "" },
      courseDuration: { type: String, default: "" },
      serviceType: { type: String, default: "" },
      serviceModal: { type: String, default: "" },
      clientName: { type: String, default: "" },
    },

    // ── Schedule configuration ──
    startDate: { type: String, default: "" }, // "YYYY-MM-DD"
    endDate: { type: String, default: "" }, // estimated end date, "YYYY-MM-DD"
    workingDays: {
      type: [Number], // 0=Sun … 6=Sat (Sunday excluded by default → [1,2,3,4,5,6])
      default: [1, 2, 3, 4, 5, 6],
    },
    dailyHours: { type: Number, default: 0 }, // teaching hours per day
    totalHours: { type: Number, default: 0 }, // total content hours (incl. assessment)
    estimatedDays: { type: Number, default: 0 },

    // ── The daily session template (sessions + breaks) ──
    sessions: { type: [DaySlotSchema], default: [] },

    // ── Holidays / leaves ──
    holidays: { type: [HolidaySchema], default: [] },

    // ── Actual-calendar deviations (cancelled days + reason) ──
    deviations: { type: [DeviationSchema], default: [] },

    // ── Scheduled assessment day blocks ──
    assessmentDays: { type: [AssessmentDaySchema], default: [] },

    // ── Status & metadata ──
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One calendar per course, per phase, per group.
ProgramCalendarSchema.index({ courseId: 1, phase: 1, groupKey: 1 }, { unique: true });

const ProgramCalendar = mongoose.model("Program-Calendar", ProgramCalendarSchema);

// Older databases carry unique indexes from earlier rules — on the course alone
// (before phases) and on course + phase (before groups). Either one rejects a
// second calendar for the same course, so both are dropped before the first
// save needs the room, and the current index is built. Idempotent and run once
// per process; indexes that are already gone are simply skipped. Anything
// else on the collection is left alone.
let indexesReady = null;
ProgramCalendar.ensureGroupIndexes = () => {
  if (!indexesReady) {
    indexesReady = (async () => {
      const existing = await ProgramCalendar.collection.indexes();
      for (const name of ["courseId_1_phase_1"]) {
        if (existing.some((i) => i.name === name)) await ProgramCalendar.collection.dropIndex(name);
      }
      const courseOnly = existing.find((i) => i.name === "courseId_1");
      if (courseOnly && courseOnly.unique) await ProgramCalendar.collection.dropIndex("courseId_1");
      await ProgramCalendar.createIndexes();
    })().catch((error) => {
      indexesReady = null; // let the next save try again
      throw error;
    });
  }
  return indexesReady;
};

module.exports = ProgramCalendar;
