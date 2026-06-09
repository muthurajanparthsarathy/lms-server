const express = require('express');
const router = express.Router();
const { getLoginLogs, getCourseActivityLogs, getCourseReport, postLoginSession, postLogout } = require('../controllers/activityLogController');

router.get('/activity-logs/logins', getLoginLogs);
router.get('/activity-logs/courses/:courseId/report', getCourseReport);
router.get('/activity-logs/courses/:courseId', getCourseActivityLogs);
router.post('/activity-logs/login-session', postLoginSession);
router.post('/activity-logs/logout', postLogout);

module.exports = router;
