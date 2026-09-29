const mongoose = require("mongoose");

// One row per We Do assignment (per batch scope) whose "assignment available"
// notification has gone out to students — see utils/assignmentStudentNotify.js.
//
// The unique index is the send-ONCE guarantee: two saves racing each other
// (two tabs, a question added while settings save) both try to insert, and
// only the first wins; the loser sends nothing. The row doubles as an audit
// of who was reached on which channel.
const exerciseNotificationLogSchema = new mongoose.Schema(
  {
    exerciseId: { type: String, required: true },
    // The batch `_id` the assignment lives under, or "shared" for one that
    // every batch of the course receives.
    scopeKey: { type: String, required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course-Structure" },
    entityType: String,
    entityId: mongoose.Schema.Types.ObjectId,
    subcategory: String,
    exerciseName: String,
    channels: {
      dashboard: Boolean,
      gmail: Boolean,
      whatsapp: Boolean,
    },
    recipients: { type: Number, default: 0 },
    delivered: {
      dashboard: { type: Number, default: 0 },
      gmail: { type: Number, default: 0 },
      whatsapp: { type: Number, default: 0 },
    },
    whatsappSkippedReason: String,
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

exerciseNotificationLogSchema.index({ exerciseId: 1, scopeKey: 1 }, { unique: true });

module.exports = mongoose.model("Exercise-Notification-Log", exerciseNotificationLogSchema);
