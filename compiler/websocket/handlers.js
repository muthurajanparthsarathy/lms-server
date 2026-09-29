// Socket.IO bindings for the live compiler, registered per connection like
// the other real-time features (see server.js).
//
//   compiler:start  { language, source }  → ack { ok, sessionId } | { ok: false, code, error }
//   compiler:input  { sessionId, data }   (data is sent to the program's stdin as is)
//   compiler:stop   { sessionId }

const { compilerUser } = require('./auth')
const log = require('../logger')

const START_TIMEOUT_MS = 10000

function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'UNAVAILABLE' })), ms))])
}

function registerCompilerHandlers(gateway, socket) {
    socket.on('compiler:start', async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {}
        try {
            const user = await compilerUser(socket)
            if (!user) return reply({ ok: false, code: 'UNAUTHENTICATED', error: 'Please sign in to run code.' })
            const { sessionId } = await withTimeout(gateway.start(socket, user, payload && typeof payload === 'object' ? payload : {}), START_TIMEOUT_MS)
            reply({ ok: true, sessionId })
        } catch (e) {
            if (e.userFacing) return reply({ ok: false, code: e.code, error: e.message })
            log.error('start_failed', { socketId: socket.id, error: e.message })
            reply({ ok: false, code: e.code || 'INTERNAL', error: 'Could not start the program. Please try again.' })
        }
    })
    socket.on('compiler:input', (payload) => {
        if (payload && typeof payload === 'object') gateway.input(socket, payload)
    })
    socket.on('compiler:stop', (payload) => {
        if (payload && typeof payload === 'object') gateway.stop(socket, payload)
    })
    socket.on('disconnect', () => gateway.disconnect(socket))
}

module.exports = { registerCompilerHandlers }
