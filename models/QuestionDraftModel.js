const mongoose = require("mongoose");

// One file inside a student's per-question draft.
const DraftFileSchema = new mongoose.Schema(
  {
    name:    { type: String, required: true },   // basename, e.g. "main.py"
    path:    { type: String, required: true },   // "/main.py" or "/dir/util.py"
    content: { type: String, default: "" },
  },
  { _id: false }
);

// One document per (userId, exerciseId, questionId). Captures the student's
// LIVE in-progress code so a Railway restart can rehydrate the container disk.
// Final submissions still live on the User document under courses[].answers[].
const QuestionDraftSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: "LMS-User", required: true },
  exerciseId: { type: String, required: true },
  questionId: { type: String, required: true },
  language:   { type: String, default: "python" },
  files:      { type: [DraftFileSchema], default: [] },
  updatedAt:  { type: Date, default: Date.now },
});

// One draft per (student, exercise, question) — upsert on save.
QuestionDraftSchema.index(
  { userId: 1, exerciseId: 1, questionId: 1 },
  { unique: true }
);

module.exports = mongoose.model("QuestionDraft", QuestionDraftSchema);
