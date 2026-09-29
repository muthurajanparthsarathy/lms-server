// services/backupService.js
//
// Execution half of the Backup module. utils/backupScopes.js decides WHAT to
// select; this file counts it, writes it out and reads it back.
//
//   countPlan(plan)            → per-collection counts, no documents loaded
//   runLocal(plan, meta)       → a .zip under server/backups/
//   runDbCopy(plan, meta)      → an upsert copy into BACKUP_MONGOURI
//   restore(record, options)   → read a local zip back into the live database
//
// Memory rules honoured throughout: every read goes through a cursor with a
// batch size of 500 and no collection is ever materialised as one array of
// documents. (adm-zip — the only zip library in this project, there is no
// archiver — needs a complete Buffer per zip entry, so a collection's SERIALISED
// text is unavoidably assembled in memory; the documents themselves are released
// batch by batch as they are serialised, which is the achievable minimum here.)

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const mongoose = require("mongoose");
const mongodb = require("mongodb");
const { MongoClient } = mongodb;

// Restoring a DB-COPY backup rebuilds the original selection plan and runs it
// against the BACKUP database (see restoreFromDb). backupScopes requires only
// mongoose and cascadeDeleteCourses, so this is not a cycle.
const { buildPlan, withDatabase } = require("../utils/backupScopes");

const BATCH_SIZE = 500;

// Refuse to plan a dump bigger than this rather than run the server out of
// memory. Checked before a single document is read.
const MAX_DOCUMENTS = 500000;

// A single collection's serialized text is one JS string (adm-zip needs a
// whole Buffer per entry). V8's max string length on 64-bit Node is
// 2^29-24 (~536 MB); canonical EJSON inflates every ObjectId/Date well past
// plain JSON, so MAX_DOCUMENTS alone (a document count) does not stop a
// wide collection from crossing that limit mid-run. Bounded well under the
// hard ceiling so the failure is a clean 400, not a RangeError after minutes
// of streaming.
const MAX_COLLECTION_BYTES = 200 * 1024 * 1024;

const BACKUP_DIR = path.join(__dirname, "..", "backups");

// EJSON keeps ObjectIds, Dates, Decimal128 and friends intact across a JSON
// round trip. NOTE for the record: the installed mongodb 5.9.2 does NOT export
// EJSON at the top level (`require('mongodb').EJSON` is undefined) — it is
// re-exported under `.BSON`, and `require('bson')` also exposes it. Resolved in
// that order, with a plain-JSON fallback that is only ever reached if all three
// disappear (in which case ObjectIds/Dates degrade to strings).
const resolveEJSON = () => {
  if (mongodb.EJSON && typeof mongodb.EJSON.stringify === "function") {
    return mongodb.EJSON;
  }
  if (mongodb.BSON && mongodb.BSON.EJSON && typeof mongodb.BSON.EJSON.stringify === "function") {
    return mongodb.BSON.EJSON;
  }
  try {
    // eslint-disable-next-line global-require
    const bson = require("bson");
    if (bson.EJSON && typeof bson.EJSON.stringify === "function") return bson.EJSON;
  } catch (err) {
    /* fall through */
  }
  return null;
};

const EJSON = resolveEJSON();

const serializeDocs = (docs) =>
  EJSON ? EJSON.stringify(docs, { relaxed: false }) : JSON.stringify(docs);

// `relaxed: false` here is not optional: EJSON.parse defaults to relaxed mode,
// which collapses every canonical wrapper ({"$numberInt":"5"}, "$numberLong")
// back to a plain JS double. Parsing relaxed after writing canonical means a
// restore silently changes every Int32/Long field's BSON type to Double.
const parseDocs = (text) => (EJSON ? EJSON.parse(text, { relaxed: false }) : JSON.parse(text));

class BackupError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = "BackupError";
    this.statusCode = statusCode;
  }
}

const liveDb = () => {
  const db = mongoose.connection && mongoose.connection.db;
  if (!db) throw new BackupError("Database connection is not ready", 500);
  return db;
};

const slugify = (value) =>
  String(value || "backup")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "backup";

const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-");

const appVersion = () => {
  try {
    // eslint-disable-next-line global-require
    return require("../package.json").version || "";
  } catch (err) {
    return "";
  }
};

