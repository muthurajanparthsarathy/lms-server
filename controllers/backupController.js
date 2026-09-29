// controllers/backupController.js
//
// House style: plain `exports.fn = async (req, res)` with a try/catch per
// handler (there is no asyncHandler and no central error middleware in this
// app). Response envelope: { success, data, message } on success and
// { success: false, message } on error.
//
// Institution scope ALWAYS comes from req.user.institution. Nothing in this file
// reads an institution, a client or a course id out of the request body without
// re-proving it belongs to the caller's institution (utils/backupScopes.js does
// that proof in loadClient / loadCourse).

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const Backup = require("../models/BackupModel");
const {
  buildPlan,
  institutionMatch,
  SCOPES,
  SCOPES_REQUIRING_TARGET,
  COLLECTIONS,
} = require("../utils/backupScopes");
const backupService = require("../services/backupService");
const BackupSchedule = require("../models/BackupScheduleModel");
const {
  FREQUENCIES,
  computeNextRunAt,
  describeSchedule,
  parseTime,
} = require("../utils/backupScheduleTiming");

const { BackupError, MAX_DOCUMENTS, BACKUP_DIR } = backupService;

const DESTINATIONS = ["local", "db"];

const isValidId = (value) => !!value && mongoose.Types.ObjectId.isValid(String(value));

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

// BackupPlanError / BackupError carry their own status; anything else is a 500.
const fail = (res, error, fallback) => {
  const status = error && error.statusCode ? error.statusCode : 500;
  const message =
    error && error.statusCode ? error.message : fallback || "Internal server error";
  return res.status(status).json({ success: false, message });
};

const rawDb = () => {
  const db = mongoose.connection && mongoose.connection.db;
  if (!db) throw new BackupError("Database connection is not ready", 500);
  return db;
};

const requireInstitution = (req) => {
  const institution = req.user && req.user.institution;
  if (!institution) throw new BackupError("User institution not found", 400);
  return institution;
};

// The stored record as the API exposes it (the BackupRecord shape in the API
// contract, minus mongoose's __v). filePath is part of that contract; the file
// is still only ever served through /backup/:id/download.
const toRecord = (doc) => {
  if (!doc) return null;
  const record = doc.toObject ? doc.toObject() : { ...doc };
  delete record.__v;
  return record;
};

const validateScope = (scope, targetId) => {
  if (!SCOPES.includes(scope)) {
    throw new BackupError(
      `Invalid scope. Expected one of: ${SCOPES.join(", ")}`,
      400
    );
  }
  if (SCOPES_REQUIRING_TARGET.includes(scope) && !targetId) {
    throw new BackupError(`A targetId is required for the "${scope}" scope`, 400);
  }
  if (targetId && !isValidId(targetId)) {
    throw new BackupError("Invalid targetId", 400);
  }
};

// ── 1. GET /backup/targets ───────────────────────────────────────────────────

exports.getBackupTargets = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    // Matches the institution field as ObjectId OR String — some course-structures
    // rows store it as a raw string (see utils/backupScopes.js institutionMatch),
    // and a course that cannot be listed here could never be chosen as a target.
    const institutionId = institutionMatch(institution);
    const db = rawDb();

    const [clients, courses] = await Promise.all([
      db
        .collection(COLLECTIONS.clients)
        .find({ institution: institutionId }, { projection: { clientCompany: 1, status: 1 } })
        .sort({ clientCompany: 1 })
        .toArray(),
      db
        .collection(COLLECTIONS.courses)
        .find(
          { institution: institutionId },
          { projection: { courseName: 1, courseCode: 1, clientId: 1, clientName: 1 } }
        )
        .sort({ courseName: 1 })
        .toArray(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        clients: clients.map((client) => ({
          _id: client._id,
          clientCompany: client.clientCompany || "",
          status: client.status || "",
        })),
        courses: courses.map((course) => ({
          _id: course._id,
          courseName: course.courseName || "",
          courseCode: course.courseCode || "",
          clientId: course.clientId || null,
          clientName: course.clientName || "",
        })),
      },
    });
  } catch (error) {
    console.error("Backup getBackupTargets error:", error);
    return fail(res, error, "Could not load backup targets");
  }
};

// ── 2. POST /backup/preview ──────────────────────────────────────────────────

exports.previewBackup = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    const { scope, targetId } = req.body || {};
    validateScope(scope, targetId);

    const plan = await buildPlan({ scope, targetId, institution });
    const { collections, totalDocuments } = await backupService.countPlan(plan);

    return res.status(200).json({
      success: true,
      data: {
        scope: plan.scope,
        targetName: plan.targetName,
        collections,
        totalDocuments,
      },
    });
  } catch (error) {
    console.error("Backup previewBackup error:", error);
    return fail(res, error, "Could not preview this backup");
  }
};

