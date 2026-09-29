// Redis connections and BullMQ queues for the gateway, created on first use.
//
//   commands    publish input/stop, alive/stop keys, health reads
//   subscriber  receives every session's output channel
//   queues      one BullMQ Queue per language (the compiler service consumes them)
//   events      QueueEvents per language, to notice jobs that fail inside the
//               service (e.g. it restarted mid-run)
//
// Redis errors are logged at most every 30 s and never crash the LMS server.

const IORedis = require('ioredis')
const { Queue, QueueEvents } = require('bullmq')
const { LANGUAGES } = require('../protocol')
const settings = require('../config')
const log = require('../logger')

let state = null
let lastErrorLog = 0

function onRedisError(name) {
    return (e) => {
        if (Date.now() - lastErrorLog < 30000) return
        lastErrorLog = Date.now()
        log.error('redis_error', { connection: name, error: e.message })
    }
}

function connect() {
    if (state) return state
    const cfg = settings.get()
    if (!cfg.redisUrl) return null
    const opts = { maxRetriesPerRequest: null, enableReadyCheck: true }
    const commands = new IORedis(cfg.redisUrl, opts)
    const subscriber = new IORedis(cfg.redisUrl, opts)
    commands.on('error', onRedisError('commands'))
    subscriber.on('error', onRedisError('subscriber'))
    const queues = {}
    const events = {}
    for (const lang of LANGUAGES) {
        queues[lang] = new Queue(lang, { connection: commands, prefix: cfg.prefix })
        queues[lang].on('error', onRedisError(`queue:${lang}`))
        // QueueEvents blocks on its connection, so it gets its own.
        const eventsConn = new IORedis(cfg.redisUrl, opts)
        eventsConn.on('error', onRedisError(`events:${lang}`))
        events[lang] = new QueueEvents(lang, { connection: eventsConn, prefix: cfg.prefix })
        events[lang].on('error', onRedisError(`events:${lang}`))
    }
    state = { commands, subscriber, queues, events, prefix: cfg.prefix }
    return state
}

module.exports = { connect }