// ── Counting ─────────────────────────────────────────────────────────────────

/**
 * countDocuments per step. Never loads a document. Returns the shape the
 * preview endpoint and the BackupModel both use.
 */
async function countPlan(plan) {
  const db = liveDb();
  const collections = [];
  let totalDocuments = 0;

  for (const step of plan.steps) {
    // eslint-disable-next-line no-await-in-loop
    const count = await db.collection(step.collection).countDocuments(step.filter || {});
    collections.push({ collection: step.collection, count });
    totalDocuments += count;
  }

  return { collections, totalDocuments };
}

// ── Local zip destination ────────────────────────────────────────────────────

/**
 * Stream one step into a JSON array of raw documents, batch by batch.
 * Returns { text, count } — `text` is the complete file body for the zip entry.
 */
async function readStepAsJsonArray(db, step) {
  const cursor = db
    .collection(step.collection)
    .find(step.filter || {})
    .batchSize(BATCH_SIZE);

  const parts = ["["];
  let bytes = 1;
  let count = 0;
  let batch = [];

  const flush = () => {
    if (!batch.length) return;
    // serializeDocs emits "[a,b,c]" — strip the outer brackets so the batches
    // concatenate into one array without ever holding them all as objects.
    const chunk = serializeDocs(batch);
    const piece = (count > batch.length ? "," : "") + chunk.slice(1, -1);
    bytes += Buffer.byteLength(piece, "utf8");
    if (bytes > MAX_COLLECTION_BYTES) {
      throw new BackupError(
        `Collection "${step.collection}" serializes to more than ${Math.round(
          MAX_COLLECTION_BYTES / (1024 * 1024)
        )} MB, which exceeds what a single local .zip entry can hold. Back up a smaller scope, or use the "db" destination instead.`,
        400
      );
    }
    parts.push(piece);
    batch = [];
  };

  for await (const doc of cursor) {
    batch.push(doc);
    count += 1;
    if (batch.length >= BATCH_SIZE) flush();
  }
  flush();
  parts.push("]");
  bytes += 1;

  return { text: parts.join(""), count, bytes };
}

/**
 * Write the plan to a zip under server/backups/.
 * Layout: manifest.json + data/<collection>.json (a JSON array of raw documents).
 */
async function runLocal(plan, meta = {}) {
  const db = liveDb();
  await fs.promises.mkdir(BACKUP_DIR, { recursive: true });

  const zip = new AdmZip();
  const collections = [];
  let totalDocuments = 0;

  for (const step of plan.steps) {
    // eslint-disable-next-line no-await-in-loop
    const { text, count } = await readStepAsJsonArray(db, step);
    zip.addFile(`data/${step.collection}.json`, Buffer.from(text, "utf8"));
    collections.push({ collection: step.collection, count });
    totalDocuments += count;
  }

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    scope: plan.scope,
    targetId: plan.targetId || "",
    targetName: plan.targetName || "",
    institution: String(meta.institution || ""),
    serialization: EJSON ? "ejson-canonical" : "json",
    collections,
    totalDocuments,
    appVersion: appVersion(),
    createdByEmail: meta.createdByEmail || "",
    note: meta.note || "",
  };
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

  const fileName = `backup-${slugify(plan.scope)}-${slugify(plan.targetName)}-${timestamp()}.zip`;
  const filePath = path.join(BACKUP_DIR, fileName);
  const buffer = zip.toBuffer();

  // Write under a temp name and rename into place only once the write is
  // complete, so a mid-write failure (disk full, process killed) can never
  // leave a truncated .zip at the final path with no record pointing at it —
  // a failed write cleans up its own temp file instead.
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.promises.writeFile(tmpPath, buffer);
    await fs.promises.rename(tmpPath, filePath);
  } catch (error) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw error;
  }

  return { fileName, filePath, sizeBytes: buffer.length, collections, totalDocuments };
}

// ── Database-copy destination ────────────────────────────────────────────────

/**
 * Copy the plan into the database behind BACKUP_MONGOURI. Destination
 * collections keep the SAME names and the documents keep their _id exactly, so
 * a re-run of the same backup overwrites rather than duplicates.
 *
 * The URI is never logged, returned or persisted — only the database name is.
 */
