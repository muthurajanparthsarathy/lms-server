// cron/backupScheduler.js
//
// Runs the schedules configured on System Settings ▸ Backup.
//
// A single tick every minute compares `nextRunAt` against now, rather than
// registering one node-cron job per institution: schedules are edited from the
// UI at runtime, and keeping a live cron registry in sync with those edits
// (add / change / disable / delete) is far more moving parts than one indexed
// query a minute.
//
// Two properties this has to hold, because it writes real backups unattended:
//
//   1. NEVER RUN TWICE. `nextRunAt` is advanced with a conditional update that
//      only succeeds for the process that still sees the old value, so a slow
//      run overlapping the next tick — or two server processes — cannot both
//      claim the same slot.
//   2. NEVER WEDGE. A failed run still advances `nextRunAt`, so one bad night
//      does not stop every future backup. The failure is recorded on the
//      schedule and shown on the card.

const cron = require("node-cron");
const mongoose = require("mongoose");

const BackupSchedule = require("../models/BackupScheduleModel");
const Backup = require("../models/BackupModel");
const { buildPlan } = require("../utils/backupScopes");
const backupService = require("../services/backupService");
const { computeNextRunAt } = require("../utils/backupScheduleTiming");

/** Guards against a long backup still running when the next tick arrives. */
let ticking = false;

/**
 * The destinations a schedule writes to, tolerating both shapes: the current
 * `destinations` array and the pre-array `destination` string. Falls back to
 * "local" so a malformed row still produces something rather than silently
 * backing up nowhere.
 */
function resolveDestinations(schedule) {
  const list = Array.isArray(schedule.destinations) ? schedule.destinations : [];
  const cleaned = list.filter((value) => value === "local" || value === "db");
  if (cleaned.length) return [...new Set(cleaned)];
  if (schedule.destination === "local" || schedule.destination === "db") {
    return [schedule.destination];
  }
  return ["local"];
}

/**
 * Run one destination and return its Backup row.
 *
 * The PLAN is built once by the caller and shared: re-planning per destination
 * would count the database twice and, worse, could select different documents
 * for the .zip and the db copy if anything changed in between.
 */
async function runOneDestination(schedule, plan, preview, destination) {
  const institution = schedule.institution;

  const record = await Backup.create({
    institution,
    scope: plan.scope,
    targetId: plan.targetId,
    targetName: plan.targetName,
    destination,
    status: "running",
    collections: preview.collections,
    totalDocuments: preview.totalDocuments,
    note: "Scheduled backup",
    createdByName: "Scheduler",
    createdByEmail: "scheduler",
    startedAt: new Date(),
  });

  try {
    const meta = { institution, note: record.note, createdByEmail: record.createdByEmail };
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
    return record;
  } catch (error) {
    record.status = "failed";
    record.error = String(error.message || "Scheduled backup failed").slice(0, 2000);
    record.completedAt = new Date();
    await record.save().catch(() => {});
    throw error;
  }
}

/**
 * Run every destination this schedule targets.
 *
 * One failing destination does NOT stop the others: if the backup database is
 * unreachable, the local .zip is still worth having. The caller is told only
 * that something failed, and which — the per-destination Backup rows carry the
 * detail.
 */
async function runScheduledBackup(schedule) {
  const institution = schedule.institution;

  const plan = await buildPlan({
    scope: schedule.scope,
    targetId: schedule.targetId || null,
    institution,
  });
  const preview = await backupService.countPlan(plan);

  if (preview.totalDocuments > backupService.MAX_DOCUMENTS) {
    throw new Error(
      `Scheduled selection contains ${preview.totalDocuments} documents, over the ${backupService.MAX_DOCUMENTS} limit.`
    );
  }

  const destinations = resolveDestinations(schedule);
  const records = [];
  const failures = [];

  for (const destination of destinations) {
    try {
      // eslint-disable-next-line no-await-in-loop
      records.push(await runOneDestination(schedule, plan, preview, destination));
    } catch (error) {
      failures.push(`${destination}: ${error.message}`);
    }
  }

  if (!records.length) {
    throw new Error(failures.join(" | ") || "Scheduled backup failed");
  }
  return { records, failures };
}

async function tick() {
  if (ticking) return;
  if (!mongoose.connection || mongoose.connection.readyState !== 1) return;
  ticking = true;

  try {
    const now = new Date();
    const due = await BackupSchedule.find({
      enabled: true,
      nextRunAt: { $ne: null, $lte: now },
    }).lean();

    for (const schedule of due) {
      const nextRunAt = computeNextRunAt(schedule, now);

      // Claim the slot BEFORE running: the update only matches while
      // nextRunAt is still the value this tick read, so a concurrent tick
      // (or a second process) that already advanced it gets no match and
      // skips the run entirely.
      // eslint-disable-next-line no-await-in-loop
      const claim = await BackupSchedule.updateOne(
        { _id: schedule._id, nextRunAt: schedule.nextRunAt },
        { $set: { nextRunAt, lastRunAt: now } }
      );
      if (!claim.modifiedCount) continue;

      try {
        // eslint-disable-next-line no-await-in-loop
        const { records, failures } = await runScheduledBackup(schedule);
        const total = records[0] ? records[0].totalDocuments : 0;
        // Partial success is recorded as FAILED with the reason: reporting
        // "completed" when the db copy did not happen would be the schedule
        // lying about what exists.
        // eslint-disable-next-line no-await-in-loop
        await BackupSchedule.updateOne(
          { _id: schedule._id },
          {
            $set: {
              lastStatus: failures.length ? "failed" : "completed",
              lastError: failures.join(" | ").slice(0, 500),
              lastBackupId: records[0]._id,
            },
          }
        );
        console.log(
          `Scheduled backup for institution ${schedule.institution}: ${total} documents to ${records
            .map((r) => r.destination)
            .join(" + ")}${failures.length ? ` (failed: ${failures.join(" | ")})` : ""}`
        );
      } catch (error) {
        console.error(
          `Scheduled backup FAILED for institution ${schedule.institution}:`,
          error.message
        );
        // eslint-disable-next-line no-await-in-loop
        await BackupSchedule.updateOne(
          { _id: schedule._id },
          {
            $set: {
              lastStatus: "failed",
              lastError: String(error.message || "Scheduled backup failed").slice(0, 500),
            },
          }
        ).catch(() => {});
      }
    }
  } catch (error) {
    console.error("Backup scheduler tick error:", error.message);
  } finally {
    ticking = false;
  }
}

function startBackupScheduler() {
  cron.schedule("* * * * *", tick);
  console.log("Backup scheduler started (checks every minute)");
}

module.exports = { startBackupScheduler, tick, runScheduledBackup, resolveDestinations };
