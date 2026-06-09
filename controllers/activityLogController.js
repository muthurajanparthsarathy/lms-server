const ActivityLog = require('../models/ActivityLog');
const User = require('../models/UserModel');
const mongoose = require('mongoose');
const config = require('config');
const jwt = require('jsonwebtoken');
const JWT_TOKEN_KEY = config.get('JWT_TOKEN_KEY');

/**
 * POST /activity-logs/login-session
 * Called by the frontend after geo lookup to update the most recent login log
 * with real IP address, location, device, browser, and OS.
 */
exports.postLoginSession = async (req, res) => {
  try {
    // Decode user from Bearer token
    const bearerHeader = req.headers['authorization'] || '';
    const token = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : '';
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorised' });

    let userId;
    try {
      const decoded = jwt.verify(token, JWT_TOKEN_KEY);
      userId = decoded.id;
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const { details = {} } = req.body;

    // Build update — only overwrite fields that are actually provided
    const set = {};
    if (details.ipAddress) set['details.ipAddress'] = details.ipAddress;
    if (details.location)  set['details.location']  = details.location;
    if (details.device)    set['details.device']    = details.device;
    if (details.browser)   set['details.browser']   = details.browser;
    if (details.os)        set['details.os']        = details.os;
    if (details.userAgent) set['details.userAgent'] = details.userAgent;

    if (Object.keys(set).length === 0) {
      return res.status(200).json({ success: true, message: 'Nothing to update' });
    }

    // Update the most recent login log for this user (within the last 10 minutes)
    const since = new Date(Date.now() - 10 * 60 * 1000);
    await ActivityLog.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId), action: 'login', createdAt: { $gte: since } },
      { $set: set },
      { sort: { createdAt: -1 } }
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error updating login session:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /activity-logs/logout
 * Stamps logoutTime + sessionDuration on the user's most recent OPEN login
 * session (one that has no logoutTime yet). Called from every sign-out button.
 */
exports.postLogout = async (req, res) => {
  try {
    const bearerHeader = req.headers['authorization'] || '';
    const token = bearerHeader.startsWith('Bearer ') ? bearerHeader.slice(7) : '';
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorised' });

    let userId;
    try {
      const decoded = jwt.verify(token, JWT_TOKEN_KEY);
      userId = decoded.id;
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const logoutTime = req.body && req.body.logoutTime ? new Date(req.body.logoutTime) : new Date();

    // Most recent login session for this user that hasn't been closed yet.
    // { logoutTime: null } also matches docs where the field is absent.
    const session = await ActivityLog.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      action: 'login',
      logoutTime: null,
    }).sort({ createdAt: -1 });

    if (!session) {
      return res.status(200).json({ success: true, message: 'No open session found' });
    }

    const sessionDuration = Math.max(
      0,
      Math.round((logoutTime.getTime() - new Date(session.createdAt).getTime()) / 1000)
    );

    session.logoutTime = logoutTime;
    session.sessionDuration = sessionDuration;
    await session.save();

    res.status(200).json({ success: true, data: { logoutTime, sessionDuration } });
  } catch (error) {
    console.error('Error recording logout:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /activity-logs/logins
 * Returns all login events, most recent first
 */
exports.getLoginLogs = async (req, res) => {
  try {
    const logs = await ActivityLog.find({ action: 'login' })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    res.status(200).json({ success: true, data: logs });
  } catch (error) {
    console.error('Error fetching login logs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /activity-logs/courses/:courseId
 * Returns per-student activity for a course:
 *   nodeVisits, methodSelections, resourceOpens, exerciseSubmissions
 */
exports.getCourseActivityLogs = async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: 'Invalid courseId' });
    }

    // ── Part A: ActivityLog events for this course ────────────────────────────
    const logs = await ActivityLog.find({
      courseId: new mongoose.Types.ObjectId(courseId),
      action: { $in: ['node_visit', 'resource_open', 'method_select', 'activity_select'] },
    })
      .sort({ createdAt: 1 })
      .lean();

    // Group activity logs by userId
    const logsByUser = {};
    for (const log of logs) {
      const uid = log.userId.toString();
      if (!logsByUser[uid]) {
        logsByUser[uid] = {
          userId: uid,
          userName: log.userName,
          userEmail: log.userEmail,
          nodeVisits: [],
          methodSelections: [],
          resourceOpens: [],
        };
      }
      if (log.action === 'node_visit') {
        logsByUser[uid].nodeVisits.push({
          nodeId: log.details.nodeId,
          nodeName: log.details.nodeName,
          nodeType: log.details.nodeType,
          visitedAt: log.createdAt,
        });
      } else if (log.action === 'resource_open') {
        logsByUser[uid].resourceOpens.push({
          resourceId: log.details.resourceId,
          resourceName: log.details.resourceName,
          resourceType: log.details.resourceType,
          openedAt: log.createdAt,
        });
      } else if (log.action === 'method_select' || log.action === 'activity_select') {
        logsByUser[uid].methodSelections.push({
          action: log.action,
          method: log.details.method,
          activity: log.details.activity,
          nodeName: log.details.nodeName,
          selectedAt: log.createdAt,
        });
      }
    }

    // ── Part B: Exercise submissions from UserModel answers ───────────────────
    const users = await User.find(
      { 'courses.courseId': new mongoose.Types.ObjectId(courseId) },
      { firstName: 1, lastName: 1, email: 1, courses: 1 }
    ).lean();

    const studentMap = {};

    for (const user of users) {
      const uid = user._id.toString();
      const courseEntry = (user.courses || []).find(
        c => c.courseId && c.courseId.toString() === courseId
      );

      // Collect exercise submissions across I_Do, We_Do, You_Do
      const exerciseSubmissions = [];
      if (courseEntry?.answers) {
        for (const method of ['I_Do', 'We_Do', 'You_Do']) {
          const methodMap = courseEntry.answers[method];
          if (!methodMap) continue;

          // answers[method] is a Mongoose Map — iterate entries
          const entries = methodMap instanceof Map
            ? Array.from(methodMap.entries())
            : Object.entries(methodMap);

          for (const [activity, progressList] of entries) {
            if (!Array.isArray(progressList)) continue;
            for (const ep of progressList) {
              const submittedAt = ep.lastTestSubmittedAt || ep.updatedAt || ep.createdAt;
              if (!submittedAt) continue;
              exerciseSubmissions.push({
                exerciseId: ep.exerciseId ? ep.exerciseId.toString() : null,
                exerciseName: ep.exerciseName || 'Exercise',
                method,
                activity,
                status: ep.status || 'in-progress',
                submittedAt,
              });
            }
          }
        }
      }

      studentMap[uid] = {
        userId: uid,
        userName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
        userEmail: user.email,
        lastActive: courseEntry?.lastAccessed || null,
        exerciseSubmissions,
      };
    }

    // ── Merge A + B ───────────────────────────────────────────────────────────
    const allUserIds = new Set([...Object.keys(logsByUser), ...Object.keys(studentMap)]);
    const result = [];

    for (const uid of allUserIds) {
      const activityData = logsByUser[uid] || {};
      const userData = studentMap[uid] || {};
      result.push({
        userId: uid,
        userName: userData.userName || activityData.userName || '',
        userEmail: userData.userEmail || activityData.userEmail || '',
        lastActive: userData.lastActive || null,
        nodeVisits: activityData.nodeVisits || [],
        methodSelections: activityData.methodSelections || [],
        resourceOpens: activityData.resourceOpens || [],
        exerciseSubmissions: userData.exerciseSubmissions || [],
      });
    }

    // Sort by most recently active
    result.sort((a, b) => {
      const aTime = a.lastActive ? new Date(a.lastActive).getTime() : 0;
      const bTime = b.lastActive ? new Date(b.lastActive).getTime() : 0;
      return bTime - aTime;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Error fetching course activity logs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /activity-logs/courses/:courseId/report
 * Returns measured time "sessions" for the report — only items that actually have a
 * start→end duration:
 *   • resource_open (I Do) with a duration  → a viewed resource
 *   • exercise_start (We Do) with a duration → a submitted assignment
 *   • exercise_start (You Do) with a duration → a submitted assessment
 * Started-but-not-submitted (duration === null) and node visits are excluded.
 */
exports.getCourseReport = async (req, res) => {
  try {
    const { courseId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ success: false, message: 'Invalid courseId' });
    }

    const logs = await ActivityLog.find({
      courseId: new mongoose.Types.ObjectId(courseId),
      action: { $in: ['resource_open', 'exercise_start'] },
      'details.duration': { $ne: null }, // only completed, measured items
    })
      .sort({ createdAt: -1 })
      .lean();

    const RES_TYPE_LABEL = {
      pdf: 'PDF', video: 'Video', ppt: 'PPT', link: 'Link',
      image: 'Image', word: 'Word', zip: 'Zip', txt: 'Text',
    };

    const sessions = logs.map(l => {
      const d = l.details || {};
      const isResource = l.action === 'resource_open';
      const pedagogy = d.method || (isResource ? 'I_Do' : 'We_Do');

      let type;
      if (isResource) {
        const rt = String(d.resourceType || '').toLowerCase();
        type = RES_TYPE_LABEL[rt] || (d.resourceType ? String(d.resourceType).toUpperCase() : 'Resource');
      } else {
        type = pedagogy === 'You_Do' ? 'Assessment' : 'Assignment';
      }

      const title = isResource
        ? (d.resourceName || 'Resource')
        : (d.exerciseName || (pedagogy === 'You_Do' ? 'Assessment' : 'Assignment'));

      return {
        studentId: l.userId ? String(l.userId) : '',
        studentName: l.userName || '',
        studentEmail: l.userEmail || '',
        pedagogy,                                   // 'I_Do' | 'We_Do' | 'You_Do'
        type,                                       // 'PDF' | 'Video' | ... | 'Assignment' | 'Assessment'
        title,
        subCategory: d.activity || null,
        nodeName: d.nodeName || null,
        nodeType: d.nodeType || null,
        startTime: l.createdAt,
        endTime: d.closedAt || null,
        durationSec: typeof d.duration === 'number' ? d.duration : 0,
      };
    });

    res.status(200).json({ success: true, data: sessions });
  } catch (error) {
    console.error('Error building course report:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