async function runDbCopy(plan, meta = {}) {
  const uri = process.env.BACKUP_MONGOURI;
  if (!uri) {
    throw new BackupError("BACKUP_MONGOURI is not configured in server/.env", 400);
  }

  const sourceDb = liveDb();
  let client;
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
    await client.connect();
    const targetDb = client.db();
    const targetDatabase = targetDb.databaseName;

    // client.db() with no argument falls back to the driver default database
    // "test" when the URI carries no path component (exactly the shape Atlas
    // hands out: "...mongodb.net/?retryWrites=true&..."). That silently sends
    // every backup somewhere the operator never chose and never sees in the
    // UI. Likewise, refuse to copy into the SAME database the live app reads
    // from — BACKUP_MONGOURI naming the live cluster with no /<db> path would
    // otherwise upsert backup documents directly into production data.
    if (!targetDatabase || targetDatabase === "test") {
      throw new BackupError(
        'BACKUP_MONGOURI must name an explicit database (add "/<dbname>" before the "?" in the connection string) — it currently resolves to the driver default database.',
        400
      );
    }
    if (targetDatabase === sourceDb.databaseName) {
      throw new BackupError(
        "BACKUP_MONGOURI resolves to the same database the application reads and writes. Point it at a separate backup database.",
        400
      );
    }

    const collections = [];
    let totalDocuments = 0;

    for (const step of plan.steps) {
      const target = targetDb.collection(step.collection);
      const cursor = sourceDb
        .collection(step.collection)
        .find(step.filter || {})
        .batchSize(BATCH_SIZE);

      let operations = [];
      let count = 0;

      const flush = async () => {
        if (!operations.length) return;
        await target.bulkWrite(operations, { ordered: false });
        operations = [];
      };

      // eslint-disable-next-line no-await-in-loop
      for await (const doc of cursor) {
        operations.push({
          replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
        });
        count += 1;
        if (operations.length >= BATCH_SIZE) {
          // eslint-disable-next-line no-await-in-loop
          await flush();
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await flush();

      collections.push({ collection: step.collection, count });
      totalDocuments += count;
    }

    return { targetDatabase, collections, totalDocuments };
  } catch (error) {
    if (error instanceof BackupError) throw error;
    // Guard against a driver error echoing the URI (and its password) outward.
    const safe = String(error.message || "Backup copy failed").replace(
      /mongodb(\+srv)?:\/\/\S+/gi,
      "<backup connection>"
    );
    throw new BackupError(`Backup database copy failed: ${safe}`, 500);
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (closeError) {
        console.error("Backup: failed to close backup client:", closeError.message);
      }
    }
  }
}

// ── Restore ──────────────────────────────────────────────────────────────────

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Run one bulkWrite and report what ACTUALLY happened, instead of letting a
 * single failed operation (e.g. lms-users.email's global unique index
 * rejecting a restored document that collides with a document created since
 * the backup was taken) throw and abort every collection queued after it.
 *
 * The Node driver raises MongoBulkWriteError even with `ordered:false` if any
 * operation in the batch failed — the remaining operations in that SAME batch
 * still ran, but the exception has to be caught here or it unwinds all the
 * way out of restore(), leaving every later collection in the zip untouched
 * and the caller with nothing but a bare 500.
 */
async function runRestoreBatch(target, operations, failures) {
  try {
    const res = await target.bulkWrite(operations, { ordered: false });
    return {
      inserted: (res.insertedCount || 0) + (res.upsertedCount || 0),
      updated: res.modifiedCount || 0,
    };
  } catch (error) {
    const result = error.result || {};
    const writeErrors = error.writeErrors || (error.result && error.result.getWriteErrors && error.result.getWriteErrors()) || [];
    if (writeErrors.length) {
      writeErrors.forEach((writeError) => {
        failures.push({
          code: writeError.code,
          message: String(writeError.errmsg || writeError.message || "Write failed").slice(0, 300),
        });
      });
    } else {
      failures.push({ code: error.code, message: String(error.message || "Write failed").slice(0, 300) });
    }
    return {
      inserted: (result.nInserted ?? result.insertedCount ?? 0) + (result.nUpserted ?? result.upsertedCount ?? 0),
      updated: result.nModified ?? result.modifiedCount ?? 0,
    };
  }
}

