const mongoose = require('mongoose');
const Module1 = mongoose.model('Module1');
const SubModule1 = mongoose.model('SubModule1');
const Topic1 = mongoose.model('Topic1');
const SubTopic1 = mongoose.model('SubTopic1');
const User = require("../../../models/UserModel");
const CourseStructure = require("../../../models/Courses/courseStructureModal");

const path = require('path');
const fs = require('fs');


const cloudinary = require('cloudinary').v2;
const stream = require('stream');
const { createClient } = require("@supabase/supabase-js");
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;

const supabase = createClient(supabaseUrl, supabaseKey);
// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});





const modelMap = {
  modules: { model: Module1, path: "modules" },
  submodules: { model: SubModule1, path: "submodules" },
  topics: { model: Topic1, path: "topics" },
  subtopics: { model: SubTopic1, path: "subtopics" },
};








// Get a single exercise by ID - Return FULL exercise data
exports.getExerciseById = async (req, res) => {
  try {
    const { exerciseId } = req.params;
    const {
      type,       // Optional: entity type (modules, submodules, topics, subtopics)
      id,         // Optional: entity ID
    } = req.query;

    console.log(`🔍 Fetching COMPLETE exercise by ID: ${exerciseId}`);

    if (!exerciseId) {
      return res.status(400).json({
        message: [{ key: "error", value: "Exercise ID is required" }]
      });
    }

    let foundExercise = null;
    let foundEntity = null;
    let foundLocation = null;

    // If type and id are provided, search in specific entity
    if (type && id && modelMap[type]) {
      const { model } = modelMap[type];
      const entity = await model.findById(id);

      if (entity && entity.pedagogy) {
        // Search through all pedagogy sections
        ['I_Do', 'We_Do', 'You_Do'].forEach(section => {
          if (entity.pedagogy[section]) {
            const sectionData = entity.pedagogy[section];

            // Handle Map and object formats
            let subcategories = [];
            if (sectionData instanceof Map) {
              subcategories = Array.from(sectionData.entries());
            } else if (typeof sectionData === 'object') {
              subcategories = Object.entries(sectionData);
            }

            subcategories.forEach(([subcategory, exercises]) => {
              if (!exercises) return;

              let exercisesArray = [];
              if (Array.isArray(exercises)) {
                exercisesArray = exercises;
              } else if (exercises._id) {
                exercisesArray = [exercises];
              }

              const exercise = exercisesArray.find(ex =>
                ex._id && ex._id.toString() === exerciseId
              );

              if (exercise) {
                // Return the FULL exercise object as-is
                foundExercise = exercise;

                // Convert Mongoose document to plain object if needed
                if (foundExercise.toObject) {
                  foundExercise = foundExercise.toObject();
                }

                foundEntity = {
                  type: type,
                  id: entity._id,
                  title: entity.title || entity.name,
                  description: entity.description || ''
                };
                foundLocation = {
                  section,
                  subcategory,
                  path: `${type}/${entity.title || entity.name}/${section}/${subcategory}`
                };
              }
            });
          }
        });
      }
    }
    // Otherwise, search across all entities
    else {
      console.log(`🔍 Searching across all entities for exercise: ${exerciseId}`);

      // Define models to search
      const modelsToSearch = [
        { name: 'modules', model: Module1, type: 'module' },
        { name: 'submodules', model: SubModule1, type: 'submodule' },
        { name: 'topics', model: Topic1, type: 'topic' },
        { name: 'subtopics', model: SubTopic1, type: 'subtopic' }
      ];

      for (const { model, type } of modelsToSearch) {
        try {
          // Search all entities with pedagogy
          const entities = await model.find({
            'pedagogy': { $exists: true, $ne: null }
          }).lean();

          for (const entity of entities) {
            if (entity.pedagogy) {
              // Search through all sections
              ['I_Do', 'We_Do', 'You_Do'].forEach(section => {
                if (entity.pedagogy[section]) {
                  const sectionData = entity.pedagogy[section];

                  let subcategories = [];
                  if (sectionData instanceof Map) {
                    subcategories = Array.from(sectionData.entries());
                  } else if (typeof sectionData === 'object') {
                    subcategories = Object.entries(sectionData);
                  }

                  subcategories.forEach(([subcategory, exercises]) => {
                    if (!exercises) return;

                    let exercisesArray = [];
                    if (Array.isArray(exercises)) {
                      exercisesArray = exercises;
                    } else if (exercises._id) {
                      exercisesArray = [exercises];
                    }

                    const exercise = exercisesArray.find(ex =>
                      ex._id && ex._id.toString() === exerciseId
                    );

                    if (exercise) {
                      // Return the FULL exercise object as-is
                      foundExercise = exercise;

                      // Convert Mongoose document to plain object if needed
                      if (foundExercise.toObject) {
                        foundExercise = foundExercise.toObject();
                      }

                      foundEntity = {
                        type: type,
                        id: entity._id,
                        title: entity.title || entity.name,
                        description: entity.description || ''
                      };
                      foundLocation = {
                        section,
                        subcategory,
                        path: `${type}/${entity.title || entity.name}/${section}/${subcategory}`
                      };
                    }
                  });
                }
              });
            }
            if (foundExercise) break;
          }
          if (foundExercise) break;
        } catch (err) {
          console.log(`Error searching in ${type}:`, err.message);
        }
      }
    }

    if (!foundExercise) {
      return res.status(404).json({
        message: [{ key: "error", value: `Exercise with ID ${exerciseId} not found` }]
      });
    }

    // Return the COMPLETE exercise object as it exists in database
    // This includes ALL fields: questions, options, correctAnswer, etc.
    const completeExerciseData = {
      ...foundExercise,  // Spread ALL properties from the found exercise

      // Add location info as additional metadata
      entity: foundEntity,
      location: foundLocation
    };

    // Remove any Mongoose-specific properties if they exist
    if (completeExerciseData.__v !== undefined) {
      delete completeExerciseData.__v;
    }

    return res.status(200).json({
      message: [{ key: "success", value: "Complete exercise data retrieved successfully" }],
      data: {
        exercise: completeExerciseData,  // Complete exercise with ALL data
        metadata: {
          exerciseId: exerciseId,
          found: true,
          entityType: foundEntity?.type,
          section: foundLocation?.section,
          subcategory: foundLocation?.subcategory,
          location: foundLocation?.path,
          totalQuestions: completeExerciseData.questions?.length || 0,
          exerciseType: completeExerciseData.exerciseType,
          exerciseName: completeExerciseData.exerciseInformation?.exerciseName || 'Unnamed Exercise'
        }
      }
    });

  } catch (err) {
    console.error("❌ Get exercise by ID error:", err);
    res.status(500).json({
      message: [{ key: "error", value: `Internal server error: ${err.message}` }]
    });
  }
};




// =============================================================================
// SHARED HELPERS (put at the top of the controller file, outside any export)
// =============================================================================

/**
 * Auto-compute the "grade" (maximum score) fields that the UI shows as readonly.
 * The user only enters GradeToPass; Grades are derived from totalMarks values.
 */
// FIXED
const computeAutoGrades = (exerciseType, exerciseInfo, gradeSettingsRaw) => {
  const result = {};

  if (exerciseType === 'MCQ' || exerciseType === 'Combined') {
    result.mcqGrade = exerciseInfo.totalMarksMCQ || exerciseInfo.totalMarks || 0;
    result.mcqGradeToPass = (gradeSettingsRaw.mcqGradeToPass !== undefined &&
      gradeSettingsRaw.mcqGradeToPass !== null)
      ? Number(gradeSettingsRaw.mcqGradeToPass)
      : null;
  }

  if (exerciseType === 'Programming' || exerciseType === 'Other' || exerciseType === 'Combined') {
    result.programmingGrade = exerciseInfo.totalMarksProgramming || exerciseInfo.totalMarks || 0;
    result.programmingGradeToPass = (gradeSettingsRaw.programmingGradeToPass !== undefined &&
      gradeSettingsRaw.programmingGradeToPass !== null)
      ? Number(gradeSettingsRaw.programmingGradeToPass)
      : null;
  }

  if (exerciseType === 'Combined') {
    result.combinedGrade = (exerciseInfo.totalMarksMCQ || 0) +
      (exerciseInfo.totalMarksProgramming || 0);
    result.combinedGradeToPass = (gradeSettingsRaw.combinedGradeToPass !== undefined &&
      gradeSettingsRaw.combinedGradeToPass !== null)
      ? Number(gradeSettingsRaw.combinedGradeToPass)
      : null;
  }

  result.separateMarks = gradeSettingsRaw.separateMarks ?? false;

  // Difficulty-based pass marks
  result.difficultyPassEnabled = gradeSettingsRaw.difficultyPassEnabled ?? false;
  result.easyPassMark = (gradeSettingsRaw.easyPassMark !== undefined && gradeSettingsRaw.easyPassMark !== null)
    ? Number(gradeSettingsRaw.easyPassMark)
    : null;
  result.mediumPassMark = (gradeSettingsRaw.mediumPassMark !== undefined && gradeSettingsRaw.mediumPassMark !== null)
    ? Number(gradeSettingsRaw.mediumPassMark)
    : null;
  result.hardPassMark = (gradeSettingsRaw.hardPassMark !== undefined && gradeSettingsRaw.hardPassMark !== null)
    ? Number(gradeSettingsRaw.hardPassMark)
    : null;

  // Overall mark to pass (optional)
  result.overallMarkToPassEnabled = gradeSettingsRaw.overallMarkToPassEnabled ?? false;
  result.overallMarkToPass = (gradeSettingsRaw.overallMarkToPass !== undefined && gradeSettingsRaw.overallMarkToPass !== null)
    ? Number(gradeSettingsRaw.overallMarkToPass)
    : null;

  return result;
};
/**
 * Build a clean availabilityPeriod object from the raw frontend payload.
 * endDate = submission deadline (stored when provided).
 * cutOffDate = optional late boundary (stored only when cutOffEnabled).
 */
const buildAvailabilityPeriod = (avail) => {
  const safeD = (v) => {
    if (!v || v === 'null' || v === 'undefined') return undefined;
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  };

  const ap = {};
  if (safeD(avail.startDate)) ap.startDate = safeD(avail.startDate);
  if (safeD(avail.endDate)) ap.endDate = safeD(avail.endDate);   // submission deadline

  ap.cutOffEnabled = !!avail.cutOffEnabled;
  if (ap.cutOffEnabled && safeD(avail.cutOffDate)) ap.cutOffDate = safeD(avail.cutOffDate);

  ap.remindGradeByEnabled = !!avail.remindGradeByEnabled;
  if (ap.remindGradeByEnabled && safeD(avail.remindGradeBy))
    ap.remindGradeBy = safeD(avail.remindGradeBy);

  ap.gracePeriodAllowed = !!(avail.gracePeriodAllowed || avail.gracePeriodEnabled);
  ap.gracePeriodEnabled = ap.gracePeriodAllowed;
  if (ap.gracePeriodAllowed && safeD(avail.gracePeriodDate))
    ap.gracePeriodDate = safeD(avail.gracePeriodDate);

  ap.extendedDays = avail.extendedDays ?? 0;
  return ap;
};

// =============================================================================
// addExercise — FULL UPDATED VERSION
// =============================================================================
exports.addExercise = async (req, res) => {
  try {
    const { type, id } = req.params;
    const {
      tabType,
      subcategory,
      exerciseType,
      programmingSettings,
      exerciseInformation,
      availabilityPeriod,
      questionConfiguration,
      questionBehavior,       // allQuestionsRequired flag
      notificationSettings,   // from frontend buildFullPayload
      gradeSettings,          // NEW — from frontend buildFullPayload
      additionalOptions,      // NEW — from frontend buildFullPayload
      isGraded,               // Graded / Non-Graded toggle
      stepsSaved,             // Array of step titles explicitly saved by user
    } = req.body;

    // ── Validate entity type ───────────────────────────────────────────────
    if (!modelMap[type]) {
      return res.status(400).json({
        message: [{ key: 'error', value: `Invalid entity type: ${type}. Valid types: modules, submodules, topics, subtopics` }]
      });
    }

    if (!subcategory) {
      return res.status(400).json({
        message: [{ key: 'error', value: "Subcategory is required." }]
      });
    }

    // ── Helper: parse JSON strings if needed ──────────────────────────────
    const parseIfNeeded = (data) => {
      if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return data; }
      }
      return data;
    };

    // ── Transform description fields ──────────────────────────────────────
    const transformQuestionDescription = (question) => {
      if (!question) return question;
      if (question.description && typeof question.description === 'string') {
        question.description = { text: question.description, imageUrl: null, imageAlignment: 'left', imageSizePercent: 100 };
      }
      return question;
    };

    const transformExerciseInfo = (info) => {
      if (!info) return info;
      const t = { ...info };
      if (t.description && typeof t.description === 'object') {
        t.description = t.description.text || '';
      }
      return t;
    };

    // ── Parse all incoming data ────────────────────────────────────────────
    let exerciseTypeParsed = parseIfNeeded(exerciseType);
    let exerciseInfo = parseIfNeeded(exerciseInformation);
    let progSettings = programmingSettings ? parseIfNeeded(programmingSettings) : null;
    let availPeriod = availabilityPeriod ? parseIfNeeded(availabilityPeriod) : {};
    let quesConfig = questionConfiguration ? parseIfNeeded(questionConfiguration) : {};
    let notifSettings = notificationSettings ? parseIfNeeded(notificationSettings) : {};
    let gradeSettingsRaw = gradeSettings ? parseIfNeeded(gradeSettings) : {};
    let additOptions = additionalOptions ? parseIfNeeded(additionalOptions) : {};

    exerciseInfo = transformExerciseInfo(exerciseInfo);

    if (quesConfig.questions) {
      if (Array.isArray(quesConfig.questions)) {
        quesConfig.questions = quesConfig.questions.map(q => transformQuestionDescription(q));
      } else {
        quesConfig.questions = transformQuestionDescription(quesConfig.questions);
      }
    }

    // ── Basic validation ──────────────────────────────────────────────────
    if (!exerciseInfo || !exerciseInfo.exerciseName) {
      return res.status(400).json({
        message: [{ key: 'error', value: 'Exercise information with exerciseName is required' }]
      });
    }

    if (!exerciseTypeParsed) {
      return res.status(400).json({
        message: [{ key: 'error', value: 'Exercise type is required (MCQ, Programming, or Combined)' }]
      });
    }

    // ── Find entity ───────────────────────────────────────────────────────
    const { model } = modelMap[type];
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: 'error', value: `${type} with ID ${id} not found` }]
      });
    }

    if (!entity.pedagogy) {
      entity.pedagogy = { I_Do: new Map(), We_Do: new Map(), You_Do: new Map() };
    }
    if (!entity.pedagogy[tabType]) {
      entity.pedagogy[tabType] = new Map();
    }

    let exercises = entity.pedagogy[tabType].has(subcategory)
      ? entity.pedagogy[tabType].get(subcategory)
      : [];

    // ── Generate exercise ID ───────────────────────────────────────────────
    const generateExerciseId = () =>
      `EX${(exercises.length + 1).toString().padStart(3, '0')}`;

    const exerciseId = exerciseInfo.exerciseId || generateExerciseId();

    // ── Configuration type flags ──────────────────────────────────────────
    const configTypeSettings = {
      mcqMode: exerciseTypeParsed === 'MCQ' || exerciseTypeParsed === 'Combined',
      programmingMode: exerciseTypeParsed === 'Programming' || exerciseTypeParsed === 'Combined',
      combinedMode: exerciseTypeParsed === 'Combined',
      otherMode: exerciseTypeParsed === 'Other',
    };

    // ── Build MCQ / Programming question configurations ───────────────────
    let mcqQuestionConfig = null;
    let programmingQuestionConfig = null;
    let othersQuestionConfig = null;
    let mcqTotalMarks = 0;
    let progTotalMarks = 0;

    // ── MCQ config builder ─────────────────────────────────────────────────
    const buildMCQConfig = (mcqCfg) => {
      const scoreType = mcqCfg.scoreSettings?.scoreType || 'equalDistribution';
      let marksPerQuestion = 0;
      let total = 0;
      if (scoreType === 'equalDistribution') {
        marksPerQuestion = mcqCfg.scoreSettings?.equalDistribution || 0;
        total = (mcqCfg.generalQuestionCount || 0) * marksPerQuestion;
      } else {
        total = mcqCfg.scoreSettings?.totalMarks || 0;
      }
      return {
        cfg: {
          totalMcqQuestions: mcqCfg.generalQuestionCount || 0,
          marksPerQuestion,
          mcqTotalMarks: total,
          attemptLimitEnabled: mcqCfg.attemptLimitEnabled || false,
          submissionAttempts: mcqCfg.submissionAttempts || 1,
          shuffleQuestions: true,
          scoringType: scoreType,
        },
        total,
      };
    };

    // ── Programming config builder ─────────────────────────────────────────
    const buildProgConfig = (progCfg) => {
      const qConfigType = progCfg.questionConfigType || 'general';
      let backendType;
      switch (qConfigType) {
        case 'levelBased': backendType = 'levelBased'; break;
        case 'selectionLevel': backendType = 'selectionLevel'; break;
        default: backendType = qConfigType;
      }

      let total = 0;
      if (qConfigType === 'general' && progCfg.scoreSettings?.scoreType === 'equalDistribution') {
        total = (progCfg.generalQuestionCount || 0) * (progCfg.scoreSettings.equalDistribution || 0);
      } else if (qConfigType === 'levelBased' || qConfigType === 'selectionLevel') {
        const counts = qConfigType === 'selectionLevel' ? progCfg.selectionLevelCounts : progCfg.levelBasedCounts;
        const levelScoring = progCfg.scoreSettings?.levelScoringConfiguration;
        if (levelScoring) {
          ['easy', 'medium', 'hard'].forEach(l => {
            const c = counts?.[l] || 0;
            if (!c) return;
            const s = levelScoring[l];
            if (!s) return;
            if (s.type === 'level_specific' && s.marksPerQuestion) total += c * s.marksPerQuestion;
            else if (s.type === 'question_specific' && s.totalMarks) total += s.totalMarks;
          });
        }
      }

      // Determine backend score type
      let backendScoreType;
      if (qConfigType === 'levelBased' || qConfigType === 'selectionLevel') {
        backendScoreType = 'levelBasedMarks';
      } else {
        switch (progCfg.scoreSettings?.scoreType) {
          case 'equalDistribution': backendScoreType = 'evenMarks'; break;
          case 'questionSpecific': backendScoreType = 'separateMarks'; break;
          case 'levelSpecific': backendScoreType = 'levelBasedMarks'; break;
          default: backendScoreType = progCfg.scoreSettings?.scoreType || 'evenMarks';
        }
      }

      const levelScoringConfig = progCfg.scoreSettings?.levelScoringConfiguration;
      let levelBasedMarks = progCfg.scoreSettings?.levelBasedMarks || { easy: 0, medium: 0, hard: 0 };

      // Populate levelBasedMarks from levelScoringConfiguration when applicable
      if (levelScoringConfig && (qConfigType === 'levelBased' || qConfigType === 'selectionLevel')) {
        const counts = qConfigType === 'selectionLevel' ? progCfg.selectionLevelCounts : progCfg.levelBasedCounts;
        ['easy', 'medium', 'hard'].forEach(l => {
          const c = counts?.[l] || 0;
          if (!c) return;
          const s = levelScoringConfig[l];
          if (s?.type === 'level_specific' && s.marksPerQuestion) {
            levelBasedMarks[l] = s.marksPerQuestion;
            if (!levelScoringConfig[l].questionCount) levelScoringConfig[l].questionCount = c;
          } else if (s?.type === 'question_specific' && s.totalMarks) {
            if (!levelScoringConfig[l].questionCount) levelScoringConfig[l].questionCount = c;
          }
        });
      }

      const cfg = {
        questionConfigType: backendType || 'general',
        attemptLimitEnabled: progCfg.attemptLimitEnabled || false,
        submissionAttempts: progCfg.submissionAttempts || 1,
        questionFlow: progCfg.questionFlow || 'freeFlow',
        compilerFileMode: progCfg.compilerFileMode || 'single',
        allowCodeExecution: true,
        enableTestCases: true,
        showSampleCases: true,
        scoreSettings: {
          scoreType: backendScoreType,
          evenMarks: progCfg.scoreSettings?.scoreType === 'equalDistribution' ? (progCfg.scoreSettings.equalDistribution || 0) : 0,
          separateMarks: progCfg.scoreSettings?.questionSpecific || { general: [], levelBased: { easy: [], medium: [], hard: [] } },
          levelBasedMarks,
          levelScoringConfiguration: levelScoringConfig,
          totalMarks: total,
        },
      };

      if (qConfigType === 'general') {
        cfg.generalQuestionCount = progCfg.generalQuestionCount || 0;
        cfg.generalMarksPerQuestion = progCfg.scoreSettings?.equalDistribution || progCfg.scoreSettings?.evenMarks || 0;
      } else if (qConfigType === 'levelBased') {
        cfg.levelBasedCounts = progCfg.levelBasedCounts || { easy: 0, medium: 0, hard: 0 };
      } else if (qConfigType === 'selectionLevel') {
        cfg.selectionLevelCounts = progCfg.selectionLevelCounts || { easy: 0, medium: 0, hard: 0 };
      }

      return { cfg, total };
    };

    // ── Dispatch to builders by exercise type ──────────────────────────────
    if (exerciseTypeParsed === 'MCQ' || exerciseTypeParsed === 'Combined') {
      if (quesConfig.mcqConfig) {
        const { cfg, total } = buildMCQConfig(quesConfig.mcqConfig);
        mcqQuestionConfig = cfg;
        mcqTotalMarks = total;
      }
    }
    if (exerciseTypeParsed === 'Programming' || exerciseTypeParsed === 'Combined') {
      if (quesConfig.programmingConfig) {
        const { cfg, total } = buildProgConfig(quesConfig.programmingConfig);
        programmingQuestionConfig = cfg;
        progTotalMarks = total;
      }
    }

    if (exerciseTypeParsed === 'Other') {
      // Frontend sends it as othersQuestionConfiguration (from buildFullPayload)
      const othersCfg = quesConfig.othersQuestionConfiguration
        || quesConfig.othersConfig  // fallback for older payloads
        || null;

      if (othersCfg) {
        const qConfigType = othersCfg.questionConfigType || 'general';

        let othersTotal = 0;

        if (qConfigType === 'general') {
          const evenMarks = othersCfg.generalMarksPerQuestion
            || othersCfg.scoreSettings?.evenMarks
            || othersCfg.scoreSettings?.equalDistribution
            || 0;
          const qCount = othersCfg.generalQuestionCount || 0;
          othersTotal = qCount * evenMarks;
        } else {
          // levelBased or selectionLevel — sum from levelScoringConfiguration
          const counts = qConfigType === 'selectionLevel'
            ? othersCfg.selectionLevelCounts
            : othersCfg.levelBasedCounts;
          const levelScoring = othersCfg.scoreSettings?.levelScoringConfiguration;

          if (levelScoring) {
            ['easy', 'medium', 'hard'].forEach(l => {
              const c = counts?.[l] || 0;
              if (!c) return;
              const s = levelScoring[l];
              if (!s) return;
              if (s.type === 'level_specific' && s.marksPerQuestion) othersTotal += c * s.marksPerQuestion;
              else if (s.type === 'question_specific' && s.totalMarks) othersTotal += s.totalMarks;
            });
          } else if (othersCfg.scoreSettings?.levelBasedMarks) {
            const lbm = othersCfg.scoreSettings.levelBasedMarks;
            ['easy', 'medium', 'hard'].forEach(l => {
              othersTotal += (counts?.[l] || 0) * (lbm[l] || 0);
            });
          }
        }

        // Use the totalMarks from scoreSettings if calculated value is 0 (fallback)
        if (!othersTotal) {
          othersTotal = othersCfg.scoreSettings?.totalMarks
            || exerciseInfo.totalMarks
            || 0;
        }

        // Build levelBasedMarks for storage
        let levelBasedMarks = { easy: 0, medium: 0, hard: 0 };
        const levelScoringConfig = othersCfg.scoreSettings?.levelScoringConfiguration;

        if (levelScoringConfig && (qConfigType === 'levelBased' || qConfigType === 'selectionLevel')) {
          const counts = qConfigType === 'selectionLevel'
            ? othersCfg.selectionLevelCounts
            : othersCfg.levelBasedCounts;
          ['easy', 'medium', 'hard'].forEach(l => {
            const c = counts?.[l] || 0;
            if (!c) return;
            const s = levelScoringConfig[l];
            if (s?.type === 'level_specific' && s.marksPerQuestion) {
              levelBasedMarks[l] = s.marksPerQuestion;
              if (!levelScoringConfig[l].questionCount) levelScoringConfig[l].questionCount = c;
            } else if (s?.type === 'question_specific' && s.totalMarks) {
              levelBasedMarks[l] = c > 0 ? s.totalMarks / c : 0;
              if (!levelScoringConfig[l].questionCount) levelScoringConfig[l].questionCount = c;
            }
          });
        }

        othersQuestionConfig = {
          questionConfigType: qConfigType,
          ...(qConfigType === 'general' && {
            generalQuestionCount: othersCfg.generalQuestionCount || 0,
            generalMarksPerQuestion: othersCfg.generalMarksPerQuestion
              || othersCfg.scoreSettings?.evenMarks
              || 0,
          }),
          ...(qConfigType === 'levelBased' && {
            levelBasedCounts: othersCfg.levelBasedCounts || { easy: 0, medium: 0, hard: 0 },
          }),
          ...(qConfigType === 'selectionLevel' && {
            selectionLevelCounts: othersCfg.selectionLevelCounts || { easy: 0, medium: 0, hard: 0 },
          }),
          scoreSettings: {
            scoreType: qConfigType === 'general' ? 'evenMarks' : 'levelBasedMarks',
            evenMarks: othersCfg.scoreSettings?.evenMarks
              || othersCfg.generalMarksPerQuestion
              || 0,
            levelBasedMarks,
            levelScoringConfiguration: levelScoringConfig || undefined,
            totalMarks: othersTotal,
          },
          questionFlow: othersCfg.questionFlow || 'freeFlow',
          attemptLimitEnabled: othersCfg.attemptLimitEnabled || false,
          submissionAttempts: othersCfg.submissionAttempts || 1,
        };

        progTotalMarks = othersTotal;
      }
    }
    // ── Build availabilityPeriod (endDate always stored) ──────────────────
    const availabilityPeriodData = buildAvailabilityPeriod(availPeriod);

    // ── Build notificationSettings (full, separate from grades) ───────────
    // const notificationSettingsData = {
    //   notifyUsers: notifSettings.notifyUsers || false,
    //   notifyGmail: notifSettings.notifyGmail || false,
    //   notifyWhatsApp: notifSettings.notifyWhatsApp || false,
    //   gradeSheet: notifSettings.gradeSheet !== undefined ? notifSettings.gradeSheet : true,
    //   notifyGradersSubmissions: notifSettings.notifyGradersSubmissions || false,
    //   notifyGradersLateSubmissions: notifSettings.notifyGradersLateSubmissions || false,
    //   notifyStudent: notifSettings.notifyStudent !== undefined ? notifSettings.notifyStudent : true,
    // };

    // ── Build notificationSettings (full, separate from grades) ───────────
    const notificationSettingsData = {
      // Global notification settings
      notifyUsers: notifSettings.notifyUsers || false,
      notifyGmail: notifSettings.notifyGmail || false,
      notifyWhatsApp: notifSettings.notifyWhatsApp || false,
      gradeSheet: notifSettings.gradeSheet !== undefined ? notifSettings.gradeSheet : true,

      // Grader submission notifications with channel support
      notifyGradersSubmissions: notifSettings.notifyGradersSubmissions || false,
      notifyGradersSubmissionsChannels: {
        dashboard: notifSettings.notifyGradersSubmissionsChannels?.dashboard ?? false,
        gmail: notifSettings.notifyGradersSubmissionsChannels?.gmail ?? false,
        whatsapp: notifSettings.notifyGradersSubmissionsChannels?.whatsapp ?? false,
      },

      // Grader late submission notifications with channel support
      notifyGradersLateSubmissions: notifSettings.notifyGradersLateSubmissions || false,
      notifyGradersLateSubmissionsChannels: {
        dashboard: notifSettings.notifyGradersLateSubmissionsChannels?.dashboard ?? false,
        gmail: notifSettings.notifyGradersLateSubmissionsChannels?.gmail ?? false,
        whatsapp: notifSettings.notifyGradersLateSubmissionsChannels?.whatsapp ?? false,
      },

      // Student notifications with channel support
      notifyStudent: notifSettings.notifyStudent !== undefined ? notifSettings.notifyStudent : true,
      notifyStudentChannels: {
        dashboard: notifSettings.notifyStudentChannels?.dashboard ?? false,
        gmail: notifSettings.notifyStudentChannels?.gmail ?? false,
        whatsapp: notifSettings.notifyStudentChannels?.whatsapp ?? false,
      },
    };

    // ── Build gradeSettings with auto-computed values ──────────────────────
    const exerciseInfoForGrade = {
      totalMarks: exerciseInfo.totalMarks || 0,
      totalMarksMCQ: exerciseInfo.totalMarksMCQ || (exerciseTypeParsed === 'MCQ' ? (exerciseInfo.totalMarks || 0) : 0),
      totalMarksProgramming: exerciseInfo.totalMarksProgramming || ((exerciseTypeParsed === 'Programming' || exerciseTypeParsed === 'Other') ? (exerciseInfo.totalMarks || 0) : 0),
    };
    const gradeSettingsData = computeAutoGrades(exerciseTypeParsed, exerciseInfoForGrade, gradeSettingsRaw);

    // ── Build additionalOptions ────────────────────────────────────────────
    const additionalOptionsData = {
      anonymousSubmissions: additOptions.anonymousSubmissions || false,
      hideGraderIdentity: additOptions.hideGraderIdentity || false,
    };

    // ── Assemble the new exercise document ────────────────────────────────
    const totalMarksForInfo = exerciseTypeParsed === 'Combined'
      ? (exerciseInfo.totalMarksMCQ || 0) + (exerciseInfo.totalMarksProgramming || 0)
      : (exerciseInfo.totalMarks || 0);

    const newExercise = {
      _id: new mongoose.Types.ObjectId(),

      exerciseType: exerciseTypeParsed,
      isGraded: isGraded !== false,
      stepsSaved: Array.isArray(stepsSaved) ? stepsSaved : [],
      configurationType: configTypeSettings,

      exerciseInformation: {
        exerciseId: exerciseId,
        exerciseName: exerciseInfo.exerciseName || '',
        description: exerciseInfo.description || '',
        exerciseLevel: exerciseInfo.exerciseLevel || 'intermediate',
        exerciseType: exerciseInfo.exerciseType || exerciseTypeParsed || '',
        testType: exerciseInfo.testType || 'mock',
        totalDuration: exerciseInfo.totalDuration || 1,
        totalMarksMCQ: exerciseTypeParsed === 'MCQ' || exerciseTypeParsed === 'Combined'
          ? (exerciseInfo.totalMarksMCQ !== undefined ? exerciseInfo.totalMarksMCQ : mcqTotalMarks) : 0,
        totalMarksProgramming: exerciseTypeParsed === 'Programming' || exerciseTypeParsed === 'Other' || exerciseTypeParsed === 'Combined'
          ? (exerciseInfo.totalMarksProgramming !== undefined ? exerciseInfo.totalMarksProgramming : progTotalMarks) : 0,
        totalMarks: exerciseInfo.totalMarks || totalMarksForInfo,
        selectedModule: exerciseInfo.selectedModule || '',
        selectedLanguages: exerciseInfo.selectedLanguages || [],
        isSectionBased: exerciseInfo.isSectionBased || false,
        sectionBasedDuration: exerciseInfo.sectionBasedDuration || false,
      },

      questionConfiguration: {},

      // Availability (endDate is always stored)
      availabilityPeriod: availabilityPeriodData,

      // Notifications (separate from grades)
      notificationSettings: notificationSettingsData,
      // Keep legacy field populated for backward compatibility
      notificatonandGradeSettings: {
        notifyUsers: notifSettings.notifyUsers || false,
        notifyGmail: notifSettings.notifyGmail || false,
        notifyWhatsApp: notifSettings.notifyWhatsApp || false,
        gradeSheet: notifSettings.gradeSheet !== undefined ? notifSettings.gradeSheet : true,
      },

      // Grade settings (auto-computed + user-entered)
      gradeSettings: gradeSettingsData,

      // Additional options
      additionalOptions: additionalOptionsData,

      // Question behavior flags
      questionBehavior: {
        allQuestionsRequired: questionBehavior?.allQuestionsRequired !== undefined
          ? questionBehavior.allQuestionsRequired
          : true,
      },

      questions: quesConfig.questions || [],
      createdAt: new Date(),
      createdBy: req.user?.email || 'system',
      version: 1,
    };

    // ── Attach programming settings ────────────────────────────────────────
    if ((exerciseTypeParsed === 'Programming' || exerciseTypeParsed === 'Combined') && progSettings) {
      newExercise.programmingSettings = {
        selectedModule: progSettings.selectedModule || null,
        selectedLanguages: progSettings.selectedLanguages || [],
      };
    }

    // ── Attach question configurations ─────────────────────────────────────
    if (mcqQuestionConfig) newExercise.questionConfiguration.mcqQuestionConfiguration = mcqQuestionConfig;
    if (programmingQuestionConfig) newExercise.questionConfiguration.programmingQuestionConfiguration = programmingQuestionConfig;
    if (othersQuestionConfig) newExercise.questionConfiguration.othersQuestionConfiguration = othersQuestionConfig;

    // ── Persist ────────────────────────────────────────────────────────────
    exercises.push(newExercise);
    entity.pedagogy[tabType].set(subcategory, exercises);
    entity.markModified(`pedagogy.${tabType}`);
    entity.updatedBy = req.user?.email || 'system';
    entity.updatedAt = new Date();
    await entity.save();

    // ── Build response config ──────────────────────────────────────────────
    let responseConfig = {};
    if (exerciseTypeParsed === 'MCQ') responseConfig = { mode: 'mcq', config: mcqQuestionConfig };
    else if (exerciseTypeParsed === 'Programming') responseConfig = { mode: 'programming', config: programmingQuestionConfig };
    else if (exerciseTypeParsed === 'Other') responseConfig = { mode: 'other', config: othersQuestionConfig };
    else if (exerciseTypeParsed === 'Combined') responseConfig = { mode: 'combined', mcqConfig: mcqQuestionConfig, programmingConfig: programmingQuestionConfig };

    return res.status(201).json({
      message: [{ key: 'success', value: `Exercise added successfully to ${subcategory}` }],
      data: {
        exercise: newExercise,
        configuration: responseConfig,
        gradeSettings: gradeSettingsData,
        notificationSettings: notificationSettingsData,
        additionalOptions: additionalOptionsData,
        subcategory,
        tabType,
        entityType: type,
        entityId: id,
        totalExercises: exercises.length,
        generatedExerciseId: exerciseId,
        location: { section: tabType, subcategory, index: exercises.length - 1 },
      },
    });

  } catch (err) {
    console.error('❌ Add exercise error:', err);
    res.status(500).json({
      message: [{ key: 'error', value: `Internal server error: ${err.message}` }],
    });
  }
};

