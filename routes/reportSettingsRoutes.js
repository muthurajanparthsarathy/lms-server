const express = require('express');
const router = express.Router();
const { userAuth } = require('../middlewares/userAuth.js');
const { getReportSettings, saveReportSettings } = require('../controllers/reportSettingsController.js');

// Read is open to any signed-in user of the institution: an export needs the
// letterhead, and everyone who can run a report can export one. WRITING is the
// restricted half, gated on the client side by the `reportsettings` permission
// that guards the page.
router.get('/report-settings/:institutionId', userAuth, getReportSettings);
router.put('/report-settings/:institutionId', userAuth, saveReportSettings);

module.exports = router;
