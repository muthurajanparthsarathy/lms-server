const express = require("express");
const router = express.Router();
const { userAuth } = require("../../../middlewares/userAuth");
const { attachPocScope } = require("../../../middlewares/pocScope");
const {
  getLiveDashboard,
  getStudentDetails,
  getMessages,
  markMessagesRead,
  getLiveSessionsList,
} = require("../../../controllers/courses/moduleStructure/liveDashboard");

router.get("/api/assessment/live-dashboard", userAuth, getLiveDashboard);
router.get("/api/assessment/student-details", userAuth, getStudentDetails);
router.get("/api/assessment/messages", userAuth, getMessages);
router.post("/api/assessment/messages/read", userAuth, markMessagesRead);

// Live Dashboard list page — one row per You_Do assessment across every course
// the caller can see. POC scoping is required here because the endpoint spans
// courses (the per-assessment routes above already ride on a courseId/nodeId
// the guard middlewares check individually).
router.get("/api/live-dashboard/sessions", userAuth, attachPocScope, getLiveSessionsList);

module.exports = router;