/**
 * Read a local backup zip back into the LIVE mongoose connection.
 *
 *   mode 'overwrite' — replaceOne(upsert) every document
 *   mode 'skip'      — insert only documents whose _id is not already present
 *                      (the DEFAULT: anything that is not exactly 'overwrite'
 *                       is treated as 'skip')
 *   dryRun           — compute matched/inserted/updated/skipped, write nothing
 *
 * A write failure in one collection (most commonly a non-_id unique index
 * collision, e.g. lms-users.email) does NOT abort the rest of the restore —
 * every collection in the archive is still attempted, and the failure is
 * surfaced per collection in the returned report rather than as a bare 500
 * that leaves the caller unable to tell what did or didn't land.
 */
/**
 * Apply ONE batch of archived documents to a live collection, accumulating
 * counts into `counters`. Shared by both restore sources — the only thing that
 * differs between a .zip and a backup database is where the documents were
 * read from, never what is done with them.
 */
async function applyRestoreBatch(target, batch, mode, dryRun, counters, failures) {
  const ids = batch.map((doc) => doc._id).filter((id) => id !== undefined);
  const existing = await target
    .find({ _id: { $in: ids } }, { projection: { _id: 1 } })
    .toArray();
  const existingIds = new Set(existing.map((doc) => String(doc._id)));
  counters.matched += existingIds.size;

  const missing = batch.filter((doc) => !existingIds.has(String(doc._id)));

  if (mode === "overwrite") {
    if (dryRun) {
      counters.updated += batch.length - missing.length;
      counters.inserted += missing.length;
      return;
    }
    if (!batch.length) return;
    const operations = batch.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    }));
    // A collection-level failure list, not a thrown error: one bad document
    // must not stop the rest of this batch, this collection, or every
    // collection queued after it.
    const result = await runRestoreBatch(target, operations, failures);
    counters.inserted += result.inserted;
    counters.updated += result.updated;
    return;
  }

  counters.skipped += batch.length - missing.length;
  if (dryRun) {
    counters.inserted += missing.length;
    return;
  }
  if (!missing.length) return;
  const operations = missing.map((doc) => ({ insertOne: { document: doc } }));
  const result = await runRestoreBatch(target, operations, failures);
  counters.inserted += result.inserted;
}

const emptyCounters = () => ({ matched: 0, inserted: 0, updated: 0, skipped: 0 });

const collectionReport = (collection, counters, failures) => ({
  collection,
  ...counters,
  failed: failures.length,
  // Capped so a pathological batch (thousands of duplicate-key errors) cannot
  // blow up the response payload; `failed` above is exact.
  failures: failures.slice(0, 20),
});

/** Restore a local .zip archive into the live database. */
async function restoreFromLocal(record, mode, dryRun) {
  if (!record.filePath || !fs.existsSync(record.filePath)) {
    throw new BackupError("Backup file is missing on disk", 404);
  }

  const db = liveDb();
  const zip = new AdmZip(record.filePath);
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && /^data\/.+\.json$/.test(entry.entryName));

  const collections = [];

  for (const entry of entries) {
    const collectionName = entry.entryName.replace(/^data\//, "").replace(/\.json$/, "");
    let docs;
    try {
      docs = parseDocs(entry.getData().toString("utf8"));
    } catch (parseError) {
      throw new BackupError(
        `Backup file is corrupt: could not read data/${collectionName}.json`,
        400
      );
    }
    if (!Array.isArray(docs)) docs = [];

    const target = db.collection(collectionName);
    const counters = emptyCounters();
    const failures = [];

    for (const batch of chunk(docs, BATCH_SIZE)) {
      // eslint-disable-next-line no-await-in-loop
      await applyRestoreBatch(target, batch, mode, dryRun, counters, failures);
    }

    collections.push(collectionReport(collectionName, counters, failures));
  }

  return collections;
}

