// Disk store for files a student's program creates while it runs in the
// multi-file editor (Python on Pyodide in the browser).
//
// Layout:  <root>/<YYYY-MM-DD>/<userId>/<questionId>/<relative path>
//
// Everything is bucketed by the server's LOCAL date so the daily cleanup
// (cron/codeFilesCleanup.js) only has to delete whole date folders older than
// today. Reads only ever look at today's folder, so yesterday's files are gone
// for the student from midnight even if the cleanup has not run yet.
//
// The root is deliberately NOT under server/uploads: that folder is served
// publicly by express.static, and these are private student files.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.CODE_FILES_DIR || path.join(__dirname, '..', 'code-files'));

const MAX_FILES = 100;
const MAX_FILE_BYTES = 1024 * 1024;       // 1 MB per file
const MAX_TOTAL_BYTES = 5 * 1024 * 1024;  // 5 MB per student per question
// questionId is only checked for shape, so cap a student's whole day too.
const MAX_USER_DAY_BYTES = 50 * 1024 * 1024;
const MAX_PATH_LENGTH = 200;
const MAX_DEPTH = 10;

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const BAD_CHARS = /[<>:"|?*\\\u0000-\u001f]/;

function todayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Ids become folder names, so keep them to a safe alphabet.
function safeId(value) {
  const s = String(value == null ? '' : value).trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(s) ? s : null;
}

// Validate a student-supplied relative path and return its clean segments, or
// an error string. Rejects anything that could escape the question folder or
// is not a legal file name on Windows (the server may run there).
function cleanSegments(rawPath) {
  const p = String(rawPath == null ? '' : rawPath).replace(/^\/+/, '');
  if (!p) return { error: 'empty path' };
  if (p.length > MAX_PATH_LENGTH) return { error: 'path too long' };
  const segments = p.split('/');
  if (segments.length > MAX_DEPTH) return { error: 'folder nesting too deep' };
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') return { error: 'invalid path' };
    if (BAD_CHARS.test(seg)) return { error: 'name contains characters not allowed in file names' };
    if (WINDOWS_RESERVED.test(seg) || /[. ]$/.test(seg)) return { error: 'name is not allowed as a file name' };
  }
  return { segments };
}

function questionDir(userId, questionId, date = todayKey()) {
  return path.join(ROOT, date, userId, questionId);
}

// Resolve segments under base and prove the result stays inside it.
function resolveInside(base, segments) {
  const full = path.resolve(base, ...segments);
  return full.startsWith(base + path.sep) ? full : null;
}

// A buffer round-trips as UTF-8 text only if decoding then re-encoding gives the
// same bytes; anything else (images, pickles, …) travels as base64.
function encodeForClient(buf) {
  const text = buf.toString('utf8');
  if (Buffer.from(text, 'utf8').equals(buf)) return { content: text, encoding: 'utf8' };
  return { content: buf.toString('base64'), encoding: 'base64' };
}

async function walk(dir, rel, out) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return out;
    throw e;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, childRel, out);
    else if (entry.isFile()) out.push({ path: childRel, full });
  }
  return out;
}

// Today's saved files for one student + question, with contents.
async function listFiles(userId, questionId) {
  const base = questionDir(userId, questionId);
  const found = await walk(base, '', []);
  found.sort((a, b) => a.path.localeCompare(b.path));
  const files = [];
  for (const f of found) {
    const buf = await fs.promises.readFile(f.full);
    files.push({ path: f.path, size: buf.length, ...encodeForClient(buf) });
  }
  return files;
}

// Check and decode an incoming file list without touching the disk.
// Returns { accepted: [{ segments, path, buf }], skipped: [{ path, reason }] }
// or { error, status } when the whole request must be refused.
function prepareFiles(files) {
  if (!Array.isArray(files)) return { error: 'files[] is required.', status: 400 };
  if (files.length > MAX_FILES) return { error: `Too many files (max ${MAX_FILES}).`, status: 413 };

  const accepted = [];
  const skipped = [];
  const seen = new Set();
  let total = 0;

  for (const f of files) {
    const rawPath = f && f.path;
    const { segments, error } = cleanSegments(rawPath);
    if (error) { skipped.push({ path: String(rawPath || ''), reason: error }); continue; }
    const rel = segments.join('/');
    const key = rel.toLowerCase(); // Windows file names are case-insensitive
    if (seen.has(key)) { skipped.push({ path: rel, reason: 'duplicate path' }); continue; }

    const encoding = f.encoding === 'base64' ? 'base64' : 'utf8';
    const buf = Buffer.from(String(f.content == null ? '' : f.content), encoding);
    if (buf.length > MAX_FILE_BYTES) { skipped.push({ path: rel, reason: 'file is larger than 1 MB' }); continue; }

    total += buf.length;
    if (total > MAX_TOTAL_BYTES) return { error: 'Output files exceed the 5 MB limit.', status: 413 };
    seen.add(key);
    accepted.push({ segments, path: rel, buf });
  }

  // A file and a folder cannot share a name ("a" and "a/b.txt").
  const dirs = new Set();
  for (const a of accepted) {
    for (let i = 1; i < a.segments.length; i++) dirs.add(a.segments.slice(0, i).join('/').toLowerCase());
  }
  const clean = [];
  for (const a of accepted) {
    if (dirs.has(a.path.toLowerCase())) skipped.push({ path: a.path, reason: 'a folder has the same name' });
    else clean.push(a);
  }
  return { accepted: clean, skipped };
}

async function dirBytes(dir) {
  let total = 0;
  for (const f of await walk(dir, '', [])) total += (await fs.promises.stat(f.full)).size;
  return total;
}

// Serialise writes per student so two overlapping saves can neither
// interleave their delete-then-write steps nor both slip under the daily cap.
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
  return next;
}

// Make today's folder hold exactly `accepted` (the program's files at the end
// of its run), so files the program deleted or renamed disappear too.
// Rejects with err.code === 'QUOTA' (nothing changed) past the daily cap.
function replaceFiles(userId, questionId, accepted) {
  return withLock(userId, async () => {
    const date = todayKey();
    const base = questionDir(userId, questionId, date);
    const incoming = accepted.reduce((n, a) => n + a.buf.length, 0);
    const elsewhere = (await dirBytes(path.join(ROOT, date, userId))) - (await dirBytes(base));
    if (elsewhere + incoming > MAX_USER_DAY_BYTES) {
      const err = new Error('Daily storage limit for program files reached (50 MB). They are cleared at midnight.');
      err.code = 'QUOTA';
      throw err;
    }
    await fs.promises.rm(base, { recursive: true, force: true });
    if (!accepted.length) return [];
    await fs.promises.mkdir(base, { recursive: true });
    const saved = [];
    for (const a of accepted) {
      const full = resolveInside(base, a.segments);
      if (!full) continue;
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, a.buf);
      saved.push({ path: a.path, size: a.buf.length });
    }
    return saved;
  });
}

// Delete every date folder older than today. Returns the folders removed.
async function deleteOldDays(now = new Date()) {
  const today = todayKey(now);
  let entries;
  try {
    entries = await fs.promises.readdir(ROOT, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const removed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !DATE_DIR.test(entry.name) || entry.name >= today) continue;
    await fs.promises.rm(path.join(ROOT, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

module.exports = {
  ROOT,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  todayKey,
  safeId,
  listFiles,
  prepareFiles,
  replaceFiles,
  deleteOldDays,
};