// =============================================================================
// updateExercise — FULL UPDATED VERSION
// NOTE: computeAutoGrades, buildAvailabilityPeriod helpers must be defined
//       in the same file (see addExercise.js for their implementations).
// =============================================================================
// =============================================================================
// updateExercise — FULL UPDATED VERSION
// NOTE: computeAutoGrades, buildAvailabilityPeriod helpers must be defined
//       in the same file (see addExercise.js for their implementations).
// =============================================================================
exports.updateExercise = async (req, res) => {
  try {
    const { type, id, exerciseId } = req.params;
    const {
      tabType,
      subcategory,
      exerciseType,
      programmingSettings,
      exerciseInformation,
      availabilityPeriod,
      questionConfiguration,
      questionBehavior,       // allQuestionsRequired flag
      notificationSettings,   // from frontend
      notificationGradeSettings, // legacy field name (keep support)
      gradeSettings,          // NEW
      additionalOptions,      // NEW
      isGraded,               // Graded / Non-Graded toggle
      stepsSaved,             // Array of step titles explicitly saved by user
    } = req.body;

    // ── Validate ──────────────────────────────────────────────────────────
    if (!modelMap[type]) {
      return res.status(400).json({
        message: [{ key: 'error', value: `Invalid entity type: ${type}.` }]
      });
    }
    if (!subcategory) {
      return res.status(400).json({ message: [{ key: 'error', value: 'Subcategory is required.' }] });
    }
    if (!tabType) {
      return res.status(400).json({ message: [{ key: 'error', value: 'tabType is required (I_Do, We_Do, You_Do)' }] });
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    const parseIfNeeded = (data) => {
      if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return data; }
      }
      return data;
    };

    const transformQuestionDescription = (question) => {
      if (!question) return question;
      if (question.description && typeof question.description === 'string') {
        question.description = { text: question.description, imageUrl: null, imageAlignment: 'left', imageSizePercent: 100 };
      }
      return question;
    };

    // ── Parse all incoming ─────────────────────────────────────────────────
    const parsedExerciseType = exerciseType ? parseIfNeeded(exerciseType) : null;
    const parsedExerciseInfo = exerciseInformation ? parseIfNeeded(exerciseInformation) : null;
    const parsedProgSettings = programmingSettings ? parseIfNeeded(programmingSettings) : null;
    const parsedAvailPeriod = availabilityPeriod ? parseIfNeeded(availabilityPeriod) : null;
    const parsedQuesConfig = questionConfiguration ? parseIfNeeded(questionConfiguration) : null;
    // Accept either field name for notifications
    const parsedNotifSettings = notificationSettings
      ? parseIfNeeded(notificationSettings)
      : (notificationGradeSettings ? parseIfNeeded(notificationGradeSettings) : null);
    const parsedGradeSettings = gradeSettings ? parseIfNeeded(gradeSettings) : null;
    const parsedAdditOptions = additionalOptions ? parseIfNeeded(additionalOptions) : null;

    // ── Find entity ───────────────────────────────────────────────────────
    const { model } = modelMap[type];
    const entity = await model.findById(id);

    if (!entity) return res.status(404).json({ message: [{ key: 'error', value: `${type} with ID ${id} not found` }] });
    if (!entity.pedagogy) return res.status(404).json({ message: [{ key: 'error', value: 'Pedagogy structure not found' }] });
    if (!entity.pedagogy[tabType]) return res.status(404).json({ message: [{ key: 'error', value: `Pedagogy tab '${tabType}' not found` }] });
    if (!entity.pedagogy[tabType].has(subcategory))
      return res.status(404).json({ message: [{ key: 'error', value: `Subcategory '${subcategory}' not found in ${tabType}` }] });

    const exercises = entity.pedagogy[tabType].get(subcategory);
    const exerciseIndex = exercises.findIndex(ex => ex._id.toString() === exerciseId);

    if (exerciseIndex === -1) {
      return res.status(404).json({
        message: [{ key: 'error', value: `Exercise with ID ${exerciseId} not found in subcategory '${subcategory}'` }]
      });
    }

    const existingExercise = exercises[exerciseIndex].toObject
      ? exercises[exerciseIndex].toObject()
      : { ...exercises[exerciseIndex] };
    delete existingExercise.$__;
    delete existingExercise.$isNew;
    delete existingExercise._doc;

    const finalExerciseType = parsedExerciseType || existingExercise.exerciseType;

    const configTypeSettings = {
      mcqMode: finalExerciseType === 'MCQ' || finalExerciseType === 'Combined',
      programmingMode: finalExerciseType === 'Programming' || finalExerciseType === 'Combined',
      combinedMode: finalExerciseType === 'Combined',
      otherMode: finalExerciseType === 'Other',
    };

    // ── Re-use question config builders (same logic as addExercise) ────────
    let mcqQuestionConfig = existingExercise.questionConfiguration?.mcqQuestionConfiguration || null;
    let programmingQuestionConfig = existingExercise.questionConfiguration?.programmingQuestionConfiguration || null;
    let othersQuestionConfig = existingExercise.questionConfiguration?.othersQuestionConfiguration || null;
    let mcqTotalMarks = existingExercise.exerciseInformation?.totalMarksMCQ || 0;
    let progTotalMarks = existingExercise.exerciseInformation?.totalMarksProgramming || 0;

    if (parsedQuesConfig) {
      // ── MCQ config ───────────────────────────────────────────────────────
      if (parsedQuesConfig.mcqConfig) {
        const mcqCfg = parsedQuesConfig.mcqConfig;
        const scoreType = mcqCfg.scoreSettings?.scoreType || 'equalDistribution';
        let marksPerQuestion = 0;
        if (scoreType === 'equalDistribution') {
          marksPerQuestion = mcqCfg.scoreSettings?.equalDistribution || 0;
          mcqTotalMarks = (mcqCfg.generalQuestionCount || 0) * marksPerQuestion;
        } else {
          mcqTotalMarks = mcqCfg.scoreSettings?.totalMarks || 0;
        }
        mcqQuestionConfig = {
          totalMcqQuestions: mcqCfg.generalQuestionCount || 0,
          marksPerQuestion,
          mcqTotalMarks,
          attemptLimitEnabled: mcqCfg.attemptLimitEnabled || false,
          submissionAttempts: mcqCfg.submissionAttempts || 1,
          shuffleQuestions: true,
          scoringType: scoreType,
        };
      }

      // ── Programming config ───────────────────────────────────────────────
      if (parsedQuesConfig.programmingConfig) {
        const progCfg = parsedQuesConfig.programmingConfig;
        const qConfigType = progCfg.questionConfigType || 'general';
        let backendType;
        switch (qConfigType) {
          case 'levelBased': backendType = 'levelBased'; break;
          case 'selectionLevel': backendType = 'selectionLevel'; break;
          default: backendType = qConfigType;
        }

        // Recalculate total marks
        progTotalMarks = 0;
        if (qConfigType === 'general' && progCfg.scoreSettings?.scoreType === 'equalDistribution') {
          progTotalMarks = (progCfg.generalQuestionCount || 0) * (progCfg.scoreSettings.equalDistribution || 0);
        } else if (qConfigType === 'levelBased' || qConfigType === 'selectionLevel') {
          const counts = qConfigType === 'selectionLevel' ? progCfg.selectionLevelCounts : progCfg.levelBasedCounts;
          const levelScoring = progCfg.scoreSettings?.levelScoringConfiguration;
          if (levelScoring) {
            ['easy', 'medium', 'hard'].forEach(l => {
              const c = counts?.[l] || 0; if (!c) return;
              const s = levelScoring[l]; if (!s) return;
              if (s.type === 'level_specific' && s.marksPerQuestion) progTotalMarks += c * s.marksPerQuestion;
              else if (s.type === 'question_specific' && s.totalMarks) progTotalMarks += s.totalMarks;
            });
          }
        }

        let backendScoreType;
        if (qConfigType === 'levelBased' || qConfigType === 'selectionLevel') {
          backendScoreType = 'levelBasedMarks';
        } else {
          switch (progCfg.scoreSettings?.scoreType) {
            case 'equalDistribution': backendScoreType = 'evenMarks'; break;
            case 'questionSpecific': backendScoreType = 'separateMarks'; break;
            case 'levelSpecific': backendScoreType = 'levelBasedMarks'; break;
            default: backendScoreType = progCfg.scoreSettings?.scoreType || 'evenMarks';
          }
        }

        const levelScoringConfig = progCfg.scoreSettings?.levelScoringConfiguration;
        let levelBasedMarks = progCfg.scoreSettings?.levelBasedMarks || { easy: 0, medium: 0, hard: 0 };

        if (levelScoringConfig && (qConfigType === 'levelBased' || qConfigType === 'selectionLevel')) {
          const counts = qConfigType === 'selectionLevel' ? progCfg.selectionLevelCounts : progCfg.levelBasedCounts;
          ['easy', 'medium', 'hard'].forEach(l => {
            const c = counts?.[l] || 0; if (!c) return;
            const s = levelScoringConfig[l];
            if (s?.type === 'level_specific' && s.marksPerQuestion) {
              levelBasedMarks[l] = s.marksPerQuestion;
              if (!levelScoringConfig[l].questionCount) levelScoringConfig[l].questionCount = c;
            } else if (s?.type === 'question_specific' && s.totalMarks) {
              if (!levelScoringConfig[l].questionCount) levelScoringConfig[l].questionCount = c;
            }
          });
        }

        programmingQuestionConfig = {
          questionConfigType: backendType || 'general',
          attemptLimitEnabled: progCfg.attemptLimitEnabled || false,
          submissionAttempts: progCfg.submissionAttempts || 1,
          questionFlow: progCfg.questionFlow || 'freeFlow',
          compilerFileMode: progCfg.compilerFileMode || 'single',
          allowCodeExecution: true,
          enableTestCases: true,
          showSampleCases: true,
          scoreSettings: {
            scoreType: backendScoreType,
            evenMarks: progCfg.scoreSettings?.scoreType === 'equalDistribution' ? (progCfg.scoreSettings.equalDistribution || 0) : 0,
            separateMarks: progCfg.scoreSettings?.questionSpecific || { general: [], levelBased: { easy: [], medium: [], hard: [] } },
            levelBasedMarks,
            levelScoringConfiguration: levelScoringConfig,
            totalMarks: progTotalMarks,
          },
        };
        if (qConfigType === 'general') {
          programmingQuestionConfig.generalQuestionCount = progCfg.generalQuestionCount || 0;
          programmingQuestionConfig.generalMarksPerQuestion = progCfg.scoreSettings?.equalDistribution || progCfg.scoreSettings?.evenMarks || 0;
        } else if (qConfigType === 'levelBased') {
          programmingQuestionConfig.levelBasedCounts = progCfg.levelBasedCounts || { easy: 0, medium: 0, hard: 0 };
        } else if (qConfigType === 'selectionLevel') {
          programmingQuestionConfig.selectionLevelCounts = progCfg.selectionLevelCounts || { easy: 0, medium: 0, hard: 0 };
        }
      }

      // ── Others config (NEW schema, replaces the old flat one) ──────────────────
      if (parsedQuesConfig.othersQuestionConfiguration || parsedQuesConfig.othersConfig) {
        const othersCfg = parsedQuesConfig.othersQuestionConfiguration
          || parsedQuesConfig.othersConfig;
        const qConfigType = othersCfg.questionConfigType || 'general';

        let othersTotal = 0;
        if (qConfigType === 'general') {
          const evenMarks = othersCfg.generalMarksPerQuestion
            || othersCfg.scoreSettings?.evenMarks || 0;
          othersTotal = (othersCfg.generalQuestionCount || 0) * evenMarks;
        } else {
          const counts = qConfigType === 'selectionLevel'
            ? othersCfg.selectionLevelCounts
            : othersCfg.levelBasedCounts;
          const levelScoring = othersCfg.scoreSettings?.levelScoringConfiguration;
          if (levelScoring) {
            ['easy', 'medium', 'hard'].forEach(l => {
              const c = counts?.[l] || 0; if (!c) return;
              const s = levelScoring[l]; if (!s) return;
              if (s.type === 'level_specific' && s.marksPerQuestion)
                othersTotal += c * s.marksPerQuestion;
              else if (s.type === 'question_specific' && s.totalMarks)
                othersTotal += s.totalMarks;
            });
          }
        }

        if (!othersTotal) {
          othersTotal = othersCfg.scoreSettings?.totalMarks
            || parsedExerciseInfo?.totalMarks
            || existingExercise.exerciseInformation?.totalMarks || 0;
        }

        othersQuestionConfig = {
          questionConfigType: qConfigType,
          ...(qConfigType === 'general' && {
            generalQuestionCount: othersCfg.generalQuestionCount || 0,
            generalMarksPerQuestion: othersCfg.generalMarksPerQuestion
              || othersCfg.scoreSettings?.evenMarks || 0,
          }),
          ...(qConfigType === 'levelBased' && {
            levelBasedCounts: othersCfg.levelBasedCounts || { easy: 0, medium: 0, hard: 0 },
          }),
          ...(qConfigType === 'selectionLevel' && {
            selectionLevelCounts: othersCfg.selectionLevelCounts || { easy: 0, medium: 0, hard: 0 },
          }),
          scoreSettings: {
            scoreType: qConfigType === 'general' ? 'evenMarks' : 'levelBasedMarks',
            evenMarks: othersCfg.generalMarksPerQuestion
              || othersCfg.scoreSettings?.evenMarks || 0,
            levelBasedMarks: othersCfg.scoreSettings?.levelBasedMarks
              || { easy: 0, medium: 0, hard: 0 },
            // ✅ Preserved on update
            levelScoringConfiguration: othersCfg.scoreSettings?.levelScoringConfiguration,
            totalMarks: othersTotal,
          },
          questionFlow: othersCfg.questionFlow || 'freeFlow',
          attemptLimitEnabled: othersCfg.attemptLimitEnabled || false,
          submissionAttempts: othersCfg.submissionAttempts || 1,
        };
        progTotalMarks = othersTotal;
      }
      // Direct overrides (if frontend sends already-formatted config objects)
      if (parsedQuesConfig.mcqQuestionConfiguration) {
        mcqQuestionConfig = parsedQuesConfig.mcqQuestionConfiguration;
        mcqTotalMarks = mcqQuestionConfig.mcqTotalMarks || 0;
      }
      if (parsedQuesConfig.programmingQuestionConfiguration) {
        programmingQuestionConfig = parsedQuesConfig.programmingQuestionConfiguration;
        progTotalMarks = programmingQuestionConfig.scoreSettings?.totalMarks
          || (programmingQuestionConfig.generalQuestionCount || 0) * (programmingQuestionConfig.scoreSettings?.evenMarks || 0)
          || 0;
      }

      if (parsedQuesConfig.questions) {
        if (Array.isArray(parsedQuesConfig.questions)) {
          parsedQuesConfig.questions = parsedQuesConfig.questions.map(q => transformQuestionDescription(q));
        }
      }
    }

    // ── Build updated exercise (spread existing, apply changes) ────────────
    const updatedExercise = {
      ...existingExercise,
      ...(parsedExerciseType && { exerciseType: finalExerciseType }),
      isGraded: isGraded !== undefined ? isGraded !== false : (existingExercise.isGraded !== false),
      stepsSaved: Array.isArray(stepsSaved) ? stepsSaved : (existingExercise.stepsSaved || []),
      configurationType: configTypeSettings,
      updatedAt: new Date(),
      updatedBy: req.user?.email || 'system',
      version: (existingExercise.version || 1) + 1,
    };

    // ── Exercise information ───────────────────────────────────────────────
    if (parsedExerciseInfo) {
      updatedExercise.exerciseInformation = {
        ...existingExercise.exerciseInformation,
        exerciseId: parsedExerciseInfo.exerciseId || existingExercise.exerciseInformation?.exerciseId,
        exerciseName: parsedExerciseInfo.exerciseName || existingExercise.exerciseInformation?.exerciseName,
        description: parsedExerciseInfo.description !== undefined ? parsedExerciseInfo.description : existingExercise.exerciseInformation?.description,
        exerciseLevel: parsedExerciseInfo.exerciseLevel || existingExercise.exerciseInformation?.exerciseLevel,
        exerciseType: parsedExerciseInfo.exerciseType || existingExercise.exerciseInformation?.exerciseType || '',
        testType: parsedExerciseInfo.testType || existingExercise.exerciseInformation?.testType || 'mock',
        totalDuration: parsedExerciseInfo.totalDuration !== undefined ? parsedExerciseInfo.totalDuration : existingExercise.exerciseInformation?.totalDuration,
        totalMarksMCQ: finalExerciseType === 'MCQ' || finalExerciseType === 'Combined'
          ? (parsedExerciseInfo.totalMarksMCQ !== undefined ? parsedExerciseInfo.totalMarksMCQ : mcqTotalMarks) : 0,
        totalMarksProgramming: finalExerciseType === 'Programming' || finalExerciseType === 'Other' || finalExerciseType === 'Combined'
          ? (parsedExerciseInfo.totalMarksProgramming !== undefined ? parsedExerciseInfo.totalMarksProgramming : progTotalMarks) : 0,
        totalMarks: parsedExerciseInfo.totalMarks || (mcqTotalMarks + progTotalMarks),
        selectedModule: parsedExerciseInfo.selectedModule !== undefined ? parsedExerciseInfo.selectedModule : existingExercise.exerciseInformation?.selectedModule || '',
        selectedLanguages: parsedExerciseInfo.selectedLanguages !== undefined ? parsedExerciseInfo.selectedLanguages : existingExercise.exerciseInformation?.selectedLanguages || [],
        isSectionBased: parsedExerciseInfo.isSectionBased !== undefined ? parsedExerciseInfo.isSectionBased : existingExercise.exerciseInformation?.isSectionBased || false,
        sectionBasedDuration: parsedExerciseInfo.sectionBasedDuration !== undefined ? parsedExerciseInfo.sectionBasedDuration : existingExercise.exerciseInformation?.sectionBasedDuration || false,
      };
    }

    // ── Programming settings ───────────────────────────────────────────────
    if (parsedProgSettings) {
      updatedExercise.programmingSettings = {
        selectedModule: parsedProgSettings.selectedModule || existingExercise.programmingSettings?.selectedModule,
        selectedLanguages: parsedProgSettings.selectedLanguages || existingExercise.programmingSettings?.selectedLanguages || [],
      };
    }

    // ── Question configuration ─────────────────────────────────────────────
    if (parsedQuesConfig) {
      if (!updatedExercise.questionConfiguration) updatedExercise.questionConfiguration = {};
      if (mcqQuestionConfig) updatedExercise.questionConfiguration.mcqQuestionConfiguration = mcqQuestionConfig;
      if (programmingQuestionConfig) updatedExercise.questionConfiguration.programmingQuestionConfiguration = programmingQuestionConfig;
      if (othersQuestionConfig) updatedExercise.questionConfiguration.othersQuestionConfiguration = othersQuestionConfig;
      if (parsedQuesConfig.questions) updatedExercise.questions = parsedQuesConfig.questions;
    }

    // ── Question behavior ──────────────────────────────────────────────────
    if (questionBehavior !== undefined) {
      updatedExercise.questionBehavior = {
        allQuestionsRequired: questionBehavior?.allQuestionsRequired !== undefined
          ? questionBehavior.allQuestionsRequired
          : (existingExercise.questionBehavior?.allQuestionsRequired !== undefined
            ? existingExercise.questionBehavior.allQuestionsRequired
            : true),
      };
    }

    // ── Availability period ────────────────────────────────────────────────
    if (parsedAvailPeriod) {
      const safeD = (v) => {
        if (!v || v === 'null' || v === 'undefined') return undefined;
        const d = new Date(v);
        return isNaN(d.getTime()) ? undefined : d;
      };
      const existAvail = existingExercise.availabilityPeriod || {};
      const prev = (f) => existAvail[f] ? new Date(existAvail[f]) : undefined;

      const startDate = safeD(parsedAvailPeriod.startDate) || prev('startDate');
      // endDate = submission deadline; fall back to existing
      const endDate = safeD(parsedAvailPeriod.endDate) || prev('endDate');
      const cutOffEnabled = parsedAvailPeriod.cutOffEnabled !== undefined
        ? !!parsedAvailPeriod.cutOffEnabled
        : !!(existAvail.cutOffEnabled ?? false);
      // cutOffDate: only keep when toggle is ON
      const cutOffDate = cutOffEnabled
        ? (safeD(parsedAvailPeriod.cutOffDate) || prev('cutOffDate'))
        : undefined;
      const remindEnabled = parsedAvailPeriod.remindGradeByEnabled !== undefined
        ? !!parsedAvailPeriod.remindGradeByEnabled
        : !!(existAvail.remindGradeByEnabled ?? false);
      const remindGradeBy = remindEnabled
        ? (safeD(parsedAvailPeriod.remindGradeBy) || prev('remindGradeBy'))
        : undefined;
      const gracePeriodOn = parsedAvailPeriod.gracePeriodAllowed !== undefined
        ? !!(parsedAvailPeriod.gracePeriodAllowed || parsedAvailPeriod.gracePeriodEnabled)
        : !!(existAvail.gracePeriodAllowed || existAvail.gracePeriodEnabled);
      const gracePeriodDate = gracePeriodOn
        ? (safeD(parsedAvailPeriod.gracePeriodDate) || prev('gracePeriodDate'))
        : undefined;

      if (startDate) {
        const ap = {};
        ap.startDate = startDate;
        if (endDate) ap.endDate = endDate;
        if (cutOffDate) ap.cutOffDate = cutOffDate;
        ap.cutOffEnabled = cutOffEnabled;
        if (remindGradeBy) ap.remindGradeBy = remindGradeBy;
        ap.remindGradeByEnabled = remindEnabled;
        ap.gracePeriodAllowed = gracePeriodOn;
        ap.gracePeriodEnabled = gracePeriodOn;
        if (gracePeriodOn && gracePeriodDate) ap.gracePeriodDate = gracePeriodDate;
        ap.extendedDays = parsedAvailPeriod.extendedDays ?? existAvail.extendedDays ?? 0;
        updatedExercise.availabilityPeriod = ap;
      } else {
        delete updatedExercise.availabilityPeriod;
      }
    }
    // ── Notification settings (separate from grades) ───────────────────────
    // ── Notification settings (separate from grades) ───────────────────────
    if (parsedNotifSettings) {
      const ex = existingExercise.notificationSettings || existingExercise.notificatonandGradeSettings || {};

      updatedExercise.notificationSettings = {
        // Global settings
        notifyUsers: parsedNotifSettings.notifyUsers !== undefined ? parsedNotifSettings.notifyUsers : (ex.notifyUsers ?? false),
        notifyGmail: parsedNotifSettings.notifyGmail !== undefined ? parsedNotifSettings.notifyGmail : (ex.notifyGmail ?? false),
        notifyWhatsApp: parsedNotifSettings.notifyWhatsApp !== undefined ? parsedNotifSettings.notifyWhatsApp : (ex.notifyWhatsApp ?? false),
        gradeSheet: parsedNotifSettings.gradeSheet !== undefined ? parsedNotifSettings.gradeSheet : (ex.gradeSheet ?? true),

        // Grader submission notifications
        notifyGradersSubmissions: parsedNotifSettings.notifyGradersSubmissions !== undefined
          ? parsedNotifSettings.notifyGradersSubmissions
          : (ex.notifyGradersSubmissions ?? false),
        notifyGradersSubmissionsChannels: {
          dashboard: parsedNotifSettings.notifyGradersSubmissionsChannels?.dashboard ?? ex.notifyGradersSubmissionsChannels?.dashboard ?? false,
          gmail: parsedNotifSettings.notifyGradersSubmissionsChannels?.gmail ?? ex.notifyGradersSubmissionsChannels?.gmail ?? false,
          whatsapp: parsedNotifSettings.notifyGradersSubmissionsChannels?.whatsapp ?? ex.notifyGradersSubmissionsChannels?.whatsapp ?? false,
        },

        // Grader late submission notifications
        notifyGradersLateSubmissions: parsedNotifSettings.notifyGradersLateSubmissions !== undefined
          ? parsedNotifSettings.notifyGradersLateSubmissions
          : (ex.notifyGradersLateSubmissions ?? false),
        notifyGradersLateSubmissionsChannels: {
          dashboard: parsedNotifSettings.notifyGradersLateSubmissionsChannels?.dashboard ?? ex.notifyGradersLateSubmissionsChannels?.dashboard ?? false,
          gmail: parsedNotifSettings.notifyGradersLateSubmissionsChannels?.gmail ?? ex.notifyGradersLateSubmissionsChannels?.gmail ?? false,
          whatsapp: parsedNotifSettings.notifyGradersLateSubmissionsChannels?.whatsapp ?? ex.notifyGradersLateSubmissionsChannels?.whatsapp ?? false,
        },

        // Student notifications
        notifyStudent: parsedNotifSettings.notifyStudent !== undefined
          ? parsedNotifSettings.notifyStudent
          : (ex.notifyStudent ?? true),
        notifyStudentChannels: {
          dashboard: parsedNotifSettings.notifyStudentChannels?.dashboard ?? ex.notifyStudentChannels?.dashboard ?? false,
          gmail: parsedNotifSettings.notifyStudentChannels?.gmail ?? ex.notifyStudentChannels?.gmail ?? false,
          whatsapp: parsedNotifSettings.notifyStudentChannels?.whatsapp ?? ex.notifyStudentChannels?.whatsapp ?? false,
        },
      };

      // Keep legacy field in sync
      updatedExercise.notificatonandGradeSettings = {
        notifyUsers: updatedExercise.notificationSettings.notifyUsers,
        notifyGmail: updatedExercise.notificationSettings.notifyGmail,
        notifyWhatsApp: updatedExercise.notificationSettings.notifyWhatsApp,
        gradeSheet: updatedExercise.notificationSettings.gradeSheet,
      };
    }

    // ── Grade settings — merge then auto-compute ───────────────────────────
    if (parsedGradeSettings !== null) {
      const exGrade = existingExercise.gradeSettings || {};
      // FIXED
      const merged = {
        mcqGrade: parsedGradeSettings?.mcqGrade !== undefined
          ? Number(parsedGradeSettings.mcqGrade)
          : exGrade.mcqGrade,
        mcqGradeToPass: parsedGradeSettings?.mcqGradeToPass !== undefined
          ? (parsedGradeSettings.mcqGradeToPass !== null
            ? Number(parsedGradeSettings.mcqGradeToPass)
            : null)
          : exGrade.mcqGradeToPass,
        programmingGrade: parsedGradeSettings?.programmingGrade !== undefined
          ? Number(parsedGradeSettings.programmingGrade)
          : exGrade.programmingGrade,
        programmingGradeToPass: parsedGradeSettings?.programmingGradeToPass !== undefined
          ? (parsedGradeSettings.programmingGradeToPass !== null
            ? Number(parsedGradeSettings.programmingGradeToPass)
            : null)
          : exGrade.programmingGradeToPass,
        combinedGrade: parsedGradeSettings?.combinedGrade !== undefined
          ? Number(parsedGradeSettings.combinedGrade)
          : exGrade.combinedGrade,
        combinedGradeToPass: parsedGradeSettings?.combinedGradeToPass !== undefined
          ? (parsedGradeSettings.combinedGradeToPass !== null
            ? Number(parsedGradeSettings.combinedGradeToPass)
            : null)
          : exGrade.combinedGradeToPass,
        separateMarks: parsedGradeSettings?.separateMarks !== undefined
          ? parsedGradeSettings.separateMarks
          : (exGrade.separateMarks ?? false),

        // Difficulty-based pass marks — merge from incoming or fall back to existing
        difficultyPassEnabled: parsedGradeSettings?.difficultyPassEnabled !== undefined
          ? parsedGradeSettings.difficultyPassEnabled
          : (exGrade.difficultyPassEnabled ?? false),
        easyPassMark: parsedGradeSettings?.easyPassMark !== undefined
          ? (parsedGradeSettings.easyPassMark !== null ? Number(parsedGradeSettings.easyPassMark) : null)
          : exGrade.easyPassMark ?? null,
        mediumPassMark: parsedGradeSettings?.mediumPassMark !== undefined
          ? (parsedGradeSettings.mediumPassMark !== null ? Number(parsedGradeSettings.mediumPassMark) : null)
          : exGrade.mediumPassMark ?? null,
        hardPassMark: parsedGradeSettings?.hardPassMark !== undefined
          ? (parsedGradeSettings.hardPassMark !== null ? Number(parsedGradeSettings.hardPassMark) : null)
          : exGrade.hardPassMark ?? null,

        // Overall mark to pass (optional)
        overallMarkToPassEnabled: parsedGradeSettings?.overallMarkToPassEnabled !== undefined
          ? parsedGradeSettings.overallMarkToPassEnabled
          : (exGrade.overallMarkToPassEnabled ?? false),
        overallMarkToPass: parsedGradeSettings?.overallMarkToPass !== undefined
          ? (parsedGradeSettings.overallMarkToPass !== null ? Number(parsedGradeSettings.overallMarkToPass) : null)
          : exGrade.overallMarkToPass ?? null,
      };

      // Re-run auto-compute so grade fields always reflect current totalMarks
      const infoForGrade = updatedExercise.exerciseInformation || existingExercise.exerciseInformation || {};
      updatedExercise.gradeSettings = computeAutoGrades(finalExerciseType, infoForGrade, merged);
    } else if (!existingExercise.gradeSettings && updatedExercise.exerciseInformation) {
      // First time update — auto-compute from existing info
      updatedExercise.gradeSettings = computeAutoGrades(finalExerciseType, updatedExercise.exerciseInformation, {});
    }

    // ── Additional options ─────────────────────────────────────────────────
    if (parsedAdditOptions) {
      const exAddit = existingExercise.additionalOptions || {};
      updatedExercise.additionalOptions = {
        anonymousSubmissions: parsedAdditOptions.anonymousSubmissions !== undefined ? parsedAdditOptions.anonymousSubmissions : (exAddit.anonymousSubmissions ?? false),
        hideGraderIdentity: parsedAdditOptions.hideGraderIdentity !== undefined ? parsedAdditOptions.hideGraderIdentity : (exAddit.hideGraderIdentity ?? false),
      };
    }

    // ── Persist ────────────────────────────────────────────────────────────
    const cleanExercise = JSON.parse(JSON.stringify(updatedExercise));
    exercises[exerciseIndex] = cleanExercise;
    entity.pedagogy[tabType].set(subcategory, exercises);
    // Mongoose change tracking for pedagogy.{tabType}: Map<String, [exerciseSchema]>
    // is unreliable when the mutation is deep inside a nested subdocument (e.g.
    // availabilityPeriod.startDate / endDate Date fields). A single
    // markModified on the Map path is NOT enough — schedule updates were
    // silently being dropped at save time. Mark each level of the nesting so
    // Mongoose emits the SET ops for these Date fields. Every other handler in
    // this file that touches an exercise inside the pedagogy Map already does
    // this; updateExercise was the outlier.
    entity.markModified(`pedagogy.${tabType}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}.${exerciseIndex}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}.${exerciseIndex}.availabilityPeriod`);
    entity.updatedBy = req.user?.email || 'system';
    entity.updatedAt = new Date();
    await entity.save();

    // ── Build response config ──────────────────────────────────────────────
    let responseConfig = {};
    if (finalExerciseType === 'MCQ') responseConfig = { mode: 'mcq', config: mcqQuestionConfig };
    else if (finalExerciseType === 'Programming') responseConfig = { mode: 'programming', config: programmingQuestionConfig };
    else if (finalExerciseType === 'Other') responseConfig = { mode: 'other', config: othersQuestionConfig };
    else if (finalExerciseType === 'Combined') responseConfig = { mode: 'combined', mcqConfig: mcqQuestionConfig, programmingConfig: programmingQuestionConfig };

    return res.status(200).json({
      message: [{ key: 'success', value: `Exercise updated successfully in ${subcategory}` }],
      data: {
        exercise: cleanExercise,
        configuration: responseConfig,
        gradeSettings: cleanExercise.gradeSettings,
        notificationSettings: cleanExercise.notificationSettings,
        additionalOptions: cleanExercise.additionalOptions,
        subcategory,
        tabType,
        entityType: type,
        entityId: id,
        exerciseId,
        totalExercises: exercises.length,
        location: { section: tabType, subcategory, index: exerciseIndex },
      },
    });

  } catch (err) {
    console.error('❌ Update exercise error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({
      message: [{ key: 'error', value: `Internal server error: ${err.message}` }],
    });
  }
};
exports.getExercises = async (req, res) => {
  try {
    const { type, id } = req.params;
    const {
      section,
      subcategory
    } = req.query;


    if (!modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}` }]
      });
    }

    const { model } = modelMap[type];
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} not found` }]
      });
    }

    // Check if pedagogy exists
    if (!entity.pedagogy || !entity.pedagogy[section]) {
      return res.json({
        message: [{ key: "success", value: "No exercises found" }],
        data: {
          exercises: [],
          section: section,
          subcategory: subcategory,
          total: 0
        }
      });
    }

    // Get exercises for specific subcategory or all in section
    let exercises = [];
    if (subcategory) {
      exercises = entity.pedagogy[section].get(subcategory) || [];
    } else {
      // Return all exercises from all subcategories in section
      const allExercises = [];
      entity.pedagogy[section].forEach((exArray, subcat) => {
        if (Array.isArray(exArray)) {
          exArray.forEach(ex => {
            allExercises.push({
              ...ex._doc,
              subcategory: subcat
            });
          });
        }
      });
      exercises = allExercises;
    }

    return res.json({
      message: [{ key: "success", value: "Exercises retrieved successfully" }],
      data: {
        exercises,
        section: section,
        subcategory: subcategory,
        total: exercises.length,
        entityType: type,
        entityId: id
      }
    });

  } catch (err) {
    console.error("❌ Get exercises error:", err);
    res.status(500).json({
      message: [{ key: "error", value: "Internal server error" }]
    });
  }
};




// Delete Exercise
exports.deleteExercise = async (req, res) => {
  try {
    const { type, id, exerciseId } = req.params;
    const {
      tabType,
      subcategory
    } = req.query;

    // Validate entity type
    if (!modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}. Valid types: modules, submodules, topics, subtopics` }]
      });
    }

    // Validate required parameters
    if (!subcategory) {
      return res.status(400).json({
        message: [{ key: "error", value: "Subcategory is required as query parameter. Valid values: 'exercises', 'practical', 'Project Development', etc." }]
      });
    }

    // Validate tabType
    if (!tabType || !['I_Do', 'We_Do', 'You_Do'].includes(tabType)) {
      return res.status(400).json({
        message: [{ key: "error", value: "tabType is required and must be one of: 'I_Do', 'We_Do', 'You_Do'" }]
      });
    }

    const { model } = modelMap[type];
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} with ID ${id} not found` }]
      });
    }

    // Check if pedagogy exists
    if (!entity.pedagogy) {
      return res.status(404).json({
        message: [{ key: "error", value: "Pedagogy structure not found for this entity" }]
      });
    }

    // Check if tabType exists
    if (!entity.pedagogy[tabType]) {
      return res.status(404).json({
        message: [{ key: "error", value: `Pedagogy tab '${tabType}' not found` }]
      });
    }

    // Convert Map to object if needed
    let tabData = entity.pedagogy[tabType];
    if (tabData instanceof Map) {
      tabData = Object.fromEntries(tabData);
    }

    // Check if subcategory exists
    if (!tabData[subcategory] || !Array.isArray(tabData[subcategory])) {
      return res.status(404).json({
        message: [{ key: "error", value: `Subcategory '${subcategory}' not found in ${tabType}` }]
      });
    }

    // Find exercise index
    const exerciseIndex = tabData[subcategory].findIndex(
      exercise => exercise._id.toString() === exerciseId
    );

    if (exerciseIndex === -1) {
      return res.status(404).json({
        message: [{ key: "error", value: `Exercise with ID ${exerciseId} not found in subcategory '${subcategory}'` }]
      });
    }

    // Get exercise data for response message (including security settings)
    const exerciseToDelete = tabData[subcategory][exerciseIndex];
    const exerciseName = exerciseToDelete?.exerciseInformation?.exerciseName || 'Unknown Exercise';
    const exerciseIdValue = exerciseToDelete?.exerciseInformation?.exerciseId || exerciseId;

    // Store deleted exercise data for response (including security settings)
    const deletedExerciseData = {
      exerciseId: exerciseIdValue,
      exerciseName: exerciseName,
      securitySettings: exerciseToDelete?.securitySettings || null,
      deletedAt: new Date()
    };

    // Remove exercise from array
    tabData[subcategory].splice(exerciseIndex, 1);

    // Convert back to Map if needed
    if (entity.pedagogy[tabType] instanceof Map) {
      entity.pedagogy[tabType].set(subcategory, tabData[subcategory]);
    } else {
      entity.pedagogy[tabType][subcategory] = tabData[subcategory];
    }

    // Mark as modified
    entity.markModified(`pedagogy.${tabType}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}`);

    // Update entity timestamps
    entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
    entity.updatedAt = new Date();

    // Save entity
    await entity.save();


    return res.status(200).json({
      message: [{ key: "success", value: `Exercise "${exerciseName}" deleted successfully from ${subcategory}` }],
      data: {
        deletedExercise: deletedExerciseData,
        subcategory: subcategory,
        tabType: tabType,
        entityType: type,
        entityId: id,
        totalExercises: tabData[subcategory].length,
        location: {
          section: tabType,
          subcategory: subcategory,
          deletedIndex: exerciseIndex
        }
      }
    });

  } catch (err) {
    console.error("❌ Delete exercise error:", err);
    console.error("❌ Error stack:", err.stack);
    res.status(500).json({
      message: [{ key: "error", value: `Internal server error: ${err.message}` }]
    });
  }
};
// Get All Subcategories
exports.getSubcategories = async (req, res) => {
  try {
    const { type, id } = req.params;
    const { section = 'We_Do' } = req.query;


    if (!modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: "Invalid entity type" }]
      });
    }

    const { model } = modelMap[type];
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} not found` }]
      });
    }

    // Check if pedagogy exists
    if (!entity.pedagogy || !entity.pedagogy[section]) {
      return res.json({
        message: [{ key: "success", value: "No subcategories found" }],
        data: {
          subcategories: [],
          section: section,
          total: 0
        }
      });
    }

    // Get all subcategories
    const subcategories = Array.from(entity.pedagogy[section].keys());

    // Count exercises in each subcategory
    const subcategoryDetails = subcategories.map(subcat => {
      const exercises = entity.pedagogy[section].get(subcat) || [];
      return {
        name: subcat,
        exerciseCount: exercises.length,
        lastUpdated: exercises.length > 0
          ? exercises[exercises.length - 1].updatedAt
          : null
      };
    });

    return res.json({
      message: [{ key: "success", value: "Subcategories retrieved successfully" }],
      data: {
        subcategories: subcategoryDetails,
        section: section,
        total: subcategories.length,
        entityType: type,
        entityId: id
      }
    });

  } catch (err) {
    console.error("❌ Get subcategories error:", err);
    res.status(500).json({
      message: [{ key: "error", value: "Internal server error" }]
    });
  }
};




exports.lockExercise = async (req, res) => {
  try {
    const userId = req.body.targetUserId || req.user._id;
    const {
      courseId,
      exerciseId,
      category,
      subcategory,
      status,
      isLocked,
      submitType,
      autoSubmitReason,
      reason,
    } = req.body;

    // AUTO submit when the client flags it (proctoring/face/tab/timeout
    // termination), or when the exercise is being terminated.
    const _isAutoSubmit = submitType === 'AUTO' || status === 'terminated';
    const _autoReason = _isAutoSubmit
      ? String(autoSubmitReason || reason || '').slice(0, 300)
      : '';


    if (!courseId || !exerciseId || !subcategory) {
      return res.status(400).json({ message: [{ key: "error", value: "Missing required fields" }] });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: [{ key: "error", value: "User not found" }] });

    // 1. Find Course Index
    const courseIndex = user.courses.findIndex(c => c.courseId && c.courseId.toString() === courseId);

    if (courseIndex === -1) {
      return res.status(404).json({ message: [{ key: "error", value: "Course not enrolled" }] });
    }

    const userCourse = user.courses[courseIndex];

    // 2. Ensure Path Exists
    if (!userCourse.answers) userCourse.answers = { I_Do: new Map(), We_Do: new Map(), You_Do: new Map() };

    const categoryKey = category;
    if (!userCourse.answers[categoryKey]) userCourse.answers[categoryKey] = new Map();

    const categoryMap = userCourse.answers[categoryKey];

    // 3. Get Exercises Array
    let exercisesArray = categoryMap.get(subcategory) || [];
    if (exercisesArray.toObject) exercisesArray = exercisesArray.toObject();

    // 4. Handle Screen Recording Upload from Form-Data
    let screenRecordingUrl = null;

    // Check if file exists in the request (for form-data uploads)
    if (req.files && req.files.screenRecording) {
      try {
        const screenRecordingFile = req.files.screenRecording;

        // Upload to Cloudinary from buffer
        const uploadResult = await new Promise((resolve, reject) => {
          // Create upload stream to Cloudinary
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              resource_type: 'video',
              folder: `lms/pedagogy/${category}/${subcategory}/screen-recordings`,
              overwrite: true,
              chunk_size: 6000000, // 6MB chunks
              eager: [
                { width: 640, height: 480, crop: "scale" }
              ]
            },
            (error, result) => {
              if (error) {
                console.error('❌ Cloudinary upload error:', error);
                reject(error);
              } else {
                resolve(result);
              }
            }
          );

          // Create readable stream from buffer
          const bufferStream = new stream.PassThrough();
          bufferStream.end(screenRecordingFile.data);

          // Pipe buffer to Cloudinary upload stream
          bufferStream.pipe(uploadStream);
        });

        screenRecordingUrl = uploadResult.secure_url;
      } catch (uploadError) {
        console.error("❌ Error uploading screen recording to Cloudinary:", uploadError);
        // Continue without failing the entire operation
      }
    }
    // Also check if screenRecording was sent as Base64 in body (for backward compatibility)
    else if (req.body.screenRecording && req.body.screenRecording.startsWith('data:video/')) {
      try {
        const base64Data = req.body.screenRecording;

        const uploadResult = await cloudinary.uploader.upload(base64Data, {
          resource_type: 'video',
          folder: `lms/pedagogy/${category}/${subcategory}/screen-recordings`,
          overwrite: true,
          chunk_size: 6000000
        });

        screenRecordingUrl = uploadResult.secure_url;
      } catch (uploadError) {
        console.error("❌ Error uploading Base64 screen recording:", uploadError);
      }
    }

    // 5. Update or Push Exercise Progress
    const exerciseIndex = exercisesArray.findIndex(ex => ex.exerciseId && ex.exerciseId.toString() === exerciseId);
    let updatedExercise = null;

    if (exerciseIndex > -1) {
      // Update Existing
      if (status) exercisesArray[exerciseIndex].status = status;
      if (isLocked !== undefined) exercisesArray[exerciseIndex].isLocked = isLocked;
      else if (status === 'terminated') exercisesArray[exerciseIndex].isLocked = true;
      if (_isAutoSubmit) {
        exercisesArray[exerciseIndex].submitType = 'AUTO';
        exercisesArray[exerciseIndex].autoSubmitReason = _autoReason;
      }

      // Add screen recording URL if uploaded
      if (screenRecordingUrl) {
        exercisesArray[exerciseIndex].screenRecording = screenRecordingUrl;
      }

      updatedExercise = exercisesArray[exerciseIndex];
    } else {
      // Create New
      const newEntry = {
        exerciseId: new mongoose.Types.ObjectId(exerciseId),
        status: status || 'in-progress',
        isLocked: isLocked !== undefined ? (isLocked === 'true' || isLocked === true) : (status === 'terminated'),
        questions: [],
        screenRecording: screenRecordingUrl || undefined,
        submitType: _isAutoSubmit ? 'AUTO' : 'USER',
        autoSubmitReason: _autoReason,
      };
      exercisesArray.push(newEntry);
      updatedExercise = newEntry;
    }

    // 6. Save to Database
    categoryMap.set(subcategory, exercisesArray);

    // Mark the SPECIFIC path modified
    user.markModified(`courses.${courseIndex}.answers.${categoryKey}`);

    await user.save();
    console.log("✅ Exercise status updated successfully", updatedExercise);
    return res.status(200).json({
      message: [{ key: "success", value: "Exercise status updated successfully" }],
      data: updatedExercise
    });

  } catch (error) {
    console.error("Lock Exercise Error:", error);
    return res.status(500).json({
      message: [{ key: "error", value: "Internal server error" }],
      error: error.message
    });
  }
};


// 2. Get Exercise Status (Debugged)
exports.getExerciseStatus = async (req, res) => {
  try {
    const userId = req.query.targetUserId || req.user._id;
    const { courseId, exerciseId, category = 'We_Do', subcategory } = req.query;

    // console.log(`🔍 STATUS REQ: User: ${userId} | Ex: ${exerciseId}`);

    if (!courseId || !exerciseId || !subcategory) {
      return res.status(400).json({ message: [{ key: "error", value: "Missing parameters" }] });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: [{ key: "error", value: "User not found" }] });

    const userCourse = user.courses ? user.courses.find(c => c.courseId && c.courseId.toString() === courseId) : null;

    if (!userCourse || !userCourse.answers) {
      return res.status(200).json({ success: true, data: { isLocked: false, status: 'new' } });
    }

    const categoryKey = category || 'We_Do';
    const categoryMap = userCourse.answers[categoryKey];

    if (!categoryMap) {
      return res.status(200).json({ success: true, data: { isLocked: false, status: 'new' } });
    }

    const exercisesArray = categoryMap.get(subcategory) || [];

    // Find the exercise
    const exercise = exercisesArray.find(ex => ex.exerciseId && ex.exerciseId.toString() === exerciseId);

    if (exercise) {
      // console.log("👉 Found Status:", exercise.isLocked, exercise.status);
      return res.status(200).json({
        success: true,
        data: {
          isLocked: exercise.isLocked || false,
          status: exercise.status || 'in-progress',
          screenRecording: exercise.screenRecording || 'empty'

        }
      });
    }

    // console.log("👉 Exercise Not Found in Array, returning unlocked");
    return res.status(200).json({
      success: true,
      data: { isLocked: false, status: 'new' }
    });

  } catch (error) {
    console.error("Get Status Error:", error);
    return res.status(500).json({ message: [{ key: "error", value: "Internal server error" }] });
  }
};


// ── Save Assessment Screen Recording URL (from proctoring hook) ───────────────
// Called after the client uploads to Cloudinary and gets a URL back.
// Saves the URL to the student's exercise record so getExerciseStatus can return it.
exports.saveAssessmentRecording = async (req, res) => {
  try {
    const {
      courseId,
      exerciseId,
      studentId,
      recordingUrl,
      category = 'You_Do',
      subcategory = 'assessments',
    } = req.body;

    const userId = studentId || req.user._id;

    if (!courseId || !exerciseId || !recordingUrl) {
      return res.status(400).json({
        success: false,
        message: [{ key: 'error', value: 'Missing required fields: courseId, exerciseId, recordingUrl' }],
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: [{ key: 'error', value: 'User not found' }] });
    }

    // Ensure course exists in user's enrolled list
    const courseIndex = user.courses
      ? user.courses.findIndex(c => c.courseId && c.courseId.toString() === courseId)
      : -1;

    if (courseIndex === -1) {
      return res.status(404).json({ success: false, message: [{ key: 'error', value: 'Course not enrolled' }] });
    }

    const userCourse = user.courses[courseIndex];

    // Ensure answers map exists
    if (!userCourse.answers) {
      userCourse.answers = { I_Do: new Map(), We_Do: new Map(), You_Do: new Map() };
    }
    const categoryKey = category;
    if (!userCourse.answers[categoryKey]) userCourse.answers[categoryKey] = new Map();

    const categoryMap = userCourse.answers[categoryKey];

    // Get or create the exercises array for this subcategory
    let exercisesArray = categoryMap.get(subcategory) || [];
    if (exercisesArray.toObject) exercisesArray = exercisesArray.toObject();

    const exerciseIndex = exercisesArray.findIndex(
      ex => ex.exerciseId && ex.exerciseId.toString() === exerciseId
    );

    if (exerciseIndex > -1) {
      // Update existing entry
      exercisesArray[exerciseIndex].screenRecording = recordingUrl;
    } else {
      // Create a new entry just to store the recording
      exercisesArray.push({
        exerciseId: new mongoose.Types.ObjectId(exerciseId),
        status: 'in-progress',
        isLocked: false,
        questions: [],
        screenRecording: recordingUrl,
      });
    }

    categoryMap.set(subcategory, exercisesArray);
    user.markModified(`courses.${courseIndex}.answers.${categoryKey}`);
    await user.save();

    console.log(`✅ Assessment recording saved for user ${userId}, exercise ${exerciseId}`);
    return res.status(200).json({
      success: true,
      message: [{ key: 'success', value: 'Recording saved successfully' }],
      data: { recordingUrl },
    });
  } catch (error) {
    console.error('saveAssessmentRecording error:', error);
    return res.status(500).json({
      success: false,
      message: [{ key: 'error', value: 'Internal server error' }],
      error: error.message,
    });
  }
};


async function uploadBufferToSupabase(buffer, filePath, mimeType) {
  try {
    const { data, error } = await supabase.storage
      .from("smartlms")
      .upload(filePath, buffer, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    // Generate public URL
    const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/${filePath}`;

    return imageUrl;

  } catch (error) {
    console.error("❌ Buffer upload failed:", error);
    throw error;
  }
}

