const Counter = require("../models/CounterModel");

// Client ID (business identifier, distinct from Mongo's _id):
//     CLT-000001, CLT-000002, ... zero-padded to six digits so ids sort
// lexicographically and stay readable in a support ticket or an email.
//
// The next number is minted with a single atomic findOneAndUpdate + $inc on
// the shared Counter document, so two parallel Add Client requests can never
// receive the same id. Counters are keyed per institution — each institution
// numbers its clients independently, starting at 1, so a small pilot org's
// ids stay short even when a large one is on CLT-045000.
//
// Numbers are permanent: deleting a client does NOT roll the counter back.
// A reused id would break every downstream reference (invoices, agreements)
// that names it, and that is exactly what human-readable ids exist to avoid.

const CLIENT_ID_PREFIX = "CLT-";
const CLIENT_ID_PAD = 6;

const formatClientCode = (n) =>
  `${CLIENT_ID_PREFIX}${String(n).padStart(CLIENT_ID_PAD, "0")}`;

const counterId = (institutionId) => `client:${String(institutionId)}`;

// Allocate the next Client ID for the given institution. Returns the string
// to store on the client document (e.g. "CLT-000023"). The write to Counter
// is atomic; the caller is only responsible for USING the value it hands out.
const nextClientCode = async (institutionId) => {
  const doc = await Counter.findOneAndUpdate(
    { _id: counterId(institutionId) },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return formatClientCode(doc.seq || 1);
};

// Advance the counter to at least the number represented by an existing
// Client ID. Used when a legacy record already carries "CLT-000042" and the
// per-institution counter is still 0 — the next allocation must land at
// CLT-000043, not CLT-000001, which would collide with the unique index.
const parseClientCode = (code) => {
  if (typeof code !== "string") return NaN;
  const m = /^CLT-(\d+)$/.exec(code.trim());
  return m ? parseInt(m[1], 10) : NaN;
};

// Raise the counter to at least `n` (a no-op if it is already higher).
// Used by the backfill routine so the sequence is always ahead of every
// stored id.
const ensureClientCounterAtLeast = async (institutionId, n) => {
  if (!Number.isFinite(n) || n <= 0) return;
  await Counter.updateOne(
    { _id: counterId(institutionId) },
    { $max: { seq: n } },
    { upsert: true }
  );
};

module.exports = {
  CLIENT_ID_PREFIX,
  formatClientCode,
  nextClientCode,
  parseClientCode,
  ensureClientCounterAtLeast,
};
