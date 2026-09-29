const ProgramCalendar = require("../../models/Courses/ProgramCalendarModel");
const CourseStructure = require("../../models/Courses/courseStructureModal");
const mongoose = require("mongoose");
const {
  calendarsArePerGroup,
  listCalendarTargets,
  calendarKeysFor,
  isValidCalendarKey,
  pickCalendar,
  calendarKeyLabel,
} = require("../../utils/calendarGroups");
const { getUserBatchId, isStudentUser } = require("../../utils/batchResources");

// What the Degree Program group rules read off a course.
const COURSE_GROUP_FIELDS = "programCalendarByBatch batchAndParticipants batch skillingBatches batches";

// Normalize the sessions array coming from the client (it uses `id` for the uid).
const normalizeSessions = (sessions = []) =>
  (Array.isArray(sessions) ? sessions : []).map((s) => ({
    slotId: s.slotId || s.id || "",
    kind: s.kind === "break" ? "break" : "session",
    name: s.name || "",
    startTime: s.startTime || "",
    endTime: s.endTime || "",
    trainer: s.trainer || "",
    sessionType: s.sessionType || "",
  }));

// Normalize the holidays array coming from the client (it uses `id` for the uid).
const normalizeHolidays = (holidays = []) =>
  (Array.isArray(holidays) ? holidays : []).map((h) => ({
    holidayId: h.holidayId || h.id || "",
    name: h.name || "Holiday",
    date: h.date || "",
    duration: ["full", "first-half", "second-half"].includes(h.duration)
      ? h.duration
      : "full",
  }));

// Normalize the deviations array coming from the client.
const normalizeDeviations = (deviations = []) =>
  (Array.isArray(deviations) ? deviations : []).map((dv) => ({
    deviationId: dv.deviationId || dv.id || "",
    date: dv.date || "",
    reason: dv.reason || "",
    // Batch scope — empty means all batches (legacy rows and the explicit
    // "everyone" answer alike). Without this line the whitelist silently
    // dropped the scope and every deviation regressed to course-wide.
    appliesTo: Array.isArray(dv.appliesTo)
      ? dv.appliesTo.map(String).filter(Boolean)
      : [],
  }));

/**
 * Create or update the program calendar for a course (upsert by courseId).
 * One calendar per course — saving again overwrites the previous configuration.
 */
// A calendar saved before phases existed has NO `phase` field at all — not an
// empty one. `{ phase: "" }` does not match a missing field in MongoDB, so
// matching "the unphased calendar" has to say both. Getting this wrong silently
// returned null for the very calendar the first phase is meant to inherit.
const UNPHASED = { $or: [{ phase: "" }, { phase: { $exists: false } }] };

// The same rule for the group: every calendar saved before groups has no
// `groupKey`, and it IS the common calendar — which is the only calendar any
// course outside the Degree Program ever has.
const COMMON_GROUP = { $or: [{ groupKey: "" }, { groupKey: { $exists: false } }] };
const phaseFilter = (phaseName) => (phaseName ? { phase: phaseName } : UNPHASED);
const groupFilter = (key) => (key ? { groupKey: key } : COMMON_GROUP);
/** One phase's calendar for one group — both conditions, each with its own $or. */
const scopeQuery = (courseId, phaseName, key) => ({ courseId, $and: [phaseFilter(phaseName), groupFilter(key)] });

