const mongoose = require("mongoose");

// Named sequences for human-readable ids, one document per sequence: `_id` is
// the sequence's name and `seq` the last number handed out. Numbers are taken
// with a single atomic findOneAndUpdate + $inc, so two concurrent requests can
// never be given the same one. First user: the client's Client ID
// (utils/clientCode.js).
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    seq: { type: Number },
  },
  { versionKey: false }
);

module.exports = mongoose.model("LMS-Counter", counterSchema);
