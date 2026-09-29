// GET /compiler/health — pool and queue status, e.g.
//   { summary: ['Java: 2 available / 3 total', …, 'Queue: 4 waiting'], languages, queue, service, gateway }
// Signed-in users, or a monitoring probe sending the header
// `x-compiler-health-token: $COMPILER_HEALTH_TOKEN` when that variable is set.

const express = require('express')
const crypto = require('crypto')
const { userAuth } = require('../middlewares/userAuth')

function probeAllowed(req) {
    const expected = process.env.COMPILER_HEALTH_TOKEN
    const given = req.headers['x-compiler-health-token']
    if (!expected || typeof given !== 'string' || given.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

function healthRouter(getGateway) {
    const router = express.Router()
    const auth = (req, res, next) => (probeAllowed(req) ? next() : userAuth(req, res, next))
    router.get('/compiler/health', auth, async (req, res) => {
        try {
            res.json(await getGateway().healthReport())
        } catch (e) {
            res.status(503).json({ configured: true, error: 'Compiler health is unavailable', detail: e.message })
        }
    })
    return router
}

module.exports = { healthRouter }