// ── 3. POST /backup/create ───────────────────────────────────────────────────

exports.createBackup = async (req, res) => {
  let record = null;
  try {
    const institution = requireInstitution(req);
    const { scope, targetId, destination, note } = req.body || {};

    validateScope(scope, targetId);
    if (!DESTINATIONS.includes(destination)) {
      return res.status(400).json({
        success: false,
        message: `Invalid destination. Expected one of: ${DESTINATIONS.join(", ")}`,
      });
    }
    if (destination === "db" && !process.env.BACKUP_MONGOURI) {
      return res.status(400).json({
        success: false,
        message: "BACKUP_MONGOURI is not configured in server/.env",
      });
    }

    const plan = await buildPlan({ scope, targetId, institution });
    const preview = await backupService.countPlan(plan);

    // Refuse an unrunnable dump before a single document is read.
    if (preview.totalDocuments > MAX_DOCUMENTS) {
      return res.status(400).json({
        success: false,
        message: `This selection contains ${preview.totalDocuments} documents, which exceeds the ${MAX_DOCUMENTS} document limit for a single backup. Back up a smaller scope (a client or a course) instead.`,
      });
    }

    const userName = `${(req.user.firstName || "").trim()} ${(req.user.lastName || "").trim()}`.trim();

    record = await Backup.create({
      institution: toObjectId(institution),
      scope: plan.scope,
      targetId: plan.targetId,
      targetName: plan.targetName,
      destination,
      status: "running",
      collections: preview.collections,
      totalDocuments: preview.totalDocuments,
      note: typeof note === "string" ? note.slice(0, 1000) : "",
      createdBy: req.user._id,
      createdByName: userName,
      createdByEmail: req.user.email || "",
      startedAt: new Date(),
    });

    const meta = {
      institution,
      note: record.note,
      createdByEmail: record.createdByEmail,
    };

    // Runs synchronously: the contract responds with the COMPLETED record.
    const result =
      destination === "local"
        ? await backupService.runLocal(plan, meta)
        : await backupService.runDbCopy(plan, meta);

    record.collections = result.collections;
    record.totalDocuments = result.totalDocuments;
    record.status = "completed";
    record.completedAt = new Date();
    if (destination === "local") {
      record.fileName = result.fileName;
      record.filePath = result.filePath;
      record.sizeBytes = result.sizeBytes;
    } else {
      record.targetDatabase = result.targetDatabase;
    }
    await record.save();

    return res.status(200).json({
      success: true,
      data: toRecord(record),
      message: "Backup completed",
    });
  } catch (error) {
    console.error("Backup createBackup error:", error);
    // A record that got as far as being created must not be left "running".
    if (record) {
      try {
        record.status = "failed";
        record.error = String((error && error.message) || "Backup failed").slice(0, 2000);
        record.completedAt = new Date();
        await record.save();
      } catch (saveError) {
        console.error("Backup: could not mark record failed:", saveError.message);
      }
    }
    const status = error && error.statusCode ? error.statusCode : 500;
    return res.status(status).json({
      success: false,
      message:
        (error && error.message) ||
        "Backup failed. The backup record has been marked as failed.",
    });
  }
};

// ── 4. GET /backup/list ──────────────────────────────────────────────────────

exports.listBackups = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = { institution: toObjectId(institution) };

    const [items, total] = await Promise.all([
      Backup.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Backup.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        items: items.map(toRecord),
        total,
        page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("Backup listBackups error:", error);
    return fail(res, error, "Could not load backups");
  }
};

// ── 5. GET /backup/:id ───────────────────────────────────────────────────────

// Every :id lookup is institution-scoped, so one tenant can never read, download,
// restore or delete another tenant's backup.
const findOwnedBackup = async (req) => {
  const institution = requireInstitution(req);
  if (!isValidId(req.params.id)) throw new BackupError("Invalid backup id", 400);
  const record = await Backup.findOne({
    _id: toObjectId(req.params.id),
    institution: toObjectId(institution),
  });
  if (!record) throw new BackupError("Backup not found", 404);
  return record;
};

exports.getBackup = async (req, res) => {
  try {
    const record = await findOwnedBackup(req);
    return res.status(200).json({ success: true, data: toRecord(record) });
  } catch (error) {
    console.error("Backup getBackup error:", error);
    return fail(res, error, "Could not load this backup");
  }
};

// ── 6. GET /backup/:id/download ──────────────────────────────────────────────

