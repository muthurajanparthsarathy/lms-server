// Live interactive compiler — LMS gateway.
//
// The programs run in the separate compiler service (compiler-service/),
// which keeps warm Docker workers for Java, C, C++ and C#. This module is
// the only part inside the LMS server:
//   gateway/     session state, queueing, relaying live I/O
//   websocket/   Socket.IO events + authentication
//   queue/       Redis + BullMQ connections
//   routes.js    GET /compiler/health
// Enabled by COMPILER_REDIS_URL; without it nothing connects and runs are
// answered with "not set up".

const { CompilerGateway } = require('./gateway/gateway')
const { registerCompilerHandlers } = require('./websocket/handlers')
const { healthRouter } = require('./routes')
const log = require('./logger')

let gateway = null

/** Call once after Socket.IO is created. */
function initCompiler(io) {
    gateway = new CompilerGateway(io)
    try {
        if (!gateway.init()) log.info('compiler_disabled', { reason: 'COMPILER_REDIS_URL is not set' })
    } catch (e) {
        log.error('compiler_init_failed', { error: e.message })
    }
    return gateway
}

/** Per-connection registration, alongside the other socket features. */
function registerCompilerSocket(socket) {
    if (gateway) registerCompilerHandlers(gateway, socket)
}

module.exports = {
    initCompiler,
    registerCompilerSocket,
    compilerRouter: healthRouter(() => gateway),
}