// Define the uploadImageToSupabase function if not already imported
async function uploadImageToSupabase(file, folderPath) {
  try {
    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `${timestamp}_${sanitizedName}`;
    const filePath = `question/${folderPath}/${fileName}`;

    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from("smartlms")
      .upload(filePath, file.data, {
        contentType: file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    // Generate public URL
    const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/${filePath}`;

    return imageUrl;

  } catch (error) {
    console.error("❌ Image upload failed:", error);
    throw error;
  }
}

exports.addQuestion = async (req, res) => {
  try {
    const { type, id, exerciseId } = req.params;
    const {
      tabType,
      subcategory,
      questionsData, // Accept array of questions
      questionType, // Keep for backward compatibility
      ...questionFields // Keep for backward compatibility
    } = req.body;

    // Handle file uploads if present
    let uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      uploadedFiles = req.files;
    }

    // Validate required parameters
    if (!type || !modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}. Valid types: modules, submodules, topics, subtopics` }]
      });
    }

    // Check if we have multiple questions or single question
    const isMultipleQuestions = Array.isArray(questionsData) && questionsData.length > 0;
    const questionsToAdd = isMultipleQuestions ? questionsData : [req.body];

    console.log(`📥 Processing ${questionsToAdd.length} question(s) to add`);

    // Validate all questions
    for (let i = 0; i < questionsToAdd.length; i++) {
      const questionData = questionsToAdd[i];
      const questionIndex = i + 1;

      // Get question type
      const qType = questionData.questionType || questionType;
      const validQuestionTypes = ['mcq', 'programming', 'database', 'others'];

      if (!qType || !validQuestionTypes.includes(qType)) {
        return res.status(400).json({
          message: [{ key: "error", value: `Invalid question type for question ${questionIndex}: ${qType}. Valid types: ${validQuestionTypes.join(', ')}` }]
        });
      }

      // Validate based on question type
      if (qType === 'mcq') {
        // Validate MCQ fields
        if (!questionData.questionTitle && !questionData.mcqQuestionTitle) {
          return res.status(400).json({
            message: [{ key: "error", value: `Question ${questionIndex}: MCQ question title is required` }]
          });
        }

        const options = questionData.options || questionData.mcqOptions;
        if (!Array.isArray(options) || options.length < 2) {
          return res.status(400).json({
            message: [{ key: "error", value: `Question ${questionIndex}: At least 2 options are required for MCQ` }]
          });
        }

        const correctAnswer = questionData.correctAnswer || questionData.mcqCorrectAnswer;
        if (!correctAnswer) {
          return res.status(400).json({
            message: [{ key: "error", value: `Question ${questionIndex}: Correct answer is required for MCQ` }]
          });
        }
      } else if (qType === 'programming') {
        // Validate Programming fields
        // title can be a plain string OR an array of content blocks (programmingQuestionTitle)
        const _progTitleText = typeof questionData.title === 'string' ? questionData.title.trim() : '';
        if (!_progTitleText) {
          return res.status(400).json({
            message: [{ key: "error", value: `Question ${questionIndex}: Programming question title is required` }]
          });
        }

        // Check if description exists and has text
        let descriptionText = '';
        if (questionData.description) {
          // New format: description is a ProgContentBlock[] array
          if (Array.isArray(questionData.description)) {
            descriptionText = questionData.description
              .filter(b => b.type === 'text' || b.type === 'image')
              .map(b => b.type === 'image' ? '[image]' : (b.value || ''))
              .join(' ')
              .replace(/<[^>]*>/g, '')
              .trim();
          } else if (typeof questionData.description === 'object') {
            // Legacy format: { text, imageUrl, contentBlocks }
            if (Array.isArray(questionData.description.contentBlocks) && questionData.description.contentBlocks.length > 0) {
              descriptionText = questionData.description.contentBlocks
                .filter(b => b.type === 'text' || b.type === 'image')
                .map(b => b.type === 'image' ? '[image]' : (b.value || ''))
                .join(' ')
                .replace(/<[^>]*>/g, '')
                .trim();
            } else {
              descriptionText = questionData.description.text || '';
            }
          } else {
            descriptionText = questionData.description;
          }
        }
        // Backward compat: also accept from programmingQuestionDescription
        if (!descriptionText && Array.isArray(questionData.programmingQuestionDescription)) {
          descriptionText = questionData.programmingQuestionDescription
            .filter(b => b.type === 'text')
            .map(b => b.value || '')
            .join(' ')
            .replace(/<[^>]*>/g, '')
            .trim();
        }

        if (!descriptionText || !descriptionText.trim()) {
          return res.status(400).json({
            message: [{ key: "error", value: `Question ${questionIndex}: Programming question description text is required` }]
          });
        }

        // Validate programming difficulty
        const validDifficulties = ['easy', 'medium', 'hard'];
        const difficulty = questionData.difficulty || 'medium';
        if (!validDifficulties.includes(difficulty)) {
          return res.status(400).json({
            message: [{ key: "error", value: `Question ${questionIndex}: Invalid difficulty. Valid values: ${validDifficulties.join(', ')}` }]
          });
        }
      }
    }

    // Get the model from modelMap
    const { model } = modelMap[type];

    if (!model) {
      return res.status(400).json({
        message: [{ key: "error", value: `Model not found for type: ${type}` }]
      });
    }

    // Find the entity
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} with ID ${id} not found` }]
      });
    }

    // Check if pedagogy exists
    if (!entity.pedagogy) {
      return res.status(404).json({
        message: [{ key: "error", value: "No pedagogy structure found in this entity" }]
      });
    }

    // Check if tabType exists
    if (!entity.pedagogy[tabType]) {
      return res.status(404).json({
        message: [{ key: "error", value: `No ${tabType} section found in pedagogy` }]
      });
    }

    // Convert Map to object if needed
    const tabData = entity.pedagogy[tabType] instanceof Map
      ? Object.fromEntries(entity.pedagogy[tabType])
      : entity.pedagogy[tabType];

    // Check if subcategory exists
    if (!tabData[subcategory]) {
      return res.status(404).json({
        message: [{ key: "error", value: `Subcategory "${subcategory}" not found in ${tabType}` }]
      });
    }

    const exercises = tabData[subcategory];

    if (!Array.isArray(exercises)) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid exercises format in subcategory "${subcategory}"` }]
      });
    }

    // Find the exercise by ID
    let foundExercise = null;
    let foundExerciseIndex = -1;

    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];

      // Check all possible ID fields
      const matches = (
        (exercise._id && exercise._id.toString() === exerciseId) ||
        (exercise.exerciseInformation?.exerciseId === exerciseId) ||
        (exercise.exerciseInformation?._id?.toString() === exerciseId)
      );

      if (matches) {
        foundExercise = exercise;
        foundExerciseIndex = i;
        break;
      }
    }

    if (!foundExercise) {
      console.error(`❌ Exercise with ID "${exerciseId}" not found in subcategory "${subcategory}"`);

      const availableExercises = exercises.map((ex, idx) => ({
        index: idx,
        _id: ex._id?.toString(),
        exerciseId: ex.exerciseInformation?.exerciseId,
        name: ex.exerciseInformation?.exerciseName,
        exerciseLevel: ex.exerciseInformation?.exerciseLevel,
        questionsCount: ex.questions?.length || 0
      }));

      return res.status(404).json({
        message: [{
          key: "error",
          value: `Exercise with ID "${exerciseId}" not found in subcategory "${subcategory}". Available exercises: ${availableExercises.length}`
        }],
        availableExercises
      });
    }

    // Initialize questions array if not exists
    if (!foundExercise.questions) {
      foundExercise.questions = [];
    }

    const addedQuestions = [];
    const startSequence = foundExercise.questions.length;

    // Add all questions
    for (let i = 0; i < questionsToAdd.length; i++) {
      const questionData = questionsToAdd[i];
      const qType = questionData.questionType || questionType;
      const questionId = new mongoose.Types.ObjectId();

      // Create base question object
      // Create base question object
      const newQuestion = {
        _id: questionId,
        questionType: qType,
        sectionId: questionData.sectionId || null, // ✅ ADD THIS LINE
        isActive: questionData.isActive !== undefined ? questionData.isActive : true,
        sequence: startSequence + i,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      // Add fields based on question type
      if (qType === 'mcq') {
        // Process MCQ options
        const options = questionData.options || questionData.mcqOptions || [];
        const processedOptions = [];

        for (let optIndex = 0; optIndex < options.length; optIndex++) {
          const option = options[optIndex];

          let optionText = '';
          let isCorrect = false;
          let imageUrl = null;
          let imageAlignment = 'left';
          let imageSizePercent = 100;

          if (typeof option === 'string') {
            optionText = option;
            const correctAnswer = questionData.correctAnswer || questionData.mcqCorrectAnswer;
            isCorrect = (parseInt(correctAnswer) === optIndex) || (correctAnswer === option);
          } else if (typeof option === 'object' && option !== null) {
            optionText = option.text || '';
            isCorrect = option.isCorrect || false;
            imageUrl = option.imageUrl || null;
            imageAlignment = option.imageAlignment || 'left';
            imageSizePercent = option.imageSizePercent || 100;

            // Handle base64 image if present (from frontend editor)
            if (option.imageUrl && option.imageUrl.startsWith('data:image')) {
              try {
                // Convert base64 to buffer and upload to Supabase
                const base64Data = option.imageUrl.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');
                const fileName = `mcq_option_${Date.now()}_${optIndex}.png`;
                const filePath = `${entity._id}/${exerciseId}/${questionId}/options/${fileName}`;

                const uploadedImageUrl = await uploadBufferToSupabase(
                  buffer,
                  filePath,
                  'image/png'
                );
                imageUrl = uploadedImageUrl;
              } catch (uploadError) {
                console.error(`Error uploading base64 image for option ${optIndex}:`, uploadError);
              }
            }
          }

          processedOptions.push({
            _id: new mongoose.Types.ObjectId(),
            text: optionText,
            isCorrect: isCorrect,
            imageUrl: imageUrl,
            imageAlignment: imageAlignment,
            imageSizePercent: imageSizePercent
          });
        }

        Object.assign(newQuestion, {
          questionTitle: questionData.questionTitle || questionData.mcqQuestionTitle || '',
          options: processedOptions,
          correctAnswer: questionData.correctAnswer || questionData.mcqCorrectAnswer || '',
        });

      } else if (qType === 'programming') {
        // Handle description with potential base64 image
        let imageUrl = null;

        // Check if description contains base64 image
        if (questionData.description && questionData.description.imageUrl) {
          const imageData = questionData.description.imageUrl;

          if (imageData.startsWith('data:image')) {
            try {
              // Extract base64 data
              const matches = imageData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
              if (matches && matches.length === 3) {
                const mimeType = matches[1];
                const base64Data = matches[2];
                const buffer = Buffer.from(base64Data, 'base64');

                // Determine file extension
                const extension = mimeType.split('/')[1] || 'png';
                const fileName = `question_image_${Date.now()}.${extension}`;
                const filePath = `${entity._id}/${exerciseId}/${questionId}/${fileName}`;

                // Upload to Supabase
                const uploadedImageUrl = await uploadBufferToSupabase(
                  buffer,
                  filePath,
                  mimeType
                );
                imageUrl = uploadedImageUrl;
              }
            } catch (uploadError) {
              console.error('Error uploading base64 image:', uploadError);
            }
          } else {
            // Already a URL
            imageUrl = questionData.description.imageUrl;
          }
        }

        const descriptionObj = {
          text: questionData.description?.text || questionData.description || '',
          imageUrl: imageUrl,
          imageAlignment: questionData.description?.imageAlignment || 'left',
          imageSizePercent: questionData.description?.imageSizePercent || 100
        };

        // Extract plain-text title for search/display; store rich blocks separately
        const _plainTitle = typeof questionData.title === 'string'
          ? questionData.title.trim()
          : (Array.isArray(questionData.programmingQuestionTitle)
            ? questionData.programmingQuestionTitle.filter(b => b.type === 'text').map(b => b.value || '').join(' ').trim()
            : '');

        Object.assign(newQuestion, {
          title: _plainTitle,
          // Store rich title blocks separately for rendering
          programmingQuestionTitle: Array.isArray(questionData.programmingQuestionTitle)
            ? questionData.programmingQuestionTitle
            : undefined,
          // Store rich description blocks array for rendering
          programmingQuestionDescription: Array.isArray(questionData.programmingQuestionDescription)
            ? questionData.programmingQuestionDescription
            : undefined,
          description: descriptionObj,
          difficulty: questionData.difficulty || 'medium',
          sampleInput: questionData.sampleInput || '',
          sampleOutput: questionData.sampleOutput || '',
          score: questionData.score || 0,
          constraints: Array.isArray(questionData.constraints) && questionData.constraints.length > 0
            ? questionData.constraints.filter(c => c && c.trim())
            : undefined,
          hints: Array.isArray(questionData.hints) && questionData.hints.length > 0
            ? questionData.hints.map((hint, index) => ({
              _id: new mongoose.Types.ObjectId(),
              hintText: hint.hintText || hint,
              pointsDeduction: hint.pointsDeduction || 0,
              isPublic: hint.isPublic !== undefined ? hint.isPublic : true,
              sequence: hint.sequence || index
            }))
            : undefined,
          testCases: Array.isArray(questionData.testCases) && questionData.testCases.length > 0
            ? questionData.testCases.map((testCase, index) => ({
              _id: new mongoose.Types.ObjectId(),
              input: testCase.input || '',
              expectedOutput: testCase.expectedOutput || '',
              isSample: testCase.isSample !== undefined ? testCase.isSample : false,
              isHidden: testCase.isHidden !== undefined ? testCase.isHidden : true,
              points: testCase.points || 1,
              explanation: testCase.explanation || `Test case ${index + 1}`,
              sequence: testCase.sequence || index
            }))
            : undefined,
          solutions: questionData.solutions && typeof questionData.solutions === 'object'
            ? {
              startedCode: questionData.solutions.startedCode || '',
              functionName: questionData.solutions.functionName || '',
              language: questionData.solutions.language || ''
            }
            : undefined,
          timeLimit: questionData.timeLimit || 2000,
          memoryLimit: questionData.memoryLimit || 256,
        });

        // Remove undefined fields
        Object.keys(newQuestion).forEach(key => {
          if (newQuestion[key] === undefined) {
            delete newQuestion[key];
          }
        });

      } else if (qType === 'database') {
        // Handle description with contentBlocks
        const descObj = typeof questionData.description === 'object'
          ? questionData.description
          : { text: questionData.description || '', contentBlocks: [] };

        Object.assign(newQuestion, {
          title: typeof questionData.title === 'string' ? questionData.title.trim() : '',
          description: {
            text: descObj.text || '',
            imageUrl: descObj.imageUrl || null,
            imageAlignment: descObj.imageAlignment || 'left',
            imageSizePercent: descObj.imageSizePercent || 100,
            contentBlocks: Array.isArray(descObj.contentBlocks) ? descObj.contentBlocks : [],
          },
          sampleQuery: questionData.sampleQuery || '',
          sampleResult: Array.isArray(questionData.sampleResult)
            ? questionData.sampleResult
            : (questionData.sampleResult ? [{ type: 'text', value: String(questionData.sampleResult) }] : []),
          difficulty: questionData.difficulty || 'medium',
          score: questionData.score || questionData.points || 0,
          points: questionData.score || questionData.points || 0,
          isDatabase: true,
          moduleType: 'Database',
          constraints: Array.isArray(questionData.constraints)
            ? questionData.constraints.filter(c => c && c.trim())
            : [],
          hints: Array.isArray(questionData.hints) && questionData.hints.length > 0
            ? questionData.hints.map((hint, index) => ({
              _id: new mongoose.Types.ObjectId(),
              hintText: hint.hintText || hint,
              pointsDeduction: hint.pointsDeduction || 0,
              isPublic: hint.isPublic !== undefined ? hint.isPublic : true,
              sequence: hint.sequence || index,
            }))
            : undefined,
        });
      } else if (qType === 'others') {
        // Build othersDescription object with text, html, images, and attachments
        const othersDescription = {
          text: "",
          html: "",
          images: [],
          attachments: []
        };

        // Process description from the request
        if (questionData.description) {
          // If description is a string (HTML with image)
          if (typeof questionData.description === 'string') {
            othersDescription.html = questionData.description;
            // Strip HTML tags for plain text
            othersDescription.text = questionData.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

            // Extract images from HTML
            const imgRegex = /<img[^>]+src="([^">]+)"[^>]*(?:alt="([^">]*)")?[^>]*>/gi;
            let match;
            while ((match = imgRegex.exec(questionData.description)) !== null) {
              // Extract style attribute if present
              const styleMatch = questionData.description.match(/style="([^"]+)"/);

              othersDescription.images.push({
                url: match[1],
                alt: match[2] || "",
                alignment: "left",
                style: styleMatch ? styleMatch[1] : "max-width:100%;border-radius:6px;margin-top:8px;",
                width: "100%",
                height: "auto"
              });
            }
          }
          // If description is already an object
          else if (typeof questionData.description === 'object' && questionData.description !== null) {
            othersDescription.text = questionData.description.text || "";
            othersDescription.html = questionData.description.html || "";
            othersDescription.images = questionData.description.images || [];
            othersDescription.attachments = questionData.description.attachments || [];
          }
        }

        // Process attachments from root level and add to othersDescription
        if (Array.isArray(questionData.attachments) && questionData.attachments.length > 0) {
          for (const att of questionData.attachments) {
            // Determine icon based on mime type
            let icon = "📎";
            const mimeType = att.mimeType || "";
            if (mimeType.includes('pdf')) icon = "📄";
            else if (mimeType.includes('word') || mimeType.includes('docx') || mimeType.includes('document')) icon = "📝";
            else if (mimeType.includes('image')) icon = "🖼️";
            else if (mimeType.includes('video')) icon = "🎥";
            else if (mimeType.includes('audio')) icon = "🎵";
            else if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) icon = "📊";
            else if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) icon = "📽️";
            else if (mimeType.includes('zip') || mimeType.includes('compressed')) icon = "🗜️";
            else if (mimeType.includes('text')) icon = "📃";

            othersDescription.attachments.push({
              name: att.name || "untitled",
              url: att.url || "",
              mimeType: mimeType || "application/octet-stream",
              size: att.size || 0,
              icon: icon,
              description: att.description || "",
              uploadedAt: new Date()
            });
          }
        }

        // Process file upload settings
        const fileUploadSettings = {
          allowMultiple: questionData.fileUploadSettings?.allowMultiple || false,
          maxFiles: questionData.fileUploadSettings?.maxFiles || 1,
          maxFileSizeMB: questionData.fileUploadSettings?.maxFileSizeMB || 10,
          allowedTypes: Array.isArray(questionData.fileUploadSettings?.allowedTypes)
            ? questionData.fileUploadSettings.allowedTypes
            : ["pdf", "docx"],
          requiredFormats: Array.isArray(questionData.fileUploadSettings?.requiredFormats)
            ? questionData.fileUploadSettings.requiredFormats
            : [],
          instructions: questionData.fileUploadSettings?.instructions || ""
        };

        Object.assign(newQuestion, {
          title: typeof questionData.title === 'string' ? questionData.title.trim() : '',
          othersDescription: othersDescription,
          difficulty: questionData.difficulty || 'medium',
          score: questionData.score || 0,
          isRequired: questionData.isRequired !== undefined ? questionData.isRequired : true,
          othersQuestionType: questionData.othersQuestionType || 'file-upload',
          fileUploadSettings: fileUploadSettings,
          scoringType: questionData.scoringType || 'levelBased',
          questionCountPerLevel: questionData.questionCountPerLevel || {
            easy: 2,
            medium: 2,
            hard: 2
          },
          totalMarks: questionData.totalMarks || 50,
          notionSettings: questionData.notionSettings || undefined
        });

        console.log('✅ Others question processed:', {
          title: newQuestion.title,
          descriptionHasImages: othersDescription.images.length,
          descriptionHasAttachments: othersDescription.attachments.length,
          attachmentsDetails: othersDescription.attachments.map(a => ({ name: a.name, mimeType: a.mimeType }))
        });
      }
      // Add question to exercise
      foundExercise.questions.push(newQuestion);
      addedQuestions.push({
        question: newQuestion,
        index: startSequence + i
      });
    }

    // Update the exercise in the array
    exercises[foundExerciseIndex] = foundExercise;

    // Update the entity's pedagogy structure
    if (entity.pedagogy[tabType] instanceof Map) {
      entity.pedagogy[tabType].set(subcategory, exercises);
    } else {
      entity.pedagogy[tabType][subcategory] = exercises;
    }

    // Mark as modified
    entity.markModified(`pedagogy.${tabType}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}.${foundExerciseIndex}.questions`);

    // Update timestamps
    entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
    entity.updatedAt = new Date();

    // Save entity
    await entity.save();

    // Prepare response data
    const responseData = {
   addedQuestions: addedQuestions.map(q => ({
  questionId: q.question._id.toString(),
  questionTitle: q.question.questionTitle || q.question.title,
  questionType: q.question.questionType,
  sectionId: q.question.sectionId, // ✅ ADD THIS LINE
  sequence: q.index,
        description: q.question.description ? {
          text: q.question.description.text,
          imageUrl: q.question.description.imageUrl,
          imageAlignment: q.question.description.imageAlignment,
          imageSizePercent: q.question.description.imageSizePercent
        } : undefined
      })),
      totalAdded: addedQuestions.length,
      exercise: {
        exerciseId: foundExercise.exerciseInformation?.exerciseId || foundExercise._id.toString(),
        exerciseName: foundExercise.exerciseInformation?.exerciseName || "Exercise",
        exerciseLevel: foundExercise.exerciseInformation?.exerciseLevel || "medium",
        totalQuestions: foundExercise.questions.length,
        totalScore: foundExercise.questions.reduce((sum, q) => sum + (q.score || 0), 0)
      },
      entity: {
        type: type,
        id: entity._id.toString(),
        title: entity.title || entity.name || "Entity"
      },
      location: {
        tabType: tabType,
        subcategory: subcategory,
        exerciseIndex: foundExerciseIndex,
        exerciseId: foundExercise._id.toString(),
        startQuestionIndex: startSequence
      }
    };

    return res.status(201).json({
      message: [{
        key: "success",
        value: `Added ${addedQuestions.length} question(s) successfully to "${foundExercise.exerciseInformation?.exerciseName}" in ${subcategory}`
      }],
      data: responseData
    });

  } catch (err) {
    console.error("❌ Add questions error:", err);
    console.error("❌ Error stack:", err.stack);

    res.status(500).json({
      message: [{
        key: "error",
        value: `Internal server error: ${err.message}`
      }],
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};


// Update question
// Update question
exports.updateQuestion = async (req, res) => {
  try {
    const { type, id, exerciseId, questionId } = req.params;
    const {
      tabType,
      subcategory,
      questionData,
      ...questionFields // Keep for backward compatibility
    } = req.body;

    // Handle file uploads if present
    let uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      uploadedFiles = req.files;
    }

    // Validate required parameters
    if (!type || !modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}. Valid types: modules, submodules, topics, subtopics` }]
      });
    }

    if (!questionId) {
      return res.status(400).json({
        message: [{ key: "error", value: "Question ID is required" }]
      });
    }

    // Get the data to update (either from questionData object or from req.body directly)
    const updateData = questionData || req.body;

    // FIX: Rename this variable to avoid conflict with the parameter
    const questionTypeValue = updateData.questionType;  // ← CHANGED: was 'questionType'

    const validQuestionTypes = ['mcq', 'programming', 'database', 'others'];

    if (questionTypeValue && !validQuestionTypes.includes(questionTypeValue)) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid question type: ${questionTypeValue}. Valid types: ${validQuestionTypes.join(', ')}` }]
      });
    }

    // Validate based on question type if validation fields are provided
    if (questionTypeValue === 'mcq') {
      // Validate MCQ fields if they are being updated
      if (updateData.questionTitle !== undefined || updateData.mcqQuestionTitle !== undefined) {
        const questionTitle = updateData.questionTitle || updateData.mcqQuestionTitle;
        if (!questionTitle || !questionTitle.trim()) {
          return res.status(400).json({
            message: [{ key: "error", value: "MCQ question title cannot be empty" }]
          });
        }
      }

      if (updateData.options !== undefined || updateData.mcqOptions !== undefined) {
        const options = updateData.options || updateData.mcqOptions;
        if (!Array.isArray(options) || options.length < 2) {
          return res.status(400).json({
            message: [{ key: "error", value: "At least 2 options are required for MCQ" }]
          });
        }
      }

      if (updateData.correctAnswer !== undefined || updateData.mcqCorrectAnswer !== undefined) {
        const correctAnswer = updateData.correctAnswer || updateData.mcqCorrectAnswer;
        if (!correctAnswer && correctAnswer !== 0) {
          return res.status(400).json({
            message: [{ key: "error", value: "Correct answer is required for MCQ" }]
          });
        }
      }
    } else if (questionTypeValue === 'programming') {
      // Validate Programming fields if they are being updated
      if (updateData.title !== undefined) {
        if (!updateData.title || !updateData.title.trim()) {
          return res.status(400).json({
            message: [{ key: "error", value: "Programming question title cannot be empty" }]
          });
        }
      }

      // Check if description is being updated and validate
      if (updateData.description !== undefined) {
        let descriptionText = '';
        if (Array.isArray(updateData.description)) {
          // New format: ProgContentBlock[] array
          descriptionText = updateData.description
            .filter(b => b.type === 'text' || b.type === 'image')
            .map(b => b.type === 'image' ? '[image]' : (b.value || ''))
            .join(' ')
            .replace(/<[^>]*>/g, '')
            .trim();
        } else if (typeof updateData.description === 'object' && updateData.description !== null) {
          // Legacy format
          if (Array.isArray(updateData.description.contentBlocks) && updateData.description.contentBlocks.length > 0) {
            descriptionText = updateData.description.contentBlocks
              .filter(b => b.type === 'text' || b.type === 'image')
              .map(b => b.type === 'image' ? '[image]' : (b.value || ''))
              .join(' ')
              .replace(/<[^>]*>/g, '')
              .trim();
          } else {
            descriptionText = updateData.description.text || '';
          }
        } else {
          descriptionText = updateData.description || '';
        }

        if (!descriptionText || !descriptionText.trim()) {
          return res.status(400).json({
            message: [{ key: "error", value: "Programming question description text cannot be empty" }]
          });
        }
      }

      // Validate programming difficulty if being updated
      if (updateData.difficulty !== undefined) {
        const validDifficulties = ['easy', 'medium', 'hard'];
        if (!validDifficulties.includes(updateData.difficulty)) {
          return res.status(400).json({
            message: [{ key: "error", value: `Invalid difficulty. Valid values: ${validDifficulties.join(', ')}` }]
          });
        }
      }
    }

    // Get the model from modelMap
    const { model } = modelMap[type];

    if (!model) {
      return res.status(400).json({
        message: [{ key: "error", value: `Model not found for type: ${type}` }]
      });
    }

    // Find the entity
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} with ID ${id} not found` }]
      });
    }

    // Check if pedagogy exists
    if (!entity.pedagogy) {
      return res.status(404).json({
        message: [{ key: "error", value: "No pedagogy structure found in this entity" }]
      });
    }

    // Check if tabType exists
    if (!entity.pedagogy[tabType]) {
      return res.status(404).json({
        message: [{ key: "error", value: `No ${tabType} section found in pedagogy` }]
      });
    }

    // Convert Map to object if needed
    const tabData = entity.pedagogy[tabType] instanceof Map
      ? Object.fromEntries(entity.pedagogy[tabType])
      : entity.pedagogy[tabType];

    // Check if subcategory exists
    if (!tabData[subcategory]) {
      return res.status(404).json({
        message: [{ key: "error", value: `Subcategory "${subcategory}" not found in ${tabType}` }]
      });
    }

    const exercises = tabData[subcategory];

    if (!Array.isArray(exercises)) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid exercises format in subcategory "${subcategory}"` }]
      });
    }

    // Find the exercise by ID
    let foundExercise = null;
    let foundExerciseIndex = -1;

    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];

      // Check all possible ID fields
      const matches = (
        (exercise._id && exercise._id.toString() === exerciseId) ||
        (exercise.exerciseInformation?.exerciseId === exerciseId) ||
        (exercise.exerciseInformation?._id?.toString() === exerciseId)
      );

      if (matches) {
        foundExercise = exercise;
        foundExerciseIndex = i;
        break;
      }
    }

    if (!foundExercise) {
      console.error(`❌ Exercise with ID "${exerciseId}" not found in subcategory "${subcategory}"`);

      const availableExercises = exercises.map((ex, idx) => ({
        index: idx,
        _id: ex._id?.toString(),
        exerciseId: ex.exerciseInformation?.exerciseId,
        name: ex.exerciseInformation?.exerciseName,
        exerciseLevel: ex.exerciseInformation?.exerciseLevel,
        questionsCount: ex.questions?.length || 0
      }));

      return res.status(404).json({
        message: [{
          key: "error",
          value: `Exercise with ID "${exerciseId}" not found in subcategory "${subcategory}". Available exercises: ${availableExercises.length}`
        }],
        availableExercises
      });
    }

    // Check if questions array exists
    if (!foundExercise.questions || !Array.isArray(foundExercise.questions)) {
      return res.status(404).json({
        message: [{ key: "error", value: "No questions found in this exercise" }]
      });
    }

    // Find the question to update
    const questionIndex = foundExercise.questions.findIndex(q =>
      q._id.toString() === questionId
    );

    if (questionIndex === -1) {
      return res.status(404).json({
        message: [{ key: "error", value: `Question with ID ${questionId} not found in exercise` }]
      });
    }

    const existingQuestion = foundExercise.questions[questionIndex];
    // FIX: Use the renamed variable here
    const finalQuestionType = questionTypeValue || existingQuestion.questionType;

    // Create updated question object by merging existing with new data
    const updatedQuestion = { ...existingQuestion.toObject ? existingQuestion.toObject() : existingQuestion };

    // Update common fields
  // Update common fields
