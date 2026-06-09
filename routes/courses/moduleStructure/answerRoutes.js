const express = require("express");
const router = express.Router();
const {
  submitAnswer,
  getAllUsers,
  evaluateStudentAnswer,
  submitMultipleFiles,
  getPreviousSubmission,
} = require("../../../controllers/courses/moduleStructure/answer");
const { userAuth } = require("../../../middlewares/userAuth");

const {
  getAnswerByQuestionId,
} = require("../../../controllers/courses/moduleStructure/answer");

router.post("/courses/answers/submit", userAuth, submitAnswer);

router.get("/users/answer/:courseId", userAuth, getAllUsers);

router.post("/users/update/submission-score", userAuth, evaluateStudentAnswer);

router.get("/courses/answers/single", userAuth, getAnswerByQuestionId);

router.post(
  "/courses/answers/submit-multiple-files",
  userAuth,
  submitMultipleFiles,
);
router.get(
  "/courses/answers/previous-submission",
  userAuth,
  getPreviousSubmission,
);

module.exports = router;
