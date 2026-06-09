const express = require("express");
const router = express.Router();
const { userAuth } = require("../../middlewares/userAuth");
const {
  getAllQuestionsbank,
  getQuestionBankById,
  createQuestionBank,
  updateQuestionBank,
  deleteQuestionBank,
  toggleQuestionStatus,
} = require("../../controllers/courses/questionBank");

router.get("/getAll/question-bank", userAuth, getAllQuestionsbank);

router.get("/getById/question-bank/:id", userAuth, getQuestionBankById);

router.post("/create/question-bank", userAuth, createQuestionBank);

router.put("/update/question-bank/:id", userAuth, updateQuestionBank);

router.delete("/deletes/question-bank/:id", userAuth, deleteQuestionBank);

router.put('/toggle-status/question-bank/:questionId',userAuth, toggleQuestionStatus);

module.exports = router;