if (updateData.isActive !== undefined) {
  updatedQuestion.isActive = updateData.isActive;
}
if (updateData.sectionId !== undefined) {
  updatedQuestion.sectionId = updateData.sectionId; // ✅ ADD THIS
}

    // Update based on question type
    if (finalQuestionType === 'mcq') {
      // Update MCQ fields
      if (updateData.questionTitle !== undefined || updateData.mcqQuestionTitle !== undefined) {
        updatedQuestion.questionTitle = updateData.questionTitle || updateData.mcqQuestionTitle || '';
      }

      // Process MCQ options if provided
      if (updateData.options !== undefined || updateData.mcqOptions !== undefined) {
        const options = updateData.options || updateData.mcqOptions || [];
        const processedOptions = [];

        for (let optIndex = 0; optIndex < options.length; optIndex++) {
          const option = options[optIndex];

          let optionText = '';
          let isCorrect = false;
          let imageUrl = null;
          let imageAlignment = 'left';
          let imageSizePercent = 100;

          if (typeof option === 'string') {
            optionText = option;
            const correctAnswer = updateData.correctAnswer || updateData.mcqCorrectAnswer;
            if (correctAnswer !== undefined) {
              isCorrect = (parseInt(correctAnswer) === optIndex) || (correctAnswer === option);
            } else {
              // Keep existing isCorrect value if not updating correctAnswer
              isCorrect = updatedQuestion.options[optIndex]?.isCorrect || false;
            }
          } else if (typeof option === 'object' && option !== null) {
            optionText = option.text || '';
            isCorrect = option.isCorrect !== undefined ? option.isCorrect : (updatedQuestion.options[optIndex]?.isCorrect || false);
            imageUrl = option.imageUrl || updatedQuestion.options[optIndex]?.imageUrl || null;
            imageAlignment = option.imageAlignment || updatedQuestion.options[optIndex]?.imageAlignment || 'left';
            imageSizePercent = option.imageSizePercent || updatedQuestion.options[optIndex]?.imageSizePercent || 100;

            // Handle base64 image if present (from frontend editor)
            if (option.imageUrl && option.imageUrl.startsWith('data:image')) {
              try {
                // Convert base64 to buffer and upload to Supabase
                const base64Data = option.imageUrl.split(',')[1];
                const buffer = Buffer.from(base64Data, 'base64');
                const fileName = `mcq_option_${Date.now()}_${optIndex}.png`;
                const filePath = `${entity._id}/${exerciseId}/${questionId}/options/${fileName}`;

                const uploadedImageUrl = await uploadBufferToSupabase(
                  buffer,
                  filePath,
                  'image/png'
                );
                imageUrl = uploadedImageUrl;
              } catch (uploadError) {
                console.error(`Error uploading base64 image for option ${optIndex}:`, uploadError);
              }
            }
          }

          processedOptions.push({
            _id: updatedQuestion.options[optIndex]?._id || new mongoose.Types.ObjectId(),
            text: optionText,
            isCorrect: isCorrect,
            imageUrl: imageUrl,
            imageAlignment: imageAlignment,
            imageSizePercent: imageSizePercent
          });
        }

        updatedQuestion.options = processedOptions;
      }

      if (updateData.correctAnswer !== undefined || updateData.mcqCorrectAnswer !== undefined) {
        updatedQuestion.correctAnswer = updateData.correctAnswer || updateData.mcqCorrectAnswer || '';
      }

    } else if (finalQuestionType === 'programming') {
      // Update Programming fields
      if (updateData.title !== undefined) {
        updatedQuestion.title = typeof updateData.title === 'string'
          ? updateData.title.trim()
          : (updatedQuestion.title || '');
      }

      // Handle description with potential base64 image
      if (updateData.description !== undefined) {
        let imageUrl = updatedQuestion.description?.imageUrl || null;

        // Check if description contains base64 image
        if (updateData.description && updateData.description.imageUrl) {
          const imageData = updateData.description.imageUrl;

          if (imageData.startsWith('data:image')) {
            try {
              // Extract base64 data
              const matches = imageData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
              if (matches && matches.length === 3) {
                const mimeType = matches[1];
                const base64Data = matches[2];
                const buffer = Buffer.from(base64Data, 'base64');

                // Determine file extension
                const extension = mimeType.split('/')[1] || 'png';
                const fileName = `question_image_${Date.now()}.${extension}`;
                const filePath = `${entity._id}/${exerciseId}/${questionId}/${fileName}`;

                // Upload to Supabase
                const uploadedImageUrl = await uploadBufferToSupabase(
                  buffer,
                  filePath,
                  mimeType
                );
                imageUrl = uploadedImageUrl;
              }
            } catch (uploadError) {
              console.error('Error uploading base64 image:', uploadError);
            }
          } else if (imageData !== updatedQuestion.description?.imageUrl) {
            // Only update if it's a new URL (not the same as existing)
            imageUrl = imageData;
          }
        }

        const descriptionObj = {
          text: updateData.description?.text !== undefined ? updateData.description.text : (updatedQuestion.description?.text || ''),
          imageUrl: imageUrl,
          imageAlignment: updateData.description?.imageAlignment !== undefined ? updateData.description.imageAlignment : (updatedQuestion.description?.imageAlignment || 'left'),
          imageSizePercent: updateData.description?.imageSizePercent !== undefined ? updateData.description.imageSizePercent : (updatedQuestion.description?.imageSizePercent || 100)
        };

        updatedQuestion.description = descriptionObj;
      }

      if (updateData.difficulty !== undefined) {
        updatedQuestion.difficulty = updateData.difficulty;
      }

      if (updateData.sampleInput !== undefined) {
        updatedQuestion.sampleInput = updateData.sampleInput;
      }

      if (updateData.sampleOutput !== undefined) {
        updatedQuestion.sampleOutput = updateData.sampleOutput;
      }

      if (updateData.score !== undefined) {
        updatedQuestion.score = updateData.score;
      }

      // Update constraints if provided
      if (updateData.constraints !== undefined) {
        updatedQuestion.constraints = Array.isArray(updateData.constraints) && updateData.constraints.length > 0
          ? updateData.constraints.filter(c => c && c.trim())
          : undefined;
      }

      // Update hints if provided
      if (updateData.hints !== undefined) {
        if (Array.isArray(updateData.hints) && updateData.hints.length > 0) {
          updatedQuestion.hints = updateData.hints.map((hint, index) => ({
            _id: hint._id || new mongoose.Types.ObjectId(),
            hintText: hint.hintText || hint,
            pointsDeduction: hint.pointsDeduction || 0,
            isPublic: hint.isPublic !== undefined ? hint.isPublic : true,
            sequence: hint.sequence || index
          }));
        } else {
          updatedQuestion.hints = undefined;
        }
      }

      // Update test cases if provided
      if (updateData.testCases !== undefined) {
        if (Array.isArray(updateData.testCases) && updateData.testCases.length > 0) {
          updatedQuestion.testCases = updateData.testCases.map((testCase, index) => ({
            _id: testCase._id || new mongoose.Types.ObjectId(),
            input: testCase.input || '',
            expectedOutput: testCase.expectedOutput || '',
            isSample: testCase.isSample !== undefined ? testCase.isSample : false,
            isHidden: testCase.isHidden !== undefined ? testCase.isHidden : true,
            points: testCase.points || 1,
            explanation: testCase.explanation || `Test case ${index + 1}`,
            sequence: testCase.sequence || index
          }));
        } else {
          updatedQuestion.testCases = undefined;
        }
      }

      // Update solutions if provided
      if (updateData.solutions !== undefined) {
        if (updateData.solutions && typeof updateData.solutions === 'object') {
          updatedQuestion.solutions = {
            startedCode: updateData.solutions.startedCode !== undefined ? updateData.solutions.startedCode : (updatedQuestion.solutions?.startedCode || ''),
            functionName: updateData.solutions.functionName !== undefined ? updateData.solutions.functionName : (updatedQuestion.solutions?.functionName || ''),
            language: updateData.solutions.language !== undefined ? updateData.solutions.language : (updatedQuestion.solutions?.language || '')
          };
        } else {
          updatedQuestion.solutions = undefined;
        }
      }

      if (updateData.timeLimit !== undefined) {
        updatedQuestion.timeLimit = updateData.timeLimit;
      }

      if (updateData.memoryLimit !== undefined) {
        updatedQuestion.memoryLimit = updateData.memoryLimit;
      }
    } else if (finalQuestionType === 'database') {
      // Update Database fields
      if (updateData.title !== undefined) {
        updatedQuestion.title = updateData.title.trim();
      }

      if (updateData.description !== undefined) {
        const descObj = typeof updateData.description === 'object'
          ? updateData.description
          : { text: updateData.description || '' };
        updatedQuestion.description = {
          text: descObj.text || updatedQuestion.description?.text || '',
          imageUrl: descObj.imageUrl !== undefined ? descObj.imageUrl : (updatedQuestion.description?.imageUrl || null),
          imageAlignment: descObj.imageAlignment || updatedQuestion.description?.imageAlignment || 'left',
          imageSizePercent: descObj.imageSizePercent || updatedQuestion.description?.imageSizePercent || 100,
          contentBlocks: Array.isArray(descObj.contentBlocks) ? descObj.contentBlocks : (updatedQuestion.description?.contentBlocks || []),
        };
      }

      if (updateData.sampleQuery !== undefined) {
        updatedQuestion.sampleQuery = updateData.sampleQuery;
      }

      if (updateData.sampleResult !== undefined) {
        updatedQuestion.sampleResult = Array.isArray(updateData.sampleResult)
          ? updateData.sampleResult
          : [{ type: 'text', value: String(updateData.sampleResult) }];
      }

      if (updateData.difficulty !== undefined) {
        updatedQuestion.difficulty = updateData.difficulty;
      }

      if (updateData.score !== undefined || updateData.points !== undefined) {
        updatedQuestion.score = updateData.score || updateData.points || 0;
        updatedQuestion.points = updatedQuestion.score;
      }

      if (updateData.constraints !== undefined) {
        updatedQuestion.constraints = Array.isArray(updateData.constraints)
          ? updateData.constraints.filter(c => c && c.trim())
          : [];
      }

      if (updateData.hints !== undefined) {
        if (Array.isArray(updateData.hints) && updateData.hints.length > 0) {
          updatedQuestion.hints = updateData.hints.map((hint, index) => ({
            _id: hint._id || new mongoose.Types.ObjectId(),
            hintText: hint.hintText || hint,
            pointsDeduction: hint.pointsDeduction || 0,
            isPublic: hint.isPublic !== undefined ? hint.isPublic : true,
            sequence: hint.sequence || index,
          }));
        } else {
          updatedQuestion.hints = [];
        }
      }

      // Preserve database flags
      updatedQuestion.isDatabase = true;
      updatedQuestion.moduleType = 'Database';
      //     } else if (finalExerciseType === 'Other' && parsedQuesConfig) {
      //   const othersCfg = parsedQuesConfig.othersQuestionConfiguration 
      //     || parsedQuesConfig.othersConfig
      //     || null;

      //   if (othersCfg) {
      //     const qConfigType = othersCfg.questionConfigType || 'general';
      //     const exInfo = parsedExerciseInfo || existingExercise.exerciseInformation || {};

      //     let othersTotal = 0;

      //     if (qConfigType === 'general') {
      //       const evenMarks = othersCfg.generalMarksPerQuestion 
      //         || othersCfg.scoreSettings?.evenMarks 
      //         || 0;
      //       othersTotal = (othersCfg.generalQuestionCount || 0) * evenMarks;
      //     } else {
      //       const counts = qConfigType === 'selectionLevel'
      //         ? othersCfg.selectionLevelCounts
      //         : othersCfg.levelBasedCounts;
      //       const levelScoring = othersCfg.scoreSettings?.levelScoringConfiguration;

      //       if (levelScoring) {
      //         ['easy', 'medium', 'hard'].forEach(l => {
      //           const c = counts?.[l] || 0;
      //           if (!c) return;
      //           const s = levelScoring[l];
      //           if (!s) return;
      //           if (s.type === 'level_specific' && s.marksPerQuestion) othersTotal += c * s.marksPerQuestion;
      //           else if (s.type === 'question_specific' && s.totalMarks) othersTotal += s.totalMarks;
      //         });
      //       }
      //     }

      //     if (!othersTotal) {
      //       othersTotal = othersCfg.scoreSettings?.totalMarks 
      //         || exInfo.totalMarks 
      //         || existingExercise.exerciseInformation?.totalMarks 
      //         || 0;
      //     }

      //     let levelBasedMarks = { easy: 0, medium: 0, hard: 0 };
      //     const levelScoringConfig = othersCfg.scoreSettings?.levelScoringConfiguration;

      //     if (levelScoringConfig && (qConfigType === 'levelBased' || qConfigType === 'selectionLevel')) {
      //       const counts = qConfigType === 'selectionLevel'
      //         ? othersCfg.selectionLevelCounts
      //         : othersCfg.levelBasedCounts;
      //       ['easy', 'medium', 'hard'].forEach(l => {
      //         const c = counts?.[l] || 0;
      //         if (!c) return;
      //         const s = levelScoringConfig[l];
      //         if (s?.type === 'level_specific' && s.marksPerQuestion) {
      //           levelBasedMarks[l] = s.marksPerQuestion;
      //           if (!levelScoringConfig[l].questionCount) levelScoringConfig[l].questionCount = c;
      //         } else if (s?.type === 'question_specific' && s.totalMarks) {
      //           levelBasedMarks[l] = c > 0 ? s.totalMarks / c : 0;
      //           if (!levelScoringConfig[l].questionCount) levelScoringConfig[l].questionCount = c;
      //         }
      //       });
      //     }

      //     othersQuestionConfig = {
      //       questionConfigType: qConfigType,
      //       ...(qConfigType === 'general' && {
      //         generalQuestionCount: othersCfg.generalQuestionCount || 0,
      //         generalMarksPerQuestion: othersCfg.generalMarksPerQuestion 
      //           || othersCfg.scoreSettings?.evenMarks 
      //           || 0,
      //       }),
      //       ...(qConfigType === 'levelBased' && {
      //         levelBasedCounts: othersCfg.levelBasedCounts || { easy: 0, medium: 0, hard: 0 },
      //       }),
      //       ...(qConfigType === 'selectionLevel' && {
      //         selectionLevelCounts: othersCfg.selectionLevelCounts || { easy: 0, medium: 0, hard: 0 },
      //       }),
      //       scoreSettings: {
      //         scoreType: qConfigType === 'general' ? 'evenMarks' : 'levelBasedMarks',
      //         evenMarks: othersCfg.generalMarksPerQuestion || othersCfg.scoreSettings?.evenMarks || 0,
      //         levelBasedMarks,
      //         levelScoringConfiguration: levelScoringConfig || undefined,
      //         totalMarks: othersTotal,
      //       },
      //       questionFlow: othersCfg.questionFlow || 'freeFlow',
      //       attemptLimitEnabled: othersCfg.attemptLimitEnabled || false,
      //       submissionAttempts: othersCfg.submissionAttempts || 1,
      //     };

      //     progTotalMarks = othersTotal;
      //   }
      // }
    } else if (finalQuestionType === 'others') {
      // Update Others question fields
      if (updateData.title !== undefined) {
        updatedQuestion.title = updateData.title;
      }
      if (updateData.description !== undefined) {
        updatedQuestion.description = updateData.description;
      }
      if (updateData.difficulty !== undefined) {
        updatedQuestion.difficulty = updateData.difficulty;
      }
      if (updateData.score !== undefined) {
        updatedQuestion.score = updateData.score;
      }
      if (updateData.isRequired !== undefined) {
        updatedQuestion.isRequired = updateData.isRequired;
      }
      if (updateData.othersQuestionType !== undefined) {
        updatedQuestion.othersQuestionType = updateData.othersQuestionType;
      }
      if (updateData.notionSettings !== undefined) {
        updatedQuestion.notionSettings = updateData.notionSettings;
      }
      if (updateData.fileUploadSettings !== undefined) {
        updatedQuestion.fileUploadSettings = updateData.fileUploadSettings;
      }
      if (updateData.attachments !== undefined) {
        updatedQuestion.attachments = Array.isArray(updateData.attachments) ? updateData.attachments : [];
      }
    }
    // Update timestamp
    updatedQuestion.updatedAt = new Date();

    // Remove undefined fields
    Object.keys(updatedQuestion).forEach(key => {
      if (updatedQuestion[key] === undefined) {
        delete updatedQuestion[key];
      }
    });

    // Update the question in the array
    foundExercise.questions[questionIndex] = updatedQuestion;

    // Update the exercise in the array
    exercises[foundExerciseIndex] = foundExercise;

    // Update the entity's pedagogy structure
    if (entity.pedagogy[tabType] instanceof Map) {
      entity.pedagogy[tabType].set(subcategory, exercises);
    } else {
      entity.pedagogy[tabType][subcategory] = exercises;
    }

    // Mark as modified
    entity.markModified(`pedagogy.${tabType}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}.${foundExerciseIndex}.questions`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}.${foundExerciseIndex}.questions.${questionIndex}`);

    // Update timestamps
    entity.updatedBy = req.user?.email || "roobankr5@gmail.com";
    entity.updatedAt = new Date();

    // Save entity
    await entity.save();

    // Prepare response data
    const responseData = {
      updatedQuestion: {
        questionId: updatedQuestion._id.toString(),
        questionTitle: updatedQuestion.questionTitle || updatedQuestion.title,
        questionType: updatedQuestion.questionType,
        sequence: updatedQuestion.sequence,
        description: updatedQuestion.description ? {
          text: updatedQuestion.description.text,
          imageUrl: updatedQuestion.description.imageUrl,
          imageAlignment: updatedQuestion.description.imageAlignment,
          imageSizePercent: updatedQuestion.description.imageSizePercent
        } : undefined
      },
      exercise: {
        exerciseId: foundExercise.exerciseInformation?.exerciseId || foundExercise._id.toString(),
        exerciseName: foundExercise.exerciseInformation?.exerciseName || "Exercise",
        exerciseLevel: foundExercise.exerciseInformation?.exerciseLevel || "medium",
        totalQuestions: foundExercise.questions.length,
        totalScore: foundExercise.questions.reduce((sum, q) => sum + (q.score || 0), 0)
      },
      entity: {
        type: type,
        id: entity._id.toString(),
        title: entity.title || entity.name || "Entity"
      },
      location: {
        tabType: tabType,
        subcategory: subcategory,
        exerciseIndex: foundExerciseIndex,
        exerciseId: foundExercise._id.toString(),
        questionIndex: questionIndex
      }
    };

    return res.status(200).json({
      message: [{
        key: "success",
        value: `Question updated successfully in "${foundExercise.exerciseInformation?.exerciseName}"`
      }],
      data: responseData
    });

  } catch (err) {
    console.error("❌ Update question error:", err);
    console.error("❌ Error stack:", err.stack);

    res.status(500).json({
      message: [{
        key: "error",
        value: `Internal server error: ${err.message}`
      }],
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};
// Get all questions for an exercise
exports.getQuestions = async (req, res) => {
  try {
    const { type, id, exerciseId } = req.params;
    const {
      includeInactive = 'false'
    } = req.query; // Keep includeInactive as query parameter

    // Validate entity type
    if (!type || !modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}. Valid types: modules, submodules, topics, subtopics` }]
      });
    }

    // Get the model from modelMap
    const { model } = modelMap[type];

    if (!model) {
      return res.status(400).json({
        message: [{ key: "error", value: `Model not found for type: ${type}` }]
      });
    }

    // Find the entity
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} with ID ${id} not found` }]
      });
    }

    if (!entity.pedagogy) {
      return res.status(404).json({
        message: [{ key: "error", value: "No pedagogy structure found in this entity" }]
      });
    }

    const validTabTypes = ['I_Do', 'We_Do', 'You_Do'];
    let foundExercise = null;
    let foundTabType = null;
    let foundSubcategory = null;

    // Search through all tab types for the exercise
    for (const tabType of validTabTypes) {
      if (!entity.pedagogy[tabType]) continue;

      // Convert Map to object if needed
      const tabData = entity.pedagogy[tabType] instanceof Map
        ? Object.fromEntries(entity.pedagogy[tabType])
        : entity.pedagogy[tabType];

      // Search through all subcategories in this tabType
      for (const [subcategory, exercises] of Object.entries(tabData)) {
        if (Array.isArray(exercises)) {
          const exercise = exercises.find(ex => {
            // Check both _id and exerciseInformation.exerciseId
            return ex._id && ex._id.toString() === exerciseId ||
              (ex.exerciseInformation && ex.exerciseInformation.exerciseId === exerciseId);
          });
          if (exercise) {
            foundExercise = exercise;
            foundTabType = tabType;
            foundSubcategory = subcategory;
            break;
          }
        }
      }
      if (foundExercise) break; // Stop searching if found
    }

    if (!foundExercise) {
      console.error(`❌ Exercise with ID "${exerciseId}" not found in ${type} "${entity.title || entity.name}"`);

      // Log available exercises for debugging
      const availableExercises = [];
      validTabTypes.forEach(tabType => {
        if (entity.pedagogy[tabType]) {
          const tabData = entity.pedagogy[tabType] instanceof Map
            ? Object.fromEntries(entity.pedagogy[tabType])
            : entity.pedagogy[tabType];

          Object.entries(tabData).forEach(([subcat, exercises]) => {
            if (Array.isArray(exercises)) {
              exercises.forEach((ex, idx) => {
                availableExercises.push({
                  tabType: tabType,
                  subcategory: subcat,
                  index: idx,
                  _id: ex._id?.toString(),
                  exerciseId: ex.exerciseInformation?.exerciseId,
                  name: ex.exerciseInformation?.exerciseName,
                  hasQuestions: ex.questions && Array.isArray(ex.questions) ? ex.questions.length : 0
                });
              });
            }
          });
        }
      });

      return res.status(404).json({
        message: [{ key: "error", value: `No exercise found with ID ${exerciseId}` }],
        data: {
          questions: [],
          exercise: {
            exerciseId: exerciseId,
            exerciseName: "Unknown Exercise",
            exerciseLevel: "medium",
            totalQuestions: 0,
            totalPoints: 0
          },
          entity: {
            type: type,
            id: entity._id.toString(),
            title: entity.title || entity.name || "Entity",
            tabType: null,
            subcategory: null
          },
          metadata: {
            exerciseId: exerciseId,
            includeInactive: includeInactive === 'true'
          },
          debug: {
            availableExercises: availableExercises
          }
        }
      });
    }

    // Get questions - handle cases where questions might not exist
    let questions = [];
    if (foundExercise.questions && Array.isArray(foundExercise.questions)) {
      questions = foundExercise.questions;
    } else {
      // Initialize empty questions array if it doesn't exist
      foundExercise.questions = [];
    }

    // Filter inactive questions if requested
    if (includeInactive === 'false') {
      questions = questions.filter(q => q.isActive !== false);
    }

    // Sort by sequence
    questions.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    // Prepare exercise data with all settings including securitySettings
    const exerciseData = {
      _id: foundExercise._id?.toString() || exerciseId,
      exerciseId: foundExercise.exerciseInformation?.exerciseId || exerciseId,
      exerciseName: foundExercise.exerciseInformation?.exerciseName || "Exercise",
      exerciseLevel: foundExercise.exerciseInformation?.exerciseLevel || "medium",
      description: foundExercise.exerciseInformation?.description || "",
      totalQuestions: questions.length,
      totalPoints: questions.reduce((sum, q) => sum + (q.score || 0), 0),
      estimatedTime: foundExercise.exerciseInformation?.estimatedTime || 60,

      // Include all settings
      programmingSettings: foundExercise.programmingSettings || {},
      compilerSettings: foundExercise.compilerSettings || {},
      availabilityPeriod: foundExercise.availabilityPeriod || {},
      questionBehavior: foundExercise.questionBehavior || {},
      evaluationSettings: foundExercise.evaluationSettings || {},
      groupSettings: foundExercise.groupSettings || {},
      scoreSettings: foundExercise.scoreSettings || {},
      securitySettings: foundExercise.securitySettings || {}, // Include security settings

      createdAt: foundExercise.createdAt,
      updatedAt: foundExercise.updatedAt,
      createdBy: foundExercise.createdBy,
      updatedBy: foundExercise.updatedBy
    };

    return res.status(200).json({
      message: [{ key: "success", value: `Found ${questions.length} questions in ${foundTabType}` }],
      data: {
        questions,
        exercise: exerciseData,
        entity: {
          type: type,
          id: entity._id.toString(),
          title: entity.title || entity.name || "Entity",
          tabType: foundTabType,
          subcategory: foundSubcategory
        },
        metadata: {
          exerciseId: exerciseId,
          tabType: foundTabType,
          subcategory: foundSubcategory,
          includeInactive: includeInactive === 'true',
          totalQuestions: questions.length,
          activeQuestions: questions.filter(q => q.isActive !== false).length,
          inactiveQuestions: questions.filter(q => q.isActive === false).length
        }
      }
    });

  } catch (err) {
    console.error("❌ Get questions error:", err);
    res.status(500).json({
      message: [{ key: "error", value: `Internal server error: ${err.message}` }]
    });
  }
};
// Get single question by ID
exports.getQuestionById = async (req, res) => {
  try {
    const { type, id, exerciseId, questionId } = req.params;

    // Validate entity type
    if (!type || !modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}. Valid types: modules, submodules, topics, subtopics` }]
      });
    }

    // Get the model from modelMap
    const { model } = modelMap[type];

    if (!model) {
      return res.status(400).json({
        message: [{ key: "error", value: `Model not found for type: ${type}` }]
      });
    }

    // Find the entity
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} with ID ${id} not found` }]
      });
    }

    if (!entity.pedagogy) {
      return res.status(404).json({
        message: [{ key: "error", value: "No pedagogy structure found in this entity" }]
      });
    }

    const validTabTypes = ['I_Do', 'We_Do', 'You_Do'];
    let foundExercise = null;
    let foundTabType = null;
    let foundSubcategory = null;
    let foundQuestion = null;
    let questionIndex = -1;

    // Search through all tab types for the exercise and question
    for (const tabType of validTabTypes) {
      if (!entity.pedagogy[tabType]) continue;

      // Convert Map to object if needed
      const tabData = entity.pedagogy[tabType] instanceof Map
        ? Object.fromEntries(entity.pedagogy[tabType])
        : entity.pedagogy[tabType];

      // Search through all subcategories in this tabType
      for (const [subcategory, exercises] of Object.entries(tabData)) {
        if (Array.isArray(exercises)) {
          const exercise = exercises.find(ex => {
            // Check both _id and exerciseInformation.exerciseId
            return ex._id && ex._id.toString() === exerciseId ||
              (ex.exerciseInformation && ex.exerciseInformation.exerciseId === exerciseId);
          });

          if (exercise) {
            // Now search for the question within this exercise
            if (exercise.questions && Array.isArray(exercise.questions)) {
              const qIndex = exercise.questions.findIndex(q =>
                q._id && q._id.toString() === questionId
              );

              if (qIndex !== -1) {
                foundExercise = exercise;
                foundTabType = tabType;
                foundSubcategory = subcategory;
                foundQuestion = exercise.questions[qIndex];
                questionIndex = qIndex;
                break;
              }
            }
          }
        }
        if (foundQuestion) break;
      }
      if (foundQuestion) break; // Stop searching if found
    }

    if (!foundExercise) {
      return res.status(404).json({
        message: [{ key: "error", value: `Exercise with ID ${exerciseId} not found` }]
      });
    }

    if (!foundQuestion) {
      // Log available questions for debugging
      const availableQuestions = [];
      if (foundExercise.questions && Array.isArray(foundExercise.questions)) {
        foundExercise.questions.forEach((q, idx) => {
          availableQuestions.push({
            index: idx,
            _id: q._id?.toString(),
            title: q.title,
            difficulty: q.difficulty,
            score: q.score
          });
        });
      }

      return res.status(404).json({
        message: [{ key: "error", value: `Question with ID ${questionId} not found in exercise ${foundExercise.exerciseInformation?.exerciseName || exerciseId}` }],
        data: {
          exercise: {
            exerciseId: exerciseId,
            exerciseName: foundExercise.exerciseInformation?.exerciseName || "Exercise",
            totalQuestions: foundExercise.questions?.length || 0
          },
          debug: {
            availableQuestions: availableQuestions
          }
        }
      });
    }

    // Prepare exercise data with all settings including securitySettings
    const exerciseData = {
      _id: foundExercise._id?.toString() || exerciseId,
      exerciseId: foundExercise.exerciseInformation?.exerciseId || exerciseId,
      exerciseName: foundExercise.exerciseInformation?.exerciseName || "Exercise",
      exerciseLevel: foundExercise.exerciseInformation?.exerciseLevel || "medium",
      description: foundExercise.exerciseInformation?.description || "",
      totalQuestions: foundExercise.questions?.length || 0,
      totalPoints: foundExercise.questions?.reduce((sum, q) => sum + (q.score || 0), 0) || 0,
      estimatedTime: foundExercise.exerciseInformation?.estimatedTime || 60,

      // Include all settings
      programmingSettings: foundExercise.programmingSettings || {},
      compilerSettings: foundExercise.compilerSettings || {},
      availabilityPeriod: foundExercise.availabilityPeriod || {},
      questionBehavior: foundExercise.questionBehavior || {},
      evaluationSettings: foundExercise.evaluationSettings || {},
      groupSettings: foundExercise.groupSettings || {},
      scoreSettings: foundExercise.scoreSettings || {},
      securitySettings: foundExercise.securitySettings || {}, // Include security settings

      createdAt: foundExercise.createdAt,
      updatedAt: foundExercise.updatedAt,
      createdBy: foundExercise.createdBy,
      updatedBy: foundExercise.updatedBy
    };

    // Get adjacent questions for navigation
    let previousQuestion = null;
    let nextQuestion = null;

    if (foundExercise.questions && Array.isArray(foundExercise.questions)) {
      if (questionIndex > 0) {
        previousQuestion = {
          _id: foundExercise.questions[questionIndex - 1]._id?.toString(),
          title: foundExercise.questions[questionIndex - 1].title,
          sequence: foundExercise.questions[questionIndex - 1].sequence
        };
      }

      if (questionIndex < foundExercise.questions.length - 1) {
        nextQuestion = {
          _id: foundExercise.questions[questionIndex + 1]._id?.toString(),
          title: foundExercise.questions[questionIndex + 1].title,
          sequence: foundExercise.questions[questionIndex + 1].sequence
        };
      }
    }

    return res.status(200).json({
      message: [{ key: "success", value: `Question "${foundQuestion.title}" retrieved successfully from ${foundTabType}` }],
      data: {
        question: foundQuestion,
        exercise: exerciseData,
        entity: {
          type: type,
          id: entity._id.toString(),
          title: entity.title || entity.name || "Entity",
          tabType: foundTabType,
          subcategory: foundSubcategory
        },
        navigation: {
          previous: previousQuestion,
          next: nextQuestion,
          currentIndex: questionIndex,
          totalQuestions: foundExercise.questions?.length || 0
        },
        metadata: {
          exerciseId: exerciseId,
          questionId: questionId,
          tabType: foundTabType,
          subcategory: foundSubcategory,
          questionSequence: foundQuestion.sequence || 0,
          isActive: foundQuestion.isActive !== false,
          difficulty: foundQuestion.difficulty || 'medium',
          score: foundQuestion.score || 0
        }
      }
    });

  } catch (err) {
    console.error("❌ Get question by ID error:", err);
    res.status(500).json({
      message: [{ key: "error", value: `Internal server error: ${err.message}` }]
    });
  }
};



// Delete question
exports.deleteQuestion = async (req, res) => {
  try {
    const { type, id, exerciseId, questionId } = req.params;
    const {
      tabType,
      subcategory
    } = req.body;

    // Validate entity type
    if (!type || !modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}. Valid types: modules, submodules, topics, subtopics` }]
      });
    }

    // Validate required parameters
    if (!tabType) {
      return res.status(400).json({
        message: [{ key: "error", value: "tabType is required (I_Do, We_Do, You_Do)" }]
      });
    }

    if (!subcategory) {
      return res.status(400).json({
        message: [{ key: "error", value: "Subcategory is required (e.g., 'Practical', 'Project Development')" }]
      });
    }

    // Get the model from modelMap
    const { model } = modelMap[type];

    if (!model) {
      return res.status(400).json({
        message: [{ key: "error", value: `Model not found for type: ${type}` }]
      });
    }

    // Find the entity
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} with ID ${id} not found` }]
      });
    }

    // Check if pedagogy exists
    if (!entity.pedagogy) {
      return res.status(404).json({
        message: [{ key: "error", value: "No pedagogy structure found in this entity" }]
      });
    }

    // Check if tabType exists
    if (!entity.pedagogy[tabType]) {
      return res.status(404).json({
        message: [{ key: "error", value: `No ${tabType} section found in pedagogy` }]
      });
    }

    // Convert Map to object if needed
    const tabData = entity.pedagogy[tabType] instanceof Map
      ? Object.fromEntries(entity.pedagogy[tabType])
      : entity.pedagogy[tabType];

    // Check if subcategory exists
    if (!tabData[subcategory]) {
      return res.status(404).json({
        message: [{ key: "error", value: `Subcategory "${subcategory}" not found in ${tabType}` }]
      });
    }

    const exercises = tabData[subcategory];

    if (!Array.isArray(exercises)) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid exercises format in subcategory "${subcategory}"` }]
      });
    }

    // Find the exercise by ID
    let foundExercise = null;
    let foundExerciseIndex = -1;

    for (let i = 0; i < exercises.length; i++) {
      const exercise = exercises[i];

      // Check all possible ID fields
      const matches = (
        (exercise._id && exercise._id.toString() === exerciseId) ||
        (exercise.exerciseInformation?.exerciseId === exerciseId) ||
        (exercise.exerciseInformation?._id?.toString() === exerciseId)
      );

      if (matches) {
        foundExercise = exercise;
        foundExerciseIndex = i;
        break;
      }
    }

    if (!foundExercise) {
      console.error(`❌ Exercise with ID "${exerciseId}" not found in subcategory "${subcategory}"`);

      // Log all available exercises for debugging
      const availableExercises = exercises.map((ex, idx) => ({
        index: idx,
        _id: ex._id?.toString(),
        exerciseId: ex.exerciseInformation?.exerciseId,
        name: ex.exerciseInformation?.exerciseName,
        exerciseLevel: ex.exerciseInformation?.exerciseLevel,
        questionsCount: ex.questions?.length || 0
      }));

      return res.status(404).json({
        message: [{
          key: "error",
          value: `Exercise with ID "${exerciseId}" not found in subcategory "${subcategory}". Available exercises: ${availableExercises.length}`
        }],
        availableExercises
      });
    }

    // Check if questions array exists
    if (!foundExercise.questions || !Array.isArray(foundExercise.questions)) {
      return res.status(404).json({
        message: [{ key: "error", value: `No questions found in exercise "${foundExercise.exerciseInformation?.exerciseName}"` }]
      });
    }

    // Find the question by ID
    const questionIndex = foundExercise.questions.findIndex(q =>
      q._id && q._id.toString() === questionId
    );

    if (questionIndex === -1) {
      // Log available questions for debugging
      const availableQuestions = foundExercise.questions.map((q, idx) => ({
        index: idx,
        _id: q._id?.toString(),
        title: q.title,
        difficulty: q.difficulty,
        score: q.score
      }));

      return res.status(404).json({
        message: [{
          key: "error",
          value: `Question with ID "${questionId}" not found in exercise "${foundExercise.exerciseInformation?.exerciseName}"`
        }],
        availableQuestions
      });
    }

    // Get the question data before deletion for response
    const deletedQuestion = foundExercise.questions[questionIndex];
    const questionTitle = deletedQuestion.title || "Question";

    // Remove the question from the array
    foundExercise.questions.splice(questionIndex, 1);

    // Update the exercise in the array
    exercises[foundExerciseIndex] = foundExercise;

    // Update the entity's pedagogy structure
    if (entity.pedagogy[tabType] instanceof Map) {
      entity.pedagogy[tabType].set(subcategory, exercises);
    } else {
      entity.pedagogy[tabType][subcategory] = exercises;
    }

    // Mark as modified
    entity.markModified(`pedagogy.${tabType}.${subcategory}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}.${foundExerciseIndex}.questions`);

    // Update timestamps
    entity.updatedBy = req.user?.email || "system";
    entity.updatedAt = new Date();

    // Save entity
    await entity.save();

    // Calculate updated totals
    const totalQuestions = foundExercise.questions.length;
    const totalScore = foundExercise.questions.reduce((sum, q) => sum + (q.score || 0), 0);

    // Prepare exercise data with all settings including securitySettings
    const exerciseData = {
      _id: foundExercise._id?.toString() || exerciseId,
      exerciseId: foundExercise.exerciseInformation?.exerciseId || exerciseId,
      exerciseName: foundExercise.exerciseInformation?.exerciseName || "Exercise",
      exerciseLevel: foundExercise.exerciseInformation?.exerciseLevel || "medium",
      description: foundExercise.exerciseInformation?.description || "",
      totalQuestions: totalQuestions,
      totalScore: totalScore,
      estimatedTime: foundExercise.exerciseInformation?.estimatedTime || 60,

      // Include all settings
      programmingSettings: foundExercise.programmingSettings || {},
      compilerSettings: foundExercise.compilerSettings || {},
      availabilityPeriod: foundExercise.availabilityPeriod || {},
      questionBehavior: foundExercise.questionBehavior || {},
      evaluationSettings: foundExercise.evaluationSettings || {},
      groupSettings: foundExercise.groupSettings || {},
      scoreSettings: foundExercise.scoreSettings || {},
      securitySettings: foundExercise.securitySettings || {},

      createdAt: foundExercise.createdAt,
      updatedAt: foundExercise.updatedAt,
      createdBy: foundExercise.createdBy,
      updatedBy: foundExercise.updatedBy
    };

    const responseData = {
      deletedQuestion: {
        _id: deletedQuestion._id?.toString(),
        title: deletedQuestion.title,
        description: deletedQuestion.description,
        difficulty: deletedQuestion.difficulty,
        score: deletedQuestion.score,
        deletedAt: new Date()
      },
      exercise: exerciseData,
      entity: {
        type: type,
        id: entity._id.toString(),
        title: entity.title || entity.name || "Entity",
        tabType: tabType,
        subcategory: subcategory
      },
      location: {
        tabType: tabType,
        subcategory: subcategory,
        exerciseIndex: foundExerciseIndex,
        exerciseId: foundExercise._id.toString(),
        deletedQuestionId: questionId.toString(),
        deletedQuestionIndex: questionIndex
      },
      metadata: {
        totalQuestionsAfterDeletion: totalQuestions,
        questionsDeleted: 1,
        remainingQuestions: totalQuestions
      }
    };

    return res.status(200).json({
      message: [{
        key: "success",
        value: `Question "${questionTitle}" deleted successfully from "${foundExercise.exerciseInformation?.exerciseName}"`
      }],
      data: responseData
    });

  } catch (err) {
    console.error("❌ Delete question error:", err);
    console.error("❌ Error stack:", err.stack);
    console.error("❌ Error details:", {
      name: err.name,
      message: err.message,
      code: err.code,
      keyValue: err.keyValue
    });

    res.status(500).json({
      message: [{
        key: "error",
        value: `Internal server error: ${err.message}`
      }],
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};






exports.getUserExerciseGradeAnalytics = async (req, res) => {
  try {
    const userId = req.user._id;
    const { exerciseId } = req.params;
    const {
      courseId,
      category = null,
      subcategory = null
    } = req.query;

    if (!exerciseId || !courseId) {
      return res.status(400).json({
        success: false,
        message: "exerciseId parameter and courseId query are required"
      });
    }

    console.log(`\n🚀 START getUserExerciseGradeAnalytics`);
    console.log(`User: ${userId}, Course: ${courseId}, Exercise: ${exerciseId}`);
    console.log(`Searching with category: ${category || 'ALL'}, subcategory: ${subcategory || 'ALL'}`);

    // 1. Find user and convert to plain object to avoid Mongoose subdocument issues
    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const userCourse = user.courses.find(c =>
      c.courseId && c.courseId.toString() === courseId
    );

    if (!userCourse) {
      return res.status(404).json({
        success: false,
        message: "User is not enrolled in this course"
      });
    }

    console.log(`✅ User course found`);

    // 2. SEARCH USER ANSWERS
    let userQuestions = [];
    let foundCategory = null;
    let foundSubcategory = null;
    let foundUserExercise = null;

    console.log(`\n🔍 SEARCHING USER ANSWERS...`);

    const searchCategories = category ? [category] : ['I_Do', 'We_Do', 'You_Do'];
    const searchSubcategories = subcategory ? [subcategory] : ['practical', 'assignments', 'assessments', 'assesments', 'homework', 'practice', 'project_development'];

    let answersData = userCourse.answers;

    if (answersData && answersData.toObject) {
      answersData = answersData.toObject();
      console.log(`  Converted answers from Mongoose subdocument to plain object`);
    }

    console.log(`  Answers data type: ${typeof answersData}`);
    console.log(`  Answers data keys: ${answersData ? Object.keys(answersData).join(', ') : 'none'}`);

    for (const cat of searchCategories) {
      console.log(`\n🔍 Checking category: ${cat}`);

      if (!answersData || !answersData[cat]) {
        console.log(`  No answers in category "${cat}"`);
        continue;
      }

      const categoryData = answersData[cat];
      console.log(`  Category data type: ${typeof categoryData}`);
      console.log(`  Category data keys: ${categoryData ? Object.keys(categoryData).join(', ') : 'none'}`);

      if (categoryData && typeof categoryData === 'object') {
        for (const subcat of searchSubcategories) {
          console.log(`    🔍 Checking subcategory: ${subcat}`);

          if (!categoryData[subcat]) {
            console.log(`    No data in "${subcat}"`);
            continue;
          }

          let exercises = categoryData[subcat];
          if (!Array.isArray(exercises)) {
            exercises = [exercises];
          }

          console.log(`    Found ${exercises.length} exercises in ${subcat}`);

          const targetId = exerciseId.toString ? exerciseId.toString() : String(exerciseId);

          for (const exercise of exercises) {
            if (!exercise) continue;

            let exerciseObj = exercise;
            if (exerciseObj && exerciseObj.toObject) {
              exerciseObj = exerciseObj.toObject();
            }

            const exerciseIdField = exerciseObj.exerciseId || exerciseObj._id || exerciseObj.id;
            if (!exerciseIdField) continue;

            const exId = exerciseIdField.toString ? exerciseIdField.toString() : String(exerciseIdField);

            console.log(`      Checking exercise ID: ${exId} against target: ${targetId}`);

            if (exId === targetId) {
              console.log(`    ✅✅✅ FOUND EXERCISE in ${cat}/${subcat}!`);
              console.log(`      Exercise ID: ${exId}`);
              console.log(`      Exercise Name: ${exerciseObj.exerciseName || exerciseObj.exerciseInformation?.exerciseName || 'No name'}`);
              console.log(`      Exercise has keys: ${Object.keys(exerciseObj).join(', ')}`);

              foundCategory = cat;
              foundSubcategory = subcat;
              foundUserExercise = exerciseObj;

              if (exerciseObj.questions && Array.isArray(exerciseObj.questions)) {
                userQuestions = exerciseObj.questions.map(q => {
                  if (q && q.toObject) return q.toObject();
                  return q;
                });
                console.log(`      Extracted ${userQuestions.length} user questions directly from exercise.questions`);
              } else {
                console.log(`      ⚠️ No questions found in exercise.questions`);
              }

              if (userQuestions.length > 0) {
                userQuestions.forEach((q, i) => {
                  if (q) {
                    const qId = q.questionId ?
                      (q.questionId.toString ? q.questionId.toString() : String(q.questionId)) :
                      'NO_ID';
                    console.log(`      Q${i + 1}: ID=${qId}, score=${q.score || 0}, totalScore=${q.totalScore || 0}, status=${q.status || 'unknown'}`);
                  }
                });
              }

              break;
            }
          }

          if (foundUserExercise) break;
        }
      }

      if (foundUserExercise) break;
    }

    console.log(`\n📊 USER ANSWERS SUMMARY:`);
    console.log(`  Found in: ${foundCategory}/${foundSubcategory || 'unknown'}`);
    console.log(`  Found exercise: ${!!foundUserExercise}`);
    console.log(`  Total user questions: ${userQuestions.length}`);

    // 3. FIND EXERCISE DETAILS FROM COURSE STRUCTURE
    let exerciseDetails = null;
    let allQuestions = [];
    let foundInEntity = null;
    let passingMarks = null;
    let totalMarks = null;

    console.log(`\n🔍 Searching for exercise details in course structure...`);

    // Helper function to extract question title safely
    const getQuestionTitle = (question) => {
      if (!question) return "Untitled";

      // Handle MCQ question title (array of blocks)
      if (question.mcqQuestionTitle && Array.isArray(question.mcqQuestionTitle)) {
        // Extract text from blocks
        const textBlocks = question.mcqQuestionTitle
          .filter(block => block.type === 'text')
          .map(block => block.value)
          .join(' ');
        if (textBlocks.trim()) return textBlocks;
        return "MCQ Question";
      }

      // Handle programming question title (array of blocks)
      if (question.programmingQuestionTitle && Array.isArray(question.programmingQuestionTitle)) {
        const textBlocks = question.programmingQuestionTitle
          .filter(block => block.type === 'text')
          .map(block => block.value)
          .join(' ');
        if (textBlocks.trim()) return textBlocks;
        return "Programming Question";
      }

      // Handle regular title
      if (question.title) return question.title;
      if (question.questionTitle) return question.questionTitle;

      return "Untitled";
    };

    const findExerciseInPedagogy = (pedagogy, targetExerciseId) => {
      if (!pedagogy) return null;

      const targetIdStr = targetExerciseId.toString ? targetExerciseId.toString() : String(targetExerciseId);

      const categories = ['I_Do', 'We_Do', 'You_Do'];
      const subcategories = ['practical', 'assignments', 'assessments', 'assesments', 'homework', 'practice', 'project_development'];

      for (const cat of categories) {
        if (pedagogy[cat]) {
          const sectionData = pedagogy[cat];

          if (typeof sectionData === 'object') {
            for (const subcat of subcategories) {
              if (sectionData[subcat] && Array.isArray(sectionData[subcat])) {
                console.log(`    Checking ${cat}/${subcat} - ${sectionData[subcat].length} exercises`);

                const found = sectionData[subcat].find(ex => {
                  if (!ex) return false;

                  const exId = ex._id?.toString() ||
                    ex.id?.toString() ||
                    ex.exerciseId?.toString() ||
                    ex.exerciseInformation?._id?.toString();

                  return exId === targetIdStr;
                });

                if (found) {
                  console.log(`    ✅ FOUND in pedagogy: ${cat}/${subcat}`);
                  return { exercise: found, category: cat, subcategory: subcat };
                }
              }
            }
          }
        }
      }

      return null;
    };

    const entityModels = [
      { name: 'Module1', model: Module1 },
      { name: 'SubModule1', model: SubModule1 },
      { name: 'Topic1', model: Topic1 },
      { name: 'SubTopic1', model: SubTopic1 }
    ];

    for (const { name, model } of entityModels) {
      try {
        const entities = await model.find({ courses: courseId }).lean();
        console.log(`  Checking ${name}: ${entities.length} entities`);

        for (const entity of entities) {
          console.log(`    Entity: ${entity.title || entity.name || 'Unnamed'}`);

          const result = findExerciseInPedagogy(entity.pedagogy, exerciseId);
          if (result) {
            exerciseDetails = result.exercise;
            foundInEntity = {
              type: name,
              id: entity._id,
              title: entity.title || entity.name || "Entity",
              category: result.category,
              subcategory: result.subcategory
            };

            // Get questions from exercise
            allQuestions = exerciseDetails.questions || [];

            // Extract passing marks and total marks from exercise configuration
            if (exerciseDetails.gradeSettings) {
              passingMarks = exerciseDetails.gradeSettings.programmingGradeToPass ||
                exerciseDetails.gradeSettings.mcqGradeToPass ||
                exerciseDetails.gradeSettings.combinedGradeToPass;
              totalMarks = exerciseDetails.gradeSettings.programmingGrade ||
                exerciseDetails.gradeSettings.mcqGrade ||
                exerciseDetails.gradeSettings.combinedGrade;
              console.log(`  ✅ Found grade settings - Passing Marks: ${passingMarks}, Total Marks: ${totalMarks}`);
            } else if (exerciseDetails.exerciseInformation) {
              totalMarks = exerciseDetails.exerciseInformation.totalMarks;
              passingMarks = totalMarks ? Math.ceil(totalMarks * 0.4) : null;
              console.log(`  ⚠️ Using exerciseInformation - Total Marks: ${totalMarks}, Calculated Passing: ${passingMarks}`);
            }

            console.log(`  ✅ EXERCISE FOUND in ${name}: "${entity.title || entity.name}"`);
            console.log(`    Category: ${result.category}/${result.subcategory}`);
            console.log(`    Exercise Name: ${exerciseDetails.exerciseInformation?.exerciseName || exerciseDetails.exerciseName || 'Unnamed'}`);
            console.log(`    Total Questions: ${allQuestions.length}`);
            console.log(`    Passing Marks Required: ${passingMarks}`);

            allQuestions.forEach((q, i) => {
              if (q) {
                const qId = q._id ? q._id.toString() : 'NO_ID';
                const qTitle = getQuestionTitle(q);
                const qScore = q.mcqQuestionScore || q.score || 10;
                console.log(`    Q${i + 1}: "${qTitle.substring(0, 30)}...", ID=${qId}, score=${qScore}`);
              }
            });

            break;
          }
        }

        if (exerciseDetails) break;
      } catch (err) {
        console.log(`  Error checking ${name}: ${err.message}`);
      }
    }

    if (!exerciseDetails && foundUserExercise) {
      console.log(`\n⚠️ Using user exercise data as fallback`);
      exerciseDetails = foundUserExercise;
      allQuestions = userQuestions;
    }

    if (!exerciseDetails) {
      console.log(`❌ Exercise not found in course structure or user data`);
      return res.status(404).json({
        success: false,
        message: "Exercise not found in course structure"
      });
    }

    // 4. MATCH QUESTIONS
    console.log(`\n🔍 MATCHING QUESTIONS...`);
    console.log(`User questions to match: ${userQuestions.length}`);
    console.log(`Exercise questions from structure: ${allQuestions.length}`);

    const userQuestionMap = new Map();
    userQuestions.forEach((userQ, index) => {
      if (userQ) {
        let qId = null;
        if (userQ.questionId) {
          qId = userQ.questionId.toString ? userQ.questionId.toString() : String(userQ.questionId);
        } else if (userQ._id) {
          qId = userQ._id.toString ? userQ._id.toString() : String(userQ._id);
        }

        if (qId) {
          userQuestionMap.set(qId, {
            data: userQ,
            index: index
          });
          console.log(`  User Q${index + 1}: ID=${qId}, score=${userQ.score || 0}, totalScore=${userQ.totalScore || 0}, status=${userQ.status || 'unknown'}`);
        }
      }
    });

    let questionsToMatch = [];

    if (allQuestions.length > 0) {
      questionsToMatch = allQuestions;
      console.log(`  Using ${allQuestions.length} questions from exercise structure for matching`);
    } else if (userQuestions.length > 0) {
      questionsToMatch = userQuestions;
      console.log(`  Using ${userQuestions.length} questions from user answers as fallback`);
    }

    const questionsWithScores = questionsToMatch.map((exerciseQuestion, index) => {
      let exerciseQId = null;

      if (exerciseQuestion._id) {
        exerciseQId = exerciseQuestion._id.toString();
      } else if (exerciseQuestion.questionId) {
        exerciseQId = exerciseQuestion.questionId.toString();
      } else if (exerciseQuestion.id) {
        exerciseQId = exerciseQuestion.id.toString();
      }

      // Get title safely using helper function
      const exerciseTitle = getQuestionTitle(exerciseQuestion);

      let userAttempt = null;
      let matchedBy = null;

      if (exerciseQId && userQuestionMap.size > 0) {
        const displayTitle = exerciseTitle.length > 30 ? exerciseTitle.substring(0, 30) + "..." : exerciseTitle;
        console.log(`\n🔍 Matching: "${displayTitle}" (${exerciseQId})`);

        if (userQuestionMap.has(exerciseQId)) {
          const userQData = userQuestionMap.get(exerciseQId);
          userAttempt = userQData.data;
          matchedBy = 'exact_id_match';
          console.log(`  ✅ EXACT MATCH! Score: ${userAttempt.score || 0}/${userAttempt.totalScore || 0}`);
        } else {
          console.log(`  ❌ No exact match found for ID: ${exerciseQId}`);
          console.log(`  Available user question IDs: ${Array.from(userQuestionMap.keys()).join(', ')}`);
        }
      } else if (userQuestionMap.size === 0) {
        const displayTitle = exerciseTitle.length > 30 ? exerciseTitle.substring(0, 30) + "..." : exerciseTitle;
        console.log(`\n⚠️ No user questions to match with: "${displayTitle}"`);
      } else if (!exerciseQId) {
        const displayTitle = exerciseTitle.length > 30 ? exerciseTitle.substring(0, 30) + "..." : exerciseTitle;
        console.log(`\n⚠️ Exercise question has no ID: "${displayTitle}"`);
      }

      const questionMaxScore = exerciseQuestion.mcqQuestionScore ||
        exerciseQuestion.score ||
        10;
      const userScore = userAttempt?.score || 0;
      const totalScore = userAttempt?.totalScore || questionMaxScore;
      const percentage = totalScore > 0 ? (userScore / totalScore) * 100 : 0;

      return {
        _id: exerciseQuestion._id || exerciseQuestion.questionId,
        sequence: exerciseQuestion.sequence || index + 1,
        title: exerciseTitle,
        difficulty: exerciseQuestion.mcqQuestionDifficulty || exerciseQuestion.difficulty || 'medium',
        maxScore: questionMaxScore,
        userScore: userScore,
        totalScore: totalScore,
        percentage: percentage.toFixed(2),
        isCorrect: userAttempt?.isCorrect || (userAttempt?.status === 'solved') || percentage >= 70,
        userAttempt: userAttempt ? {
          status: userAttempt.status || 'attempted',
          attempts: userAttempt.attempts || 1,
          score: userAttempt.score,
          totalScore: userAttempt.totalScore,
          feedback: userAttempt.feedback || '',
          language: userAttempt.language || '',
          submittedAt: userAttempt.submittedAt,
          evaluatedAt: userAttempt.evaluatedAt,
          matchedBy: matchedBy
        } : null,
        debug: {
          exerciseQuestionId: exerciseQId,
          userQuestionId: userAttempt?.questionId?.toString?.() || userAttempt?._id?.toString?.(),
          matched: !!userAttempt
        }
      };
    });

    // 5. CALCULATE ANALYTICS
    const evaluatedQuestions = questionsWithScores.filter(q => q.userScore > 0);
    const attemptedQuestions = questionsWithScores.filter(q => q.userAttempt);
    const correctQuestions = questionsWithScores.filter(q => q.isCorrect);

    console.log(`\n📊 FINAL RESULTS:`);
    console.log(`  Total exercise questions: ${questionsToMatch.length}`);
    console.log(`  User attempts found: ${userQuestions.length}`);
    console.log(`  Matched questions: ${attemptedQuestions.length}`);
    console.log(`  Questions with scores > 0: ${evaluatedQuestions.length}`);
    console.log(`  Correct questions: ${correctQuestions.length}`);

    const totalUserScore = evaluatedQuestions.reduce((sum, q) => sum + q.userScore, 0);
    const totalMaxScore = questionsWithScores.reduce((sum, q) => sum + q.maxScore, 0);
    const overallPercentage = totalMaxScore > 0 ? (totalUserScore / totalMaxScore) * 100 : 0;

    console.log(`  Total User Score: ${totalUserScore.toFixed(2)} / ${totalMaxScore}`);
    console.log(`  Overall Percentage: ${overallPercentage.toFixed(2)}%`);

    // Helper function for letter grade
    const getLetterGrade = (percentage) => {
      if (percentage >= 90) return 'A';
      if (percentage >= 80) return 'B';
      if (percentage >= 70) return 'C';
      if (percentage >= 60) return 'D';
      return 'F';
    };

    // Determine passing status based on exercise configuration
    let isPassing = false;

    if (passingMarks !== null && totalMaxScore > 0) {
      isPassing = totalUserScore >= passingMarks;
      console.log(`  Passing Check: User Score (${totalUserScore}) >= Passing Marks (${passingMarks}) = ${isPassing}`);
    } else {
      isPassing = overallPercentage >= 70;
      console.log(`  Using fallback 70% threshold: ${overallPercentage}% >= 70% = ${isPassing}`);
    }

    // 6. PREPARE RESPONSE
    const response = {
      success: true,
      data: {
        user: {
          _id: user._id,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Unknown',
          email: user.email
        },
        exercise: {
          _id: exerciseId,
          name: exerciseDetails.exerciseInformation?.exerciseName ||
            exerciseDetails.exerciseName ||
            "Exercise",
          totalQuestions: questionsToMatch.length,
          foundInCategory: foundCategory || foundInEntity?.category,
          foundInSubcategory: foundSubcategory || foundInEntity?.subcategory,
          entity: foundInEntity,
          passingMarks: passingMarks,
          totalMarks: totalMaxScore
        },
        summary: {
          totalQuestions: questionsToMatch.length,
          attemptedQuestions: attemptedQuestions.length,
          evaluatedQuestions: evaluatedQuestions.length,
          correctQuestions: correctQuestions.length,
          totalScore: totalUserScore.toFixed(2),
          maxPossibleScore: totalMaxScore,
          overallPercentage: overallPercentage.toFixed(2),
          completionRate: questionsToMatch.length > 0 ?
            ((attemptedQuestions.length / questionsToMatch.length) * 100).toFixed(2) : "0.00",
          averageScore: attemptedQuestions.length > 0 ?
            (totalUserScore / attemptedQuestions.length).toFixed(2) : "0.00"
        },
        questions: questionsWithScores,
        grade: {
          obtained: totalUserScore,
          outOf: totalMaxScore,
          percentage: overallPercentage.toFixed(2),
          letterGrade: getLetterGrade(overallPercentage),
          isPassing: isPassing,
          passingMarksRequired: passingMarks
        },
        debug: {
          userQuestionsFound: userQuestions.length,
          exerciseQuestionsFound: questionsToMatch.length,
          matchesFound: attemptedQuestions.length,
          searchLocation: foundCategory ? `${foundCategory}/${foundSubcategory}` : 'unknown',
          userQuestions: userQuestions.map(q => ({
            questionId: q.questionId ?
              (q.questionId.toString ? q.questionId.toString() : String(q.questionId)) :
              null,
            score: q.score || 0,
            totalScore: q.totalScore || 0,
            status: q.status || 'unknown'
          })),
          matchingDetails: {
            exactMatches: questionsWithScores.filter(q => q.userAttempt?.matchedBy === 'exact_id_match').length,
            partialMatches: questionsWithScores.filter(q => q.userAttempt?.matchedBy === 'partial_id_match').length,
            noMatches: questionsWithScores.filter(q => !q.userAttempt).length
          }
        }
      }
    };

    console.log(`\n✅ getUserExerciseGradeAnalytics COMPLETE`);
    console.log(`Response sent with ${attemptedQuestions.length} matched questions`);

    return res.status(200).json(response);

  } catch (error) {
    console.error("❌ getUserExerciseGradeAnalytics error:", error);
    console.error("❌ Error stack:", error.stack);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};




// Helper function for letter grade
function getLetterGrade(percentage) {
  if (percentage >= 90) return 'A';
  if (percentage >= 80) return 'B';
  if (percentage >= 70) return 'C';
  if (percentage >= 60) return 'D';
  return 'F';
}






// Get all exercises for a course with user scores and questions
exports.getCourseExercisesWithUserScores = async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.user._id; // Authenticated user (or pass userId if admin)
    const { targetUserId } = req.query; // Optional: for admin viewing other users

    const finalUserId = targetUserId || userId;

    console.log(`📊 Fetching exercises for Course: ${courseId}, User: ${finalUserId}`);

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "courseId parameter is required"
      });
    }

    // 1. Find the user to get their progress
    const user = await User.findById(finalUserId)
      .select('firstName lastName email courses')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // 2. Find user's course progress
    const userCourse = user.courses?.find(c =>
      c.courseId && c.courseId.toString() === courseId
    );

    if (!userCourse) {
      return res.status(404).json({
        success: false,
        message: "User is not enrolled in this course"
      });
    }

    // 3. Get all entities (modules, submodules, topics, subtopics) for this course
    const allEntities = [];

    // Get modules
    const modules = await Module1.find({ courses: courseId })
      .select('_id title description level duration pedagogy')
      .lean();
    modules.forEach(mod => allEntities.push({ ...mod, type: 'module' }));

    // Get submodules
    const subModules = await SubModule1.find({ courses: courseId })
      .select('_id title description level duration pedagogy')
      .lean();
    subModules.forEach(sub => allEntities.push({ ...sub, type: 'submodule' }));

    // Get topics
    const topics = await Topic1.find({ courses: courseId })
      .select('_id title description level duration pedagogy')
      .lean();
    topics.forEach(topic => allEntities.push({ ...topic, type: 'topic' }));

    // Get subtopics
    const subTopics = await SubTopic1.find({ courses: courseId })
      .select('_id title description level duration pedagogy')
      .lean();
    subTopics.forEach(st => allEntities.push({ ...st, type: 'subtopic' }));

    // 4. Extract all exercises from all entities
    const allExercises = [];
    const entityMap = new Map(); // Map entity ID to entity info

    allEntities.forEach(entity => {
      entityMap.set(entity._id.toString(), {
        type: entity.type,
        title: entity.title,
        description: entity.description
      });

      if (entity.pedagogy) {
        // Search through all pedagogy sections
        ['I_Do', 'We_Do', 'You_Do'].forEach(section => {
          const sectionData = entity.pedagogy[section];
          if (!sectionData) return;

          // Handle both Map and object formats
          let subcategories = [];
          if (sectionData instanceof Map) {
            subcategories = Array.from(sectionData.entries());
          } else if (typeof sectionData === 'object') {
            subcategories = Object.entries(sectionData);
          }

          subcategories.forEach(([subcategory, value]) => {
            if (!value) return;

            let exercisesArray = [];
            if (Array.isArray(value)) {
              exercisesArray = value;
            } else if (value.exercises && Array.isArray(value.exercises)) {
              exercisesArray = value.exercises;
            } else if (value._id) {
              // Single exercise object
              exercisesArray = [value];
            }

            exercisesArray.forEach(exercise => {
              if (exercise && exercise._id) {
                allExercises.push({
                  ...exercise,
                  entity: {
                    id: entity._id,
                    type: entity.type,
                    title: entity.title
                  },
                  section,
                  subcategory,
                  location: `${entity.type}/${entity.title}/${section}/${subcategory}`
                });
              }
            });
          });
        });
      }
    });

    // 5. Get user's progress for these exercises
    const userProgressMap = new Map();

    // Search in user's course progress
    if (userCourse.answers) {
      ['I_Do', 'We_Do', 'You_Do'].forEach(section => {
        const sectionData = userCourse.answers[section];
        if (!sectionData) return;

        // Handle both Map and object formats
        let subcategories = [];
        if (sectionData instanceof Map) {
          subcategories = Array.from(sectionData.entries());
        } else if (typeof sectionData === 'object') {
          subcategories = Object.entries(sectionData);
        }

        subcategories.forEach(([subcategory, value]) => {
          if (!value) return;

          let exercisesArray = [];
          if (Array.isArray(value)) {
            exercisesArray = value;
          } else if (typeof value === 'object' && value.exercises) {
            exercisesArray = value.exercises;
          } else if (value._id) {
            exercisesArray = [value];
          }

          exercisesArray.forEach(userExercise => {
            if (userExercise && userExercise.exerciseId) {
              userProgressMap.set(userExercise.exerciseId.toString(), {
                status: userExercise.status || 'not_started',
                questions: userExercise.questions || [],
                totalScore: calculateTotalScore(userExercise.questions || []),
                averageScore: calculateAverageScore(userExercise.questions || []),
                completionRate: calculateCompletionRate(userExercise.questions || []),
                lastAccessed: userExercise.updatedAt
              });
            }
          });
        });
      });
    }

    // Helper functions
    function calculateTotalScore(questions) {
      return questions.reduce((sum, q) => sum + (q.score || 0), 0);
    }

    function calculateAverageScore(questions) {
      if (questions.length === 0) return 0;
      return calculateTotalScore(questions) / questions.length;
    }

    function calculateCompletionRate(questions) {
      if (questions.length === 0) return 0;
      const solved = questions.filter(q =>
        q.status === 'solved' || q.isCorrect === true
      ).length;
      return (solved / questions.length) * 100;
    }

    // 6. Combine exercises with user progress
    const exercisesWithProgress = allExercises.map(exercise => {
      const userProgress = userProgressMap.get(exercise._id.toString());
      const questions = exercise.questions || [];

      // Calculate exercise statistics
      const totalQuestions = questions.length;
      const totalPoints = questions.reduce((sum, q) => sum + (q.score || 0), 0);

      // Calculate difficulty distribution
      const difficultyCount = {
        easy: questions.filter(q => q.difficulty === 'easy').length,
        medium: questions.filter(q => q.difficulty === 'medium').length,
        hard: questions.filter(q => q.difficulty === 'hard').length
      };

      // Get user's question attempts
      const userQuestionAttempts = userProgress?.questions || [];
      const userQuestionMap = new Map();
      userQuestionAttempts.forEach(q => {
        if (q.questionId) {
          userQuestionMap.set(q.questionId.toString(), q);
        }
      });

      // Map questions with user attempts
      const questionsWithAttempts = questions.map(q => {
        const userAttempt = userQuestionMap.get(q._id?.toString());
        return {
          _id: q._id,
          title: q.title,
          difficulty: q.difficulty,
          score: q.score,
          maxScore: q.score,
          userScore: userAttempt?.score || 0,
          status: userAttempt?.status || 'not_attempted',
          isCorrect: userAttempt?.isCorrect || false,
          attempts: userAttempt?.attempts || 0,
          submittedAt: userAttempt?.submittedAt,
          feedback: userAttempt?.feedback,
          language: userAttempt?.language
        };
      });

      return {
        _id: exercise._id,
        exerciseId: exercise.exerciseInformation?.exerciseId,
        exerciseName: exercise.exerciseInformation?.exerciseName || 'Unnamed Exercise',
        description: exercise.exerciseInformation?.description || '',
        exerciseLevel: exercise.exerciseInformation?.exerciseLevel || 'intermediate',
        totalQuestions,
        totalPoints,
        estimatedTime: exercise.exerciseInformation?.estimatedTime || 0,

        // Entity location
        entity: exercise.entity,
        section: exercise.section,
        subcategory: exercise.subcategory,
        location: exercise.location,

        // User progress
        userProgress: userProgress || {
          status: 'not_started',
          totalScore: 0,
          averageScore: 0,
          completionRate: 0,
          lastAccessed: null
        },

        // Difficulty analysis
        difficultyCount,

        // Questions with user attempts
        questions: questionsWithAttempts,

        // Overall statistics
        statistics: {
          attemptedQuestions: questionsWithAttempts.filter(q => q.status !== 'not_attempted').length,
          solvedQuestions: questionsWithAttempts.filter(q => q.isCorrect === true).length,
          averageScore: calculateAverageScore(userQuestionAttempts),
          totalScore: calculateTotalScore(userQuestionAttempts),
          accuracy: userQuestionAttempts.length > 0
            ? (questionsWithAttempts.filter(q => q.isCorrect).length / userQuestionAttempts.length) * 100
            : 0
        },

        // Dates
        createdAt: exercise.createdAt,
        startDate: exercise.availabilityPeriod?.startDate,
        endDate: exercise.availabilityPeriod?.endDate,

        // Settings
        programmingLanguages: exercise.programmingSettings?.selectedLanguages || [],
        practiceMode: exercise.configurationType?.practiceMode || false,
        manualEvaluation: exercise.configurationType?.manualEvaluation || false
      };
    });

    // 7. Calculate overall course statistics
    const courseStatistics = {
      totalExercises: exercisesWithProgress.length,
      totalQuestions: exercisesWithProgress.reduce((sum, ex) => sum + ex.totalQuestions, 0),
      totalPoints: exercisesWithProgress.reduce((sum, ex) => sum + ex.totalPoints, 0),

      completedExercises: exercisesWithProgress.filter(ex =>
        ex.userProgress.status === 'completed' ||
        ex.userProgress.completionRate >= 100
      ).length,

      inProgressExercises: exercisesWithProgress.filter(ex =>
        ex.userProgress.status === 'in_progress' ||
        (ex.userProgress.completionRate > 0 && ex.userProgress.completionRate < 100)
      ).length,

      notStartedExercises: exercisesWithProgress.filter(ex =>
        ex.userProgress.status === 'not_started' ||
        ex.userProgress.completionRate === 0
      ).length,

      overallScore: exercisesWithProgress.reduce((sum, ex) => sum + ex.userProgress.totalScore, 0),
      overallAverage: exercisesWithProgress.length > 0
        ? exercisesWithProgress.reduce((sum, ex) => sum + ex.userProgress.averageScore, 0) / exercisesWithProgress.length
        : 0,

      overallCompletion: exercisesWithProgress.length > 0
        ? exercisesWithProgress.reduce((sum, ex) => sum + ex.userProgress.completionRate, 0) / exercisesWithProgress.length
        : 0,

      byDifficulty: {
        easy: {
          total: exercisesWithProgress.reduce((sum, ex) => sum + ex.difficultyCount.easy, 0),
          solved: exercisesWithProgress.reduce((sum, ex) =>
            sum + ex.questions.filter(q => q.difficulty === 'easy' && q.isCorrect).length, 0
          )
        },
        medium: {
          total: exercisesWithProgress.reduce((sum, ex) => sum + ex.difficultyCount.medium, 0),
          solved: exercisesWithProgress.reduce((sum, ex) =>
            sum + ex.questions.filter(q => q.difficulty === 'medium' && q.isCorrect).length, 0
          )
        },
        hard: {
          total: exercisesWithProgress.reduce((sum, ex) => sum + ex.difficultyCount.hard, 0),
          solved: exercisesWithProgress.reduce((sum, ex) =>
            sum + ex.questions.filter(q => q.difficulty === 'hard' && q.isCorrect).length, 0
          )
        }
      }
    };

    // 8. Prepare response
    const response = {
      success: true,
      data: {
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        },
        course: {
          _id: courseId,
          exercisesCount: exercisesWithProgress.length
        },
        exercises: exercisesWithProgress,
        statistics: courseStatistics,
        summary: {
          fetchedAt: new Date(),
          totalEntities: allEntities.length,
          exercisesFound: exercisesWithProgress.length,
          userProgressAvailable: userProgressMap.size > 0
        }
      }
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error("❌ Get course exercises with user scores error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};














// Get all exercises for a course (Admin/Program Coordinator View - No enrollment required)
exports.getCourseExercisesAdminView = async (req, res) => {
  try {
    const { courseId } = req.params;
    const {
      includeQuestions = 'false',
      includeUserProgress = 'false',
      userId = null  // Optional: if you want to check a specific user's progress
    } = req.query;

    console.log(`👨‍💼 Admin fetching exercises for Course: ${courseId}`);

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "courseId parameter is required"
      });
    }

    // 1. Get course details
    const course = await CourseStructure.findById(courseId)
      .select('courseName courseCode description startDate endDate status')
      .lean();

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    console.log(`📚 Course found: ${course.courseName}`);

    // 2. Get all entities for this course
    const allEntities = [];

    // Get modules
    const modules = await Module1.find({ courses: courseId })
      .select('_id title description level duration orderIndex pedagogy')
      .sort({ orderIndex: 1 })
      .lean();
    modules.forEach(mod => allEntities.push({ ...mod, type: 'module' }));

    // Get submodules
    const subModules = await SubModule1.find({ courses: courseId })
      .select('_id title description level duration orderIndex pedagogy')
      .sort({ orderIndex: 1 })
      .lean();
    subModules.forEach(sub => allEntities.push({ ...sub, type: 'submodule' }));

    // Get topics
    const topics = await Topic1.find({ courses: courseId })
      .select('_id title description level duration orderIndex pedagogy')
      .sort({ orderIndex: 1 })
      .lean();
    topics.forEach(topic => allEntities.push({ ...topic, type: 'topic' }));

    // Get subtopics
    const subTopics = await SubTopic1.find({ courses: courseId })
      .select('_id title description level duration orderIndex pedagogy')
      .sort({ orderIndex: 1 })
      .lean();
    subTopics.forEach(st => allEntities.push({ ...st, type: 'subtopic' }));

    console.log(`📦 Found ${allEntities.length} entities for course`);

    // 3. Extract all exercises from all entities
    const allExercises = [];
    const entityMap = new Map();

    allEntities.forEach(entity => {
      entityMap.set(entity._id.toString(), {
        type: entity.type,
        title: entity.title,
        description: entity.description,
        level: entity.level,
        duration: entity.duration,
        orderIndex: entity.orderIndex
      });

      if (entity.pedagogy) {
        // Search through all pedagogy sections
        ['I_Do', 'We_Do', 'You_Do'].forEach(section => {
          const sectionData = entity.pedagogy[section];
          if (!sectionData) return;

          // Handle both Map and object formats
          let subcategories = [];
          if (sectionData instanceof Map) {
            subcategories = Array.from(sectionData.entries());
          } else if (typeof sectionData === 'object') {
            subcategories = Object.entries(sectionData);
          }

          subcategories.forEach(([subcategory, value]) => {
            if (!value) return;

            let exercisesArray = [];
            if (Array.isArray(value)) {
              exercisesArray = value;
            } else if (value.exercises && Array.isArray(value.exercises)) {
              exercisesArray = value.exercises;
            } else if (value._id) {
              exercisesArray = [value];
            }

            exercisesArray.forEach(exercise => {
              if (exercise && exercise._id) {
                allExercises.push({
                  ...exercise,
                  entity: {
                    id: entity._id,
                    type: entity.type,
                    title: entity.title,
                    description: entity.description,
                    level: entity.level,
                    duration: entity.duration,
                    orderIndex: entity.orderIndex
                  },
                  section,
                  subcategory,
                  location: `${entity.type}/${entity.title}/${section}/${subcategory}`
                });
              }
            });
          });
        });
      }
    });

    console.log(`📊 Found ${allExercises.length} exercises in course`);

    // 4. Optional: Get user progress if userId is provided
    let userProgressMap = new Map();
    let userDetails = null;

    if (userId && includeUserProgress === 'true') {
      const user = await User.findById(userId)
        .select('firstName lastName email courses')
        .lean();

      if (user) {
        userDetails = {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        };

        // Find user's course progress
        const userCourse = user.courses?.find(c =>
          c.courseId && c.courseId.toString() === courseId
        );

        if (userCourse && userCourse.answers) {
          ['I_Do', 'We_Do', 'You_Do'].forEach(section => {
            const sectionData = userCourse.answers[section];
            if (!sectionData) return;

            // Handle both Map and object formats
            let subcategories = [];
            if (sectionData instanceof Map) {
              subcategories = Array.from(sectionData.entries());
            } else if (typeof sectionData === 'object') {
              subcategories = Object.entries(sectionData);
            }

            subcategories.forEach(([subcategory, value]) => {
              if (!value) return;

              let exercisesArray = [];
              if (Array.isArray(value)) {
                exercisesArray = value;
              } else if (typeof value === 'object' && value.exercises) {
                exercisesArray = value.exercises;
              } else if (value._id) {
                exercisesArray = [value];
              }

              exercisesArray.forEach(userExercise => {
                if (userExercise && userExercise.exerciseId) {
                  userProgressMap.set(userExercise.exerciseId.toString(), {
                    status: userExercise.status || 'not_started',
                    questions: userExercise.questions || [],
                    totalScore: userExercise.questions?.reduce((sum, q) => sum + (q.score || 0), 0) || 0,
                    averageScore: userExercise.questions?.length > 0 ?
                      (userExercise.questions.reduce((sum, q) => sum + (q.score || 0), 0) / userExercise.questions.length) : 0,
                    completionRate: userExercise.questions?.length > 0 ?
                      (userExercise.questions.filter(q => q.status === 'solved' || q.isCorrect === true).length / userExercise.questions.length * 100) : 0,
                    lastAccessed: userExercise.updatedAt,
                    startedAt: userExercise.createdAt
                  });
                }
              });
            });
          });
          console.log(`👤 Found progress for user ${userId}: ${userProgressMap.size} exercises`);
        }
      }
    }

    // 5. Format exercises for response
    const formattedExercises = allExercises.map(exercise => {
      const questions = exercise.questions || [];
      const totalQuestions = questions.length;
      const totalPoints = questions.reduce((sum, q) => sum + (q.score || 0), 0);

      // Get user progress for this exercise if available
      const userProgress = userProgressMap.get(exercise._id.toString());

      // Format exercise data
      const formattedExercise = {
        _id: exercise._id,
        exerciseId: exercise.exerciseInformation?.exerciseId,
        exerciseName: exercise.exerciseInformation?.exerciseName || 'Unnamed Exercise',
        description: exercise.exerciseInformation?.description || '',
        exerciseLevel: exercise.exerciseInformation?.exerciseLevel || 'intermediate',
        totalQuestions,
        totalPoints,
        estimatedTime: exercise.exerciseInformation?.estimatedTime || 0,

        // Entity location
        entity: exercise.entity,
        section: exercise.section,
        subcategory: exercise.subcategory,
        location: exercise.location,

        // Settings
        programmingLanguages: exercise.programmingSettings?.selectedLanguages || [],
        practiceMode: exercise.configurationType?.practiceMode || false,
        manualEvaluation: exercise.configurationType?.manualEvaluation || false,

        // Dates
        createdAt: exercise.createdAt,
        startDate: exercise.availabilityPeriod?.startDate,
        endDate: exercise.availabilityPeriod?.endDate,
        status: exercise.availabilityPeriod?.startDate && exercise.availabilityPeriod?.endDate ?
          (new Date() < new Date(exercise.availabilityPeriod.startDate) ? 'scheduled' :
            new Date() > new Date(exercise.availabilityPeriod.endDate) ? 'expired' : 'active') :
          'no_dates',

        // Question statistics
        questionStatistics: {
          easy: questions.filter(q => q.difficulty === 'easy').length,
          medium: questions.filter(q => q.difficulty === 'medium').length,
          hard: questions.filter(q => q.difficulty === 'hard').length,
          totalQuestions
        }
      };

      // Include questions if requested
      if (includeQuestions === 'true') {
        formattedExercise.questions = questions.map(q => ({
          _id: q._id,
          title: q.title,
          description: q.description,
          difficulty: q.difficulty,
          score: q.score,
          timeLimit: q.timeLimit,
          memoryLimit: q.memoryLimit,
          isActive: q.isActive !== false
        }));
      }

      // Include user progress if available and requested
      if (includeUserProgress === 'true' && userProgress) {
        formattedExercise.userProgress = {
          status: userProgress.status,
          totalScore: userProgress.totalScore,
          averageScore: userProgress.averageScore,
          completionRate: userProgress.completionRate,
          lastAccessed: userProgress.lastAccessed,
          startedAt: userProgress.startedAt,
          questionsAttempted: userProgress.questions?.length || 0,
          questionsSolved: userProgress.questions?.filter(q =>
            q.status === 'solved' || q.isCorrect === true
          ).length || 0
        };
      }

      return formattedExercise;
    });

    // 6. Sort exercises by entity type and order
    formattedExercises.sort((a, b) => {
      // First by entity type order
      const entityOrder = { module: 1, submodule: 2, topic: 3, subtopic: 4 };
      const entityA = entityOrder[a.entity.type] || 5;
      const entityB = entityOrder[b.entity.type] || 5;
      if (entityA !== entityB) return entityA - entityB;

      // Then by entity order index
      if (a.entity.orderIndex !== b.entity.orderIndex) {
        return (a.entity.orderIndex || 999) - (b.entity.orderIndex || 999);
      }

      // Then by entity title
      return a.entity.title.localeCompare(b.entity.title);
    });

    // 7. Group exercises by entity type for better organization
    const exercisesByEntityType = {
      modules: formattedExercises.filter(ex => ex.entity.type === 'module'),
      submodules: formattedExercises.filter(ex => ex.entity.type === 'submodule'),
      topics: formattedExercises.filter(ex => ex.entity.type === 'topic'),
      subtopics: formattedExercises.filter(ex => ex.entity.type === 'subtopic')
    };

    // 8. Calculate course statistics
    const courseStatistics = {
      totalEntities: allEntities.length,
      totalExercises: formattedExercises.length,
      totalQuestions: formattedExercises.reduce((sum, ex) => sum + ex.totalQuestions, 0),
      totalPoints: formattedExercises.reduce((sum, ex) => sum + ex.totalPoints, 0),

      byEntityType: {
        modules: {
          count: exercisesByEntityType.modules.length,
          questions: exercisesByEntityType.modules.reduce((sum, ex) => sum + ex.totalQuestions, 0)
        },
        submodules: {
          count: exercisesByEntityType.submodules.length,
          questions: exercisesByEntityType.submodules.reduce((sum, ex) => sum + ex.totalQuestions, 0)
        },
        topics: {
          count: exercisesByEntityType.topics.length,
          questions: exercisesByEntityType.topics.reduce((sum, ex) => sum + ex.totalQuestions, 0)
        },
        subtopics: {
          count: exercisesByEntityType.subtopics.length,
          questions: exercisesByEntityType.subtopics.reduce((sum, ex) => sum + ex.totalQuestions, 0)
        }
      },

      bySection: {
        I_Do: formattedExercises.filter(ex => ex.section === 'I_Do').length,
        We_Do: formattedExercises.filter(ex => ex.section === 'We_Do').length,
        You_Do: formattedExercises.filter(ex => ex.section === 'You_Do').length
      },

      byDifficulty: {
        easy: formattedExercises.reduce((sum, ex) => sum + ex.questionStatistics.easy, 0),
        medium: formattedExercises.reduce((sum, ex) => sum + ex.questionStatistics.medium, 0),
        hard: formattedExercises.reduce((sum, ex) => sum + ex.questionStatistics.hard, 0)
      },

      byStatus: {
        active: formattedExercises.filter(ex => ex.status === 'active').length,
        scheduled: formattedExercises.filter(ex => ex.status === 'scheduled').length,
        expired: formattedExercises.filter(ex => ex.status === 'expired').length,
        no_dates: formattedExercises.filter(ex => ex.status === 'no_dates').length
      }
    };

    // 9. Prepare final response
    const response = {
      success: true,
      data: {
        course: {
          _id: course._id,
          name: course.courseName,
          code: course.courseCode,
          description: course.description,
          startDate: course.startDate,
          endDate: course.endDate,
          status: course.status
        },

        // User details if provided
        ...(userDetails && { user: userDetails }),

        // Exercises in different formats
        exercises: formattedExercises,
        exercisesByEntityType,

        // Statistics
        statistics: courseStatistics,

        // Summary
        summary: {
          fetchedAt: new Date(),
          totalExercises: formattedExercises.length,
          includeQuestions: includeQuestions === 'true',
          includeUserProgress: includeUserProgress === 'true',
          userProgressAvailable: userProgressMap.size > 0
        }
      }
    };

    console.log(`✅ Admin view generated for course ${courseId}`);
    console.log(`   Total exercises: ${formattedExercises.length}`);
    console.log(`   Total questions: ${courseStatistics.totalQuestions}`);
    console.log(`   User progress included: ${includeUserProgress === 'true'}`);

    return res.status(200).json(response);

  } catch (error) {
    console.error("❌ Get course exercises (admin view) error:", error);
    console.error("❌ Error stack:", error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

exports.getEnrolledStudentsForExercise = async (req, res) => {
  try {
    const { courseId, exerciseId } = req.params;
    const {
      includeProgress = 'true',
      search = '',
      page = 1,
      limit = 20,
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    console.log(`👨‍🏫 Fetching enrolled students for Exercise: ${exerciseId} in Course: ${courseId}`);

    if (!courseId || !exerciseId) {
      return res.status(400).json({
        success: false,
        message: "courseId and exerciseId parameters are required"
      });
    }

    // 1. Get course details
    const course = await CourseStructure.findById(courseId)
      .select('courseName courseCode description')
      .lean();

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // 2. Get exercise details to verify it exists and get grade settings
    let exerciseDetails = null;
    let exerciseFoundIn = null;
    let gradeSettings = null;
    let totalMaxScore = 0;
    let exerciseName = '';

    // Search for exercise in all entity types
    const entityModels = [
      { name: 'Module1', model: Module1 },
      { name: 'SubModule1', model: SubModule1 },
      { name: 'Topic1', model: Topic1 },
      { name: 'SubTopic1', model: SubTopic1 }
    ];

    for (const { name, model } of entityModels) {
      try {
        const entities = await model.find({ courses: courseId })
          .select('_id title pedagogy')
          .lean();

        for (const entity of entities) {
          if (entity.pedagogy) {
            ['I_Do', 'We_Do', 'You_Do'].forEach(section => {
              if (entity.pedagogy[section]) {
                const sectionData = entity.pedagogy[section];
                let subcategories = [];

                if (sectionData instanceof Map) {
                  subcategories = Array.from(sectionData.entries());
                } else if (typeof sectionData === 'object') {
                  subcategories = Object.entries(sectionData);
                }

                subcategories.forEach(([subcategory, exercises]) => {
                  if (!exercises) return;

                  let exercisesArray = [];
                  if (Array.isArray(exercises)) {
                    exercisesArray = exercises;
                  } else if (exercises._id) {
                    exercisesArray = [exercises];
                  }

                  const exercise = exercisesArray.find(ex =>
                    ex._id && ex._id.toString() === exerciseId
                  );

                  if (exercise) {
                    exerciseDetails = {
                      ...exercise,
                      entity: {
                        type: name,
                        id: entity._id,
                        title: entity.title
                      },
                      section,
                      subcategory
                    };
                    exerciseFoundIn = { name, entity, section, subcategory };

                    // Get grade settings
                    gradeSettings = exercise.gradeSettings || null;

                    // Get exercise name
                    exerciseName = exercise.exerciseInformation?.exerciseName ||
                      exercise.exerciseName ||
                      'Unnamed Exercise';

                    // Calculate total max score
                    if (exercise.questions && Array.isArray(exercise.questions)) {
                      totalMaxScore = exercise.questions.reduce((sum, q) => {
                        const qScore = q.mcqQuestionScore || q.score || 10;
                        return sum + qScore;
                      }, 0);
                    }

                    console.log(`✅ Found exercise: ${exerciseName}`);
                    console.log(`   Grade Settings:`, gradeSettings);
                    console.log(`   Total Max Score: ${totalMaxScore}`);
                  }
                });
              }
            });
          }
        }
        if (exerciseDetails) break;
      } catch (err) {
        console.log(`Error searching in ${name}:`, err.message);
      }
    }

    if (!exerciseDetails) {
      return res.status(404).json({
        success: false,
        message: "Exercise not found in course structure"
      });
    }

    console.log(`✅ Exercise found: ${exerciseName}`);

    // 3. Get all enrolled users for this course
    const enrolledUsers = await User.find({
      courses: { $exists: true, $ne: null }
    })
      .select('_id firstName lastName email profile phone status createdAt role courses')
      .lean();

    console.log(`👥 Found ${enrolledUsers.length} users with courses data`);

    // Filter users who are enrolled in this specific course
    const enrolledInCourse = enrolledUsers.filter(user => {
      if (!user.courses || !Array.isArray(user.courses)) {
        return false;
      }
      return user.courses.some(course =>
        course && course.courseId && course.courseId.toString() === courseId
      );
    });

    console.log(`📊 ${enrolledInCourse.length} users enrolled in course ${courseId}`);

    // 4. Process each user to find their exercise progress with Pass/Fail
    const studentsWithProgress = await Promise.all(
      enrolledInCourse.map(async (user) => {
        const userCourses = user.courses || [];
        const userCourse = userCourses.find(c =>
          c && c.courseId && c.courseId.toString() === courseId
        );

        let exerciseProgress = null;
        let questionAttempts = [];
        let overallScore = 0;
        let completionPercentage = 0;
        let lastActivity = null;
        let status = 'not_started';
        let isPassing = false;
        let passingMarksRequired = null;

        if (userCourse && userCourse.answers) {
          // Search through all sections for this exercise
          ['I_Do', 'We_Do', 'You_Do'].forEach(section => {
            const sectionData = userCourse.answers[section];
            if (!sectionData) return;

            // Handle both Map and object formats
            let subcategories = [];
            if (sectionData instanceof Map) {
              subcategories = Array.from(sectionData.entries());
            } else if (typeof sectionData === 'object') {
              subcategories = Object.entries(sectionData);
            }

            subcategories.forEach(([subcategory, exercises]) => {
              if (!exercises) return;

              let exercisesArray = [];
              if (Array.isArray(exercises)) {
                exercisesArray = exercises;
              } else if (typeof exercises === 'object' && exercises._id) {
                exercisesArray = [exercises];
              }

              if (!exercisesArray || !Array.isArray(exercisesArray)) {
                return;
              }

              const userExercise = exercisesArray.find(ex =>
                ex && ex.exerciseId && ex.exerciseId.toString() === exerciseId
              );

              if (userExercise) {
                exerciseProgress = userExercise;
                questionAttempts = userExercise.questions || [];

                // Calculate overall score
                overallScore = questionAttempts.reduce((sum, q) => sum + (q.score || 0), 0);

                // Calculate completion percentage
                const totalQuestions = exerciseDetails.questions?.length || 0;
                const attemptedQuestions = questionAttempts.length;
                completionPercentage = totalQuestions > 0 ?
                  (attemptedQuestions / totalQuestions) * 100 : 0;

                // Determine status based on exercise type
                const isMCQExercise = exerciseDetails.exerciseType === 'MCQ' ||
                  (exerciseDetails.questions && exerciseDetails.questions.every(q => q.questionType === 'MCQ'));

                if (questionAttempts.length === 0) {
                  status = 'not_started';
                } else if (isMCQExercise) {
                  // For MCQ exercises, they're auto-evaluated when answered
                  status = 'evaluated';
                } else if (questionAttempts.some(q => q.status === 'submitted' || q.status === 'attempted')) {
                  status = 'in_progress';
                } else if (questionAttempts.every(q => q.status === 'evaluated')) {
                  status = 'evaluated';
                } else if (questionAttempts.every(q => q.status === 'solved' || q.status === 'completed')) {
                  status = 'completed';
                }

                lastActivity = userExercise.updatedAt || userExercise.createdAt;
              }
            });
          });
        }

        // Calculate Pass/Fail based on grade settings
        if (gradeSettings) {
          // Use mcqGradeToPass for MCQ exercises
          passingMarksRequired = gradeSettings.mcqGradeToPass ||
            gradeSettings.programmingGradeToPass ||
            gradeSettings.combinedGradeToPass ||
            (totalMaxScore * 0.4); // Default 40% if not specified

          // Check if student has passed
          isPassing = overallScore >= passingMarksRequired;

          console.log(`Student ${user.firstName} ${user.lastName}: Score ${overallScore}/${totalMaxScore}, Pass Mark ${passingMarksRequired}, Passing: ${isPassing}`);
        } else {
          // Default: 50% passing mark
          passingMarksRequired = totalMaxScore * 0.5;
          isPassing = overallScore >= passingMarksRequired;
        }

        // Get user role name
        let roleName = 'Student';
        if (user.role) {
          if (mongoose.Types.ObjectId.isValid(user.role)) {
            const roleDoc = await mongoose.model('Role').findById(user.role).lean();
            roleName = roleDoc?.renameRole || roleDoc?.originalRole || 'Student';
          } else if (typeof user.role === 'string') {
            roleName = user.role;
          }
        }

        let enrolledAt = user.createdAt;
        if (userCourse && userCourse.enrolledAt) {
          enrolledAt = userCourse.enrolledAt;
        } else if (userCourse && userCourse.createdAt) {
          enrolledAt = userCourse.createdAt;
        }

        return {
          _id: user._id,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          firstName: user.firstName || '',
          lastName: user.lastName || '',
          email: user.email || '',
          profile: user.profile || '',
          phone: user.phone || '',
          status: user.status || 'active',
          role: roleName,
          enrolledAt: enrolledAt,
          lastAccessed: userCourse?.lastAccessed,

          // Exercise-specific progress with Pass/Fail
          exerciseProgress: includeProgress === 'true' ? {
            status,
            overallScore,
            completionPercentage: completionPercentage.toFixed(2),
            questionsAttempted: questionAttempts.length,
            questionsTotal: exerciseDetails.questions?.length || 0,
            lastActivity,
            startedAt: exerciseProgress?.createdAt,
            submittedAt: exerciseProgress?.updatedAt,
            isPassing: isPassing,
            passingMarksRequired: passingMarksRequired,
            totalMaxScore: totalMaxScore,

            // Detailed question attempts
            questionAttempts: includeProgress === 'true' ? questionAttempts.map(q => ({
              questionId: q.questionId,
              title: q.questionTitle || `Question ${q.questionId?.toString().substring(0, 8)}...`,
              score: q.score || 0,
              totalScore: q.totalScore || 0,
              status: q.status || 'attempted',
              isCorrect: q.isCorrect || false,
              attempts: q.attempts || 1,
              submittedAt: q.submittedAt,
              evaluatedAt: q.evaluatedAt,
              feedback: q.feedback || ''
            })) : [],

            projectType: exerciseProgress?.projectType,
            fileCount: exerciseProgress?.questions?.[0]?.files?.length || 0,
            folderCount: exerciseProgress?.questions?.[0]?.folders?.length || 0
          } : null
        };
      })
    );

    // 5. Apply search filter if provided
    let filteredStudents = studentsWithProgress;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredStudents = studentsWithProgress.filter(student =>
        (student.name && student.name.toLowerCase().includes(searchLower)) ||
        (student.email && student.email.toLowerCase().includes(searchLower)) ||
        (student.role && student.role.toLowerCase().includes(searchLower))
      );
    }

    // 6. Apply sorting
    filteredStudents.sort((a, b) => {
      let aValue, bValue;

      switch (sortBy) {
        case 'progress':
          aValue = a.exerciseProgress?.completionPercentage || 0;
          bValue = b.exerciseProgress?.completionPercentage || 0;
          break;
        case 'score':
          aValue = a.exerciseProgress?.overallScore || 0;
          bValue = b.exerciseProgress?.overallScore || 0;
          break;
        case 'passing':
          aValue = a.exerciseProgress?.isPassing ? 1 : 0;
          bValue = b.exerciseProgress?.isPassing ? 1 : 0;
          break;
        case 'lastAccessed':
          aValue = a.exerciseProgress?.lastActivity ? new Date(a.exerciseProgress.lastActivity).getTime() : 0;
          bValue = b.exerciseProgress?.lastActivity ? new Date(b.exerciseProgress.lastActivity).getTime() : 0;
          break;
        case 'name':
        default:
          aValue = a.name ? a.name.toLowerCase() : '';
          bValue = b.name ? b.name.toLowerCase() : '';
      }

      if (sortOrder === 'desc') {
        return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
      } else {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      }
    });

    // 7. Apply pagination
    const totalStudents = filteredStudents.length;
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedStudents = filteredStudents.slice(startIndex, endIndex);

    // 8. Calculate exercise statistics with Pass/Fail counts
    const studentsWithProgressOnly = studentsWithProgress.filter(s =>
      s.exerciseProgress && s.exerciseProgress.status !== 'not_started'
    );

    const exerciseStatistics = {
      totalEnrolled: enrolledInCourse.length,
      studentsWithProgress: studentsWithProgressOnly.length,

      byStatus: {
        not_started: studentsWithProgress.filter(s =>
          s.exerciseProgress && s.exerciseProgress.status === 'not_started'
        ).length,
        in_progress: studentsWithProgress.filter(s =>
          s.exerciseProgress && s.exerciseProgress.status === 'in_progress'
        ).length,
        completed: studentsWithProgress.filter(s =>
          s.exerciseProgress && s.exerciseProgress.status === 'completed'
        ).length,
        evaluated: studentsWithProgress.filter(s =>
          s.exerciseProgress && s.exerciseProgress.status === 'evaluated'
        ).length
      },

      byPassFail: {
        pass: studentsWithProgressOnly.filter(s =>
          s.exerciseProgress && s.exerciseProgress.isPassing === true
        ).length,
        fail: studentsWithProgressOnly.filter(s =>
          s.exerciseProgress && s.exerciseProgress.isPassing === false
        ).length,
        not_started: studentsWithProgress.filter(s =>
          !s.exerciseProgress || s.exerciseProgress.status === 'not_started'
        ).length
      },

      averageScore: studentsWithProgressOnly.length > 0 ?
        studentsWithProgressOnly.reduce((sum, s) => sum + (s.exerciseProgress?.overallScore || 0), 0) /
        studentsWithProgressOnly.length : 0,

      averageCompletion: studentsWithProgressOnly.length > 0 ?
        studentsWithProgressOnly.reduce((sum, s) => sum + parseFloat(s.exerciseProgress?.completionPercentage || 0), 0) /
        studentsWithProgressOnly.length : 0,

      passingMarksRequired: gradeSettings?.mcqGradeToPass ||
        gradeSettings?.programmingGradeToPass ||
        gradeSettings?.combinedGradeToPass ||
        (totalMaxScore * 0.4),

      totalMaxScore: totalMaxScore,

      scoreDistribution: {
        '0-20': studentsWithProgressOnly.filter(s => (s.exerciseProgress?.overallScore || 0) <= 20).length,
        '21-40': studentsWithProgressOnly.filter(s => (s.exerciseProgress?.overallScore || 0) > 20 &&
          (s.exerciseProgress?.overallScore || 0) <= 40).length,
        '41-60': studentsWithProgressOnly.filter(s => (s.exerciseProgress?.overallScore || 0) > 40 &&
          (s.exerciseProgress?.overallScore || 0) <= 60).length,
        '61-80': studentsWithProgressOnly.filter(s => (s.exerciseProgress?.overallScore || 0) > 60 &&
          (s.exerciseProgress?.overallScore || 0) <= 80).length,
        '81-100': studentsWithProgressOnly.filter(s => (s.exerciseProgress?.overallScore || 0) > 80).length
      }
    };

    // 9. Prepare final response
    const responseData = {
      success: true,
      data: {
        course: {
          _id: course._id,
          name: course.courseName,
          code: course.courseCode,
          description: course.description
        },

        exercise: {
          _id: exerciseDetails._id,
          exerciseId: exerciseDetails.exerciseInformation?.exerciseId,
          name: exerciseName,
          description: exerciseDetails.exerciseInformation?.description || '',
          level: exerciseDetails.exerciseInformation?.exerciseLevel || 'intermediate',
          totalQuestions: exerciseDetails.questions?.length || 0,
          totalPoints: totalMaxScore,
          exerciseType: exerciseDetails.exerciseType ||
            (exerciseDetails.questions?.every(q => q.questionType === 'MCQ') ? 'MCQ' : 'Programming'),
          gradeSettings: gradeSettings,
          passingMarksRequired: gradeSettings?.mcqGradeToPass ||
            gradeSettings?.programmingGradeToPass ||
            gradeSettings?.combinedGradeToPass,

          location: {
            entityType: exerciseFoundIn?.name,
            entityTitle: exerciseFoundIn?.entity?.title,
            section: exerciseFoundIn?.section,
            subcategory: exerciseFoundIn?.subcategory
          },

          questions: exerciseDetails.questions?.map(q => ({
            _id: q._id,
            title: q.mcqQuestionTitle || q.title || 'Untitled Question',
            difficulty: q.mcqQuestionDifficulty || q.difficulty || 'medium',
            score: q.mcqQuestionScore || q.score || 10
          })) || []
        },

        students: paginatedStudents,

        statistics: exerciseStatistics,

        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalStudents,
          pages: Math.ceil(totalStudents / parseInt(limit)),
          showing: paginatedStudents.length
        },

        filters: {
          search,
          includeProgress: includeProgress === 'true',
          sortBy,
          sortOrder
        },

        summary: {
          fetchedAt: new Date(),
          totalEnrolled: enrolledInCourse.length,
          exerciseFound: true,
          exerciseName: exerciseName,
          totalMaxScore: totalMaxScore,
          passingMarks: gradeSettings?.mcqGradeToPass || gradeSettings?.programmingGradeToPass || totalMaxScore * 0.4
        }
      }
    };

    console.log(`✅ Exercise student list generated`);
    console.log(`   Total enrolled: ${enrolledInCourse.length}`);
    console.log(`   With progress: ${exerciseStatistics.studentsWithProgress}`);
    console.log(`   Pass: ${exerciseStatistics.byPassFail.pass}, Fail: ${exerciseStatistics.byPassFail.fail}`);
    console.log(`   Page ${page}: ${paginatedStudents.length} students`);

    return res.status(200).json(responseData);

  } catch (error) {
    console.error("❌ Get enrolled students for exercise error:", error);
    console.error("❌ Error stack:", error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};



// Get exercise questions with student's answers for admin/coordinator view
exports.getStudentExerciseQuestions = async (req, res) => {
  try {
    const { courseId, studentId, exerciseId } = req.params;
    const {
      includeCorrectAnswers = 'true',  // Whether to include correct answers
      includeTestCases = 'false',      // Whether to include test cases
      includeHints = 'false'           // Whether to include hints
    } = req.query;

    console.log(`👨‍🏫 Admin viewing student exercise questions`);
    console.log(`Course: ${courseId}, Student: ${studentId}, Exercise: ${exerciseId}`);

    // 1. Validate required parameters
    if (!courseId || !studentId || !exerciseId) {
      return res.status(400).json({
        success: false,
        message: "courseId, studentId, and exerciseId are required"
      });
    }

    // 2. Get student details
    const student = await User.findById(studentId)
      .select('_id firstName lastName email profile status createdAt')
      .lean();

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student not found"
      });
    }

    // 3. Get course details
    const course = await CourseStructure.findById(courseId)
      .select('courseName courseCode description')
      .lean();

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // 4. Check if student is enrolled
    const studentWithCourses = await User.findById(studentId)
      .select('courses')
      .lean();

    const isEnrolled = studentWithCourses?.courses?.some(c =>
      c.courseId && c.courseId.toString() === courseId
    );

    if (!isEnrolled) {
      return res.status(404).json({
        success: false,
        message: "Student is not enrolled in this course"
      });
    }

    // 5. Find the exercise in course structure to get question details
    let exerciseDetails = null;
    let exerciseLocation = null;

    // Search in all entity types
    const entityModels = [
      { name: 'Module1', model: Module1 },
      { name: 'SubModule1', model: SubModule1 },
      { name: 'Topic1', model: Topic1 },
      { name: 'SubTopic1', model: SubTopic1 }
    ];

    for (const { name, model } of entityModels) {
      try {
        const entities = await model.find({ courses: courseId })
          .select('_id title pedagogy')
          .lean();

        for (const entity of entities) {
          if (entity.pedagogy) {
            ['I_Do', 'We_Do', 'You_Do'].forEach(section => {
              if (entity.pedagogy[section]) {
                const sectionData = entity.pedagogy[section];
                let subcategories = [];

                if (sectionData instanceof Map) {
                  subcategories = Array.from(sectionData.entries());
                } else if (typeof sectionData === 'object') {
                  subcategories = Object.entries(sectionData);
                }

                subcategories.forEach(([subcategory, exercises]) => {
                  if (!exercises) return;

                  let exercisesArray = [];
                  if (Array.isArray(exercises)) {
                    exercisesArray = exercises;
                  } else if (exercises._id) {
                    exercisesArray = [exercises];
                  }

                  const exercise = exercisesArray.find(ex =>
                    ex._id && ex._id.toString() === exerciseId
                  );

                  if (exercise) {
                    exerciseDetails = exercise;
                    exerciseLocation = {
                      entityType: name,
                      entityId: entity._id,
                      entityTitle: entity.title,
                      section,
                      subcategory,
                      fullPath: `${name}/${entity.title}/${section}/${subcategory}`
                    };
                  }
                });
              }
            });
          }
        }
        if (exerciseDetails) break;
      } catch (err) {
        console.log(`Error searching in ${name}:`, err.message);
      }
    }

    if (!exerciseDetails) {
      return res.status(404).json({
        success: false,
        message: "Exercise not found in course structure"
      });
    }


    // 6. Get student's answers for this exercise
    const studentWithAnswers = await User.findById(studentId)
      .select('courses')
      .lean();

    let studentAnswers = [];
    let exerciseProgress = null;
    let foundInCategory = null;

    if (studentWithAnswers?.courses) {
      const userCourse = studentWithAnswers.courses.find(c =>
        c.courseId && c.courseId.toString() === courseId
      );

      if (userCourse && userCourse.answers) {
        // Search through all categories
        ['I_Do', 'We_Do', 'You_Do'].forEach(category => {
          if (userCourse.answers[category]) {
            const categoryData = userCourse.answers[category];

            // Handle both Map and object formats
            let exercisesArray = [];
            if (categoryData instanceof Map) {
              const allExercises = [];
              categoryData.forEach((exArray, key) => {
                if (Array.isArray(exArray)) {
                  allExercises.push(...exArray);
                }
              });
              exercisesArray = allExercises;
            } else if (typeof categoryData === 'object') {
              exercisesArray = Object.values(categoryData).flat();
            }

            const userExercise = exercisesArray.find(ex =>
              ex.exerciseId && ex.exerciseId.toString() === exerciseId
            );

            if (userExercise) {
              studentAnswers = userExercise.questions || [];
              exerciseProgress = {
                status: userExercise.status || 'not_started',
                totalScore: userExercise.questions?.reduce((sum, q) => sum + (q.score || 0), 0) || 0,
                averageScore: userExercise.questions?.length > 0 ?
                  (userExercise.questions.reduce((sum, q) => sum + (q.score || 0), 0) / userExercise.questions.length) : 0,
                questionsAttempted: userExercise.questions?.length || 0,
                lastActivity: userExercise.updatedAt || userExercise.createdAt,
                startedAt: userExercise.createdAt,
                projectType: userExercise.projectType,
                fileCount: userExercise.questions?.[0]?.files?.length || 0,
                folderCount: userExercise.questions?.[0]?.folders?.length || 0
              };
              foundInCategory = category;
            }
          }
        });
      }
    }


    // 7. Create a map of student answers for easy lookup
    const studentAnswerMap = new Map();
    studentAnswers.forEach(answer => {
      if (answer.questionId) {
        const questionId = answer.questionId.toString ? answer.questionId.toString() : String(answer.questionId);
        studentAnswerMap.set(questionId, answer);
      }
    });

    // 8. Get exercise questions and combine with student answers
    const exerciseQuestions = exerciseDetails.questions || [];

    const questionsWithStudentAnswers = exerciseQuestions.map((question, index) => {
      const questionId = question._id?.toString();
      const studentAnswer = questionId ? studentAnswerMap.get(questionId) : null;

      // Format the question with student answer
      const formattedQuestion = {
        _id: question._id,
        sequence: question.sequence || index + 1,
        title: question.title || `Question ${index + 1}`,
        description: question.description || '',
        difficulty: question.difficulty || 'medium',
        score: question.score || 10,
        timeLimit: question.timeLimit || 2000,
        memoryLimit: question.memoryLimit || 256,
        isActive: question.isActive !== false,
        createdAt: question.createdAt,

        // Student's attempt (if any)
        studentAttempt: studentAnswer ? {
          _id: studentAnswer._id,
          questionId: studentAnswer.questionId,
          questionTitle: studentAnswer.questionTitle || question.title,

          // Code submission details
          codeAnswer: studentAnswer.codeAnswer || '',
          language: studentAnswer.language || '',

          // Multi-file project details
          files: studentAnswer.files || [],
          folders: studentAnswer.folders || [],
          projectStructure: studentAnswer.projectStructure || {},
          entryPoints: studentAnswer.entryPoints || [],
          isMultiFile: !!(studentAnswer.files && studentAnswer.files.length > 0),

          // Evaluation details
          score: studentAnswer.score || 0,
          totalScore: studentAnswer.totalScore || question.score || 10,
          percentage: studentAnswer.totalScore > 0 ?
            ((studentAnswer.score || 0) / studentAnswer.totalScore * 100).toFixed(2) :
            (question.score > 0 ? ((studentAnswer.score || 0) / question.score * 100).toFixed(2) : 0),
          isCorrect: studentAnswer.isCorrect || false,
          status: studentAnswer.status || 'attempted',
          attempts: studentAnswer.attempts || 1,
          feedback: studentAnswer.feedback || '',

          // Submission details
          submittedAt: studentAnswer.submittedAt,
          evaluatedAt: studentAnswer.evaluatedAt,
          evaluatedBy: studentAnswer.evaluatedBy,
          createdAt: studentAnswer.createdAt,
          updatedAt: studentAnswer.updatedAt
        } : null,

        // Question details (conditionally included)
        ...(includeCorrectAnswers === 'true' && {
          sampleInput: question.sampleInput || '',
          sampleOutput: question.sampleOutput || '',
          constraints: question.constraints || [],
          solutions: question.solutions || {}
        }),

        ...(includeHints === 'true' && {
          hints: question.hints || []
        }),

        ...(includeTestCases === 'true' && {
          testCases: question.testCases || []
        })
      };

      return formattedQuestion;
    });

    // 9. Calculate statistics
    const attemptedQuestions = questionsWithStudentAnswers.filter(q => q.studentAttempt).length;
    const solvedQuestions = questionsWithStudentAnswers.filter(q =>
      q.studentAttempt && (q.studentAttempt.isCorrect || q.studentAttempt.status === 'solved')
    ).length;

    const totalScoreObtained = questionsWithStudentAnswers.reduce((sum, q) =>
      sum + (q.studentAttempt?.score || 0), 0
    );

    const totalPossibleScore = questionsWithStudentAnswers.reduce((sum, q) =>
      sum + q.score, 0
    );

    const overallPercentage = totalPossibleScore > 0 ?
      (totalScoreObtained / totalPossibleScore * 100).toFixed(2) : 0;

    // 10. Prepare response
    const response = {
      success: true,
      data: {
        // Student information
        student: {
          _id: student._id,
          name: `${student.firstName} ${student.lastName || ''}`,
          email: student.email,
          profile: student.profile || '',
          status: student.status || 'active',
          enrolled: isEnrolled
        },

        // Course information
        course: {
          _id: course._id,
          name: course.courseName,
          code: course.courseCode,
          description: course.description
        },

        // Exercise information
        exercise: {
          _id: exerciseDetails._id,
          exerciseId: exerciseDetails.exerciseInformation?.exerciseId,
          name: exerciseDetails.exerciseInformation?.exerciseName || 'Unnamed Exercise',
          description: exerciseDetails.exerciseInformation?.description || '',
          level: exerciseDetails.exerciseInformation?.exerciseLevel || 'intermediate',
          totalDuration: exerciseDetails.exerciseInformation?.totalDuration || 0,
          createdAt: exerciseDetails.createdAt,

          // Location in course structure
          location: exerciseLocation,

          // Exercise settings
          programmingLanguages: exerciseDetails.programmingSettings?.selectedLanguages || [],
          practiceMode: exerciseDetails.configurationType?.practiceMode || false,
          manualEvaluation: exerciseDetails.configurationType?.manualEvaluation || false,
          availabilityPeriod: exerciseDetails.availabilityPeriod || {}
        },

        // Questions with student answers
        questions: questionsWithStudentAnswers,

        // Student's overall progress for this exercise
        studentProgress: {
          ...exerciseProgress,
          questionsAttempted: attemptedQuestions,
          questionsTotal: questionsWithStudentAnswers.length,
          questionsSolved: solvedQuestions,
          completionPercentage: questionsWithStudentAnswers.length > 0 ?
            (attemptedQuestions / questionsWithStudentAnswers.length * 100).toFixed(2) : 0,
          totalScoreObtained,
          totalPossibleScore,
          overallPercentage,
          foundInCategory
        },

        // Statistics
        statistics: {
          totalQuestions: questionsWithStudentAnswers.length,
          attemptedQuestions,
          solvedQuestions,
          pendingQuestions: questionsWithStudentAnswers.length - attemptedQuestions,
          averageScore: attemptedQuestions > 0 ? (totalScoreObtained / attemptedQuestions).toFixed(2) : 0,
          byDifficulty: {
            easy: {
              total: questionsWithStudentAnswers.filter(q => q.difficulty === 'easy').length,
              attempted: questionsWithStudentAnswers.filter(q => q.difficulty === 'easy' && q.studentAttempt).length,
              solved: questionsWithStudentAnswers.filter(q => q.difficulty === 'easy' && q.studentAttempt?.isCorrect).length
            },
            medium: {
              total: questionsWithStudentAnswers.filter(q => q.difficulty === 'medium').length,
              attempted: questionsWithStudentAnswers.filter(q => q.difficulty === 'medium' && q.studentAttempt).length,
              solved: questionsWithStudentAnswers.filter(q => q.difficulty === 'medium' && q.studentAttempt?.isCorrect).length
            },
            hard: {
              total: questionsWithStudentAnswers.filter(q => q.difficulty === 'hard').length,
              attempted: questionsWithStudentAnswers.filter(q => q.difficulty === 'hard' && q.studentAttempt).length,
              solved: questionsWithStudentAnswers.filter(q => q.difficulty === 'hard' && q.studentAttempt?.isCorrect).length
            }
          }
        },

        // Summary
        summary: {
          fetchedAt: new Date(),
          includeCorrectAnswers: includeCorrectAnswers === 'true',
          includeTestCases: includeTestCases === 'true',
          includeHints: includeHints === 'true',
          hasStudentAnswers: studentAnswers.length > 0,
          isMultiFileProject: questionsWithStudentAnswers.some(q => q.studentAttempt?.isMultiFile)
        }
      }
    };



    return res.status(200).json(response);

  } catch (error) {
    console.error("❌ Get student exercise questions error:", error);
    console.error("❌ Error stack:", error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};


async function uploadImageToSupabase(file, folderPath) {
  try {
    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `${timestamp}_${sanitizedName}`;
    const filePath = `question/${folderPath}/${fileName}`;

    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from("smartlms")
      .upload(filePath, file.data, {
        contentType: file.mimetype,
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    // Generate public URL
    const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/${filePath}`;

    return imageUrl;

  } catch (error) {
    console.error("❌ Image upload failed:", error);
    throw error;
  }
}
exports.addMCQQuestions = async (req, res) => {
  try {
    const { type, id, exerciseId } = req.params;
    let { tabType, subcategory, questionsData } = req.body;

    if (typeof questionsData === 'string') {
      try {
        questionsData = JSON.parse(questionsData);
      } catch (parseError) {
        console.error('❌ Failed to parse questionsData JSON:', parseError);
        return res.status(400).json({
          message: [{ key: "error", value: "Invalid questionsData format. Must be valid JSON array." }]
        });
      }
    }

    if (!type || !modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}` }]
      });
    }

    if (!Array.isArray(questionsData) || questionsData.length === 0) {
      console.error('❌ questionsData is not an array or empty:', questionsData);
      return res.status(400).json({
        message: [{ key: "error", value: "questionsData must be a non-empty array" }]
      });
    }

    // Option-based types that require mcqQuestionOptions validation
    const OPTION_BASED_TYPES = ['multiple_choice', 'multiple_select', 'dropdown', 'checkboxes'];
    // Text-based types that don't require options
    const TEXT_BASED_TYPES = ['short_answer', 'essay'];
    // Other types
    const OTHER_TYPES = ['true_false', 'numeric', 'matching', 'ordering'];

    const processedQuestions = [];

    for (let i = 0; i < questionsData.length; i++) {
      const question = questionsData[i];
      
      // Debug log to see what we're receiving
      console.log(`📝 Question ${i + 1} title type:`, typeof question.mcqQuestionTitle);
      console.log(`📝 Question ${i + 1} title value:`, question.mcqQuestionTitle);
      
      // Validate question title - Handle different data types
      let isValidTitle = false;
      let processedTitle = '';
      
      if (question.mcqQuestionTitle !== undefined && question.mcqQuestionTitle !== null) {
        if (typeof question.mcqQuestionTitle === 'string') {
          processedTitle = question.mcqQuestionTitle.trim();
          isValidTitle = processedTitle.length > 0;
        } else if (Array.isArray(question.mcqQuestionTitle)) {
          processedTitle = question.mcqQuestionTitle;
          isValidTitle = question.mcqQuestionTitle.length > 0;
        } else if (typeof question.mcqQuestionTitle === 'object') {
          // Handle object case - convert to string or use a property
          console.warn(`⚠️ Question ${i + 1}: mcqQuestionTitle is an object:`, question.mcqQuestionTitle);
          // Try to extract text from common patterns
          if (question.mcqQuestionTitle.text) {
            processedTitle = question.mcqQuestionTitle.text.trim();
          } else if (question.mcqQuestionTitle.title) {
            processedTitle = question.mcqQuestionTitle.title.trim();
          } else {
            processedTitle = JSON.stringify(question.mcqQuestionTitle);
          }
          isValidTitle = processedTitle.length > 0;
        } else if (typeof question.mcqQuestionTitle === 'number' || typeof question.mcqQuestionTitle === 'boolean') {
          // Convert numbers and booleans to string
          processedTitle = String(question.mcqQuestionTitle);
          isValidTitle = processedTitle.trim().length > 0;
        } else {
          processedTitle = String(question.mcqQuestionTitle || '').trim();
          isValidTitle = processedTitle.length > 0;
        }
      }
      
      if (!isValidTitle) {
        return res.status(400).json({
          message: [{ key: "error", value: `Question ${i + 1}: MCQ question title is required and must be a non-empty string or array` }]
        });
      }

      // Validate question type
      if (!question.mcqQuestionType) {
        return res.status(400).json({
          message: [{ key: "error", value: `Question ${i + 1}: MCQ question type is required` }]
        });
      }

      const isOptionBased = OPTION_BASED_TYPES.includes(question.mcqQuestionType);
      const isTextBased = TEXT_BASED_TYPES.includes(question.mcqQuestionType);

      // Validate options for option-based types
      if (isOptionBased) {
        if (!Array.isArray(question.mcqQuestionOptions) || question.mcqQuestionOptions.length < 2) {
          return res.status(400).json({
            message: [{ key: "error", value: `Question ${i + 1}: At least 2 options are required` }]
          });
        }

        if (!Array.isArray(question.mcqQuestionCorrectAnswers) || question.mcqQuestionCorrectAnswers.length === 0) {
          return res.status(400).json({
            message: [{ key: "error", value: `Question ${i + 1}: At least one correct answer is required` }]
          });
        }
      }

      // Process options (only for option-based types)
      let processedOptions = [];
      if (isOptionBased && Array.isArray(question.mcqQuestionOptions)) {
        processedOptions = await Promise.all(
          question.mcqQuestionOptions.map(async (option, optIndex) => {
            let imageUrl = option.imageUrl || null;

            const imageField = `question_${i}_option_${optIndex}_image`;
            const imageFile = req.files?.[imageField];

            if (imageFile) {
              try {
                imageUrl = await uploadImageToSupabase(
                  imageFile,
                  `mcq/${exerciseId}/question_${Date.now()}_option_${optIndex}`
                );
              } catch (uploadError) {
                console.error(`Error uploading image for option ${optIndex}:`, uploadError);
                return res.status(500).json({
                  message: [{ key: "error", value: `Failed to upload image for option ${optIndex + 1}` }]
                });
              }
            }

            return {
              _id: new mongoose.Types.ObjectId(),
              text: option.text || '',
              isCorrect: option.isCorrect || false,
              imageUrl: imageUrl,
              imageAlignment: option.imageAlignment || 'left',
              imageSizePercent: option.imageSizePercent || 100
            };
          })
        );
      }

      // Process question image
      let questionImageUrl = question.mcqQuestionImageUrl || null;
      const questionImageField = `question_${i}_image`;
      const questionImageFile = req.files?.[questionImageField];

      if (questionImageFile) {
        try {
          questionImageUrl = await uploadImageToSupabase(
            questionImageFile,
            `mcq/${exerciseId}/question_${Date.now()}_main`
          );
        } catch (uploadError) {
          console.error('Error uploading question image:', uploadError);
          return res.status(500).json({
            message: [{ key: "error", value: `Failed to upload image for question ${i + 1}` }]
          });
        }
      }

      // Handle mcqQuestionCorrectAnswers for ALL question types
      let correctAnswers = [];
      if (isOptionBased) {
        // For option-based types, use the provided correct answers array
        correctAnswers = question.mcqQuestionCorrectAnswers || [];
      } else if (isTextBased) {
        // For short_answer and essay, store the answer key in mcqQuestionCorrectAnswers
        if (question.shortAnswer && typeof question.shortAnswer === 'string' && question.shortAnswer.trim()) {
          correctAnswers = [question.shortAnswer.trim()];
        } else if (question.mcqQuestionCorrectAnswers && Array.isArray(question.mcqQuestionCorrectAnswers)) {
          correctAnswers = question.mcqQuestionCorrectAnswers;
        } else if (question.mcqQuestionCorrectAnswers && typeof question.mcqQuestionCorrectAnswers === 'string') {
          correctAnswers = [question.mcqQuestionCorrectAnswers];
        }
      } else if (question.mcqQuestionType === 'true_false') {
        // For true/false, store the boolean as string
        if (question.trueFalseAnswer !== null && question.trueFalseAnswer !== undefined) {
          correctAnswers = [String(question.trueFalseAnswer)];
        } else if (question.mcqQuestionCorrectAnswers && Array.isArray(question.mcqQuestionCorrectAnswers)) {
          correctAnswers = question.mcqQuestionCorrectAnswers;
        }
      } else if (question.mcqQuestionType === 'numeric') {
        // For numeric, store the answer as string
        if (question.numericAnswer !== null && question.numericAnswer !== undefined) {
          correctAnswers = [String(question.numericAnswer)];
        } else if (question.mcqQuestionCorrectAnswers && Array.isArray(question.mcqQuestionCorrectAnswers)) {
          correctAnswers = question.mcqQuestionCorrectAnswers;
        }
      } else if (question.mcqQuestionType === 'matching') {
        // For matching, store pairs as strings
        if (question.matchingPairs && question.matchingPairs.length > 0) {
          correctAnswers = question.matchingPairs.map(p => `${p.left}|${p.right}`);
        } else if (question.mcqQuestionCorrectAnswers && Array.isArray(question.mcqQuestionCorrectAnswers)) {
          correctAnswers = question.mcqQuestionCorrectAnswers;
        }
      } else if (question.mcqQuestionType === 'ordering') {
        // For ordering, store the correct order as strings
        if (question.orderingItems && question.orderingItems.length > 0) {
          const sorted = [...question.orderingItems].sort((a, b) => a.order - b.order);
          correctAnswers = sorted.map(item => item.text.trim());
        } else if (question.mcqQuestionCorrectAnswers && Array.isArray(question.mcqQuestionCorrectAnswers)) {
          correctAnswers = question.mcqQuestionCorrectAnswers;
        }
      } else {
        // Fallback: use provided correct answers or empty array
        correctAnswers = Array.isArray(question.mcqQuestionCorrectAnswers) 
          ? question.mcqQuestionCorrectAnswers 
          : (question.mcqQuestionCorrectAnswers ? [question.mcqQuestionCorrectAnswers] : []);
      }

      // Build base question object with properly processed title
      const processedQuestion = {
        _id: new mongoose.Types.ObjectId(),
        questionType: 'mcq',
        sectionId: question.sectionId || null,
        mcqQuestionTitle: processedTitle,
        mcqQuestionType: question.mcqQuestionType,
        mcqQuestionDifficulty: question.mcqQuestionDifficulty || undefined,
        mcqQuestionScore: question.mcqQuestionScore || 1,
        mcqQuestionTimeLimit: question.mcqQuestionTimeLimit || 0,
        mcqQuestionRequired: question.mcqQuestionRequired !== undefined ? question.mcqQuestionRequired : true,
        hasOtherOption: question.hasOtherOption || false,
        hasExplanation: question.hasExplanation || false,
        isActive: question.isActive !== undefined ? question.isActive : true,
        mcqQuestionOptionsPerRow: question.mcqQuestionOptionsPerRow || 1,
        mcqQuestionOptions: processedOptions,
        mcqQuestionCorrectAnswers: correctAnswers,
        mcqQuestionImageUrl: questionImageUrl,
        mcqQuestionImageAlignment: question.mcqQuestionImageAlignment || 'left',
        mcqQuestionImageSizePercent: question.mcqQuestionImageSizePercent || 100,
        sequence: 0, // updated below
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Add explanation if provided
      if (question.hasExplanation && question.mcqQuestionDescription && 
          typeof question.mcqQuestionDescription === 'string' && 
          question.mcqQuestionDescription.trim() !== '') {
        processedQuestion.mcqQuestionDescription = question.mcqQuestionDescription.trim();
      }

      // ── Type-specific answer fields (for backward compatibility) ──────────────
      if (question.mcqQuestionType === 'true_false') {
        processedQuestion.trueFalseAnswer = question.trueFalseAnswer ?? null;
      }

      if (question.mcqQuestionType === 'short_answer') {
        processedQuestion.shortAnswer = (question.shortAnswer && typeof question.shortAnswer === 'string') 
          ? question.shortAnswer.trim() 
          : '';
      }

      if (question.mcqQuestionType === 'essay') {
        processedQuestion.shortAnswer = (question.shortAnswer && typeof question.shortAnswer === 'string') 
          ? question.shortAnswer.trim() 
          : '';
      }

      if (question.mcqQuestionType === 'numeric') {
        processedQuestion.numericAnswer = question.numericAnswer ?? null;
        processedQuestion.numericTolerance = question.numericTolerance ?? null;
      }

      if (question.mcqQuestionType === 'matching') {
        processedQuestion.matchingPairs = (question.matchingPairs || []).map(p => ({
          left: p.left || '',
          right: p.right || '',
        }));
      }

      if (question.mcqQuestionType === 'ordering') {
        processedQuestion.orderingItems = (question.orderingItems || []).map(item => ({
          text: item.text || '',
          order: item.order || 0,
        }));
      }

      processedQuestions.push(processedQuestion);
    }

    // Get model and entity
    const { model } = modelMap[type];
    if (!model) {
      return res.status(400).json({
        message: [{ key: "error", value: `Model not found for type: ${type}` }]
      });
    }

    const entity = await model.findById(id);
    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} with ID ${id} not found` }]
      });
    }

    if (!entity.pedagogy) {
      return res.status(404).json({
        message: [{ key: "error", value: "No pedagogy structure found in this entity" }]
      });
    }

    if (!entity.pedagogy[tabType]) {
      return res.status(404).json({
        message: [{ key: "error", value: `No ${tabType} section found in pedagogy` }]
      });
    }

    const tabData = entity.pedagogy[tabType] instanceof Map
      ? Object.fromEntries(entity.pedagogy[tabType])
      : entity.pedagogy[tabType];

    if (!tabData[subcategory]) {
      return res.status(404).json({
        message: [{ key: "error", value: `Subcategory "${subcategory}" not found in ${tabType}` }]
      });
    }

    const exercises = tabData[subcategory];

    if (!Array.isArray(exercises)) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid exercises format in subcategory "${subcategory}"` }]
      });
    }

    const exerciseIndex = exercises.findIndex(ex =>
      ex._id?.toString() === exerciseId ||
      ex.exerciseInformation?.exerciseId === exerciseId
    );

    if (exerciseIndex === -1) {
      const availableExercises = exercises.map((ex, idx) => ({
        index: idx,
        _id: ex._id?.toString(),
        exerciseId: ex.exerciseInformation?.exerciseId,
        name: ex.exerciseInformation?.exerciseName,
        questionsCount: ex.questions?.length || 0
      }));

      return res.status(404).json({
        message: [{
          key: "error",
          value: `Exercise with ID "${exerciseId}" not found in subcategory "${subcategory}". Available exercises: ${availableExercises.length}`
        }],
        availableExercises
      });
    }

    const exercise = exercises[exerciseIndex];

    if (!exercise.questions) {
      exercise.questions = [];
    }

    const startSequence = exercise.questions.length;
    const addedQuestions = [];

    processedQuestions.forEach((question, index) => {
      question.sequence = startSequence + index;
      exercise.questions.push(question);
      
      // Prepare response with safe title representation
      let responseTitle = question.mcqQuestionTitle;
      if (Array.isArray(question.mcqQuestionTitle)) {
        responseTitle = question.mcqQuestionTitle;
      } else if (typeof question.mcqQuestionTitle === 'string') {
        responseTitle = question.mcqQuestionTitle;
      } else {
        responseTitle = String(question.mcqQuestionTitle);
      }
      
      addedQuestions.push({
        questionId: question._id.toString(),
        mcqQuestionTitle: responseTitle,
        mcqQuestionType: question.mcqQuestionType,
        sequence: question.sequence,
        sectionId: question.sectionId,
        mcqQuestionCorrectAnswers: question.mcqQuestionCorrectAnswers,
        shortAnswer: question.shortAnswer,
        optionsCount: question.mcqQuestionOptions.length,
        mcqQuestionRequired: question.mcqQuestionRequired
      });
    });

    exercises[exerciseIndex] = exercise;

    if (entity.pedagogy[tabType] instanceof Map) {
      entity.pedagogy[tabType].set(subcategory, exercises);
    } else {
      entity.pedagogy[tabType][subcategory] = exercises;
    }

    entity.markModified(`pedagogy.${tabType}.${subcategory}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}.${exerciseIndex}.questions`);
    entity.updatedAt = new Date();
    entity.updatedBy = req.user?.email || "system";

    await entity.save();

    const totalMCQMarks = processedQuestions.reduce((sum, q) => sum + (q.mcqQuestionScore || 0), 0);

    // Group added questions by section for response
    const addedBySection = {};
    addedQuestions.forEach(q => {
      const secId = q.sectionId || 'unassigned';
      if (!addedBySection[secId]) {
        addedBySection[secId] = [];
      }
      addedBySection[secId].push(q);
    });

    return res.status(201).json({
      success: true,
      message: `Successfully added ${addedQuestions.length} MCQ question(s)`,
      data: {
        addedQuestions,
        addedBySection,
        exercise: {
          id: exercise._id?.toString(),
          exerciseId: exercise.exerciseInformation?.exerciseId,
          exerciseName: exercise.exerciseInformation?.exerciseName,
          totalQuestions: exercise.questions.length,
          totalMCQMarks
        },
        location: {
          entityType: type,
          entityId: entity._id.toString(),
          tabType,
          subcategory,
          exerciseIndex
        }
      }
    });

  } catch (error) {
    console.error("❌ Error adding MCQ questions:", error);
    return res.status(500).json({
      success: false,
      message: [{ key: "error", value: `Internal server error: ${error.message}` }]
    });
  }
};
 