/**
 * Restore a DB-COPY backup: read from the backup database, write into the live one.
 *
 * The backup database holds SHARED collections that accumulate across runs
 * (runDbCopy upserts by _id and never deletes), so "everything in
 * lms-users over there" is not this backup's contents — it is every
 * db-destination backup ever taken. To restore only what THIS record covers,
 * the original selection plan is rebuilt and evaluated AGAINST THE BACKUP
 * DATABASE, which reproduces exactly the set of documents that run copied.
 *
 * Resolving the plan against the backup database rather than the live one is
 * the crux: a restore exists precisely because the live database has lost
 * something, so resolving course/module/exercise ids there would find nothing
 * and quietly restore an empty set.
 */
async function restoreFromDb(record, mode, dryRun) {
  const uri = process.env.BACKUP_MONGOURI;
  if (!uri) {
    throw new BackupError("BACKUP_MONGOURI is not configured in server/.env", 400);
  }
  if (!record.scope) {
    throw new BackupError("This backup record has no scope to restore from", 400);
  }

  const liveDatabase = liveDb();
  let client;
  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
    await client.connect();
    const sourceDb = client.db();

    // Refuse to read from a database the backup was not written to — if
    // BACKUP_MONGOURI has been repointed since, the documents over there are
    // someone else's and restoring them into the live database would be an
    // invented dataset, not a restore.
    if (record.targetDatabase && sourceDb.databaseName !== record.targetDatabase) {
      throw new BackupError(
        `This backup was written to the database "${record.targetDatabase}", but BACKUP_MONGOURI now points at "${sourceDb.databaseName}". Point it back before restoring.`,
        400
      );
    }

    const plan = await withDatabase(sourceDb, () =>
      buildPlan({
        scope: record.scope,
        targetId: record.targetId || null,
        institution: record.institution,
      })
    );

    const collections = [];

    for (const step of plan.steps) {
      const target = liveDatabase.collection(step.collection);
      const counters = emptyCounters();
      const failures = [];

      const cursor = sourceDb
        .collection(step.collection)
        .find(step.filter || {})
        .batchSize(BATCH_SIZE);

      let batch = [];
      // eslint-disable-next-line no-await-in-loop
      for await (const doc of cursor) {
        batch.push(doc);
        if (batch.length >= BATCH_SIZE) {
          // eslint-disable-next-line no-await-in-loop
          await applyRestoreBatch(target, batch, mode, dryRun, counters, failures);
          batch = [];
        }
      }
      if (batch.length) {
        // eslint-disable-next-line no-await-in-loop
        await applyRestoreBatch(target, batch, mode, dryRun, counters, failures);
      }

      collections.push(collectionReport(step.collection, counters, failures));
    }

    return collections;
  } catch (error) {
    if (error instanceof BackupError) throw error;
    if (error && error.name === "BackupPlanError") {
      throw new BackupError(error.message, error.statusCode || 400);
    }
    // Never let a driver error echo the URI (and its password) outward.
    const safe = String(error.message || "Restore failed").replace(
      /mongodb(\+srv)?:\/\/\S+/gi,
      "<backup connection>"
    );
    throw new BackupError(`Restore from the backup database failed: ${safe}`, 500);
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (closeError) {
        console.error("Backup: failed to close backup client:", closeError.message);
      }
    }
  }
}

async function restore(record, options = {}) {
  const mode = options.mode === "overwrite" ? "overwrite" : "skip";
  const dryRun = options.dryRun !== false;

  if (!record) {
    throw new BackupError("Backup not found", 404);
  }

  const collections =
    record.destination === "db"
      ? await restoreFromDb(record, mode, dryRun)
      : await restoreFromLocal(record, mode, dryRun);

  return {
    dryRun,
    mode,
    source: record.destination === "db" ? "database" : "archive",
    collections,
    totalInserted: collections.reduce((sum, c) => sum + c.inserted, 0),
    totalUpdated: collections.reduce((sum, c) => sum + c.updated, 0),
    totalSkipped: collections.reduce((sum, c) => sum + c.skipped, 0),
    totalFailed: collections.reduce((sum, c) => sum + c.failed, 0),
  };
}

module.exports = {
  countPlan,
  runLocal,
  runDbCopy,
  restore,
  BackupError,
  MAX_DOCUMENTS,
  BACKUP_DIR,
  BATCH_SIZE,
};
