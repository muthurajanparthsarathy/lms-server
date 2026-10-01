// Files created by a student's program in the multi-file editor.
//
// The editor runs Python in the browser (Pyodide), whose file system lives in
// memory and vanishes after every run. These two endpoints give it a real home
// on the server:
//   GET /api/code-files?questionId=…   today's files, loaded into the next run
//   PUT /api/code-files                 the program's files at the end of a run
//                                       (replaces the whole set, so deletes stick)
// Files are kept for the current day only — cron/codeFilesCleanup.js removes
// older days. See services/codeFileStore.js for the layout and limits.
//
// The JSON body limit for PUT is raised in server.js, ahead of the global
// 100 KB express.json(); a body it rejects arrives here as
// req.codeFilesBodyError so the answer passes through cors() and the browser
// can read it.

const express = require('express');
const { userAuth } = require('../middlewares/userAuth');
const store = require('../services/codeFileStore');

const router = express.Router();

router.get('/code-files', userAuth, async (req, res) => {
  const userId = store.safeId(req.user?._id);
  const questionId = store.safeId(req.query.questionId);
  if (!userId) return res.status(401).json({ error: 'Not signed in.' });
  if (!questionId) return res.status(400).json({ error: 'A valid questionId is required.' });

  try {
    const date = store.todayKey();
    const files = await store.listFiles(userId, questionId);
    return res.json({ date, files });
  } catch (e) {
    console.error('code-files list error:', e);
    return res.status(500).json({ error: 'Could not read saved files.' });
  }
});

router.put('/code-files', userAuth, async (req, res) => {
  const bodyError = req.codeFilesBodyError;
  if (bodyError) {
    return bodyError.status === 413
      ? res.status(413).json({ error: 'Output files are too large to save (5 MB per question).' })
      : res.status(400).json({ error: 'Invalid request body.' });
  }
  const userId = store.safeId(req.user?._id);
  const questionId = store.safeId(req.body?.questionId);
  if (!userId) return res.status(401).json({ error: 'Not signed in.' });
  if (!questionId) return res.status(400).json({ error: 'A valid questionId is required.' });
  // `date` is the day the run's files were loaded for. A run that started
  // yesterday must not carry yesterday's files into today.
  if (req.body?.date && req.body.date !== store.todayKey()) {
    return res.status(409).json({ error: 'The day changed while the program ran; its files are only kept for one day.' });
  }

  const prepared = store.prepareFiles(req.body?.files);
  if (prepared.error) return res.status(prepared.status).json({ error: prepared.error });

  try {
    const saved = await store.replaceFiles(userId, questionId, prepared.accepted);
    return res.json({ date: store.todayKey(), saved, skipped: prepared.skipped });
  } catch (e) {
    if (e.code === 'QUOTA') return res.status(413).json({ error: e.message });
    console.error('code-files save error:', e);
    return res.status(500).json({ error: 'Could not save files.' });
  }
});

module.exports = router;