exports.updateMCQQuestion = async (req, res) => {
  try {
    const { type, id, exerciseId, questionId } = req.params;
    let { tabType, subcategory, questionData } = req.body;

    if (typeof questionData === 'string') {
      try {
        questionData = JSON.parse(questionData);
      } catch (parseError) {
        console.error('❌ Failed to parse questionData JSON:', parseError);
        return res.status(400).json({
          message: [{ key: "error", value: "Invalid questionData format. Must be valid JSON." }]
        });
      }
    }

    if (!type || !modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}` }]
      });
    }

    if (!questionId) {
      return res.status(400).json({
        message: [{ key: "error", value: "Question ID is required" }]
      });
    }

    if (!questionData || typeof questionData !== 'object') {
      return res.status(400).json({
        message: [{ key: "error", value: "questionData must be a valid object" }]
      });
    }

    if (!questionData.mcqQuestionTitle ||
      (typeof questionData.mcqQuestionTitle === 'string' && !questionData.mcqQuestionTitle.trim()) ||
      (Array.isArray(questionData.mcqQuestionTitle) && questionData.mcqQuestionTitle.length === 0)) {
      return res.status(400).json({
        message: [{ key: "error", value: "MCQ question title is required" }]
      });
    }

    if (!questionData.mcqQuestionType) {
      return res.status(400).json({
        message: [{ key: "error", value: "MCQ question type is required" }]
      });
    }

    // Option-based types that require options validation
    const OPTION_BASED_TYPES = ['multiple_choice', 'multiple_select', 'dropdown', 'checkboxes'];
    const isOptionBased = OPTION_BASED_TYPES.includes(questionData.mcqQuestionType);

    if (isOptionBased) {
      if (!Array.isArray(questionData.mcqQuestionOptions) || questionData.mcqQuestionOptions.length < 2) {
        return res.status(400).json({
          message: [{ key: "error", value: "At least 2 options are required" }]
        });
      }

      if (!Array.isArray(questionData.mcqQuestionCorrectAnswers) || questionData.mcqQuestionCorrectAnswers.length === 0) {
        return res.status(400).json({
          message: [{ key: "error", value: "At least one correct answer is required" }]
        });
      }
    }

    const { model } = modelMap[type];
    if (!model) {
      return res.status(400).json({
        message: [{ key: "error", value: `Model not found for type: ${type}` }]
      });
    }

    const entity = await model.findById(id);
    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} with ID ${id} not found` }]
      });
    }

    if (!entity.pedagogy) {
      return res.status(404).json({
        message: [{ key: "error", value: "No pedagogy structure found in this entity" }]
      });
    }

    if (!entity.pedagogy[tabType]) {
      return res.status(404).json({
        message: [{ key: "error", value: `No ${tabType} section found in pedagogy` }]
      });
    }

    const tabData = entity.pedagogy[tabType] instanceof Map
      ? Object.fromEntries(entity.pedagogy[tabType])
      : entity.pedagogy[tabType];

    if (!tabData[subcategory]) {
      return res.status(404).json({
        message: [{ key: "error", value: `Subcategory "${subcategory}" not found in ${tabType}` }]
      });
    }

    const exercises = tabData[subcategory];

    if (!Array.isArray(exercises)) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid exercises format in subcategory "${subcategory}"` }]
      });
    }

    const exerciseIndex = exercises.findIndex(ex =>
      ex._id?.toString() === exerciseId ||
      ex.exerciseInformation?.exerciseId === exerciseId
    );

    if (exerciseIndex === -1) {
      return res.status(404).json({
        message: [{ key: "error", value: `Exercise with ID "${exerciseId}" not found in subcategory "${subcategory}"` }]
      });
    }

    const exercise = exercises[exerciseIndex];

    if (!exercise.questions || !Array.isArray(exercise.questions)) {
      return res.status(404).json({
        message: [{ key: "error", value: "No questions found in this exercise" }]
      });
    }

    const questionIndex = exercise.questions.findIndex(q =>
      q._id?.toString() === questionId
    );

    if (questionIndex === -1) {
      return res.status(404).json({
        message: [{ key: "error", value: `Question with ID "${questionId}" not found` }]
      });
    }

    const originalQuestion = exercise.questions[questionIndex];

    // Process options (only for option-based types)
    let processedOptions = [];
    if (isOptionBased && Array.isArray(questionData.mcqQuestionOptions)) {
      processedOptions = await Promise.all(
        questionData.mcqQuestionOptions.map(async (option, optIndex) => {
          let imageUrl = option.imageUrl || null;

          const imageField = `option_${optIndex}_image`;
          const imageFile = req.files?.[imageField];

          if (imageFile) {
            try {
              imageUrl = await uploadImageToSupabase(
                imageFile,
                `mcq/${exerciseId}/question_${questionId}_option_${optIndex}_${Date.now()}`
              );
            } catch (uploadError) {
              console.error(`Error uploading image for option ${optIndex}:`, uploadError);
              return res.status(500).json({
                message: [{ key: "error", value: `Failed to upload image for option ${optIndex + 1}` }]
              });
            }
          }

          return {
            _id: option._id || new mongoose.Types.ObjectId(),
            text: option.text || '',
            isCorrect: option.isCorrect || false,
            imageUrl: imageUrl,
            imageAlignment: option.imageAlignment || 'left',
            imageSizePercent: option.imageSizePercent || 100
          };
        })
      );
    }

    // Process question image
    let questionImageUrl = questionData.mcqQuestionImageUrl || questionData.questionImage || null;
    const questionImageFile = req.files?.questionImage;

    if (questionImageFile) {
      try {
        questionImageUrl = await uploadImageToSupabase(
          questionImageFile,
          `mcq/${exerciseId}/question_${questionId}_main_${Date.now()}`
        );
      } catch (uploadError) {
        console.error('Error uploading question image:', uploadError);
        return res.status(500).json({
          message: [{ key: "error", value: "Failed to upload question image" }]
        });
      }
    } else if (!questionImageUrl && originalQuestion.mcqQuestionImageUrl && !questionData.removeImage) {
      // Preserve existing image if not explicitly removed
      questionImageUrl = originalQuestion.mcqQuestionImageUrl;
    } else if (!questionImageUrl && originalQuestion.questionImage && !questionData.removeImage) {
      questionImageUrl = originalQuestion.questionImage;
    }

    // Build updated question
    const updatedQuestion = {
      _id: originalQuestion._id,
      questionType: 'mcq',
      sectionId: questionData.sectionId !== undefined ? questionData.sectionId : (originalQuestion.sectionId || null), // 🆕 NEW: Section update support
      mcqQuestionTitle: Array.isArray(questionData.mcqQuestionTitle)
        ? questionData.mcqQuestionTitle
        : (questionData.mcqQuestionTitle || '').trim(),
      mcqQuestionType: questionData.mcqQuestionType,
      mcqQuestionDifficulty: questionData.mcqQuestionDifficulty || originalQuestion.mcqQuestionDifficulty || undefined,
      mcqQuestionScore: questionData.mcqQuestionScore !== undefined ? questionData.mcqQuestionScore : (originalQuestion.mcqQuestionScore || 1),
      mcqQuestionTimeLimit: questionData.mcqQuestionTimeLimit !== undefined ? questionData.mcqQuestionTimeLimit : (originalQuestion.mcqQuestionTimeLimit || 0),
      mcqQuestionRequired: questionData.mcqQuestionRequired !== undefined
        ? questionData.mcqQuestionRequired
        : (originalQuestion.mcqQuestionRequired !== undefined ? originalQuestion.mcqQuestionRequired : true),
      hasOtherOption: questionData.hasOtherOption !== undefined ? questionData.hasOtherOption : (originalQuestion.hasOtherOption || false),
      hasExplanation: questionData.hasExplanation !== undefined ? questionData.hasExplanation : (originalQuestion.hasExplanation || false),
      isActive: questionData.isActive !== undefined ? questionData.isActive : (originalQuestion.isActive !== undefined ? originalQuestion.isActive : true),
      mcqQuestionOptionsPerRow: questionData.mcqQuestionOptionsPerRow || originalQuestion.mcqQuestionOptionsPerRow || 1,
      mcqQuestionOptions: processedOptions,
      mcqQuestionCorrectAnswers: isOptionBased ? (questionData.mcqQuestionCorrectAnswers || []) : [],
      mcqQuestionImageUrl: questionImageUrl,
      mcqQuestionImageAlignment: questionData.mcqQuestionImageAlignment || originalQuestion.mcqQuestionImageAlignment || 'left',
      mcqQuestionImageSizePercent: questionData.mcqQuestionImageSizePercent || originalQuestion.mcqQuestionImageSizePercent || 100,
      sequence: originalQuestion.sequence,
      createdAt: originalQuestion.createdAt || new Date(),
      updatedAt: new Date(),
    };

    // Explanation
    if (updatedQuestion.hasExplanation && questionData.mcqQuestionDescription && questionData.mcqQuestionDescription.trim() !== '') {
      updatedQuestion.mcqQuestionDescription = questionData.mcqQuestionDescription.trim();
    }

    // ── Type-specific answer fields ──────────────────────────────────────────
    if (questionData.mcqQuestionType === 'true_false') {
      updatedQuestion.trueFalseAnswer = questionData.trueFalseAnswer !== undefined
        ? questionData.trueFalseAnswer
        : (originalQuestion.trueFalseAnswer ?? null);
    }

    if (questionData.mcqQuestionType === 'short_answer') {
      updatedQuestion.shortAnswer = questionData.shortAnswer !== undefined
        ? questionData.shortAnswer
        : (originalQuestion.shortAnswer || '');
    }

    if (questionData.mcqQuestionType === 'numeric') {
      updatedQuestion.numericAnswer = questionData.numericAnswer !== undefined
        ? questionData.numericAnswer
        : (originalQuestion.numericAnswer ?? null);
      updatedQuestion.numericTolerance = questionData.numericTolerance !== undefined
        ? questionData.numericTolerance
        : (originalQuestion.numericTolerance ?? null);
    }

    if (questionData.mcqQuestionType === 'matching') {
      updatedQuestion.matchingPairs = Array.isArray(questionData.matchingPairs)
        ? questionData.matchingPairs.map(p => ({ left: p.left || '', right: p.right || '' }))
        : (originalQuestion.matchingPairs || []);
    }

    if (questionData.mcqQuestionType === 'ordering') {
      updatedQuestion.orderingItems = Array.isArray(questionData.orderingItems)
        ? questionData.orderingItems.map(item => ({ text: item.text || '', order: item.order || 0 }))
        : (originalQuestion.orderingItems || []);
    }

    // Update in array
    exercise.questions[questionIndex] = updatedQuestion;
    exercises[exerciseIndex] = exercise;

    if (entity.pedagogy[tabType] instanceof Map) {
      entity.pedagogy[tabType].set(subcategory, exercises);
    } else {
      entity.pedagogy[tabType][subcategory] = exercises;
    }

    entity.markModified(`pedagogy.${tabType}.${subcategory}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}.${exerciseIndex}.questions.${questionIndex}`);
    entity.updatedAt = new Date();
    entity.updatedBy = req.user?.email || "system";

    await entity.save();

    const totalMCQMarks = exercise.questions
      .filter(q => q.questionType === 'mcq')
      .reduce((sum, q) => sum + (q.mcqQuestionScore || 0), 0);

    return res.status(200).json({
      success: true,
      message: "MCQ question updated successfully",
      data: {
        updatedQuestion: {
          questionId: updatedQuestion._id.toString(),
          mcqQuestionTitle: updatedQuestion.mcqQuestionTitle,
          mcqQuestionType: updatedQuestion.mcqQuestionType,
          mcqQuestionDifficulty: updatedQuestion.mcqQuestionDifficulty,
          mcqQuestionScore: updatedQuestion.mcqQuestionScore,
          mcqQuestionRequired: updatedQuestion.mcqQuestionRequired,
          isActive: updatedQuestion.isActive,
          sequence: updatedQuestion.sequence,
          sectionId: updatedQuestion.sectionId, // 🆕 Include sectionId in response
          optionsCount: updatedQuestion.mcqQuestionOptions.length
        },
        exercise: {
          id: exercise._id?.toString(),
          exerciseId: exercise.exerciseInformation?.exerciseId,
          exerciseName: exercise.exerciseInformation?.exerciseName,
          totalQuestions: exercise.questions.length,
          totalMCQMarks
        },
        location: {
          entityType: type,
          entityId: entity._id.toString(),
          tabType,
          subcategory,
          exerciseIndex,
          questionIndex
        }
      }
    });

  } catch (error) {
    console.error("❌ Error updating MCQ question:", error);
    return res.status(500).json({
      success: false,
      message: [{ key: "error", value: `Internal server error: ${error.message}` }]
    });
  }
};

exports.deleteMCQQuestion = async (req, res) => {
  try {
    const { type, id, exerciseId, questionId } = req.params;
    const { tabType, subcategory } = req.body;

    // ── 1. Validate entity type ───────────────────────────────────────────────
    if (!type || !modelMap[type]) {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: `Invalid entity type: ${type}` }]
      });
    }

    if (!questionId) {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: "Question ID is required" }]
      });
    }

    if (!tabType || !subcategory) {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: `tabType and subcategory are required. Received: tabType="${tabType}", subcategory="${subcategory}"` }]
      });
    }

    // ── 2. Find the entity ────────────────────────────────────────────────────
    const { model } = modelMap[type];
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        success: false,
        message: [{ key: "error", value: `${type} with ID ${id} not found` }]
      });
    }

    if (!entity.pedagogy) {
      return res.status(404).json({
        success: false,
        message: [{ key: "error", value: "No pedagogy data found on this entity" }]
      });
    }

    if (!entity.pedagogy[tabType]) {
      return res.status(404).json({
        success: false,
        message: [{ key: "error", value: `tabType "${tabType}" not found in pedagogy` }]
      });
    }

    // ── 3. Handle Mongoose Map — MUST use .get() not bracket access ───────────
    const tabSection = entity.pedagogy[tabType];
    const isMap = tabSection instanceof Map;

    // Get actual subcategory keys for error messages
    const availableKeys = isMap
      ? Array.from(tabSection.keys())
      : Object.keys(tabSection);

    // Get the exercises array using .get() for Map, bracket for plain object
    const exercises = isMap
      ? tabSection.get(subcategory)
      : tabSection[subcategory];

    if (!exercises) {
      return res.status(404).json({
        success: false,
        message: [{
          key: "error",
          value: `subcategory "${subcategory}" not found under tabType "${tabType}". Available keys: [${availableKeys.join(', ')}]`
        }]
      });
    }

    if (!Array.isArray(exercises)) {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: `Expected array at pedagogy.${tabType}.${subcategory}, got ${typeof exercises}` }]
      });
    }

    // ── 4. Find the exercise ──────────────────────────────────────────────────
    const exerciseIndex = exercises.findIndex(ex =>
      ex._id?.toString() === exerciseId ||
      ex.exerciseInformation?.exerciseId === exerciseId
    );

    if (exerciseIndex === -1) {
      return res.status(404).json({
        success: false,
        message: [{ key: "error", value: `Exercise "${exerciseId}" not found` }]
      });
    }

    const exercise = exercises[exerciseIndex];

    // ── 5. Find and remove the question ──────────────────────────────────────
    if (!Array.isArray(exercise.questions)) {
      return res.status(400).json({
        success: false,
        message: [{ key: "error", value: "Exercise has no questions array" }]
      });
    }

    const questionIndex = exercise.questions.findIndex(q =>
      q._id?.toString() === questionId
    );

    if (questionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: [{ key: "error", value: `Question "${questionId}" not found in this exercise` }]
      });
    }

    // 🆕 Get section info before deleting for response
    const deletedQuestionSection = exercise.questions[questionIndex].sectionId || null;

    exercise.questions.splice(questionIndex, 1);
    exercise.questions.forEach((q, idx) => { q.sequence = idx; });

    // ── 6. Save back — must use .set() for Mongoose Map ──────────────────────
    exercises[exerciseIndex] = exercise;

    if (isMap) {
      entity.pedagogy[tabType].set(subcategory, exercises);
    } else {
      entity.pedagogy[tabType][subcategory] = exercises;
    }

    entity.markModified(`pedagogy.${tabType}`);
    entity.updatedAt = new Date();
    entity.updatedBy = req.user?.email || "system";

    await entity.save();

    return res.status(200).json({
      success: true,
      message: "MCQ question deleted successfully",
      data: {
        exerciseId,
        questionId,
        deletedFromSection: deletedQuestionSection, // 🆕 Include which section it was deleted from
        remainingQuestions: exercise.questions.length
      }
    });

  } catch (error) {
    console.error("❌ Error deleting MCQ question:", error);
    return res.status(500).json({
      success: false,
      message: [{ key: "error", value: `Internal server error: ${error.message}` }]
    });
  }
};

// ─── Upload question image directly to Supabase ───────────────────────────────
exports.uploadQuestionImage = async (req, res) => {
  try {
    const file = req.files?.image;
    if (!file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }
    const url = await uploadImageToSupabase(file, `mcq/question-images`);
    return res.status(200).json({ success: true, url });
  } catch (error) {
    console.error('❌ Error uploading question image:', error);
    return res.status(500).json({ success: false, message: 'Failed to upload image' });
  }
};

// ─── Upload question file attachment to Supabase ──────────────────────────────
exports.uploadQuestionFile = async (req, res) => {
  try {
    const file = req.files?.file;
    if (!file) {
      return res.status(400).json({ success: false, message: 'No file provided' });
    }

    const ALLOWED_MIME_TYPES = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ];

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ success: false, message: 'File type not allowed' });
    }

    const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
    if (file.size > MAX_SIZE_BYTES) {
      return res.status(400).json({ success: false, message: 'File too large (max 20 MB)' });
    }

    const timestamp = Date.now();

    // ── Always derive the extension from the MIME type (not from the filename).
    // Filenames can arrive mangled (spaces, encoding quirks, wrong extension) but
    // the browser MIME type is always reliable.
    const MIME_TO_EXT = {
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'application/vnd.ms-powerpoint': '.ppt',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
      'text/plain': '.txt',
      'text/csv': '.csv',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'application/zip': '.zip',
      'application/x-zip-compressed': '.zip',
    };

    const correctExt = MIME_TO_EXT[file.mimetype] || path.extname(file.name || '').toLowerCase() || '';
    // Strip the (potentially wrong) extension from the original name, keep only the stem
    const rawStem = path.basename(file.name || 'upload', path.extname(file.name || ''));
    const cleanStem = rawStem.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 100);
    const cleanName = cleanStem + correctExt;           // e.g. "ProblemStatementsforReact.docx"
    const fileName = `${timestamp}_${cleanName}`;
    const filePath = `question/others/attachments/${fileName}`;

    const { error } = await supabase.storage
      .from('smartlms')
      .upload(filePath, file.data, {
        contentType: file.mimetype,
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/${filePath}`;
    // Return cleanName (correct extension) — NOT file.name which may be mangled
    return res.status(200).json({ success: true, url, name: cleanName, mimeType: file.mimetype });
  } catch (error) {
    console.error('❌ Error uploading question file:', error);
    return res.status(500).json({ success: false, message: 'Failed to upload file' });
  }
};