exports.downloadBackup = async (req, res) => {
  try {
    const record = await findOwnedBackup(req);

    if (record.destination !== "local" || !record.filePath) {
      return res.status(404).json({
        success: false,
        message: "This backup has no downloadable file (it was copied to a backup database)",
      });
    }

    // The path is server-generated, but confirm it still resolves inside the
    // backups directory before streaming anything off disk.
    const resolved = path.resolve(record.filePath);
    if (!resolved.startsWith(path.resolve(BACKUP_DIR) + path.sep)) {
      return res.status(404).json({ success: false, message: "Backup file not found" });
    }
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ success: false, message: "Backup file is missing on disk" });
    }

    const stat = await fs.promises.stat(resolved);
    const fileName = (record.fileName || path.basename(resolved)).replace(/"/g, "");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", stat.size);

    const stream = fs.createReadStream(resolved);
    stream.on("error", (streamError) => {
      console.error("Backup downloadBackup stream error:", streamError);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "Could not read the backup file" });
      } else {
        res.destroy(streamError);
      }
    });
    return stream.pipe(res);
  } catch (error) {
    console.error("Backup downloadBackup error:", error);
    if (res.headersSent) return res.destroy();
    return fail(res, error, "Could not download this backup");
  }
};

// ── 7. POST /backup/:id/restore ──────────────────────────────────────────────

exports.restoreBackup = async (req, res) => {
  try {
    const record = await findOwnedBackup(req);
    const { mode, dryRun } = req.body || {};

    if (record.status !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Only a completed backup can be restored",
      });
    }

    const result = await backupService.restore(record, {
      // Anything that is not exactly 'overwrite' restores in 'skip' mode.
      mode: mode === "overwrite" ? "overwrite" : "skip",
      // Anything that is not exactly false is a dry run.
      dryRun: dryRun !== false && dryRun !== "false",
    });

    // A restore that hit write failures (e.g. a document colliding with a
    // non-_id unique index such as lms-users.email) still writes 200 with the
    // per-collection report — the caller needs the exact matched/inserted/
    // updated/skipped/failed counts, not a bare error that hides how much of
    // the restore actually landed.
    const failureNote =
      !result.dryRun && result.totalFailed
        ? ` ${result.totalFailed} document(s) could not be written — see the per-collection report.`
        : "";

    return res.status(200).json({
      success: true,
      data: result,
      message: result.dryRun
        ? "Dry run complete. No documents were written."
        : `Restore complete.${failureNote}`,
    });
  } catch (error) {
    console.error("Backup restoreBackup error:", error);
    return fail(res, error, "Could not restore this backup");
  }
};

// ── 8. DELETE /backup/:id ────────────────────────────────────────────────────

exports.deleteBackup = async (req, res) => {
  try {
    const record = await findOwnedBackup(req);

    if (record.destination === "local" && record.filePath) {
      const resolved = path.resolve(record.filePath);
      if (resolved.startsWith(path.resolve(BACKUP_DIR) + path.sep)) {
        try {
          await fs.promises.unlink(resolved);
        } catch (unlinkError) {
          // A file that is already gone must not block deleting the record.
          if (unlinkError.code !== "ENOENT") {
            console.error("Backup deleteBackup unlink error:", unlinkError.message);
          }
        }
      }
    }

    await Backup.deleteOne({ _id: record._id });
    return res.status(200).json({ success: true, message: "Backup deleted" });
  } catch (error) {
    console.error("Backup deleteBackup error:", error);
    return fail(res, error, "Could not delete this backup");
  }
};

// ── 9. GET /backup/schedule ──────────────────────────────────────────────────

// The schedule is created lazily on first read, so the UI always has a row to
// edit and the card never has to render an "unconfigured" special case.
const loadSchedule = async (institution) => {
  const existing = await BackupSchedule.findOne({ institution: toObjectId(institution) });
  if (existing) return existing;
  return BackupSchedule.create({ institution: toObjectId(institution) });
};

const schedulePayload = (doc) => {
  const record = doc.toObject ? doc.toObject() : { ...doc };
  delete record.__v;
  record.summary = describeSchedule(record);
  return record;
};

exports.getBackupSchedule = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    const schedule = await loadSchedule(institution);
    return res.status(200).json({ success: true, data: schedulePayload(schedule) });
  } catch (error) {
    console.error("Backup getBackupSchedule error:", error);
    return fail(res, error, "Could not load the backup schedule");
  }
};

// ── 10. PUT /backup/schedule ─────────────────────────────────────────────────

