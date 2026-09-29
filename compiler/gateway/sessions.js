// In-memory registry of live compiler sessions on this LMS server process.
//
// Session: { sessionId, userId, socketId, language, status, workerId,
//            createdAt, lastActivityAt, ending, timers }
//   status: queued → starting → compiling → running (→ removed when it ends)
// The program process itself lives in the compiler service; this holds the
// socket side. Everything is removed when the run ends or the socket drops.

class SessionRegistry {
    constructor() {
        this.byId = new Map()
    }

    add(session) {
        this.byId.set(session.sessionId, session)
    }

    get(sessionId) {
        return this.byId.get(sessionId)
    }

    remove(sessionId) {
        this.byId.delete(sessionId)
    }

    forSocket(socketId) {
        return [...this.byId.values()].filter((s) => s.socketId === socketId)
    }

    countForUser(userId) {
        let n = 0
        for (const s of this.byId.values()) if (s.userId === userId && !s.ending) n++
        return n
    }

    all() {
        return [...this.byId.values()]
    }
}

module.exports = { SessionRegistry }
