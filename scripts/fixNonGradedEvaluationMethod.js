/**
 * One-off correction for the ten exercises seeded on DSA 2 ▸ "Fast & Slow
 * Pointers, Linked List Reversals" (see seedDsa2FastSlowPointerExercises.js).
 *
 * Two things to fix:
 *
 * 1. DUPLICATES. The seeder originally matched existing rows by NAME. A trainer
 *    renamed We Do EX201/EX202/EX203 in the wizard between runs, so the second
 *    run did not recognise them and appended a second row under each of those
 *    same EX ids. The seeder now matches on `exerciseId`; this script clears up
 *    what the name-matching run left behind. For each duplicated id the OLDEST
 *    row wins — that is the one the trainer has been editing (it carries their
 *    rename and a bumped `version`); the newer copy is the seeder's own, minutes
 *    old and never touched by anyone.
 *
 * 2. THE NON-GRADED RULE. A non-graded exercise records no score, so there is
 *    nothing to evaluate: the wizards now hide the Evaluation Method step for it
 *    and pin the stored method to Manual. That moved the matrix's non-graded
 *    slot from #02 (AI) onto #01 (Manual), so:
 *      #01  → Non-Graded · manual   · 0 marks  · no Grade Settings step
 *      #02  → Graded     · ai       · 50 marks · Grade Settings step
 *      #03  → Graded     · testcase · 50 marks   (already correct — verified)
 *      #04  → Graded     · testcase · 50 marks, level-based (already correct)
 *      #05  → Graded     · MCQ      · 50 marks   (already correct)
 *    As a backstop the same rule is applied to EVERY exercise on this node:
 *    isGraded === false ⇒ evaluationMethod.method = 'manual'.
 *
 * Names are left exactly as they are — the trainer's renames stand.
 *
 * Idempotent: re-running reports "already correct" and writes nothing.
 *
 * Run:  node scripts/fixNonGradedEvaluationMethod.js
 *       node scripts/fixNonGradedEvaluationMethod.js --dry-run
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const Topic = require("../models/Courses/moduleStructure/topicModal");

const TOPIC_ID = "6a9bbde440c030b8579e2906";
const WE_DO_SUB = "assignment";
const YOU_DO_SUB = "assesment";
const ACTOR = "batch@gmail.com";
const DRY = process.argv.includes("--dry-run");

// Target state per seeded id. Only the rows whose graded/evaluation pairing the
// rule changed carry a spec; the rest are verified and left alone.
const TARGET = {
  EX201: { isGraded: false, method: "manual", marksPerQuestion: 0 },
  EX202: { isGraded: true, method: "ai", marksPerQuestion: 10 },
  EX301: { isGraded: false, method: "manual", marksPerQuestion: 0 },
  EX302: { isGraded: true, method: "ai", marksPerQuestion: 10 },
};
const SEEDED = /^EX(20|30)[1-5]$/;

const changes = [];
const note = (s) => { changes.push(s); console.log(`    ${s}`); };

/** Keep the oldest row per duplicated exerciseId; return how many were dropped. */
function dedupe(list, label) {
  const byId = new Map();
  for (const ex of list) {
    const id = ex?.exerciseInformation?.exerciseId;
    if (!id || !SEEDED.test(id)) continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(ex);
  }
  let dropped = 0;
  for (const [id, rows] of byId) {
    if (rows.length < 2) continue;
    // Oldest first — the trainer's copy. `version` is shown so the log makes
    // clear which one carried edits.
    rows.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const keep = rows[0];
    for (const doomed of rows.slice(1)) {
      note(`${label} ${id}: dropped duplicate v${doomed.version} "${doomed.exerciseInformation.exerciseName}" ` +
        `(kept v${keep.version} "${keep.exerciseInformation.exerciseName}")`);
      list.splice(list.indexOf(doomed), 1);
      dropped++;
    }
  }
  return dropped;
}

/** Re-point every marks-bearing field at `marksPerQuestion`. */
function setMarks(ex, marksPerQuestion, label, id) {
  const isProgramming = ex.exerciseType === "Programming";
  const questions = ex.questions || [];
  const total = marksPerQuestion * questions.length;

  questions.forEach((q) => {
    if (isProgramming) q.score = marksPerQuestion;
    else q.mcqQuestionScore = marksPerQuestion;
  });

  const info = ex.exerciseInformation;
  info.totalMarks = total;
  info.totalMarksProgramming = isProgramming ? total : 0;
  info.totalMarksMCQ = isProgramming ? 0 : total;

  const prog = ex.questionConfiguration?.programmingQuestionConfiguration;
  if (prog && prog.questionConfigType === "general") {
    prog.generalMarksPerQuestion = marksPerQuestion;
    prog.scoreSettings.evenMarks = marksPerQuestion;
    prog.scoreSettings.totalMarks = total;
  }
  const mcq = ex.questionConfiguration?.mcqQuestionConfiguration;
  if (mcq) {
    mcq.marksPerQuestion = marksPerQuestion;
    mcq.mcqTotalMarks = total;
  }

  // computeAutoGrades: the grade IS the total; the pass mark is 40% of it, and
  // a non-graded exercise carries 0 / null.
  ex.gradeSettings = ex.gradeSettings || {};
  const pass = total > 0 ? Math.round(total * 0.4) : null;
  if (isProgramming) {
    ex.gradeSettings.programmingGrade = total;
    ex.gradeSettings.programmingGradeToPass = pass;
  } else {
    ex.gradeSettings.mcqGrade = total;
    ex.gradeSettings.mcqGradeToPass = pass;
  }
  note(`${label} ${id}: marks → ${marksPerQuestion}/question, ${total} total`);
}

