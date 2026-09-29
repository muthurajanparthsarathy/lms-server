// Compiler gateway: turns a student's socket events into compiler-service
// jobs and relays the program's live I/O back.
//
//   compiler:start  validate → BullMQ job (picked at once if a warm worker is
//                   free, otherwise queued: the student sees their position)
//   service output (Redis pub/sub) → compiler:stdout / :stderr / :status / …
//   compiler:input  → Redis → the running program's stdin
//   compiler:stop / socket disconnect → the run is removed from the queue or
//                   killed, the worker cleaned and released by the service
//
// No LMS data is sent to the compiler service besides the program text, the
// language and the user id (for its logs).

const crypto = require('crypto')
const { connect } = require('../queue/connections')
const { SessionRegistry } = require('./sessions')
const { LANGUAGES, LABELS, TERMINAL, EVENTS, channels: makeChannels } = require('../protocol')
const settings = require('../config')
const log = require('../logger')

const ALIVE_TTL_MS = 30000
const STOP_TTL_MS = 15 * 60 * 1000
const WAITING_STATES = new Set(['waiting', 'delayed', 'prioritized', 'waiting-children'])

class UserError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
        this.userFacing = true
    }
}

// A project file path as a clean relative path ("src/Main.java"), or null.
// No absolute paths, no "..", no option-like or control-character names.
function cleanPath(raw) {
    if (typeof raw !== 'string' || raw.length > 255) return null
    const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean)
    if (!parts.length) return null
    for (const p of parts) {
        if (p === '.' || p === '..' || p.startsWith('-') || /[\x00-\x1f"'`$<>|*?]/.test(p)) return null
    }
    return parts.join('/')
}

// Optional multi-file project: { files: [{ path, content }], entry }.
function projectOf(payload, cfg) {
    if (payload.files === undefined) return null
    if (!Array.isArray(payload.files) || !payload.files.length) throw new UserError('BAD_FILES', 'The project has no files.')
    if (payload.files.length > cfg.maxFiles) throw new UserError('TOO_MANY_FILES', `A project can have at most ${cfg.maxFiles} files.`)
    const files = []
    const seen = new Set()
    let bytes = 0
    for (const f of payload.files) {
        const path = cleanPath(f && f.path)
        if (!path || typeof f.content !== 'string') throw new UserError('BAD_FILES', 'One of the file names is not allowed.')
        if (seen.has(path)) throw new UserError('BAD_FILES', `The file ${path} appears twice.`)
        seen.add(path)
        bytes += Buffer.byteLength(f.content, 'utf8')
        files.push({ path, content: f.content })
    }
    if (bytes > cfg.maxProjectBytes) throw new UserError('SOURCE_TOO_LARGE', `The project is larger than ${Math.round(cfg.maxProjectBytes / 1024)} KB.`)
    const entry = cleanPath(payload.entry)
    if (!entry || !seen.has(entry)) throw new UserError('BAD_FILES', 'The file to run is not part of the project.')
    return { files, entry, bytes }
}

class CompilerGateway {
    constructor(io) {
        this.io = io
        this.sessions = new SessionRegistry()
        this.runs = new Map() // userId → start timestamps within the last minute
        this.conn = null
    }

    // Connect to Redis once (at boot, when configured) and start listening.
    init() {
        if (this.conn) return this.conn
        const conn = connect()
        if (!conn) return null
        this.conn = conn
        this.ch = makeChannels(conn.prefix)
        conn.subscriber.on('message', (channel, raw) => this.onServiceMessage(channel, raw))
        for (const lang of LANGUAGES) {
            conn.events[lang].on('failed', ({ jobId, failedReason }) => this.onJobFailed(jobId, failedReason))
        }
        this.aliveTimer = setInterval(() => this.refreshAlive(), 10000)
        this.aliveTimer.unref()
        log.info('gateway_ready', { prefix: conn.prefix })
        return conn
    }

    emit(session, event, payload = {}) {
        this.io.to(session.socketId).emit(event, { sessionId: session.sessionId, ...payload })
    }

    async serviceHealth() {
        const raw = await this.conn.commands.get(this.ch.health)
        if (!raw) return { online: false, languages: {} }
        const h = JSON.parse(raw)
        const ageMs = Date.now() - h.ts
        return { online: ageMs < settings.get().serviceStaleMs, ageMs, languages: h.languages || {}, host: h.host, pool: h.pool }
    }

    // ── compiler:start ──────────────────────────────────────────────────────
    async start(socket, user, payload) {
        const cfg = settings.get()
        const conn = this.init()
        if (!conn) throw new UserError('NOT_CONFIGURED', 'The live compiler is not set up on this server yet.')
        if (conn.commands.status !== 'ready') throw new UserError('UNAVAILABLE', 'The compiler service is unavailable right now. Please try again shortly.')

        const language = String(payload.language || '')
        if (!LANGUAGES.includes(language)) throw new UserError('BAD_LANGUAGE', 'This language is not supported.')
        const source = payload.source
        if (typeof source !== 'string' || !source.trim()) throw new UserError('EMPTY', 'Write some code first.')
        if (Buffer.byteLength(source, 'utf8') > cfg.maxSourceBytes) throw new UserError('SOURCE_TOO_LARGE', `The program is larger than ${Math.round(cfg.maxSourceBytes / 1024)} KB.`)
        const project = projectOf(payload, cfg)

        // A new Run from the same tab replaces the previous one.
        for (const old of this.sessions.forSocket(socket.id)) await this.stopSession(old, 'replaced')
        if (this.sessions.countForUser(user.userId) >= cfg.maxSessionsPerUser) {
            throw new UserError('TOO_MANY', 'You already have a program running in another tab. Stop it first.')
        }
        const now = Date.now()
        const recent = (this.runs.get(user.userId) || []).filter((t) => now - t < 60000)
        if (recent.length >= cfg.maxRunsPerMinute) throw new UserError('RATE_LIMIT', 'Too many runs in a minute. Please wait a moment.')
        recent.push(now)
        this.runs.set(user.userId, recent)

        const health = await this.serviceHealth()
        if (!health.online) throw new UserError('OFFLINE', 'The compiler service is offline right now. Please try again shortly.')
        const pool = health.languages[language]
        if (!pool || pool.total < 1) throw new UserError('LANGUAGE_DISABLED', `${LABELS[language]} is not available right now.`)
        const queue = conn.queues[language]
        if ((await queue.getWaitingCount()) >= cfg.maxQueueLength) throw new UserError('BUSY', 'The compiler is very busy right now. Please try again in a minute.')

        const sessionId = crypto.randomUUID()
        const session = {
            sessionId,
            userId: user.userId,
            socketId: socket.id,
            language,
            status: 'queued',
            workerId: null,
            createdAt: now,
            lastActivityAt: now,
            ending: false,
            timers: [],
        }
        this.sessions.add(session)
        try {
            await conn.subscriber.subscribe(this.ch.out(sessionId))
            await conn.commands.set(this.ch.alive(sessionId), '1', 'PX', ALIVE_TTL_MS)
            const job = { sessionId, language, source, userId: user.userId }
            if (project) Object.assign(job, { files: project.files, entry: project.entry })
            await queue.add('run', job, { jobId: sessionId, attempts: 1, removeOnComplete: true, removeOnFail: true })
        } catch (e) {
            this.finalize(session, 'error')
            throw e
        }
        log.info('execution_requested', { sessionId, userId: user.userId, language, bytes: project ? project.bytes : Buffer.byteLength(source, 'utf8'), ...(project ? { files: project.files.length } : {}) })
        this.watchQueue(session)
        return { sessionId }
    }

    // While the run waits for a worker, tell the student where they are.
    watchQueue(session) {
        const queue = this.conn.queues[session.language]
        let announced = false
        const check = async () => {
            if (session.status !== 'queued' || session.ending || !this.sessions.get(session.sessionId)) return
            try {
                const waiting = await queue.getJobs(['waiting', 'prioritized'], 0, 500, true)
                const index = waiting.findIndex((j) => j.id === session.sessionId)
                if (index !== -1 && session.status === 'queued') {
                    if (!announced) { announced = true; log.info('queued', { sessionId: session.sessionId, language: session.language, position: index + 1 }) }
                    this.emit(session, EVENTS.queued, { position: index + 1, waiting: waiting.length })
                }
            } catch (e) {
                log.warn('queue_position_failed', { sessionId: session.sessionId, error: e.message })
            }
            session.timers.push(setTimeout(check, 2000))
        }
        session.timers.push(setTimeout(check, 400))
    }

    // ── Output from the compiler service ────────────────────────────────────
    onServiceMessage(channel, raw) {
        const m = /:session:([0-9a-f-]{36}):out$/.exec(channel)
        const session = m && this.sessions.get(m[1])
        if (!session) return
        let msg
        try { msg = JSON.parse(raw) } catch { return }
        session.lastActivityAt = Date.now()
        switch (msg.t) {
            case 'started':
                session.status = 'starting'
                session.workerId = msg.workerId
                this.emit(session, EVENTS.started, { workerId: msg.workerId })
                break
            case 'status':
                session.status = msg.phase
                this.emit(session, EVENTS.status, { phase: msg.phase })
                break
            case 'stdout': this.emit(session, EVENTS.stdout, { data: msg.d }); break
            case 'stderr': this.emit(session, EVENTS.stderr, { data: msg.d, source: msg.source }); break
            case 'compile_error': this.emit(session, EVENTS.compileError, { output: msg.output }); break
            case 'completed': this.emit(session, EVENTS.completed, { exitCode: msg.exitCode, signal: msg.signal, durationMs: msg.durationMs }); break
            case 'timeout': this.emit(session, EVENTS.timeout, { kind: msg.kind, message: msg.message }); break
            case 'stopped': this.emit(session, EVENTS.stopped); break
            case 'error': this.emit(session, EVENTS.error, { code: msg.code, message: msg.message }); break
        }
        if (TERMINAL.has(msg.t)) this.finalize(session, msg.t)
    }

    onJobFailed(jobId, reason) {
        const session = this.sessions.get(jobId)
        if (!session) return
        log.error('job_failed', { sessionId: jobId, reason: String(reason || '').slice(0, 200) })
        this.emit(session, EVENTS.error, { code: 'SERVICE_FAILED', message: 'The compiler service stopped unexpectedly. Please run the program again.' })
        this.finalize(session, 'error')
    }

    // ── compiler:input ──────────────────────────────────────────────────────
    input(socket, payload) {
        const session = this.sessions.get(String(payload.sessionId || ''))
        if (!session || session.socketId !== socket.id || session.ending) return
        const data = payload.data
        if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > settings.get().maxInputBytes) return
        session.lastActivityAt = Date.now()
        this.conn.commands.publish(this.ch.in(session.sessionId), JSON.stringify({ t: 'input', d: data })).catch(() => {})
    }

    // ── compiler:stop / disconnect ──────────────────────────────────────────
    stop(socket, payload) {
        const session = this.sessions.get(String(payload.sessionId || ''))
        if (!session || session.socketId !== socket.id) return
        log.info('student_stopped', { sessionId: session.sessionId, status: session.status })
        this.stopSession(session, 'student').catch((e) => log.error('stop_failed', { sessionId: session.sessionId, error: e.message }))
    }

    disconnect(socket) {
        const open = this.sessions.forSocket(socket.id)
        if (!open.length) return
        log.info('socket_disconnected', { socketId: socket.id, sessions: open.length })
        for (const s of open) this.stopSession(s, 'disconnect').catch(() => {})
    }

    async stopSession(session, why) {
        if (session.ending) return
        session.ending = true
        const { commands, queues } = this.conn
        await commands.set(this.ch.stop(session.sessionId), '1', 'PX', STOP_TTL_MS).catch(() => {})
        // Still waiting in the queue? Take it out; nothing is running yet.
        let removed = false
        try {
            const job = await queues[session.language].getJob(session.sessionId)
            if (job && WAITING_STATES.has(await job.getState())) { await job.remove(); removed = true }
        } catch { /* it just became active: stop it below instead */ }
        if (removed) {
            this.emit(session, EVENTS.stopped)
            this.finalize(session, why)
            return
        }
        await commands.publish(this.ch.in(session.sessionId), JSON.stringify({ t: 'stop' })).catch(() => {})
        // The service answers with "stopped"; don't wait forever for it.
        session.timers.push(setTimeout(() => {
            if (!this.sessions.get(session.sessionId)) return
            this.emit(session, EVENTS.stopped)
            this.finalize(session, why)
        }, 15000))
    }

    finalize(session, outcome) {
        if (!this.sessions.get(session.sessionId)) return
        for (const t of session.timers) clearTimeout(t)
        this.sessions.remove(session.sessionId)
        this.conn.subscriber.unsubscribe(this.ch.out(session.sessionId)).catch(() => {})
        this.conn.commands.del(this.ch.alive(session.sessionId)).catch(() => {})
        log.info('execution_finished', { sessionId: session.sessionId, userId: session.userId, language: session.language, outcome, workerId: session.workerId, ms: Date.now() - session.createdAt })
    }

    refreshAlive() {
        const open = this.sessions.all()
        if (!open.length || !this.conn || this.conn.commands.status !== 'ready') return
        const pipeline = this.conn.commands.pipeline()
        for (const s of open) pipeline.set(this.ch.alive(s.sessionId), '1', 'PX', ALIVE_TTL_MS)
        pipeline.exec().catch(() => {})
        // Forget rate-limit history older than a minute.
        const now = Date.now()
        for (const [user, times] of this.runs) if (!times.some((t) => now - t < 60000)) this.runs.delete(user)
    }

    // ── GET /compiler/health ────────────────────────────────────────────────
    async healthReport() {
        const conn = this.init()
        if (!conn) return { configured: false }
        const service = await this.serviceHealth()
        const queue = {}
        let waitingTotal = 0
        for (const lang of LANGUAGES) {
            const [waiting, active] = await Promise.all([conn.queues[lang].getWaitingCount(), conn.queues[lang].getActiveCount()])
            queue[lang] = { waiting, active }
            waitingTotal += waiting
        }
        const summary = LANGUAGES.map((l) => {
            const p = service.languages[l]
            return p ? `${LABELS[l]}: ${p.available} available / ${p.total} total` : `${LABELS[l]}: no workers`
        })
        summary.push(`Queue: ${waitingTotal} waiting`)
        return {
            configured: true,
            service: { online: service.online, lastReportMsAgo: service.ageMs ?? null, host: service.host, pool: service.pool },
            languages: service.languages,
            queue,
            gateway: { activeSessions: this.sessions.all().length },
            summary,
        }
    }
}

module.exports = { CompilerGateway, UserError }
