// models/BackupModel.js
//
// One document per backup run. The record is created with status "running"
// BEFORE the dump starts so a crash mid-run leaves a visible, explainable row
// instead of silence; the controller flips it to "completed" or "failed".
//
// Deliberately NOT stored: the destination Mongo URI. A "db" backup keeps only
// `targetDatabase` (the database name) so credentials never reach the database,
// the API response or the logs.

const mongoose = require("mongoose");

// `collection` is a reserved mongoose schema pathname, so it warns on every
// boot. The name is fixed by the API contract and verified to round-trip
// correctly (read, toObject and toJSON all return the stored string), so the
// warning is suppressed rather than the field renamed.
const backupCollectionSchema = new mongoose.Schema(
  {
    collection: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { _id: false, suppressReservedKeysWarning: true }
);

const backupSchema = new mongoose.Schema(
  {
    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LMS-Institution",
      required: true,
      index: true,
    },

    // What was selected. targetId is a String because it addresses different
    // collections per scope (client _id, course _id) and is empty for the
    // institution-wide and all-users scopes.
    scope: {
      type: String,
      enum: ["client", "users", "course", "client-full", "institution"],
      required: true,
    },
    targetId: { type: String, default: "" },
    targetName: { type: String, default: "" },

    destination: { type: String, enum: ["local", "db"], required: true },
    status: {
      type: String,
      enum: ["running", "completed", "failed"],
      default: "running",
    },

    collections: { type: [backupCollectionSchema], default: [] },
    totalDocuments: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },

    // destination "local"
    fileName: { type: String, default: "" },
    filePath: { type: String, default: "" },

    // destination "db" — database NAME only, never the URI.
    targetDatabase: { type: String, default: "" },

    note: { type: String, default: "" },
    error: { type: String, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "LMS-User" },
    createdByName: { type: String, default: "" },
    createdByEmail: { type: String, default: "" },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The list endpoint is always "newest first, this institution".
backupSchema.index({ institution: 1, createdAt: -1, _id: -1 });
backupSchema.index({ institution: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("LMS-Backup", backupSchema);
