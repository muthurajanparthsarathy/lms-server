// Wipe ALL of one student's stored answer data so every assignment (We_Do) and
// assessment (You_Do) shows a fresh "Start" button instead of "Continue".
//
// What it clears (for the target student only):
//   1. user.courses[*].answers.We_Do  — all assignment answers/progress/locks
//   2. user.courses[*].answers.You_Do — all assessment answers/progress/locks
//   3. ExamSession documents (studentId = user._id) — so MCQ/section assessments
//      start a brand-new attempt (no resume, no leftover timer).
//
//   I_Do (lecture/demo) answers are LEFT ALONE by default — pass --includeIDo to
//   clear those too. ExamSession deletion can be skipped with --keepSessions.
//
// Because the "Start vs Continue" label is derived purely from these answer
// entries (see Client assignmentState.ts → getAttemptInfo/attemptExists),
// removing them flips every row back to "Start".
//
// Safe by default: DRY-RUN unless you pass --commit. Dry-run prints a full
// per-course / per-category breakdown and changes nothing. Only the target
// student is ever touched.
//
// Run from the Server folder:
//   node scripts/resetStudentAllProgress.js                          # dry-run, default email
//   node scripts/resetStudentAllProgress.js --commit                 # wipe We_Do + You_Do + sessions
//   node scripts/resetStudentAllProgress.js --email=a@b.in --commit
//   node scripts/resetStudentAllProgress.js --course=<id> --commit   # limit to one course
//   node scripts/resetStudentAllProgress.js --includeIDo --commit    # also clear I_Do
//   node scripts/resetStudentAllProgress.js --keepSessions --commit  # don't delete ExamSessions
//
// Uses MONGOURI from Server/.env like the other scripts.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const User = require("../models/UserModel");
const ExamSession = require("../models/Courses/moduleStructure/ExamSessionModel");

const DEFAULT_EMAIL = "aplsk.student02@lmsdemo.in";

function parseArgs(argv) {
  const out = { commit: false, includeIDo: false, keepSessions: false };
  for (const a of argv) {
    if (a === "--commit") out.commit = true;
    else if (a === "--includeIDo") out.includeIDo = true;
    else if (a === "--keepSessions") out.keepSessions = true;
    else if (a.startsWith("--email=")) out.email = a.slice("--email=".length).trim();
    else if (a.startsWith("--course=")) out.courseId = a.slice("--course=".length).trim();
  }
  return out;
}

// Count exercises in a Mongoose Map (subcategory -> array of entries).
function countCategory(categoryMap) {
  let subcats = 0;
  let exercises = 0;
  const perSub = [];
  if (categoryMap && typeof categoryMap.forEach === "function") {
    categoryMap.forEach((arrRaw, subcategory) => {
      let arr = arrRaw;
      if (arr && arr.toObject) arr = arr.toObject();
      const n = Array.isArray(arr) ? arr.length : 0;
      if (n > 0) {
        subcats += 1;
        exercises += n;
        perSub.push(`${subcategory}: ${n}`);
      }
    });
  }
  return { subcats, exercises, perSub };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email || DEFAULT_EMAIL;

  const categoriesToClear = args.includeIDo
    ? ["We_Do", "You_Do", "I_Do"]
    : ["We_Do", "You_Do"];

  console.log("── Reset Student ALL Progress ────────────────────────────────");
  console.log(`Mode        : ${args.commit ? "COMMIT (will write)" : "DRY-RUN (no changes)"}`);
  console.log(`Email       : ${email}`);
  console.log(`Courses     : ${args.courseId ? args.courseId : "ALL enrolled"}`);
  console.log(`Clearing    : ${categoriesToClear.join(", ")}`);
  console.log(`ExamSessions: ${args.keepSessions ? "kept" : "deleted"}`);
  console.log("──────────────────────────────────────────────────────────────");

  if (!process.env.MONGOURI) {
    console.error("MONGOURI not set in Server/.env — cannot connect.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGOURI);
  console.log("MongoDB connected.\n");

  const user = await User.findOne({ email: new RegExp(`^${email}$`, "i") });
  if (!user) {
    console.error(`No user found with email ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Found user: ${user.firstName || ""} ${user.lastName || ""} (${user._id})`);

  const courses = Array.isArray(user.courses) ? user.courses : [];
  const targetCourses = args.courseId
    ? courses.filter((c) => c.courseId && c.courseId.toString() === args.courseId)
    : courses;

  if (targetCourses.length === 0) {
    console.log("\nNo matching enrolled course(s) for this student. Nothing to clear.");
  }

  // ── Report + (optionally) clear answer maps, course by course ──────────────
  let totalCleared = 0;
  const touchedPaths = new Set();

  console.log("\nStored answer data:");
  for (const userCourse of targetCourses) {
    const courseIndex = courses.indexOf(userCourse);
    const cid = userCourse.courseId ? userCourse.courseId.toString() : "(no id)";
    console.log(`\n  Course ${cid}:`);

    if (!userCourse.answers) {
      console.log("    (no answers stored)");
      continue;
    }

    for (const category of ["I_Do", "We_Do", "You_Do"]) {
      const categoryMap = userCourse.answers[category];
      const { subcats, exercises, perSub } = countCategory(categoryMap);
      const willClear = categoriesToClear.includes(category);
      const tag = willClear ? "→ will clear" : "→ kept";
      console.log(
        `    ${category.padEnd(6)}: ${exercises} exercise(s) in ${subcats} subcategor${subcats === 1 ? "y" : "ies"} ${exercises > 0 ? tag : ""}` +
        (perSub.length ? `  [${perSub.join(", ")}]` : "")
      );

      if (willClear && exercises > 0) {
        totalCleared += exercises;
        if (args.commit && categoryMap && typeof categoryMap.clear === "function") {
          categoryMap.clear();
          touchedPaths.add(`courses.${courseIndex}.answers.${category}`);
        }
      }
    }
  }

  // ── ExamSession attempt records ────────────────────────────────────────────
  const studentIdStr = String(user._id);
  const sessionCount = await ExamSession.countDocuments({ studentId: studentIdStr });
  console.log(`\nExamSession attempt records for this student: ${sessionCount}` +
    (args.keepSessions ? " (kept)" : " (will delete)"));

  // ── Commit ─────────────────────────────────────────────────────────────────
  if (!args.commit) {
    console.log("\nDRY-RUN: nothing was changed.");
    console.log(`Would clear ${totalCleared} exercise entr${totalCleared === 1 ? "y" : "ies"}` +
      (args.keepSessions ? "" : ` and delete ${sessionCount} ExamSession record(s)`) + ".");
    console.log("Re-run with --commit to apply.");
    await mongoose.disconnect();
    return;
  }

  if (touchedPaths.size > 0) {
    touchedPaths.forEach((p) => user.markModified(p));
    await user.save();
  }
  console.log(`\n✅ Cleared ${totalCleared} exercise entr${totalCleared === 1 ? "y" : "ies"} from ${categoriesToClear.join(" + ")}.`);

  if (!args.keepSessions && sessionCount > 0) {
    const del = await ExamSession.deleteMany({ studentId: studentIdStr });
    console.log(`✅ Deleted ${del.deletedCount} ExamSession record(s).`);
  }

  console.log("\nEvery assignment and assessment for this student now shows \"Start\" (fresh attempt).");
  await mongoose.disconnect();
  console.log("MongoDB disconnected.");
}

main().catch(async (err) => {
  console.error("resetStudentAllProgress error:", err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