function applyTarget(ex, label) {
  const id = ex.exerciseInformation.exerciseId;
  const spec = TARGET[id];
  if (!spec) return false;
  let touched = false;

  if ((ex.isGraded !== false) !== spec.isGraded) {
    note(`${label} ${id}: isGraded ${ex.isGraded} → ${spec.isGraded}`);
    ex.isGraded = spec.isGraded;
    touched = true;

    setMarks(ex, spec.marksPerQuestion, label, id);

    // The We Do list requires the Grade Settings step for a graded exercise and
    // must not see it on a non-graded one (ProblemSolving.tsx isExerciseComplete).
    const steps = Array.isArray(ex.stepsSaved) ? ex.stepsSaved.slice() : [];
    const has = steps.includes("Grade Settings");
    if (spec.isGraded && !has) steps.push("Grade Settings");
    if (!spec.isGraded && has) steps.splice(steps.indexOf("Grade Settings"), 1);
    ex.stepsSaved = steps;
    note(`${label} ${id}: stepsSaved → ${JSON.stringify(steps)}`);
  }

  if (ex.evaluationMethod?.method !== spec.method) {
    note(`${label} ${id}: evaluation ${ex.evaluationMethod?.method} → ${spec.method}`);
    ex.evaluationMethod = ex.evaluationMethod || {};
    ex.evaluationMethod.method = spec.method;
    // Criteria are what the AI evaluator judges on — meaningless under the
    // other two methods, and required to be non-empty under 'ai'.
    ex.evaluationMethod.ai = ex.evaluationMethod.ai || {};
    ex.evaluationMethod.ai.criteria = spec.method === "ai"
      ? ["correctness", "efficiency", "edgeCases"]
      : [];
    ex.evaluationMethod.ai.testCasesCountMode = "common";
    ex.evaluationMethod.ai.testCasesCount = ex.evaluationMethod.ai.testCasesCount ?? 20;
    touched = true;
  }

  if (touched) ex.updatedBy = ACTOR;
  return touched;
}

/** The rule itself, applied to every exercise on the node. */
function pinNonGradedToManual(ex, label) {
  if (ex.isGraded !== false) return false;
  if (ex.evaluationMethod?.method === "manual") return false;
  note(`${label} ${ex.exerciseInformation.exerciseId}: non-graded — evaluation ` +
    `${ex.evaluationMethod?.method} → manual`);
  ex.evaluationMethod = ex.evaluationMethod || {};
  ex.evaluationMethod.method = "manual";
  ex.evaluationMethod.ai = ex.evaluationMethod.ai || {};
  ex.evaluationMethod.ai.criteria = [];
  ex.updatedBy = ACTOR;
  return true;
}

(async () => {
  await mongoose.connect(process.env.MONGOURI, { serverSelectionTimeoutMS: 30000 });
  console.log(`MongoDB connected${DRY ? "  (DRY RUN — nothing will be written)" : ""}\n`);

  const topic = await Topic.findById(TOPIC_ID);
  if (!topic) throw new Error(`Topic ${TOPIC_ID} not found`);
  console.log(`Topic: ${topic.title.trim()}`);

  for (const [section, sub, label] of [
    ["We_Do", WE_DO_SUB, "We Do "],
    ["You_Do", YOU_DO_SUB, "You Do"],
  ]) {
    const map = topic.pedagogy[section];
    const list = map.get(sub);
    if (!Array.isArray(list)) continue;
    console.log(`\n  ${label.trim()} ▸ ${sub}  (${list.length} rows)`);
    dedupe(list, label);
    for (const ex of list) {
      applyTarget(ex, label);
      pinNonGradedToManual(ex, label);
    }
    map.set(sub, list);
    topic.markModified(`pedagogy.${section}`);
  }

  if (!changes.length) {
    console.log("\nNothing to change — already correct.");
    await mongoose.disconnect();
    return;
  }
  if (DRY) {
    console.log(`\nDRY RUN — ${changes.length} change(s) would be applied. Nothing written.`);
    await mongoose.disconnect();
    return;
  }

  topic.updatedBy = ACTOR;
  topic.updatedAt = new Date();
  await topic.save();
  console.log(`\nSaved — ${changes.length} change(s) applied.`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
