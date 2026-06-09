const express = require("express");
const router = express.Router();
const { userAuth } = require("../../../middlewares/userAuth");
const {

  createPedagogyView,
  getAllPedagogyViews,
  getPedagogyViewById,
  updatePedagogyView,
  deletePedagogyView,
  deleteDocument,
  getAllCoursesData,
  // Lightweight Resources-page-only variants. See pedagogyView.js for the
  // rationale — they exist to avoid the ~95% wasted payload `getAllCoursesData`
  // ships when the page only renders the sidebar tree + selected-node pedagogy.
  getAllCoursesDataLight,
  // Review-submission-only variant — drops pedagogy.I_Do + non-exercise
  // resources + the user.permissions field + other-course enrolment data.
  getCoursesDataForReview,
  getNodePedagogy,
  duplicateCourseHierarchy,
  updateEntity,          // ← must be here
  updateFileSettings,    // ← keep this too
  getAllCoursesDataWithoutAINotes,
  studentDashboardAnalyticsOptimized,
  getStudentCourseProgress,
  staffStudentAnalytics,
  createPage,
  updatePage,
  deletePage,
  addMCQQuestionToFile,
  getExerciseSubmissionStatus,

} = require("../../../controllers/courses/moduleStructure/pedagogyView");

// Routes
router.post("/pedagogy-view/create", userAuth, createPedagogyView);
router.get("/pedagogy-view/getAll", userAuth, getAllPedagogyViews);
router.get("/pedagogy-view/getByid/:id", userAuth, getPedagogyViewById);
router.put("/pedagogy-view/update/:id", userAuth, updatePedagogyView);
router.delete(
  "/pedagogy-view/delete/:activityType/:itemId",
  deletePedagogyView
);

router.delete("/delete/:model/:id", deleteDocument);

// common data fetch for course related data
//
// IMPORTANT ROUTE ORDERING NOTE:
//   Express resolves routes in declaration order. A more-specific path like
//   `/getAll/courses-data/light/:courseId` MUST be declared BEFORE the
//   wildcard `/getAll/courses-data/:courseId`, otherwise the wildcard
//   swallows the request with `courseId === "light"`. The lightweight
//   routes therefore come first.
router.get("/getAll/courses-data/light/:courseId", getAllCoursesDataLight);
router.get("/getAll/courses-data/node-pedagogy/:type/:id", getNodePedagogy);
router.get(
  "/getAll/courses-data/without-ai-notes/:courseId/:exerciseId",
  getAllCoursesDataWithoutAINotes
);
router.get("/getAll/courses-data/review/:courseId", getCoursesDataForReview);
// Generic catch-all comes LAST.
router.get("/getAll/courses-data/:courseId", getAllCoursesData);

router.get(
  "/student-Dashboard/courses-data/analytics",
  userAuth,
  studentDashboardAnalyticsOptimized
);

router.get(
  '/analytics/staff/analytics/students',
  userAuth,
  staffStudentAnalytics
);

router.get(
  '/analytics/staff/analytics/student-progress/:courseId/:studentId',
  userAuth,
 getStudentCourseProgress
);

router.post("/dupicate-date", userAuth, duplicateCourseHierarchy);

// ✅ ONLY these two lines for uploadResourses — no duplicates
router.put("/uploadResourses/:type/:id",          userAuth, updateEntity);
router.put("/uploadResourses/:type/:id/settings", userAuth, updateFileSettings);

// Pages routes
router.post(  "/pages/:type/:id/pages",         userAuth, createPage);
router.put(   "/pages/:type/:id/pages/:pageId", userAuth, updatePage);
router.delete("/pages/:type/:id/pages/:pageId", userAuth, deletePage);

router.post('/file-mcq-add/:type/:id', userAuth, addMCQQuestionToFile);

// Check which exercises have at least one student submission
// Query: courseId, tabType, subcategory, exerciseIds (comma-separated)
router.get('/analytics/exercise-submission-status', userAuth, getExerciseSubmissionStatus);
// In your routes file, update the two page routes:

// All three must have the same /pages/ prefix

module.exports = router;