exports.addYouDoExercise = async (req, res) => {
  try {
    const { type, id } = req.params;
    const {
      tabType,
      subcategory,
      exerciseType,
      exerciseInformation,
      availabilityPeriod,
      questionConfiguration,
      notificationSettings,
      gradeSettings,
      additionalOptions,
      isSectionBased,
      sections,
      sectionConfigs,
      questions = [],
      securitySettings,  // ← Add securitySettings to destructuring
    } = req.body;

    // ── Helper: parse JSON strings if needed (MUST be defined FIRST) ──────
    const parseIfNeeded = (data) => {
      if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return data; }
      }
      return data;
    };

    // ── Transform description fields ──────────────────────────────────────
    const transformExerciseInfo = (info) => {
      if (!info) return info;
      const t = { ...info };
      if (t.description && typeof t.description === 'object' && t.description.text !== undefined) {
        t.description = t.description.text;
      }
      return t;
    };

    // ── Parse all incoming data (NOW parseIfNeeded is defined) ─────────────
    let exerciseTypeParsed = parseIfNeeded(exerciseType);
    let exerciseInfo = transformExerciseInfo(parseIfNeeded(exerciseInformation));
    let availPeriod = parseIfNeeded(availabilityPeriod) || {};
    let quesConfig = parseIfNeeded(questionConfiguration) || {};
    let notifSettings = parseIfNeeded(notificationSettings) || {};
    let gradeSettingsRaw = parseIfNeeded(gradeSettings) || {};
    let additOptions = parseIfNeeded(additionalOptions) || {};
    let securitySettingsData = parseIfNeeded(securitySettings) || {};  // ← Now safe to use

    // ── Validate entity type ───────────────────────────────────────────────
    if (!modelMap[type]) {
      return res.status(400).json({
        message: [{ key: 'error', value: `Invalid entity type: ${type}` }]
      });
    }

    if (!subcategory) {
      return res.status(400).json({
        message: [{ key: 'error', value: "Subcategory is required." }]
      });
    }

    // ── Basic validation ──────────────────────────────────────────────────
    if (!exerciseInfo || !exerciseInfo.exerciseName) {
      return res.status(400).json({
        message: [{ key: 'error', value: 'Exercise name is required' }]
      });
    }

    // ── Find entity ───────────────────────────────────────────────────────
    const { model } = modelMap[type];
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: 'error', value: `${type} with ID ${id} not found` }]
      });
    }

    // ── Initialize pedagogy structure ─────────────────────────────────────
    if (!entity.pedagogy) {
      entity.pedagogy = { I_Do: new Map(), We_Do: new Map(), You_Do: new Map() };
    }

    const tabKey = tabType === 'I_Do' ? 'I_Do' : tabType === 'We_Do' ? 'We_Do' : 'You_Do';

    if (!entity.pedagogy[tabKey]) {
      entity.pedagogy[tabKey] = new Map();
    }

    let exercises = entity.pedagogy[tabKey].has(subcategory)
      ? entity.pedagogy[tabKey].get(subcategory)
      : [];

    // ── Generate exercise ID ───────────────────────────────────────────────
    const generateExerciseId = () =>
      `EX${(exercises.length + 1).toString().padStart(3, '0')}`;

    const exerciseId = exerciseInfo.exerciseId || generateExerciseId();

    // ── Configuration type flags ──────────────────────────────────────────
    const configTypeSettings = {
      mcqMode: exerciseTypeParsed === 'MCQ' || exerciseTypeParsed === 'Combined',
      programmingMode: exerciseTypeParsed === 'Programming' || exerciseTypeParsed === 'Combined',
      combinedMode: exerciseTypeParsed === 'Combined',
      otherMode: exerciseTypeParsed === 'Other',
      sectionBased: isSectionBased === true,
    };

    // ── Build MCQ config ───────────────────────────────────────────────────
    const buildMCQConfig = (mcqCfg) => {
      if (!mcqCfg) return { cfg: null, total: 0 };

      const scoreType = mcqCfg.scoreSettings?.scoreType || 'equalDistribution';
      let marksPerQuestion = 0;
      let total = 0;

      if (scoreType === 'equalDistribution') {
        marksPerQuestion = mcqCfg.scoreSettings?.equalDistribution || 0;
        total = (mcqCfg.generalQuestionCount || 0) * marksPerQuestion;
      } else {
        total = mcqCfg.scoreSettings?.totalMarks || 0;
      }

      return {
        cfg: {
          totalMcqQuestions: mcqCfg.generalQuestionCount || 0,
          marksPerQuestion,
          mcqTotalMarks: total,
          attemptLimitEnabled: mcqCfg.attemptLimitEnabled || false,
          submissionAttempts: mcqCfg.submissionAttempts || 1,
          shuffleQuestions: true,
          scoringType: scoreType,
        },
        total,
      };
    };

    // ── Build Programming config ───────────────────────────────────────────
    const buildProgConfig = (progCfg) => {
      if (!progCfg) return { cfg: null, total: 0 };

      const qConfigType = progCfg.questionConfigType || 'general';
      let total = 0;

      if (qConfigType === 'general') {
        const evenMarks = progCfg.scoreSettings?.equalDistribution || 0;
        total = (progCfg.generalQuestionCount || 0) * evenMarks;
      } else if (qConfigType === 'levelBased' || qConfigType === 'selectionLevel') {
        const counts = qConfigType === 'selectionLevel'
          ? progCfg.selectionLevelCounts
          : progCfg.levelBasedCounts;
        const levelScoring = progCfg.scoreSettings?.levelScoringConfiguration;

        if (levelScoring) {
          ['easy', 'medium', 'hard'].forEach(l => {
            const c = counts?.[l] || 0;
            if (!c) return;
            const s = levelScoring[l];
            if (!s) return;
            if (s.type === 'level_specific' && s.marksPerQuestion) {
              total += c * s.marksPerQuestion;
            } else if (s.type === 'question_specific' && s.totalMarks) {
              total += s.totalMarks;
            }
          });
        }
      }

      let backendScoreType = 'evenMarks';
      if (qConfigType === 'levelBased' || qConfigType === 'selectionLevel') {
        backendScoreType = 'levelBasedMarks';
      } else {
        switch (progCfg.scoreSettings?.scoreType) {
          case 'equalDistribution': backendScoreType = 'evenMarks'; break;
          case 'questionSpecific': backendScoreType = 'separateMarks'; break;
          default: backendScoreType = progCfg.scoreSettings?.scoreType || 'evenMarks';
        }
      }

      const cfg = {
        questionConfigType: qConfigType,
        attemptLimitEnabled: progCfg.attemptLimitEnabled || false,
        submissionAttempts: progCfg.submissionAttempts || 1,
        questionFlow: progCfg.questionFlow || 'freeFlow',
        allowCodeExecution: true,
        enableTestCases: true,
        showSampleCases: true,
        scoreSettings: {
          scoreType: backendScoreType,
          evenMarks: progCfg.scoreSettings?.equalDistribution || 0,
          levelBasedMarks: progCfg.scoreSettings?.levelBasedMarks || { easy: 0, medium: 0, hard: 0 },
          levelScoringConfiguration: progCfg.scoreSettings?.levelScoringConfiguration,
          totalMarks: total,
        },
      };

      if (qConfigType === 'general') {
        cfg.generalQuestionCount = progCfg.generalQuestionCount || 0;
      } else if (qConfigType === 'levelBased') {
        cfg.levelBasedCounts = progCfg.levelBasedCounts || { easy: 0, medium: 0, hard: 0 };
      } else if (qConfigType === 'selectionLevel') {
        cfg.selectionLevelCounts = progCfg.selectionLevelCounts || { easy: 0, medium: 0, hard: 0 };
      }

      return { cfg, total };
    };

    // ── Build Others config ─────────────────────────────────────────────────
    const buildOthersConfig = (othersCfg) => {
      if (!othersCfg) return { cfg: null, total: 0 };

      const qConfigType = othersCfg.questionConfigType || 'general';
      let total = 0;

      if (qConfigType === 'general') {
        const evenMarks = othersCfg.scoreSettings?.equalDistribution || othersCfg.generalMarksPerQuestion || 0;
        total = (othersCfg.generalQuestionCount || 0) * evenMarks;
      } else if (qConfigType === 'levelBased' || qConfigType === 'selectionLevel') {
        const counts = qConfigType === 'selectionLevel'
          ? othersCfg.selectionLevelCounts
          : othersCfg.levelBasedCounts;
        const levelScoring = othersCfg.scoreSettings?.levelScoringConfiguration;

        if (levelScoring) {
          ['easy', 'medium', 'hard'].forEach(l => {
            const c = counts?.[l] || 0;
            if (!c) return;
            const s = levelScoring[l];
            if (!s) return;
            if (s.type === 'level_specific' && s.marksPerQuestion) {
              total += c * s.marksPerQuestion;
            } else if (s.type === 'question_specific' && s.totalMarks) {
              total += s.totalMarks;
            }
          });
        }
      }

      const cfg = {
        questionConfigType: qConfigType,
        attemptLimitEnabled: othersCfg.attemptLimitEnabled || false,
        submissionAttempts: othersCfg.submissionAttempts || 1,
        questionFlow: othersCfg.questionFlow || 'freeFlow',
        scoreSettings: {
          scoreType: qConfigType === 'general' ? 'evenMarks' : 'levelBasedMarks',
          evenMarks: othersCfg.scoreSettings?.equalDistribution || othersCfg.generalMarksPerQuestion || 0,
          levelBasedMarks: othersCfg.scoreSettings?.levelBasedMarks || { easy: 0, medium: 0, hard: 0 },
          levelScoringConfiguration: othersCfg.scoreSettings?.levelScoringConfiguration,
          totalMarks: total,
        },
      };

      if (qConfigType === 'general') {
        cfg.generalQuestionCount = othersCfg.generalQuestionCount || 0;
      } else if (qConfigType === 'levelBased') {
        cfg.levelBasedCounts = othersCfg.levelBasedCounts || { easy: 0, medium: 0, hard: 0 };
      } else if (qConfigType === 'selectionLevel') {
        cfg.selectionLevelCounts = othersCfg.selectionLevelCounts || { easy: 0, medium: 0, hard: 0 };
      }

      return { cfg, total };
    };

    // ── Extract MCQ/Programming/Others configs ─────────────────────────────
    let mcqQuestionConfig = null;
    let programmingQuestionConfig = null;
    let othersQuestionConfig = null;
    let mcqTotalMarks = 0;
    let progTotalMarks = 0;

    if (quesConfig.mcqConfig) {
      const { cfg, total } = buildMCQConfig(quesConfig.mcqConfig);
      mcqQuestionConfig = cfg;
      mcqTotalMarks = total;
    }

    if (quesConfig.programmingConfig) {
      const { cfg, total } = buildProgConfig(quesConfig.programmingConfig);
      programmingQuestionConfig = cfg;
      progTotalMarks = total;
    }

    if (quesConfig.othersQuestionConfiguration || quesConfig.othersConfig) {
      const othersCfg = quesConfig.othersQuestionConfiguration || quesConfig.othersConfig;
      const { cfg, total } = buildOthersConfig(othersCfg);
      othersQuestionConfig = cfg;
      progTotalMarks = total;
    }

    // ── Build availabilityPeriod ───────────────────────────────────────────
    const buildAvailabilityPeriod = (period) => {
      const parseDate = (dateObj) => {
        if (!dateObj || !dateObj.year || !dateObj.month || !dateObj.day) return null;
        return new Date(
          dateObj.year,
          dateObj.month - 1,
          dateObj.day,
          dateObj.hour || 0,
          dateObj.minute || 0
        );
      };

      const startDate = parseDate(period.startDate);
      const endDate = parseDate(period.endDate);
      const cutOffDate = period.cutOffEnabled ? parseDate(period.cutOffDate) : null;
      const gracePeriodDate = period.gracePeriodEnabled ? parseDate(period.gracePeriodDate) : null;

      return {
        startDate,
        endDate,
        cutOffDate,
        cutOffEnabled: period.cutOffEnabled || false,
        gracePeriodAllowed: period.gracePeriodEnabled || false,
        gracePeriodEnabled: period.gracePeriodEnabled || false,
        gracePeriodDate,
        extendedDays: period.extendedDays || 0,
      };
    };

    const availabilityPeriodData = buildAvailabilityPeriod(availPeriod);

    // ── Build notificationSettings ─────────────────────────────────────────
    const notificationSettingsData = {
      notifyUsers: notifSettings.notifyUsers || false,
      notifyGmail: notifSettings.notifyGmail || false,
      notifyWhatsApp: notifSettings.notifyWhatsApp || false,
      gradeSheet: notifSettings.gradeSheet !== undefined ? notifSettings.gradeSheet : true,
      notifyGradersSubmissions: notifSettings.notifyGradersSubmissions || false,
      notifyGradersLateSubmissions: notifSettings.notifyGradersLateSubmissions || false,
      notifyStudent: notifSettings.notifyStudent !== undefined ? notifSettings.notifyStudent : true,
    };

    // ── Build gradeSettings ────────────────────────────────────────────────
    const totalMarksForMCQ = exerciseTypeParsed === 'MCQ' || exerciseTypeParsed === 'Combined'
      ? (exerciseInfo.totalMarksMCQ || mcqTotalMarks)
      : 0;
    const totalMarksForProg = exerciseTypeParsed === 'Programming' || exerciseTypeParsed === 'Other' || exerciseTypeParsed === 'Combined'
      ? (exerciseInfo.totalMarksProgramming || progTotalMarks)
      : 0;
    const totalMarksCombined = totalMarksForMCQ + totalMarksForProg;

    const gradeSettingsData = {
      mcqGrade: totalMarksForMCQ > 0 ? totalMarksForMCQ : null,
      mcqGradeToPass: gradeSettingsRaw.mcqGradeToPass || null,
      programmingGrade: totalMarksForProg > 0 ? totalMarksForProg : null,
      programmingGradeToPass: gradeSettingsRaw.programmingGradeToPass || null,
      combinedGrade: totalMarksCombined > 0 ? totalMarksCombined : null,
      combinedGradeToPass: gradeSettingsRaw.combinedGradeToPass || null,
      separateMarks: gradeSettingsRaw.separateMarks || false,
    };

    // ── Build additionalOptions ────────────────────────────────────────────
    const additionalOptionsData = {
      anonymousSubmissions: additOptions.anonymousSubmissions || false,
      hideGraderIdentity: additOptions.hideGraderIdentity || false,
    };

    // ── Assemble the new exercise document ─────────────────────────────────
    const totalMarksForInfo = isSectionBased
      ? (exerciseInfo.totalMarks || 0)
      : exerciseTypeParsed === 'Combined'
        ? totalMarksCombined
        : (exerciseInfo.totalMarks || progTotalMarks || mcqTotalMarks);

    const newExercise = {
      _id: new mongoose.Types.ObjectId(),
      exerciseType: exerciseTypeParsed,
      configurationType: configTypeSettings,
      isSectionBased: isSectionBased || false,
      sections: sections || [],
      sectionConfigs: sectionConfigs || {},

      exerciseInformation: {
        exerciseId: exerciseId,
        exerciseName: exerciseInfo.exerciseName || '',
        testType: exerciseInfo.testType || 'mock',
        description: exerciseInfo.description || '',
        exerciseLevel: exerciseInfo.exerciseLevel || 'intermediate',
        exerciseType: exerciseInfo.exerciseType || exerciseTypeParsed || '',
        totalDuration: exerciseInfo.totalDuration || 1,
        totalMarksMCQ: totalMarksForMCQ,
        totalMarksProgramming: totalMarksForProg,
        totalMarks: totalMarksForInfo,
        selectedModule: exerciseInfo.selectedModule || '',
        selectedLanguages: exerciseInfo.selectedLanguages || [],
        isSectionBased: exerciseInfo.isSectionBased || isSectionBased || false,
        sectionBasedDuration: exerciseInfo.sectionBasedDuration || false,
      },

      securitySettings: securitySettingsData,  // ← Add security settings
      questionConfiguration: {},
      availabilityPeriod: availabilityPeriodData,
      notificationSettings: notificationSettingsData,
      gradeSettings: gradeSettingsData,
      additionalOptions: additionalOptionsData,
      questions: questions,
      createdAt: new Date(),
      createdBy: req.user?.email || 'system',
      version: 1,
    };

    // Attach question configurations
    if (mcqQuestionConfig) {
      newExercise.questionConfiguration.mcqQuestionConfiguration = mcqQuestionConfig;
    }
    if (programmingQuestionConfig) {
      newExercise.questionConfiguration.programmingQuestionConfiguration = programmingQuestionConfig;
    }
    if (othersQuestionConfig) {
      newExercise.questionConfiguration.othersQuestionConfiguration = othersQuestionConfig;
    }

    // Attach programming settings if needed
    if ((exerciseTypeParsed === 'Programming' || exerciseTypeParsed === 'Combined') && exerciseInfo.selectedLanguages) {
      newExercise.programmingSettings = {
        selectedModule: exerciseInfo.selectedModule || null,
        selectedLanguages: exerciseInfo.selectedLanguages || [],
      };
    }

    // ── Save to database ───────────────────────────────────────────────────
    exercises.push(newExercise);
    entity.pedagogy[tabKey].set(subcategory, exercises);
    entity.markModified(`pedagogy.${tabKey}`);
    entity.updatedBy = req.user?.email || 'system';
    entity.updatedAt = new Date();
    await entity.save();

    // ── Build response config ──────────────────────────────────────────────
    let responseConfig = {};
    if (exerciseTypeParsed === 'MCQ') {
      responseConfig = { mode: 'mcq', config: mcqQuestionConfig };
    } else if (exerciseTypeParsed === 'Programming') {
      responseConfig = { mode: 'programming', config: programmingQuestionConfig };
    } else if (exerciseTypeParsed === 'Other') {
      responseConfig = { mode: 'other', config: othersQuestionConfig };
    } else if (exerciseTypeParsed === 'Combined') {
      responseConfig = {
        mode: 'combined',
        mcqConfig: mcqQuestionConfig,
        programmingConfig: programmingQuestionConfig
      };
    }

    return res.status(201).json({
      message: [{ key: 'success', value: `Exercise added successfully to ${subcategory}` }],
      data: {
        exercise: newExercise,
        configuration: responseConfig,
        gradeSettings: gradeSettingsData,
        notificationSettings: notificationSettingsData,
        additionalOptions: additionalOptionsData,
        securitySettings: securitySettingsData,
        subcategory,
        tabType: tabKey,
        entityType: type,
        entityId: id,
        totalExercises: exercises.length,
        generatedExerciseId: exerciseId,
        location: { section: tabKey, subcategory, index: exercises.length - 1 },
      },
    });

  } catch (err) {
    console.error('❌ Add exercise error:', err);
    res.status(500).json({
      message: [{ key: 'error', value: `Internal server error: ${err.message}` }],
    });
  }
};


