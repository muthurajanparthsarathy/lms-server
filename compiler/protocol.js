// Wire contract with the compiler service (compiler-service/src/protocol.js
// holds the same definitions and the full description). Two small copies so
// the LMS server and the compiler service deploy independently: change both
// together.

const LANGUAGES = ['java', 'c', 'cpp', 'csharp', 'javascript', 'typescript', 'go']
const LABELS = { java: 'Java', c: 'C', cpp: 'C++', csharp: 'C#', javascript: 'JavaScript', typescript: 'TypeScript', go: 'Go' }
const TERMINAL = new Set(['compile_error', 'completed', 'timeout', 'stopped', 'error'])

const channels = (prefix) => ({
    out: (id) => `${prefix}:session:${id}:out`,
    in: (id) => `${prefix}:session:${id}:in`,
    stop: (id) => `${prefix}:session:${id}:stop`,
    alive: (id) => `${prefix}:session:${id}:alive`,
    health: `${prefix}:health`,
})

// Socket.IO events. Client → server: compiler:start (with ack), compiler:input,
// compiler:stop. Server → client: everything below, always with { sessionId }.
// compiler:start { language, source } runs one file; a multi-file project
// adds { files: [{ path, content }], entry } (entry = the path to run, and
// `source` is that file's content).
const EVENTS = {
    queued: 'compiler:queued', // { position, waiting }
    started: 'compiler:started', // a warm worker took the run  { workerId }
    status: 'compiler:status', // { phase: 'compiling' | 'running' }
    stdout: 'compiler:stdout', // { data }
    stderr: 'compiler:stderr', // { data, source?: 'compiler' }  (compiler warnings)
    compileError: 'compiler:compile_error', // { output }
    completed: 'compiler:completed', // { exitCode, signal, durationMs }
    timeout: 'compiler:timeout', // { kind: 'execution' | 'idle' | 'session', message }
    stopped: 'compiler:stopped',
    error: 'compiler:error', // { code, message }
}

module.exports = { LANGUAGES, LABELS, TERMINAL, channels, EVENTS }