exports.updateBackupSchedule = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    const body = req.body || {};

    if (body.frequency !== undefined && !FREQUENCIES.includes(body.frequency)) {
      return res.status(400).json({
        success: false,
        message: `Invalid frequency. Expected one of: ${FREQUENCIES.join(", ")}`,
      });
    }
    if (body.time !== undefined && !/^\d{1,2}:\d{2}$/.test(String(body.time))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid time. Expected "HH:mm", e.g. "02:00".',
      });
    }
    if (body.scope !== undefined && !SCOPES.includes(body.scope)) {
      return res.status(400).json({
        success: false,
        message: `Invalid scope. Expected one of: ${SCOPES.join(", ")}`,
      });
    }
    // Accepts the array (current) or a single string (older clients).
    let nextDestinations = null;
    if (body.destinations !== undefined) {
      if (!Array.isArray(body.destinations)) {
        return res.status(400).json({
          success: false,
          message: "destinations must be an array",
        });
      }
      const cleaned = [...new Set(body.destinations.map(String))];
      const invalid = cleaned.filter((value) => !DESTINATIONS.includes(value));
      if (invalid.length) {
        return res.status(400).json({
          success: false,
          message: `Invalid destination(s): ${invalid.join(", ")}. Expected: ${DESTINATIONS.join(", ")}`,
        });
      }
      nextDestinations = cleaned;
    } else if (body.destination !== undefined) {
      if (!DESTINATIONS.includes(body.destination)) {
        return res.status(400).json({
          success: false,
          message: `Invalid destination. Expected one of: ${DESTINATIONS.join(", ")}`,
        });
      }
      nextDestinations = [body.destination];
    }

    const schedule = await loadSchedule(institution);

    if (body.enabled !== undefined) schedule.enabled = !!body.enabled;
    if (body.frequency !== undefined) schedule.frequency = body.frequency;
    if (body.time !== undefined) {
      // Normalised so "9:5" cannot be stored and later parsed as 09:05 by one
      // reader and 09:50 by another.
      const { hours, minutes } = parseTime(body.time);
      schedule.time = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    }
    if (body.dayOfWeek !== undefined) {
      const day = Number(body.dayOfWeek);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        return res.status(400).json({
          success: false,
          message: "Invalid dayOfWeek. Expected 0 (Sunday) to 6 (Saturday).",
        });
      }
      schedule.dayOfWeek = day;
    }
    if (body.dayOfMonth !== undefined) {
      const day = Number(body.dayOfMonth);
      if (!Number.isInteger(day) || day < 1 || day > 31) {
        return res.status(400).json({
          success: false,
          message: "Invalid dayOfMonth. Expected 1 to 31.",
        });
      }
      schedule.dayOfMonth = day;
    }
    if (body.scope !== undefined) schedule.scope = body.scope;
    if (nextDestinations) {
      schedule.destinations = nextDestinations;
      // Kept in step so anything still reading the singular field (and the
      // scheduler's own fallback) sees a coherent value.
      schedule.destination = nextDestinations[0] || "local";
    }
    if (body.targetId !== undefined) {
      const value = String(body.targetId || "");
      if (value && !isValidId(value)) {
        return res.status(400).json({ success: false, message: "Invalid targetId" });
      }
      schedule.targetId = value;
    }

    // A scope that needs a target but has none would fail every night at 2am
    // with nobody watching, so it is refused at save time instead.
    if (schedule.enabled && SCOPES_REQUIRING_TARGET.includes(schedule.scope) && !schedule.targetId) {
      return res.status(400).json({
        success: false,
        message: `The "${schedule.scope}" scope needs a target before the schedule can be enabled.`,
      });
    }
    const activeDestinations = Array.isArray(schedule.destinations) && schedule.destinations.length
      ? schedule.destinations
      : [schedule.destination].filter(Boolean);

    if (schedule.enabled && activeDestinations.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Choose at least one destination before enabling the schedule.",
      });
    }
    if (
      schedule.enabled &&
      activeDestinations.includes("db") &&
      !process.env.BACKUP_MONGOURI
    ) {
      return res.status(400).json({
        success: false,
        message: "BACKUP_MONGOURI is not configured in server/.env",
      });
    }

    // Recomputed on every save so an edit takes effect immediately rather than
    // after one more run at the OLD cadence.
    schedule.nextRunAt = schedule.enabled ? computeNextRunAt(schedule, new Date()) : null;
    schedule.updatedBy = req.user.email || "";
    await schedule.save();

    return res.status(200).json({
      success: true,
      data: schedulePayload(schedule),
      message: schedule.enabled ? "Schedule saved" : "Schedule turned off",
    });
  } catch (error) {
    console.error("Backup updateBackupSchedule error:", error);
    return fail(res, error, "Could not save the backup schedule");
  }
};
