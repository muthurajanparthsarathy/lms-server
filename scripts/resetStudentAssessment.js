// Reset a single student's assessment attempt so they can attend it again.
//
// Clears the stored progress entry (answers + status + the proctoring lock)
// for ONE student / ONE exercise inside user.courses[].answers.<category>.
// After this runs, GET /exercise/status returns { isLocked:false, status:'new' }
// and the "Access Terminated" screen no longer appears — the student starts
// fresh with no saved answers.
//
// Safe by default: DRY-RUN unless you pass --commit. Dry-run prints exactly
// what it would remove and touches nothing. It only ever removes the entry
// whose exerciseId matches; every other exercise/answer is left untouched.
//
// Run from the Server folder:
//   node scripts/resetStudentAssessment.js                      # dry-run, URL defaults
//   node scripts/resetStudentAssessment.js --commit             # actually reset
//   node scripts/resetStudentAssessment.js --email=a@b.in --course=<id> --exercise=<id> --commit
//
// Uses MONGOURI from Server/.env like the other scripts.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const User = require("../models/UserModel");

// ── Defaults taken from the assessment URL that was locked ────────────────────
const DEFAULTS = {
  email: "aplsk.student02@lmsdemo.in",
  courseId: "6a9bbb2140c030b8579db445",
  exerciseId: "6a9e84fe78ebfcc96b669969",
};

// Tiny CLI parser: supports --key=value flags and a bare --commit switch.
function parseArgs(argv) {
  const out = { commit: false };
  for (const a of argv) {
    if (a === "--commit") out.commit = true;
    else if (a.startsWith("--email=")) out.email = a.slice("--email=".length).trim();
    else if (a.startsWith("--course=")) out.courseId = a.slice("--course=".length).trim();
    else if (a.startsWith("--exercise=")) out.exerciseId = a.slice("--exercise=".length).trim();
  }
  return out;
}

const CATEGORIES = ["You_Do", "We_Do", "I_Do"];

function summarizeEntry(entry) {
  return {
    status: entry.status,
    isLocked: entry.isLocked,
    submitType: entry.submitType,
    autoSubmitReason: entry.autoSubmitReason,
    answersStored: Array.isArray(entry.questions) ? entry.questions.length : 0,
    screenRecording: entry.screenRecording ? "yes" : "no",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email || DEFAULTS.email;
  const courseId = args.courseId || DEFAULTS.courseId;
  const exerciseId = args.exerciseId || DEFAULTS.exerciseId;

  console.log("── Reset Student Assessment ──────────────────────────────────");
  console.log(`Mode      : ${args.commit ? "COMMIT (will write)" : "DRY-RUN (no changes)"}`);
  console.log(`Email     : ${email}`);
  console.log(`Course    : ${courseId}`);
  console.log(`Exercise  : ${exerciseId}`);
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

  const courseIndex = user.courses.findIndex(
    (c) => c.courseId && c.courseId.toString() === courseId
  );
  if (courseIndex === -1) {
    console.error(`User is not enrolled in course ${courseId}. Nothing to reset.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const userCourse = user.courses[courseIndex];
  if (!userCourse.answers) {
    console.log("No answers stored for this course — already clean. Nothing to reset.");
    await mongoose.disconnect();
    return;
  }

  // Scan every category/subcategory for entries matching the exerciseId.
  const matches = []; // { category, subcategory, index, entry }
  for (const category of CATEGORIES) {
    const categoryMap = userCourse.answers[category];
    if (!categoryMap || typeof categoryMap.forEach !== "function") continue;

    categoryMap.forEach((arrRaw, subcategory) => {
      let arr = arrRaw;
      if (arr && arr.toObject) arr = arr.toObject();
      if (!Array.isArray(arr)) return;
      arr.forEach((entry, index) => {
        if (entry && entry.exerciseId && entry.exerciseId.toString() === exerciseId) {
          matches.push({ category, subcategory, index, entry });
        }
      });
    });
  }

  if (matches.length === 0) {
    console.log("\nNo stored attempt found for this exercise — the student is already");
    console.log("in a fresh state for it (GET /exercise/status would return 'new').");
    console.log("\nNote: if the live site still shows 'Access Terminated', the deployed");
    console.log("server may point at a DIFFERENT database than this Server/.env MONGOURI.");
    await mongoose.disconnect();
    return;
  }

  console.log(`\nFound ${matches.length} stored entr${matches.length === 1 ? "y" : "ies"} for this exercise:`);
  for (const m of matches) {
    console.log(`  • answers.${m.category}["${m.subcategory}"][${m.index}] →`, summarizeEntry(m.entry));
  }

  if (!args.commit) {
    console.log("\nDRY-RUN: nothing was changed. Re-run with --commit to remove the above");
    console.log("entr" + (matches.length === 1 ? "y" : "ies") + " and give the student a fresh attempt.");
    await mongoose.disconnect();
    return;
  }

  // COMMIT: remove the matching entries. Rebuild each affected subcategory array
  // without the matched exercise, then mark the exact path modified so Mongoose
  // persists the Map change (same pattern the lock/unlock controllers use).
  const touchedPaths = new Set();
  for (const category of CATEGORIES) {
    const categoryMap = userCourse.answers[category];
    if (!categoryMap || typeof categoryMap.forEach !== "function") continue;

    const subKeys = [];
    categoryMap.forEach((_v, subcategory) => subKeys.push(subcategory));

    for (const subcategory of subKeys) {
      let arr = categoryMap.get(subcategory);
      if (arr && arr.toObject) arr = arr.toObject();
      if (!Array.isArray(arr)) continue;

      const filtered = arr.filter(
        (entry) => !(entry && entry.exerciseId && entry.exerciseId.toString() === exerciseId)
      );
      if (filtered.length !== arr.length) {
        categoryMap.set(subcategory, filtered);
        touchedPaths.add(`courses.${courseIndex}.answers.${category}`);
      }
    }
  }

  touchedPaths.forEach((p) => user.markModified(p));
  await user.save();

  console.log(`\n✅ Removed ${matches.length} entr${matches.length === 1 ? "y" : "ies"}.`);
  console.log("   The student can now attend the assessment again from scratch");
  console.log("   (no saved answers, no lock).");

  await mongoose.disconnect();
  console.log("MongoDB disconnected.");
}

main().catch(async (err) => {
  console.error("resetStudentAssessment error:", err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
