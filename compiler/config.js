// Gateway settings (LMS server side of the live compiler). Read lazily so
// dotenv (loaded by config/db.js at boot) has run first.
//
// The whole feature is off until COMPILER_REDIS_URL is set: nothing connects
// to Redis and compiler:start answers "not configured", so the rest of the
// LMS runs exactly as before.

function int(name, fallback) {
    const n = Number.parseInt(process.env[name] ?? '', 10)
    return Number.isFinite(n) && n >= 0 ? n : fallback
}

function get() {
    return {
        redisUrl: process.env.COMPILER_REDIS_URL || '',
        prefix: process.env.COMPILER_QUEUE_PREFIX || 'lms-compiler',
        maxSourceBytes: int('COMPILER_MAX_SOURCE_BYTES', 64 * 1024),
        // Multi-file projects (the course code editor): all files together.
        maxProjectBytes: int('COMPILER_MAX_PROJECT_BYTES', 256 * 1024),
        maxFiles: int('COMPILER_MAX_FILES', 50),
        maxInputBytes: int('COMPILER_MAX_INPUT_BYTES', 4096),
        maxRunsPerMinute: int('COMPILER_MAX_RUNS_PER_MINUTE', 20),
        maxSessionsPerUser: int('COMPILER_MAX_SESSIONS_PER_USER', 1),
        // Beyond this many waiting runs per language, new runs are refused
        // with "busy" instead of queueing for a very long time.
        maxQueueLength: int('COMPILER_MAX_QUEUE_LENGTH', 50),
        // The service writes its health key every few seconds; older than
        // this = offline.
        serviceStaleMs: int('COMPILER_SERVICE_STALE_MS', 20000),
        // Local development only: lets the compiler work without signing in.
        // Ignored when NODE_ENV=production.
        allowAnonymous: process.env.NODE_ENV !== 'production' && process.env.COMPILER_ALLOW_ANONYMOUS === 'true',
    }
}

module.exports = { get }
