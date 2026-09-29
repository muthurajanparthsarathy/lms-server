// Structured (JSON-per-line) logs for the compiler gateway. Never log source
// code or program I/O; log ids, sizes and outcomes.

function write(level, event, fields) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, svc: 'compiler-gateway', event, ...fields })
    if (level === 'error' || level === 'warn') console.error(line)
    else console.log(line)
}

module.exports = {
    info: (event, fields = {}) => write('info', event, fields),
    warn: (event, fields = {}) => write('warn', event, fields),
    error: (event, fields = {}) => write('error', event, fields),
}