exports.updateYouDoExercise = async (req, res) => {
  try {
    const { type, id, exerciseId } = req.params;
    const {
      tabType,
      subcategory,
      exerciseType,
      programmingSettings,
      exerciseInformation,
      availabilityPeriod,
      questionConfiguration,
      notificationSettings,
      notificationGradeSettings,
      gradeSettings,
      additionalOptions,
      isSectionBased,      // ← ADD THIS
      sections,            // ← ADD THIS
      sectionConfigs,      // ← ADD THIS
      securitySettings,    // ← ADD THIS (if needed)
    } = req.body;

    // ── Validate ──────────────────────────────────────────────────────────
    if (!modelMap[type]) {
      return res.status(400).json({
        message: [{ key: 'error', value: `Invalid entity type: ${type}.` }]
      });
    }
    if (!subcategory) {
      return res.status(400).json({ message: [{ key: 'error', value: 'Subcategory is required.' }] });
    }
    if (!tabType) {
      return res.status(400).json({ message: [{ key: 'error', value: 'tabType is required (I_Do, We_Do, You_Do)' }] });
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    const parseIfNeeded = (data) => {
      if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return data; }
      }
      return data;
    };

    const transformQuestionDescription = (question) => {
      if (!question) return question;
      if (question.description && typeof question.description === 'string') {
        question.description = { text: question.description, imageUrl: null, imageAlignment: 'left', imageSizePercent: 100 };
      }
      return question;
    };

    // ── Parse all incoming ─────────────────────────────────────────────────
    const parsedExerciseType = exerciseType ? parseIfNeeded(exerciseType) : null;
    const parsedExerciseInfo = exerciseInformation ? parseIfNeeded(exerciseInformation) : null;
    const parsedProgSettings = programmingSettings ? parseIfNeeded(programmingSettings) : null;
    const parsedAvailPeriod = availabilityPeriod ? parseIfNeeded(availabilityPeriod) : null;
    const parsedQuesConfig = questionConfiguration ? parseIfNeeded(questionConfiguration) : null;
    const parsedNotifSettings = notificationSettings
      ? parseIfNeeded(notificationSettings)
      : (notificationGradeSettings ? parseIfNeeded(notificationGradeSettings) : null);
    const parsedGradeSettings = gradeSettings ? parseIfNeeded(gradeSettings) : null;
    const parsedAdditOptions = additionalOptions ? parseIfNeeded(additionalOptions) : null;

    // ── Parse section-related fields ───────────────────────────────────────
    const parsedIsSectionBased = isSectionBased !== undefined ? isSectionBased : false;
    const parsedSections = sections ? parseIfNeeded(sections) : [];
    const parsedSectionConfigs = sectionConfigs ? parseIfNeeded(sectionConfigs) : {};
    const parsedSecuritySettings = securitySettings ? parseIfNeeded(securitySettings) : null;

    // ── Find entity ───────────────────────────────────────────────────────
    const { model } = modelMap[type];
    const entity = await model.findById(id);

    if (!entity) return res.status(404).json({ message: [{ key: 'error', value: `${type} with ID ${id} not found` }] });
    if (!entity.pedagogy) return res.status(404).json({ message: [{ key: 'error', value: 'Pedagogy structure not found' }] });
    if (!entity.pedagogy[tabType]) return res.status(404).json({ message: [{ key: 'error', value: `Pedagogy tab '${tabType}' not found` }] });
    if (!entity.pedagogy[tabType].has(subcategory))
      return res.status(404).json({ message: [{ key: 'error', value: `Subcategory '${subcategory}' not found in ${tabType}` }] });

    const exercises = entity.pedagogy[tabType].get(subcategory);
    const exerciseIndex = exercises.findIndex(ex => ex._id.toString() === exerciseId);

    if (exerciseIndex === -1) {
      return res.status(404).json({
        message: [{ key: 'error', value: `Exercise with ID ${exerciseId} not found in subcategory '${subcategory}'` }]
      });
    }

    const existingExercise = exercises[exerciseIndex].toObject
      ? exercises[exerciseIndex].toObject()
      : { ...exercises[exerciseIndex] };
    delete existingExercise.$__;
    delete existingExercise.$isNew;
    delete existingExercise._doc;

    const finalExerciseType = parsedExerciseType || existingExercise.exerciseType;

    const configTypeSettings = {
      mcqMode: finalExerciseType === 'MCQ' || finalExerciseType === 'Combined',
      programmingMode: finalExerciseType === 'Programming' || finalExerciseType === 'Combined',
      combinedMode: finalExerciseType === 'Combined',
      otherMode: finalExerciseType === 'Other',
      sectionBased: parsedIsSectionBased,
    };

    // ── Re-use question config builders (same logic as addExercise) ────────
    let mcqQuestionConfig = existingExercise.questionConfiguration?.mcqQuestionConfiguration || null;
    let programmingQuestionConfig = existingExercise.questionConfiguration?.programmingQuestionConfiguration || null;
    let othersQuestionConfig = existingExercise.questionConfiguration?.othersQuestionConfiguration || null;
    let mcqTotalMarks = existingExercise.exerciseInformation?.totalMarksMCQ || 0;
    let progTotalMarks = existingExercise.exerciseInformation?.totalMarksProgramming || 0;

    if (parsedQuesConfig) {
      // ── MCQ config ───────────────────────────────────────────────────────
      if (parsedQuesConfig.mcqConfig) {
        const mcqCfg = parsedQuesConfig.mcqConfig;
        const scoreType = mcqCfg.scoreSettings?.scoreType || 'equalDistribution';
        let marksPerQuestion = 0;
        if (scoreType === 'equalDistribution') {
          marksPerQuestion = mcqCfg.scoreSettings?.equalDistribution || 0;
          mcqTotalMarks = (mcqCfg.generalQuestionCount || 0) * marksPerQuestion;
        } else {
          mcqTotalMarks = mcqCfg.scoreSettings?.totalMarks || 0;
        }
        mcqQuestionConfig = {
          totalMcqQuestions: mcqCfg.generalQuestionCount || 0,
          marksPerQuestion,
          mcqTotalMarks,
          attemptLimitEnabled: mcqCfg.attemptLimitEnabled || false,
          submissionAttempts: mcqCfg.submissionAttempts || 1,
          shuffleQuestions: true,
          scoringType: scoreType,
        };
      }

      // ── Programming config ───────────────────────────────────────────────
      if (parsedQuesConfig.programmingConfig) {
        const progCfg = parsedQuesConfig.programmingConfig;
        const qConfigType = progCfg.questionConfigType || 'general';
        let backendType;
        switch (qConfigType) {
          case 'levelBased': backendType = 'levelBased'; break;
          case 'selectionLevel': backendType = 'selectionLevel'; break;
          default: backendType = qConfigType;
        }

        progTotalMarks = 0;
        if (qConfigType === 'general' && progCfg.scoreSettings?.scoreType === 'equalDistribution') {
          progTotalMarks = (progCfg.generalQuestionCount || 0) * (progCfg.scoreSettings.equalDistribution || 0);
        } else if (qConfigType === 'levelBased' || qConfigType === 'selectionLevel') {
          const counts = qConfigType === 'selectionLevel' ? progCfg.selectionLevelCounts : progCfg.levelBasedCounts;
          const levelScoring = progCfg.scoreSettings?.levelScoringConfiguration;
          if (levelScoring) {
            ['easy', 'medium', 'hard'].forEach(l => {
              const c = counts?.[l] || 0; if (!c) return;
              const s = levelScoring[l]; if (!s) return;
              if (s.type === 'level_specific' && s.marksPerQuestion) progTotalMarks += c * s.marksPerQuestion;
              else if (s.type === 'question_specific' && s.totalMarks) progTotalMarks += s.totalMarks;
            });
          }
        }

        let backendScoreType;
        if (qConfigType === 'levelBased' || qConfigType === 'selectionLevel') {
          backendScoreType = 'levelBasedMarks';
        } else {
          switch (progCfg.scoreSettings?.scoreType) {
            case 'equalDistribution': backendScoreType = 'evenMarks'; break;
            case 'questionSpecific': backendScoreType = 'separateMarks'; break;
            case 'levelSpecific': backendScoreType = 'levelBasedMarks'; break;
            default: backendScoreType = progCfg.scoreSettings?.scoreType || 'evenMarks';
          }
        }

        const levelScoringConfig = progCfg.scoreSettings?.levelScoringConfiguration;
        let levelBasedMarks = progCfg.scoreSettings?.levelBasedMarks || { easy: 0, medium: 0, hard: 0 };

        if (levelScoringConfig && (qConfigType === 'levelBased' || qConfigType === 'selectionLevel')) {
          const counts = qConfigType === 'selectionLevel' ? progCfg.selectionLevelCounts : progCfg.levelBasedCounts;
          ['easy', 'medium', 'hard'].forEach(l => {
            const c = counts?.[l] || 0; if (!c) return;
            const s = levelScoringConfig[l];
            if (s?.type === 'level_specific' && s.marksPerQuestion) {
              levelBasedMarks[l] = s.marksPerQuestion;
              if (!levelScoringConfig[l].questionCount) levelScoringConfig[l].questionCount = c;
            } else if (s?.type === 'question_specific' && s.totalMarks) {
              if (!levelScoringConfig[l].questionCount) levelScoringConfig[l].questionCount = c;
            }
          });
        }

        programmingQuestionConfig = {
          questionConfigType: backendType || 'general',
          attemptLimitEnabled: progCfg.attemptLimitEnabled || false,
          submissionAttempts: progCfg.submissionAttempts || 1,
          questionFlow: progCfg.questionFlow || 'freeFlow',
          allowCodeExecution: true,
          enableTestCases: true,
          showSampleCases: true,
          scoreSettings: {
            scoreType: backendScoreType,
            evenMarks: progCfg.scoreSettings?.scoreType === 'equalDistribution' ? (progCfg.scoreSettings.equalDistribution || 0) : 0,
            separateMarks: progCfg.scoreSettings?.questionSpecific || { general: [], levelBased: { easy: [], medium: [], hard: [] } },
            levelBasedMarks,
            levelScoringConfiguration: levelScoringConfig,
            totalMarks: progTotalMarks,
          },
        };
        if (qConfigType === 'general') {
          programmingQuestionConfig.generalQuestionCount = progCfg.generalQuestionCount || 0;
          programmingQuestionConfig.generalMarksPerQuestion = progCfg.scoreSettings?.equalDistribution || progCfg.scoreSettings?.evenMarks || 0;
        } else if (qConfigType === 'levelBased') {
          programmingQuestionConfig.levelBasedCounts = progCfg.levelBasedCounts || { easy: 0, medium: 0, hard: 0 };
        } else if (qConfigType === 'selectionLevel') {
          programmingQuestionConfig.selectionLevelCounts = progCfg.selectionLevelCounts || { easy: 0, medium: 0, hard: 0 };
        }
      }

      // ── Others config ───────────────────────────────────────────────────
      if (parsedQuesConfig.othersQuestionConfiguration || parsedQuesConfig.othersConfig) {
        const othersCfg = parsedQuesConfig.othersQuestionConfiguration || parsedQuesConfig.othersConfig;
        const qConfigType = othersCfg.questionConfigType || 'general';

        let othersTotal = 0;
        if (qConfigType === 'general') {
          const evenMarks = othersCfg.generalMarksPerQuestion || othersCfg.scoreSettings?.evenMarks || 0;
          othersTotal = (othersCfg.generalQuestionCount || 0) * evenMarks;
        } else {
          const counts = qConfigType === 'selectionLevel' ? othersCfg.selectionLevelCounts : othersCfg.levelBasedCounts;
          const levelScoring = othersCfg.scoreSettings?.levelScoringConfiguration;
          if (levelScoring) {
            ['easy', 'medium', 'hard'].forEach(l => {
              const c = counts?.[l] || 0; if (!c) return;
              const s = levelScoring[l]; if (!s) return;
              if (s.type === 'level_specific' && s.marksPerQuestion)
                othersTotal += c * s.marksPerQuestion;
              else if (s.type === 'question_specific' && s.totalMarks)
                othersTotal += s.totalMarks;
            });
          }
        }

        if (!othersTotal) {
          othersTotal = othersCfg.scoreSettings?.totalMarks || parsedExerciseInfo?.totalMarks || existingExercise.exerciseInformation?.totalMarks || 0;
        }

        othersQuestionConfig = {
          questionConfigType: qConfigType,
          ...(qConfigType === 'general' && {
            generalQuestionCount: othersCfg.generalQuestionCount || 0,
            generalMarksPerQuestion: othersCfg.generalMarksPerQuestion || othersCfg.scoreSettings?.evenMarks || 0,
          }),
          ...(qConfigType === 'levelBased' && {
            levelBasedCounts: othersCfg.levelBasedCounts || { easy: 0, medium: 0, hard: 0 },
          }),
          ...(qConfigType === 'selectionLevel' && {
            selectionLevelCounts: othersCfg.selectionLevelCounts || { easy: 0, medium: 0, hard: 0 },
          }),
          scoreSettings: {
            scoreType: qConfigType === 'general' ? 'evenMarks' : 'levelBasedMarks',
            evenMarks: othersCfg.generalMarksPerQuestion || othersCfg.scoreSettings?.evenMarks || 0,
            levelBasedMarks: othersCfg.scoreSettings?.levelBasedMarks || { easy: 0, medium: 0, hard: 0 },
            levelScoringConfiguration: othersCfg.scoreSettings?.levelScoringConfiguration,
            totalMarks: othersTotal,
          },
          questionFlow: othersCfg.questionFlow || 'freeFlow',
          attemptLimitEnabled: othersCfg.attemptLimitEnabled || false,
          submissionAttempts: othersCfg.submissionAttempts || 1,
        };
        progTotalMarks = othersTotal;
      }

      // Direct overrides (if frontend sends already-formatted config objects)
      if (parsedQuesConfig.mcqQuestionConfiguration) {
        mcqQuestionConfig = parsedQuesConfig.mcqQuestionConfiguration;
        mcqTotalMarks = mcqQuestionConfig.mcqTotalMarks || 0;
      }
      if (parsedQuesConfig.programmingQuestionConfiguration) {
        programmingQuestionConfig = parsedQuesConfig.programmingQuestionConfiguration;
        progTotalMarks = programmingQuestionConfig.scoreSettings?.totalMarks || 0;
      }

      if (parsedQuesConfig.questions) {
        if (Array.isArray(parsedQuesConfig.questions)) {
          parsedQuesConfig.questions = parsedQuesConfig.questions.map(q => transformQuestionDescription(q));
        }
      }
    }

    // ── Build updated exercise (spread existing, apply changes) ────────────
    const updatedExercise = {
      ...existingExercise,
      ...(parsedExerciseType && { exerciseType: finalExerciseType }),
      configurationType: configTypeSettings,
      updatedAt: new Date(),
      updatedBy: req.user?.email || 'system',
      version: (existingExercise.version || 1) + 1,
    };

    // ── Section-based fields ───────────────────────────────────────────────
    if (parsedIsSectionBased !== undefined) {
      updatedExercise.isSectionBased = parsedIsSectionBased;
    }
    if (parsedSections.length > 0) {
      updatedExercise.sections = parsedSections;
    }
    if (Object.keys(parsedSectionConfigs).length > 0) {
      updatedExercise.sectionConfigs = parsedSectionConfigs;
    }
    if (parsedSecuritySettings) {
      updatedExercise.securitySettings = parsedSecuritySettings;
    }

    // ── Exercise information ───────────────────────────────────────────────
    if (parsedExerciseInfo) {
      updatedExercise.exerciseInformation = {
        ...existingExercise.exerciseInformation,
        exerciseId: parsedExerciseInfo.exerciseId || existingExercise.exerciseInformation?.exerciseId,
        exerciseName: parsedExerciseInfo.exerciseName || existingExercise.exerciseInformation?.exerciseName,
        testType: parsedExerciseInfo.testType || existingExercise.exerciseInformation?.testType || 'mock',
        description: parsedExerciseInfo.description !== undefined ? parsedExerciseInfo.description : existingExercise.exerciseInformation?.description,
        exerciseLevel: parsedExerciseInfo.exerciseLevel || existingExercise.exerciseInformation?.exerciseLevel,
        totalDuration: parsedExerciseInfo.totalDuration !== undefined ? parsedExerciseInfo.totalDuration : existingExercise.exerciseInformation?.totalDuration,
        totalMarksMCQ: finalExerciseType === 'MCQ' || finalExerciseType === 'Combined'
          ? (parsedExerciseInfo.totalMarksMCQ !== undefined ? parsedExerciseInfo.totalMarksMCQ : mcqTotalMarks) : 0,
        totalMarksProgramming: finalExerciseType === 'Programming' || finalExerciseType === 'Other' || finalExerciseType === 'Combined'
          ? (parsedExerciseInfo.totalMarksProgramming !== undefined ? parsedExerciseInfo.totalMarksProgramming : progTotalMarks) : 0,
        totalMarks: parsedExerciseInfo.totalMarks || (mcqTotalMarks + progTotalMarks),
        selectedModule: parsedExerciseInfo.selectedModule || existingExercise.exerciseInformation?.selectedModule,
        selectedLanguages: parsedExerciseInfo.selectedLanguages || existingExercise.exerciseInformation?.selectedLanguages || [],
        isSectionBased: parsedIsSectionBased,
        sectionBasedDuration: parsedExerciseInfo.sectionBasedDuration !== undefined ? parsedExerciseInfo.sectionBasedDuration : existingExercise.exerciseInformation?.sectionBasedDuration || false,
      };
    }

    // ── Programming settings ───────────────────────────────────────────────
    if (parsedProgSettings) {
      updatedExercise.programmingSettings = {
        selectedModule: parsedProgSettings.selectedModule || existingExercise.programmingSettings?.selectedModule,
        selectedLanguages: parsedProgSettings.selectedLanguages || existingExercise.programmingSettings?.selectedLanguages || [],
      };
    }

    // ── Question configuration ─────────────────────────────────────────────
    if (parsedQuesConfig) {
      if (!updatedExercise.questionConfiguration) updatedExercise.questionConfiguration = {};
      if (mcqQuestionConfig) updatedExercise.questionConfiguration.mcqQuestionConfiguration = mcqQuestionConfig;
      if (programmingQuestionConfig) updatedExercise.questionConfiguration.programmingQuestionConfiguration = programmingQuestionConfig;
      if (othersQuestionConfig) updatedExercise.questionConfiguration.othersQuestionConfiguration = othersQuestionConfig;
      if (parsedQuesConfig.questions) updatedExercise.questions = parsedQuesConfig.questions;
    }

    // ── Availability period ────────────────────────────────────────────────
    if (parsedAvailPeriod) {
      const safeD = (v) => {
        if (!v || v === 'null' || v === 'undefined') return undefined;
        const d = new Date(v);
        return isNaN(d.getTime()) ? undefined : d;
      };
      const existAvail = existingExercise.availabilityPeriod || {};
      const prev = (f) => existAvail[f] ? new Date(existAvail[f]) : undefined;

      const startDate = safeD(parsedAvailPeriod.startDate) || prev('startDate');
      const endDate = safeD(parsedAvailPeriod.endDate) || prev('endDate');
      const cutOffEnabled = parsedAvailPeriod.cutOffEnabled !== undefined
        ? !!parsedAvailPeriod.cutOffEnabled
        : !!(existAvail.cutOffEnabled ?? false);
      const cutOffDate = cutOffEnabled
        ? (safeD(parsedAvailPeriod.cutOffDate) || prev('cutOffDate'))
        : undefined;
      const remindEnabled = parsedAvailPeriod.remindGradeByEnabled !== undefined
        ? !!parsedAvailPeriod.remindGradeByEnabled
        : !!(existAvail.remindGradeByEnabled ?? false);
      const remindGradeBy = remindEnabled
        ? (safeD(parsedAvailPeriod.remindGradeBy) || prev('remindGradeBy'))
        : undefined;
      const gracePeriodOn = parsedAvailPeriod.gracePeriodAllowed !== undefined
        ? !!(parsedAvailPeriod.gracePeriodAllowed || parsedAvailPeriod.gracePeriodEnabled)
        : !!(existAvail.gracePeriodAllowed || existAvail.gracePeriodEnabled);
      const gracePeriodDate = gracePeriodOn
        ? (safeD(parsedAvailPeriod.gracePeriodDate) || prev('gracePeriodDate'))
        : undefined;

      if (startDate) {
        const ap = {};
        ap.startDate = startDate;
        if (endDate) ap.endDate = endDate;
        if (cutOffDate) ap.cutOffDate = cutOffDate;
        ap.cutOffEnabled = cutOffEnabled;
        if (remindGradeBy) ap.remindGradeBy = remindGradeBy;
        ap.remindGradeByEnabled = remindEnabled;
        ap.gracePeriodAllowed = gracePeriodOn;
        ap.gracePeriodEnabled = gracePeriodOn;
        if (gracePeriodOn && gracePeriodDate) ap.gracePeriodDate = gracePeriodDate;
        ap.extendedDays = parsedAvailPeriod.extendedDays ?? existAvail.extendedDays ?? 0;
        updatedExercise.availabilityPeriod = ap;
      } else {
        delete updatedExercise.availabilityPeriod;
      }
    }

    // ── Notification settings ──────────────────────────────────────────────
    if (parsedNotifSettings) {
      const ex = existingExercise.notificationSettings || existingExercise.notificatonandGradeSettings || {};
      updatedExercise.notificationSettings = {
        notifyUsers: parsedNotifSettings.notifyUsers !== undefined ? parsedNotifSettings.notifyUsers : (ex.notifyUsers ?? false),
        notifyGmail: parsedNotifSettings.notifyGmail !== undefined ? parsedNotifSettings.notifyGmail : (ex.notifyGmail ?? false),
        notifyWhatsApp: parsedNotifSettings.notifyWhatsApp !== undefined ? parsedNotifSettings.notifyWhatsApp : (ex.notifyWhatsApp ?? false),
        gradeSheet: parsedNotifSettings.gradeSheet !== undefined ? parsedNotifSettings.gradeSheet : (ex.gradeSheet ?? true),
        notifyGradersSubmissions: parsedNotifSettings.notifyGradersSubmissions !== undefined ? parsedNotifSettings.notifyGradersSubmissions : (ex.notifyGradersSubmissions ?? false),
        notifyGradersLateSubmissions: parsedNotifSettings.notifyGradersLateSubmissions !== undefined ? parsedNotifSettings.notifyGradersLateSubmissions : (ex.notifyGradersLateSubmissions ?? false),
        notifyStudent: parsedNotifSettings.notifyStudent !== undefined ? parsedNotifSettings.notifyStudent : (ex.notifyStudent ?? true),
      };
      updatedExercise.notificatonandGradeSettings = {
        notifyUsers: updatedExercise.notificationSettings.notifyUsers,
        notifyGmail: updatedExercise.notificationSettings.notifyGmail,
        notifyWhatsApp: updatedExercise.notificationSettings.notifyWhatsApp,
        gradeSheet: updatedExercise.notificationSettings.gradeSheet,
      };
    }

    // ── Grade settings (include computeAutoGrades if you have it) ──────────
    if (parsedGradeSettings !== null) {
      const exGrade = existingExercise.gradeSettings || {};
      const merged = {
        mcqGrade: parsedGradeSettings?.mcqGrade !== undefined ? Number(parsedGradeSettings.mcqGrade) : exGrade.mcqGrade,
        mcqGradeToPass: parsedGradeSettings?.mcqGradeToPass !== undefined
          ? (parsedGradeSettings.mcqGradeToPass !== null ? Number(parsedGradeSettings.mcqGradeToPass) : null)
          : exGrade.mcqGradeToPass,
        programmingGrade: parsedGradeSettings?.programmingGrade !== undefined ? Number(parsedGradeSettings.programmingGrade) : exGrade.programmingGrade,
        programmingGradeToPass: parsedGradeSettings?.programmingGradeToPass !== undefined
          ? (parsedGradeSettings.programmingGradeToPass !== null ? Number(parsedGradeSettings.programmingGradeToPass) : null)
          : exGrade.programmingGradeToPass,
        combinedGrade: parsedGradeSettings?.combinedGrade !== undefined ? Number(parsedGradeSettings.combinedGrade) : exGrade.combinedGrade,
        combinedGradeToPass: parsedGradeSettings?.combinedGradeToPass !== undefined
          ? (parsedGradeSettings.combinedGradeToPass !== null ? Number(parsedGradeSettings.combinedGradeToPass) : null)
          : exGrade.combinedGradeToPass,
        separateMarks: parsedGradeSettings?.separateMarks !== undefined ? parsedGradeSettings.separateMarks : (exGrade.separateMarks ?? false),
      };
      updatedExercise.gradeSettings = merged;
    }

    // ── Additional options ─────────────────────────────────────────────────
    if (parsedAdditOptions) {
      const exAddit = existingExercise.additionalOptions || {};
      updatedExercise.additionalOptions = {
        anonymousSubmissions: parsedAdditOptions.anonymousSubmissions !== undefined ? parsedAdditOptions.anonymousSubmissions : (exAddit.anonymousSubmissions ?? false),
        hideGraderIdentity: parsedAdditOptions.hideGraderIdentity !== undefined ? parsedAdditOptions.hideGraderIdentity : (exAddit.hideGraderIdentity ?? false),
      };
    }

    // ── Persist ────────────────────────────────────────────────────────────
    const cleanExercise = JSON.parse(JSON.stringify(updatedExercise));
    exercises[exerciseIndex] = cleanExercise;
    entity.pedagogy[tabType].set(subcategory, exercises);
    // Same Map-of-Array-of-Subdoc tracking issue as updateExercise above:
    // marking only the Map path does NOT reliably persist changes to deeply
    // nested Date fields like availabilityPeriod.startDate/endDate. Mark each
    // level so Mongoose emits the SET ops. Without this, the Schedule step's
    // Save would return 200 but the new start/end times never reached MongoDB.
    entity.markModified(`pedagogy.${tabType}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}.${exerciseIndex}`);
    entity.markModified(`pedagogy.${tabType}.${subcategory}.${exerciseIndex}.availabilityPeriod`);
    entity.updatedBy = req.user?.email || 'system';
    entity.updatedAt = new Date();
    await entity.save();

    // ── Build response config ──────────────────────────────────────────────
    let responseConfig = {};
    if (finalExerciseType === 'MCQ') responseConfig = { mode: 'mcq', config: mcqQuestionConfig };
    else if (finalExerciseType === 'Programming') responseConfig = { mode: 'programming', config: programmingQuestionConfig };
    else if (finalExerciseType === 'Other') responseConfig = { mode: 'other', config: othersQuestionConfig };
    else if (finalExerciseType === 'Combined') responseConfig = { mode: 'combined', mcqConfig: mcqQuestionConfig, programmingConfig: programmingQuestionConfig };

    return res.status(200).json({
      message: [{ key: 'success', value: `Exercise updated successfully in ${subcategory}` }],
      data: {
        exercise: cleanExercise,
        configuration: responseConfig,
        gradeSettings: cleanExercise.gradeSettings,
        notificationSettings: cleanExercise.notificationSettings,
        additionalOptions: cleanExercise.additionalOptions,
        securitySettings: cleanExercise.securitySettings,
        subcategory,
        tabType,
        entityType: type,
        entityId: id,
        exerciseId,
        totalExercises: exercises.length,
        location: { section: tabType, subcategory, index: exerciseIndex },
      },
    });

  } catch (err) {
    console.error('❌ Update exercise error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({
      message: [{ key: 'error', value: `Internal server error: ${err.message}` }],
    });
  }
};