exports.saveProgramCalendar = async (req, res) => {
  try {
    const {
      courseId,
      startDate,
      sessions,
      deviations,
      status,
      // The phase this calendar is for, by name. Absent for a course with no
      // phases, which keeps saving its single "" calendar exactly as before.
      phase,
      // Set by the client ONLY for a course's FIRST phase. It means "if this
      // course has a calendar from before phases existed, that calendar is
      // mine" — so the first save under Phase I adopts it instead of leaving
      // it orphaned beside a new one. Only the first phase may claim it; every
      // other phase starts empty, which is the point of phases.
      adoptLegacy,
      // Degree Program only: the section or batch this calendar is for, when
      // Course Setup gives groups their own calendars. Absent or "" is the
      // course's common calendar — for every other service, always.
      groupKey,
    } = req.body;

    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({
        success: false,
        message: "A valid courseId is required",
      });
    }

    // Pull a fresh snapshot of the course identity so the calendar is
    // self-describing even if the course list isn't loaded.
    const course = await CourseStructure.findById(courseId).lean();
    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found",
      });
    }

    const who = req.user?.email || req.user?.name || req.body.createdBy || "";

    const update = {
      courseId,
      courseName: course.courseName || "",
      courseCode: course.courseCode || "",
      courseDetails: {
        category: course.category || "",
        courseLevel: course.courseLevel || "",
        courseDuration: course.courseDuration || "",
        serviceType: course.serviceType || "",
        serviceModal: course.serviceModal || "",
        clientName: String(course.clientName || ""),
      },
      // ONLY the inputs are stored: the start date a human chose, the session
      // template they built, and the deviations that actually happened. End
      // date, day counts, hour totals and holidays are all DERIVED — the page
      // recomputes them from these inputs (plus pedagogy hours and the holiday
      // module) on every load, so a stored copy could only go stale. The
      // derived fields are written as empty here to flush values persisted by
      // older saves — otherwise they would sit in the record as stale lies.
      startDate: startDate || "",
      endDate: "",
      dailyHours: 0,
      totalHours: 0,
      estimatedDays: 0,
      holidays: [],
      sessions: normalizeSessions(sessions),
      deviations: normalizeDeviations(deviations),
      status: status === "published" ? "published" : "draft",
      updatedBy: who,
      updatedAt: new Date(),
    };

    // A group key must be one of the course's calendar groups right now.
    // Saving a stale one (a group since removed, or a course switched back to
    // one calendar) is refused rather than quietly written over the common
    // calendar, which every other group follows.
    const key = typeof groupKey === "string" ? groupKey.trim() : "";
    if (key && !isValidCalendarKey(course, key)) {
      return res.status(409).json({
        success: false,
        message: "This group no longer has its own Program Calendar. Reload the page and pick a group again.",
      });
    }
    // A degree group's own calendar is a second calendar for the same course
    // and phase, which the older one-per-course indexes would reject.
    if (key) await ProgramCalendar.ensureGroupIndexes();

    const phaseName = typeof phase === "string" ? phase.trim() : "";
    let existing = await ProgramCalendar.findOne(scopeQuery(courseId, phaseName, key));
    if (!existing && phaseName && adoptLegacy && !key) {
      existing = await ProgramCalendar.findOne(scopeQuery(courseId, "", ""));
    }

    let calendar;
    if (existing) {
      calendar = await ProgramCalendar.findOneAndUpdate(
        { _id: existing._id },
        { $set: { ...update, phase: phaseName, groupKey: key } },
        { new: true }
      );
    } else {
      // A group's first save: its own calendar begins here, from what the page
      // showed — which was the calendar it had been following.
      calendar = await ProgramCalendar.create({ ...update, phase: phaseName, groupKey: key, createdBy: who });
    }

    return res.status(existing ? 200 : 201).json({
      success: true,
      message: existing
        ? "Program calendar updated successfully"
        : "Program calendar created successfully",
      data: calendar,
    });
  } catch (error) {
    console.error("Error saving program calendar:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get the program calendar for a single course.
 */
exports.getProgramCalendarByCourse = async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid courseId" });
    }

    // Same rule as the save: this phase's calendar, falling back to a
    // pre-phase one only for the course's first phase.
    const phaseName = typeof req.query.phase === "string" ? req.query.phase.trim() : "";
    const course = await CourseStructure.findById(courseId).select(COURSE_GROUP_FIELDS).lean();

    // Degree Program: which group's calendar. Staff pick one on the Program
    // Calendar page; a student only ever gets their own group's, whatever they
    // ask for. With no pick, the page opens on the first group. Any other
    // course has no targets, so this resolves to its one common calendar.
    const targets = listCalendarTargets(course);
    const asked = typeof req.query.group === "string" ? req.query.group.trim() : "";
    let target = "";
    if (targets.length) {
      if (req.user && isStudentUser(req.user)) target = getUserBatchId(course, req.user._id || req.user.id);
      else target = targets.some((t) => t.id === asked) ? asked : targets[0].id;
    }
    const keys = calendarKeysFor(course, target);
    // Saves go to the group's own calendar: the first key.
    const saveKey = keys[0] || "";

    const calendars = await ProgramCalendar.find({ courseId, ...phaseFilter(phaseName) }).lean();
    let calendar = pickCalendar(calendars, keys);
    if (!calendar && phaseName && String(req.query.adoptLegacy || "") === "1") {
      calendar = await ProgramCalendar.findOne(scopeQuery(courseId, "", "")).lean();
    }

    const foundKey = calendar ? String(calendar.groupKey || "") : "";
    const group = {
      perGroup: calendarsArePerGroup(course) && targets.length > 0,
      targets,
      key: saveKey,
      label: calendarKeyLabel(course, saveKey),
      // True when the group has no calendar of its own yet and is shown the
      // one it follows — its section's or the common one. Saving creates its
      // own from what is on screen.
      inherited: Boolean(calendar) && foundKey !== saveKey,
      inheritedFrom: calendar && foundKey !== saveKey ? calendarKeyLabel(course, foundKey) : "",
    };

    // Not an error — the course simply has no saved calendar yet.
    if (!calendar) {
      return res.status(200).json({
        success: true,
        message: "No program calendar saved for this course yet",
        data: null,
        group,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Program calendar fetched successfully",
      data: calendar,
      group,
    });
  } catch (error) {
    console.error("Error fetching program calendar:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Get all saved program calendars (list view — excludes the heavy arrays).
 */
exports.getAllProgramCalendars = async (req, res) => {
  try {
    const calendars = await ProgramCalendar.find()
      .select("-sessions -holidays")
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "Program calendars fetched successfully",
      data: calendars,
    });
  } catch (error) {
    console.error("Error fetching program calendars:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

/**
 * Delete the program calendar for a course.
 */
exports.deleteProgramCalendar = async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid courseId" });
    }

    // Scoped to the phase, so resetting Phase II never destroys Phase I's
    // calendar. No legacy adoption here: deleting is not the place to guess.
    // And (Degree Program) to the group: resetting one group's calendar leaves
    // it following its section's or the common calendar again, and touches no
    // other group's.
    const phaseName = typeof req.query.phase === "string" ? req.query.phase.trim() : "";
    const key = typeof req.query.group === "string" ? req.query.group.trim() : "";
    const deleted = await ProgramCalendar.findOneAndDelete(scopeQuery(courseId, phaseName, key));

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Program calendar not found for this course",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Program calendar deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting program calendar:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
