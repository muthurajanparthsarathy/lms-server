// Is an exercise fully configured?
//
// Moved out of controllers/courses/moduleStructure/exerciseAndQuestion.js so
// the node models' save hook (utils/assignmentStudentNotify.js) can apply the
// very same rule the approvals flow uses — a model cannot require a
// controller. The rules are unchanged.

/**
 * Port of the client-side `isAssessmentComplete` — same rules, same order.
 * Called on the raw exercise sub-doc as it lives inside pedagogy.
 */
const isExerciseFullyConfigured = (ex) => {
  if (!ex) return false;
  if (!ex.exerciseType) return false;
  const info = ex.exerciseInformation || {};
  if (!info.exerciseName || !String(info.exerciseName).trim()) return false;
  if (!ex.availabilityPeriod || !ex.availabilityPeriod.startDate) return false;
  // Non-graded exercises (isGraded === false) legitimately carry totalMarks=0,
  // so the marks requirement only applies to graded ones. Without this guard
  // every non-graded We_Do/You_Do item is stuck "not fully configured" — hidden
  // from the approvals overview and its step-1 notification never fires.
  if (ex.isGraded !== false
      && (info.totalMarks ?? 0) <= 0 && (info.totalMarksMCQ ?? 0) <= 0) return false;

  // Scope-aware baseline: for "settings_and_questions", questions are the
  // whole point — an exercise with zero questions is by definition NOT
  // fully configured, even if the trainer hasn't set a count yet. Without
  // this guard the per-type checks below fall through when the configured
  // count is 0/undefined, letting an empty exercise pass as "complete".
  const scope = ex.availabilityPeriod?.approvalScope || 'settings';
  const hasQuestions = Array.isArray(ex.questions) && ex.questions.length > 0;
  if (scope === 'settings_and_questions' && !hasQuestions) return false;

  // Section-based
  if (ex.isSectionBased) {
    const sectionConfigs = ex.sectionConfigs instanceof Map
      ? Object.fromEntries(ex.sectionConfigs)
      : (ex.sectionConfigs || {});
    const allQuestions = ex.questions || [];
    const countBySection = {};
    allQuestions.forEach((q) => {
      const sid = q.sectionId;
      if (!sid) return;
      if (!countBySection[sid]) countBySection[sid] = { mcq: 0, prog: 0 };
      if (q.questionType === 'mcq') countBySection[sid].mcq++;
      else if (['programming', 'database', 'others'].includes(q.questionType)) countBySection[sid].prog++;
    });
    for (const key of Object.keys(sectionConfigs)) {
      const cfg = sectionConfigs[key] || {};
      const sectionId = cfg.id || key;
      const type = cfg.exerciseType || 'MCQ';
      const c = countBySection[sectionId] || { mcq: 0, prog: 0 };
      if (type === 'MCQ' || type === 'Combined') {
        const limit = cfg.mcqConfig?.generalQuestionCount || 0;
        if (limit > 0 && c.mcq < limit) return false;
      }
      if (type === 'Programming' || type === 'Combined') {
        const pc = cfg.programmingConfig || {};
        const lb = pc.levelBasedCounts || {};
        const limit = pc.questionConfigType === 'general'
          ? (pc.generalQuestionCount || 0)
          : ((lb.easy || 0) + (lb.medium || 0) + (lb.hard || 0));
        if (limit > 0 && c.prog < limit) return false;
      }
    }
    return true;
  }

  // Non-section-based
  const qc = ex.questionConfiguration || {};
  const mcqCfg = qc.mcqQuestionConfiguration;
  const progCfg = qc.programmingQuestionConfiguration;
  const questions = ex.questions || [];
  const mcqQs = questions.filter((q) => q.questionType === 'mcq');
  const progQs = questions.filter((q) => ['programming', 'database', 'others'].includes(q.questionType));

  if (ex.exerciseType === 'MCQ') {
    const maxQ = mcqCfg?.totalMcqQuestions ?? 0;
    if (maxQ > 0 && mcqQs.length < maxQ) return false;
  } else if (ex.exerciseType === 'Programming') {
    const ct = progCfg?.questionConfigType;
    const lc = progCfg?.levelBasedCounts ?? progCfg?.selectionLevelCounts ?? {};
    const maxQ = ct === 'general'
      ? (progCfg?.generalQuestionCount ?? 0)
      : ((lc.easy ?? 0) + (lc.medium ?? 0) + (lc.hard ?? 0));
    if (maxQ > 0 && progQs.length < maxQ) return false;
  } else if (ex.exerciseType === 'Combined') {
    const ct = progCfg?.questionConfigType;
    const lc = progCfg?.levelBasedCounts ?? progCfg?.selectionLevelCounts ?? {};
    const progMax = ct === 'general'
      ? (progCfg?.generalQuestionCount ?? 0)
      : ((lc.easy ?? 0) + (lc.medium ?? 0) + (lc.hard ?? 0));
    const maxQ = (mcqCfg?.totalMcqQuestions ?? 0) + progMax;
    const curQ = mcqQs.length + progQs.length;
    if (maxQ > 0 && curQ < maxQ) return false;
  }
  return true;
};

module.exports = { isExerciseFullyConfigured };