// GET YOU DO EXERCISES - For Assessment component with Pagination
exports.getYouDoExercises = async (req, res) => {
  try {
    const { type, id } = req.params;
    const {
      tabType,
      subcategory,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Validate entity type
    if (!modelMap[type]) {
      return res.status(400).json({
        message: [{ key: "error", value: `Invalid entity type: ${type}` }]
      });
    }

    const { model } = modelMap[type];
    const entity = await model.findById(id);

    if (!entity) {
      return res.status(404).json({
        message: [{ key: "error", value: `${type} not found` }]
      });
    }

    // Check if pedagogy exists
    if (!entity.pedagogy || !entity.pedagogy[tabType]) {
      return res.json({
        message: [{ key: "success", value: "No exercises found" }],
        data: {
          exercises: [],
          tabType: tabType,
          subcategory: subcategory,
          total: 0,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: 0
        }
      });
    }

    // Get exercises for specific subcategory
    let exercises = [];
    if (subcategory) {
      exercises = entity.pedagogy[tabType].get(subcategory) || [];
    } else {
      // Return all exercises from all subcategories in tabType
      const allExercises = [];
      entity.pedagogy[tabType].forEach((exArray, subcat) => {
        if (Array.isArray(exArray)) {
          exArray.forEach(ex => {
            const exerciseObj = ex.toObject ? ex.toObject() : { ...ex };
            allExercises.push({
              ...exerciseObj,
              subcategory: subcat
            });
          });
        }
      });
      exercises = allExercises;
    }

    // Convert to array and add timestamps for sorting
    // NOTE: must call .toObject() on Mongoose subdocs — spreading a Document directly
    // copies internal props ($__, _doc, ...) instead of the actual data, which made
    // exerciseInformation.exerciseName render as "Untitled Assessment" on the client.
    let exercisesArray = exercises.map(ex => {
      const obj = ex && typeof ex.toObject === 'function' ? ex.toObject() : { ...ex };
      return {
        ...obj,
        sortCreatedAt: obj.createdAt ? new Date(obj.createdAt).getTime() : 0,
        sortUpdatedAt: obj.updatedAt ? new Date(obj.updatedAt).getTime() : 0,
      };
    });

    // Sort exercises (descending order by default - latest first)
    exercisesArray.sort((a, b) => {
      let aValue, bValue;

      switch (sortBy) {
        case 'createdAt':
          aValue = a.sortCreatedAt;
          bValue = b.sortCreatedAt;
          break;
        case 'updatedAt':
          aValue = a.sortUpdatedAt;
          bValue = b.sortUpdatedAt;
          break;
        case 'exerciseName':
          aValue = a.exerciseInformation?.exerciseName || '';
          bValue = b.exerciseInformation?.exerciseName || '';
          return sortOrder === 'desc'
            ? bValue.localeCompare(aValue)
            : aValue.localeCompare(bValue);
        case 'totalMarks':
          aValue = a.exerciseInformation?.totalMarks || 0;
          bValue = b.exerciseInformation?.totalMarks || 0;
          break;
        default:
          aValue = a.sortCreatedAt;
          bValue = b.sortCreatedAt;
      }

      if (sortOrder === 'desc') {
        return bValue - aValue;
      } else {
        return aValue - bValue;
      }
    });

    // Calculate pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const total = exercisesArray.length;
    const totalPages = Math.ceil(total / limitNum);
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;

    // Get paginated exercises
    const paginatedExercises = exercisesArray.slice(startIndex, endIndex);

    // Remove temporary sort fields from response
    const cleanExercises = paginatedExercises.map(({ sortCreatedAt, sortUpdatedAt, ...rest }) => rest);

    return res.json({
      message: [{ key: "success", value: "Exercises retrieved successfully" }],
      data: {
        exercises: cleanExercises,
        tabType: tabType,
        subcategory: subcategory,
        pagination: {
          total: total,
          page: pageNum,
          limit: limitNum,
          totalPages: totalPages,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1
        },
        sorting: {
          sortBy: sortBy,
          sortOrder: sortOrder
        },
        entityType: type,
        entityId: id
      }
    });

  } catch (err) {
    console.error("❌ Get YouDo exercises error:", err);
    res.status(500).json({
      message: [{ key: "error", value: "Internal server error" }]
    });
  }
};
