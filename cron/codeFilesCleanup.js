// Daily cleanup for files created by students' programs (see
// services/codeFileStore.js). Runs once at startup — so a server that was down
// at midnight still clears old days — and then every day at 00:05 in the
// store's time zone (CODE_FILES_TZ).

const cron = require('node-cron');
const { deleteOldDays, TIMEZONE } = require('../services/codeFileStore');

const cleanupCodeFiles = async () => {
    try {
        const removed = await deleteOldDays();
        if (removed.length) console.log(`🧹 Deleted old code-file folders: ${removed.join(', ')}`);
        return removed;
    } catch (error) {
        console.error('❌ Error cleaning up code files:', error);
        return [];
    }
};

const startCodeFilesCleanupCron = () => {
    cleanupCodeFiles();
    cron.schedule('5 0 * * *', cleanupCodeFiles, TIMEZONE ? { timezone: TIMEZONE } : undefined);
};

module.exports = {
    cleanupCodeFiles,
    startCodeFilesCleanupCron
};
