// routes/testYourSkillsRoutes.js
const express = require("express");
const router = express.Router();
const { userAuth } = require("../../../middlewares/userAuth");
const {
  TestYourSkillsAddMCQ,
  TestYourSkillsGetAllMCQs,
  TestYourSkillsGetMCQById,
  TestYourSkillsUpdateMCQ,
  TestYourSkillsDeleteMCQ,
  TestYourSkillsBulkAddMCQs,
  TestYourSkillsGetStats,
  addMcqToYouDo,
  getYouDoItems,
  getYouDoItem,
  deleteYouDoItem,
  deleteQuestionFromYouDo,
  updateQuestionInYouDo
} = require("../../../controllers/courses/moduleStructure/testYourSkillsController");

router.post("/createquestion/:type/:id/you-do/:itemKey/mcq", addMcqToYouDo);

// Get all You_Do items
router.get("/getAllQuestions/:type/:id/you-do", getYouDoItems);

// Get specific You_Do item
router.get("/getQuestion/:type/:id/you-do/:itemKey", getYouDoItem);

// Delete You_Do item
router.delete("/deleteQuestion/:type/:id/you-do/:itemKey", deleteYouDoItem);

// Delete specific question from You_Do item
router.delete("/deleteQuestion/:type/:id/you-do/:itemKey/question/:questionId", deleteQuestionFromYouDo);
router.put("/updateQuestion/:type/:id/you-do/:itemKey/question/:questionId", updateQuestionInYouDo);

module.exports = router;