// models/BackupScheduleModel.js
//
// One schedule per institution. The Backup page's "Backup Schedule" card reads
// this; cron/backupScheduler.js is what actually runs it.
//
// `nextRunAt` is a STORED timestamp rather than something recomputed from
// (frequency, time) on every tick. Two reasons:
//   1. It is the only way "every 2 days" can mean anything — that cadence is
//      relative to the last run, so it has to be anchored somewhere.
//   2. It makes the due check a single indexed comparison instead of parsing
//      and re-deriving a cron expression for every institution every minute.

const mongoose = require("mongoose");

const FREQUENCIES = ["daily", "every2days", "weekly", "monthly"];

const backupScheduleSchema = new mongoose.Schema(
  {
    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LMS-Institution",
      required: true,
      unique: true,
      index: true,
    },

    enabled: { type: Boolean, default: false },

    frequency: { type: String, enum: FREQUENCIES, default: "daily" },

    /** Local wall-clock time of day, "HH:mm" 24h. */
    time: { type: String, default: "02:00" },

    /** 0 = Sunday … 6 = Saturday. Only read when frequency is 'weekly'. */
    dayOfWeek: { type: Number, min: 0, max: 6, default: 1 },

    /** Only read when frequency is 'monthly'. 29-31 clamp to the month's last
     *  day so a schedule set for the 31st still fires in February. */
    dayOfMonth: { type: Number, min: 1, max: 31, default: 1 },

    // What the scheduled run backs up — the same shape the manual form posts.
    scope: {
      type: String,
      enum: ["client", "users", "course", "client-full", "institution"],
      default: "institution",
    },
    targetId: { type: String, default: "" },

    /**
     * Where each scheduled run writes. An ARRAY because a schedule can do both:
     * a local .zip you can download AND a copy in the backup database. Each
     * destination produces its own Backup row, because a backup record carries
     * exactly one destination (a .zip has a size and a file, a db copy has a
     * database name and neither).
     *
     * `destination` (singular) is still read as a fallback so schedules saved
     * before this became a list keep working without a migration.
     */
    destinations: {
      type: [{ type: String, enum: ["local", "db"] }],
      default: ["local"],
    },
    destination: { type: String, enum: ["local", "db"], default: "local" },

    nextRunAt: { type: Date, default: null, index: true },
    lastRunAt: { type: Date, default: null },
    lastStatus: {
      type: String,
      enum: ["never", "completed", "failed"],
      default: "never",
    },
    lastError: { type: String, default: "" },
    /** The BackupModel row the last scheduled run produced. */
    lastBackupId: { type: mongoose.Schema.Types.ObjectId, ref: "LMS-Backup", default: null },

    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LMS-BackupSchedule", backupScheduleSchema);
module.exports.FREQUENCIES = FREQUENCIES;
