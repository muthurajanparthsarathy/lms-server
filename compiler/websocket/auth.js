// Who is running code. The shared Socket.IO middleware (server.js) already
// verified the JWT and set socket.userId; here we also require the token to
// still exist in the token store, exactly like the REST `userAuth`
// middleware, so a signed-out token can't keep using the compiler.

const tokenModal = require('../../models/tokenModal')
const settings = require('../config')

async function compilerUser(socket) {
    if (socket.data.compilerUser) return socket.data.compilerUser
    const token = socket.handshake.auth && socket.handshake.auth.token
    if (socket.userId && token) {
        const doc = await tokenModal.findOne({ token }).select('_id').lean()
        if (doc) {
            socket.data.compilerUser = { userId: String(socket.userId) }
            return socket.data.compilerUser
        }
    }
    if (settings.get().allowAnonymous) return { userId: `anon:${socket.id}` }
    return null
}

module.exports = { compilerUser }
