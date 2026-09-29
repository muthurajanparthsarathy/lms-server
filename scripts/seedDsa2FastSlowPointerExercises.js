/**
 * DSA 2 ▸ "Fast & Slow Pointers, Linked List Reversals (full, partial, k-group)"
 *
 * Seeds FIVE We Do assignments and FIVE You Do assessments on that topic, each
 * written in the exact shape the trainer wizards produce (ExerciseSettings for
 * We Do, CreateAssessmentModal for You Do) so both list screens render them as
 * "Complete" and a student can start them straight away.
 *
 * The five cover the whole configuration matrix in one pass:
 *
 *   #  Type         Evaluation  Graded  Question configuration
 *   ─────────────────────────────────────────────────────────────────────────
 *   1  Programming  manual      NO      general · 5 ×  0 =  0   (non-graded)
 *   2  Programming  ai          yes     general · 5 × 10 = 50
 *   3  Programming  testcase    yes     general · 5 × 10 = 50
 *   4  Programming  testcase    yes     levelBased · 2E×7 + 2M×8 + 1H×20 = 50
 *   5  MCQ          —           yes     mcq · 5 × 10 = 50
 *
 * Non-graded lands on #1 (manual) rather than on the AI row deliberately: a
 * non-graded exercise records no score, so the wizards now hide the Evaluation
 * Method step for it entirely and pin the stored method to Manual. Putting the
 * AI example on a graded row is what keeps all three methods represented under
 * that rule — and it is also what makes the You Do set legal, since a GRADED
 * You_Do may only be Test Case or AI (see YOUDO_ALLOWED_METHODS).
 *
 * Questions come from ./data/dsa2FastSlowPointerQuestions.js — the five Java
 * problems from the Phase II assessment document, plus five MCQs authored on
 * this topic's own subject.
 *
 * Idempotent: exercises are matched by `exerciseInformation.exerciseName`, so
 * an existing one is left untouched and only missing ones are appended.
 *
 * Run:  node scripts/seedDsa2FastSlowPointerExercises.js
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const Topic = require("../models/Courses/moduleStructure/topicModal");
const {
  PROGRAMMING_QUESTIONS,
  MCQ_QUESTIONS,
} = require("./data/dsa2FastSlowPointerQuestions");

// ── Target ──────────────────────────────────────────────────────────────────
const COURSE_ID  = "6a9bbb2140c030b8579db445"; // DSA 2
const TOPIC_ID   = "6a9bbde440c030b8579e2906"; // Fast & Slow Pointers, Linked List Reversals
const WE_DO_SUB  = "assignment"; // this node's existing We Do subcategory key
const YOU_DO_SUB = "assesment";  // this node's existing You Do key (legacy spelling)

const TRAINER_ID    = new mongoose.Types.ObjectId("6a46063688dae7ba0df3b1cc");
const TRAINER_EMAIL = "batch@gmail.com";
// The topic's testConfiguration allows coreProgram: ["java"] only.
const LANGUAGE     = "java";
const MODULE_LABEL = "Core Programming";

const oid = () => new mongoose.Types.ObjectId();
const NOW = new Date();
// Open now, closes in 45 days — this is the window a student is judged against.
const START_AT = new Date(NOW.getTime() - 60 * 60 * 1000);
const END_AT = new Date(NOW.getTime() + 45 * 24 * 60 * 60 * 1000);

// ── Question builders ───────────────────────────────────────────────────────
const emptyApproval = () => ({
  status: "pending",
  currentStepOrder: null,
  decidedBy: null,
  decidedAt: null,
  rejectionMessage: "",
  editedSinceReject: false,
  queries: [],
});

const buildProgrammingQuestion = (q, idx, score, difficulty) => ({
  _id: oid(),
  questionType: "programming",
  createdBy: TRAINER_ID,
  createdByEmail: TRAINER_EMAIL,
  approval: emptyApproval(),
  source: "scratch-manual",
  bankQuestionId: null,
  sectionId: null,
  mcqQuestionDescription: "",
  isActive: true,
  hasOtherOption: false,
  hasExplanation: false,
  mcqQuestionOptions: [],
  mcqQuestionCorrectAnswers: [],
  mcqQuestionImageUrl: null,
  trueFalseAnswer: null,
  shortAnswer: "",
  essayAnswer: "",
  numericAnswer: null,
  numericTolerance: null,
  matchingPairs: [],
  orderingItems: [],
  sequence: idx,
  title: q.title,
  description: {
    text: q.description,
    imageUrl: null,
    imageAlignment: "left",
    imageSizePercent: 100,
  },
  difficulty: difficulty || q.difficulty,
  sampleInput: q.testCases[0].input,
  sampleOutput: q.testCases[0].expectedOutput,
  score,
  constraints: q.constraints.slice(),
  testCases: q.testCases.map((t) => ({ ...t, _id: oid() })),
  aiTestCasesCount: null,
  aiGeneratedTestCases: [],
  aiGeneratedTestCasesModel: "",
  aiGeneratedTestCasesAt: null,
  solutions: { _id: oid(), startedCode: q.starterCode, functionName: "main", language: LANGUAGE },
  timeLimit: 2000,
  memoryLimit: 256,
  isLinkQuestion: false,
  questionLink: "",
  starterCode: q.starterCode,
  solutionCode: q.solutionCode,
  codeSetupLanguage: LANGUAGE,
  executionType: "fullProgram",
  functionContract: { functionName: "", returnType: "integer", params: [] },
  startingExperience: "custom",
  sampleQuery: "",
  sampleResult: [],
  isDatabase: false,
  lastEditedAfterSubmissionAt: null,
  hints: [],
  createdAt: NOW,
  updatedAt: NOW,
});

const buildMcqQuestion = (q, idx, score) => {
  const options = q.options.map((o) => ({
    _id: oid(),
    text: o.text,
    isCorrect: o.isCorrect,
    imageUrl: null,
    imageAlignment: "left",
    imageSizePercent: 100,
  }));
  return {
    _id: oid(),
    questionType: "mcq",
    createdBy: TRAINER_ID,
    createdByEmail: TRAINER_EMAIL,
    approval: emptyApproval(),
    source: "scratch-manual",
    bankQuestionId: null,
    sectionId: null,
    mcqQuestionTitle: [{ id: `gen-txt-${NOW.getTime()}-${idx}`, type: "text", value: q.title }],
    mcqQuestionDescription: q.explanation,
    mcqQuestionType: "multiple_choice",
    mcqQuestionDifficulty: q.difficulty,
    mcqQuestionScore: score,
    mcqQuestionTimeLimit: 120,
    mcqQuestionRequired: true,
    hasOtherOption: false,
    hasExplanation: true,
    isActive: true,
    mcqQuestionOptionsPerRow: 1,
    mcqQuestionOptions: options,
    mcqQuestionCorrectAnswers: options.filter((o) => o.isCorrect).map((o) => o.text),
    mcqQuestionImageUrl: null,
    mcqQuestionImageAlignment: "left",
    mcqQuestionImageSizePercent: 100,
    sequence: idx,
    createdAt: NOW,
    updatedAt: NOW,
  };
};

// ── Shared exercise fragments ───────────────────────────────────────────────
const availabilityPeriod = () => ({
  startDate: START_AT,
  endDate: END_AT,
  cutOffEnabled: false,
  remindGradeByEnabled: false,
  gracePeriodAllowed: false,
  gracePeriodEnabled: false,
  extendedDays: 0,
  // No approval gate — the exercise is live for students the moment it saves.
  requiresAdminApproval: false,
  approvalScope: "settings",
});

const notificationSettings = () => ({
  notifyUsers: true,
  notifyGmail: false,
  notifyWhatsApp: false,
  gradeSheet: true,
  notifyGradersSubmissions: false,
  notifyGradersLateSubmissions: false,
  notifyStudent: true,
});

const legacyNotificationSettings = () => ({
  notifyUsers: true,
  notifyGmail: false,
  notifyWhatsApp: false,
  gradeSheet: true,
});

const evaluationMethod = (method) => ({
  method,
  ai: {
    criteria: method === "ai" ? ["correctness", "efficiency", "edgeCases"] : [],
    testCasesCountMode: "common",
    testCasesCount: 20,
  },
});

// Mirrors computeAutoGrades in exerciseAndQuestion.js: the grade equals the
// exercise's own total, and only the pass mark is author-supplied.
const gradeSettings = ({ mcqGrade, mcqPass, progGrade, progPass }) => ({
  mcqGrade: mcqGrade === undefined ? null : mcqGrade,
  mcqGradeToPass: mcqPass === undefined ? null : mcqPass,
  programmingGrade: progGrade === undefined ? null : progGrade,
  programmingGradeToPass: progPass === undefined ? null : progPass,
  combinedGrade: null,
  combinedGradeToPass: null,
  separateMarks: false,
  difficultyPassEnabled: false,
  easyPassMark: null,
  mediumPassMark: null,
  hardPassMark: null,
  overallMarkToPassEnabled: false,
  overallMarkToPass: null,
});

// You Do assessments carry a security block. Every proctoring gate is left off
// so the assessment opens without a camera / fullscreen prompt; only the
// timer's auto-submit is on.
const securitySettings = () => ({
  preventTabSwitch: false, maxTabSwitches: 7,
  preventCopyPaste: false, preventBrowserClose: false,
  screenRecordingEnabled: false, enableFaceVerification: false,
  multipleFaceDetection: false, faceWarningLimit: 3,
  faceMonitoringDetection: false, faceMonitoringWarningLimit: 3,
  autoSubmitOnTimeout: true, warnBeforeTimeout: true, warningSeconds: 30,
  preventRightClick: false, preventDevTools: false, preventPrinting: false,
  preventRefresh: false, requireFullscreen: false, preventBackNavigation: false,
  preventScreenshot: false, preventScreenRecording: false, preventUrlChange: false,
  enableIdVerification: false, enableVoiceVerification: false,
  captureIntervalSeconds: 60, blockOtherIPs: false, allowedIPs: [],
  singleDeviceOnly: false, shuffleQuestions: false, shuffleOptions: false,
  randomizeQuestionOrder: false, preventQuestionBacktrack: false,
  sessionTimeoutMinutes: 0, maxAttempts: 1, graceAttempts: 0, cooldownMinutes: 30,
});

const INSTRUCTIONS =
  "<h2>Instructions</h2><ul>" +
  "<li>Read the problem statement, input format and output format before you start coding.</li>" +
  "<li>Read the input from <b>stdin</b> in the order the description gives, and print the answer to <b>stdout</b> with no extra text.</li>" +
  "<li>Boolean answers must be printed in lowercase — <code>true</code> or <code>false</code>.</li>" +
  "<li>Run the sample test cases first, then submit — the hidden cases cover the boundary and edge conditions named in the constraints.</li>" +
  "<li>Aim for the expected time and space complexity stated with each question.</li>" +
  "</ul>";

// ── Question-configuration builders ─────────────────────────────────────────
const generalProgrammingConfig = (marksPerQuestion) => ({
  questionConfigType: "general",
  generalQuestionCount: 5,
  generalMarksPerQuestion: marksPerQuestion,
  patternTotal: 0,
  levelBasedCounts: { easy: 0, medium: 0, hard: 0 },
  selectionLevelCounts: { easy: 0, medium: 0, hard: 0 },
  scoreSettings: {
    scoreType: "evenMarks",
    evenMarks: marksPerQuestion,
    separateMarks: { general: [], levelBased: { easy: [], medium: [], hard: [] } },
    levelBasedMarks: { easy: 0, medium: 0, hard: 0 },
    levelScoringConfiguration: {
      easy: { type: "level_specific", marksPerQuestion: 0, questionCount: 0, totalMarks: 0 },
      medium: { type: "level_specific", marksPerQuestion: 0, questionCount: 0, totalMarks: 0 },
      hard: { type: "level_specific", marksPerQuestion: 0, questionCount: 0, totalMarks: 0 },
    },
    totalMarks: marksPerQuestion * 5,
  },
  attemptLimitEnabled: false,
  submissionAttempts: 1,
  questionFlow: "freeFlow",
  compilerFileMode: "multiple",
  allowCodeExecution: true,
  enableTestCases: true,
  showSampleCases: true,
});

// 2 easy × 7 + 2 medium × 8 + 1 hard × 20 = 50 — the same split the trainer
// already used for these five questions on EX614.
const LEVEL_PLAN = {
  easy: { count: 2, marks: 7 },
  medium: { count: 2, marks: 8 },
  hard: { count: 1, marks: 20 },
};

const levelBasedProgrammingConfig = () => ({
  questionConfigType: "levelBased",
  generalQuestionCount: 0,
  generalMarksPerQuestion: 0,
  patternTotal: 5,
  levelBasedCounts: {
    easy: LEVEL_PLAN.easy.count,
    medium: LEVEL_PLAN.medium.count,
    hard: LEVEL_PLAN.hard.count,
  },
  selectionLevelCounts: { easy: 0, medium: 0, hard: 0 },
  scoreSettings: {
    scoreType: "levelBasedMarks",
    evenMarks: 0,
    separateMarks: { general: [], levelBased: { easy: [], medium: [], hard: [] } },
    levelBasedMarks: {
      easy: LEVEL_PLAN.easy.marks,
      medium: LEVEL_PLAN.medium.marks,
      hard: LEVEL_PLAN.hard.marks,
    },
    // The list screen reads questionCount / totalMarks per level to decide when
    // a difficulty slot is full — both must match the questions actually added.
    levelScoringConfiguration: {
      easy: { type: "level_specific", marksPerQuestion: LEVEL_PLAN.easy.marks, questionCount: LEVEL_PLAN.easy.count, totalMarks: LEVEL_PLAN.easy.count * LEVEL_PLAN.easy.marks },
      medium: { type: "level_specific", marksPerQuestion: LEVEL_PLAN.medium.marks, questionCount: LEVEL_PLAN.medium.count, totalMarks: LEVEL_PLAN.medium.count * LEVEL_PLAN.medium.marks },
      hard: { type: "level_specific", marksPerQuestion: LEVEL_PLAN.hard.marks, questionCount: LEVEL_PLAN.hard.count, totalMarks: LEVEL_PLAN.hard.count * LEVEL_PLAN.hard.marks },
    },
    totalMarks: 50,
  },
  attemptLimitEnabled: false,
  submissionAttempts: 1,
  questionFlow: "freeFlow",
  compilerFileMode: "multiple",
  allowCodeExecution: true,
  enableTestCases: true,
  showSampleCases: true,
});

// The five document questions mapped onto the level plan, in document order.
const LEVEL_ASSIGNMENT = [
  { difficulty: "easy", score: LEVEL_PLAN.easy.marks },
  { difficulty: "easy", score: LEVEL_PLAN.easy.marks },
  { difficulty: "medium", score: LEVEL_PLAN.medium.marks },
  { difficulty: "medium", score: LEVEL_PLAN.medium.marks },
  { difficulty: "hard", score: LEVEL_PLAN.hard.marks },
];

const mcqQuestionConfig = (marksPerQuestion) => ({
  totalMcqQuestions: 5,
  marksPerQuestion,
  mcqTotalMarks: marksPerQuestion * 5,
  attemptLimitEnabled: false,
  submissionAttempts: 1,
  shuffleQuestions: false,
  scoringType: "equalDistribution",
});

// ── Exercise builder ────────────────────────────────────────────────────────
// `stepsSaved` is what the We Do list checks for "Complete"; the You Do list
// ignores it but the edit wizard reopens on the steps named here.
const WE_DO_STEPS = ["Exercise Details", "Question Configuration", "Add Questions", "Schedule", "Notifications"];
const YOU_DO_STEPS = ["Exercise Details", "Question Configuration", "Question Source", "Add Questions", "Schedule", "Security Settings", "Notifications", "Select Assessment Content"];

const buildExercise = (o) => {
  const isProgramming = o.type === "Programming";
  const graded = o.isGraded !== false;
  // A non-graded exercise legitimately carries 0 marks — both list screens skip
  // the marks check when isGraded === false.
  const marksPerQuestion = graded ? 10 : 0;

  let questionConfiguration;
  let questions;

  if (!isProgramming) {
    questionConfiguration = { mcqQuestionConfiguration: mcqQuestionConfig(marksPerQuestion) };
    questions = MCQ_QUESTIONS.map((q, i) => buildMcqQuestion(q, i, marksPerQuestion));
  } else if (o.configMode === "levelBased") {
    questionConfiguration = { programmingQuestionConfiguration: levelBasedProgrammingConfig() };
    questions = PROGRAMMING_QUESTIONS.map((q, i) =>
      buildProgrammingQuestion(q, i, LEVEL_ASSIGNMENT[i].score, LEVEL_ASSIGNMENT[i].difficulty));
  } else {
    questionConfiguration = { programmingQuestionConfiguration: generalProgrammingConfig(marksPerQuestion) };
    questions = PROGRAMMING_QUESTIONS.map((q, i) => buildProgrammingQuestion(q, i, marksPerQuestion));
  }

  const totalMarks = questions.reduce(
    (sum, q) => sum + (isProgramming ? q.score : q.mcqQuestionScore), 0);

  const steps = (o.tab === "We_Do" ? WE_DO_STEPS : YOU_DO_STEPS).slice();
  if (graded) steps.push("Grade Settings");

  // Non-graded pins Manual, matching what the wizards now do: the Evaluation
  // Method control is hidden for a non-graded exercise (nothing is scored, so
  // there is nothing to evaluate) and Manual is the value behind it. Enforced
  // here rather than trusted from the caller so this script cannot seed a row
  // the UI would immediately contradict.
  const method = graded ? o.method : "manual";

  const ex = {
    _id: oid(),
    exerciseType: o.type,
    isGraded: graded,
    stepsSaved: steps,
    configurationType: {
      mcqMode: !isProgramming,
      programmingMode: isProgramming,
      combinedMode: false,
      otherMode: false,
    },
    exerciseInformation: {
      exerciseId: o.exerciseId,
      exerciseName: o.name,
      description: o.description,
      exerciseLevel: o.level,
      exerciseType: o.type,
      testType: "mock",
      totalDuration: isProgramming ? 60 : 30,
      totalMarksMCQ: isProgramming ? 0 : totalMarks,
      totalMarksProgramming: isProgramming ? totalMarks : 0,
      totalMarks,
      selectedModule: isProgramming ? MODULE_LABEL : "",
      selectedLanguages: isProgramming ? [LANGUAGE] : [],
      isSectionBased: false,
      sectionBasedDuration: false,
    },
    questionConfiguration,
    questionSource: "scratch",
    customDistribution: null,
    customSources: [],
    customDistributionBySection: {},
    saveToBank: false,
    questionSourceMcq: null,
    customSourcesMcq: [],
    customDistributionMcq: null,
    evaluationMethod: evaluationMethod(method),
    availabilityPeriod: availabilityPeriod(),
    approvalWorkflow: null,
    notificationSettings: notificationSettings(),
    notificatonandGradeSettings: legacyNotificationSettings(),
    gradeSettings: gradeSettings(
      graded
        ? (isProgramming
          ? { progGrade: totalMarks, progPass: Math.round(totalMarks * 0.4) }
          : { mcqGrade: totalMarks, mcqPass: Math.round(totalMarks * 0.4) })
        : (isProgramming ? { progGrade: 0 } : { mcqGrade: 0 })),
    additionalOptions: { anonymousSubmissions: false, hideGraderIdentity: false },
    questionBehavior: { allQuestionsRequired: true },
    isSectionBased: false,
    sections: [],
    selectedTopics: [],
    instructions: INSTRUCTIONS,
    questions,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: TRAINER_EMAIL,
    updatedBy: TRAINER_EMAIL,
    version: 1,
  };

  if (isProgramming) {
    ex.programmingSettings = { selectedModule: MODULE_LABEL, selectedLanguages: [LANGUAGE] };
  }
  if (o.tab === "You_Do") {
    ex.securitySettings = securitySettings();
    ex.sectionConfigs = {};
  }
  return ex;
};

// ── The five-exercise matrix, built once per tab ────────────────────────────
const matrix = (tab, label, ids) => [
  buildExercise({
    tab, type: "Programming", method: "manual", isGraded: false, configMode: "general",
    exerciseId: ids[0],
    name: `${label} 01 — Manual Evaluation (Non Graded)`,
    description: "Five Java problem-solving questions from the Phase II paper. Practice only — nothing is scored, so no evaluation method applies and the trainer reviews the work manually.",
    level: "beginner",
  }),
  buildExercise({
    tab, type: "Programming", method: "ai", isGraded: true, configMode: "general",
    exerciseId: ids[1],
    name: `${label} 02 — AI Evaluation (Graded)`,
    description: "The same five questions, evaluated by AI on correctness, efficiency and edge-case handling — 10 marks each, 50 in total.",
    level: "beginner",
  }),
  buildExercise({
    tab, type: "Programming", method: "testcase", isGraded: true, configMode: "general",
    exerciseId: ids[2],
    name: `${label} 03 — Test Case Evaluation (Graded)`,
    description: "The same five questions, scored automatically against the sample and hidden test cases — 10 marks each, 50 in total.",
    level: "intermediate",
  }),
  buildExercise({
    tab, type: "Programming", method: "testcase", isGraded: true, configMode: "levelBased",
    exerciseId: ids[3],
    name: `${label} 04 — Level Based (Graded)`,
    description: "Level-based configuration: 2 easy (7 marks each), 2 medium (8 each) and 1 hard (20) — 50 in total, scored against the test cases.",
    level: "intermediate",
  }),
  buildExercise({
    tab, type: "MCQ", method: "testcase", isGraded: true,
    exerciseId: ids[4],
    name: `${label} 05 — MCQ (Graded)`,
    description: "Five multiple-choice questions on fast & slow pointers and linked-list reversal — 10 marks each, 50 in total, scored automatically.",
    level: "beginner",
  }),
];

// ── Upsert ──────────────────────────────────────────────────────────────────
const asMap = (v) => (v instanceof Map ? v : new Map(Object.entries(v || {})));

// Identity is `exerciseInformation.exerciseId` (EX201…EX205 / EX301…EX305), NOT
// the name. A trainer renaming an exercise in the wizard is routine — matching
// on the name made a rename look like a missing row and re-seeded a duplicate
// under the same EX id. The id is assigned once at create and no wizard edits
// it, so it is the only stable handle this script has.
//
// A row that already exists is left completely untouched: this script seeds,
// it does not overwrite. Correcting rows that are already out there is a
// migration's job, not a re-run's — see fixNonGradedEvaluationMethod.js.
const upsert = (map, subcategory, spec) => {
  const list = map.get(subcategory) || [];
  const info = spec.exerciseInformation;
  const existing = list.find(
    (e) => e && e.exerciseInformation && e.exerciseInformation.exerciseId === info.exerciseId);
  if (existing) {
    console.log(`    ·  ${info.exerciseId}  ${existing.exerciseInformation.exerciseName}   (already present — untouched)`);
    return false;
  }
  list.push(spec);
  map.set(subcategory, list);
  console.log(`    +  ${info.exerciseId}  ${info.exerciseName}`);
  return true;
};

(async () => {
  await mongoose.connect(process.env.MONGOURI, { serverSelectionTimeoutMS: 30000 });
  console.log("MongoDB connected\n");

  const topic = await Topic.findById(TOPIC_ID);
  if (!topic) throw new Error(`Topic ${TOPIC_ID} not found`);
  if (String(topic.courses) !== COURSE_ID) {
    throw new Error(`Topic ${TOPIC_ID} belongs to course ${topic.courses}, expected ${COURSE_ID}`);
  }
  console.log(`Topic: ${topic.title.trim()}`);

  topic.pedagogy = topic.pedagogy || {};
  const weDo = asMap(topic.pedagogy.We_Do);
  const youDo = asMap(topic.pedagogy.You_Do);

  // Exercise ids follow the wizards' own `EX` + three digits, kept clear of the
  // ones already on this node (084 / 614 / 762 / 403 / 032 / 918).
  console.log(`\n  We Do ▸ ${WE_DO_SUB}`);
  let added = 0;
  matrix("We_Do", "Technical Assignment", ["EX201", "EX202", "EX203", "EX204", "EX205"])
    .forEach((s) => { if (upsert(weDo, WE_DO_SUB, s)) added++; });

  console.log(`\n  You Do ▸ ${YOU_DO_SUB}`);
  matrix("You_Do", "Technical Assessment", ["EX301", "EX302", "EX303", "EX304", "EX305"])
    .forEach((s) => { if (upsert(youDo, YOU_DO_SUB, s)) added++; });

  topic.pedagogy.We_Do = weDo;
  topic.pedagogy.You_Do = youDo;
  topic.markModified("pedagogy.We_Do");
  topic.markModified("pedagogy.You_Do");
  topic.updatedBy = TRAINER_EMAIL;
  topic.updatedAt = new Date();
  await topic.save();

  console.log(`\nSaved — ${added} exercise(s) added.`);
  console.log(`  We Do  ▸ ${WE_DO_SUB}:  ${weDo.get(WE_DO_SUB).length} total`);
  console.log(`  You Do ▸ ${YOU_DO_SUB}: ${youDo.get(YOU_DO_SUB).length} total`);

  await mongoose.disconnect();
})().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
