// One-time fix for clients whose `createdAt` reads LATER than the earliest
// Service Mapping they're attached to. A client that already has a 2024
// service cannot logically have been created in 2026, so this reads each
// client's earliest service year and, when the client's createdAt year sits
// after it, sets createdAt to the January 1st of (min service year − 1) —
// the year before the first engagement started.
//
// Reports and Client Management both read `createdAt` for the Year column,
// so a single field on the document is the whole fix.
//
// Only `createdAt` is written (updateOne + $set, timestamps off): every
// other field is untouched and `updatedAt` does not move, so audit trails
// stay accurate and no legacy record can fail validation on unrelated
// required fields.
//
// Run from the server folder. DRY RUN first — it writes nothing:
//     node scripts/fixClientCreatedYear.js
//     node scripts/fixClientCreatedYear.js --apply
//     node scripts/fixClientCreatedYear.js --client=<name-or-clientId>
//     node scripts/fixClientCreatedYear.js --client=<name-or-clientId> --apply
//
// --client narrows to a single client; matched case-insensitively against
// `clientCompany` OR `clientId`. Without --client the script processes
// every client with the same inconsistency.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");

const Client = require("../models/ClientManagementModel");
const ServiceMapping = require("../models/ServiceMappingModel");

const APPLY = process.argv.includes("--apply");
const CLIENT_ARG =
  (process.argv.find((a) => a.startsWith("--client=")) || "").split("=")[1] || "";

// Parse a Service Mapping's `year` string ("2024", "2024-25", "2024 batch") into
// its earliest calendar year. Anything that doesn't start with four digits in a
// recognisable range is ignored, so a stray "Not set" doesn't drag the min down
// to 0.
const parseYear = (raw) => {
  const match = /(\d{4})/.exec(String(raw || ""));
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 1990 || year > 2100) return null;
  return year;
};

const run = async () => {
  if (!process.env.MONGOURI) throw new Error("MONGOURI not found in server/.env");
  await mongoose.connect(process.env.MONGOURI);

  const clientFilter = {};
  if (CLIENT_ARG) {
    // Match by human clientId or by company name, both case-insensitive.
    const rx = new RegExp(`^${CLIENT_ARG.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    clientFilter.$or = [{ clientId: rx }, { clientCompany: rx }];
  }

  const clients = await Client.find(clientFilter, {
    clientId: 1,
    clientCompany: 1,
    createdAt: 1,
  })
    .sort({ clientCompany: 1, _id: 1 })
    .lean();

  console.log(`\n${APPLY ? "APPLY — writes will happen" : "DRY RUN — nothing will be written"}`);
  console.log(
    `${clients.length} client(s) considered${CLIENT_ARG ? ` (filter: ${CLIENT_ARG})` : ""}\n`
  );

  if (!clients.length) {
    await mongoose.disconnect();
    return;
  }

  // Pull every mapping's client + year in one round trip so we don't fire
  // one find per client. Group the earliest year per client id in memory.
  const mappings = await ServiceMapping.find(
    { client: { $in: clients.map((c) => c._id) } },
    { client: 1, year: 1 }
  ).lean();

  const minYearByClient = new Map();
  for (const mapping of mappings) {
    const year = parseYear(mapping.year);
    if (year === null) continue;
    const key = String(mapping.client);
    const current = minYearByClient.get(key);
    if (current === undefined || year < current) minYearByClient.set(key, year);
  }

  const rows = [];
  let skippedNoService = 0;
  let skippedOk = 0;

  for (const client of clients) {
    const minYear = minYearByClient.get(String(client._id));
    if (minYear === undefined) {
      skippedNoService += 1;
      continue;
    }
    const createdYear = client.createdAt ? new Date(client.createdAt).getUTCFullYear() : null;
    if (createdYear === null || Number.isNaN(createdYear)) {
      // No parseable createdAt — leave it alone; a separate migration should
      // deal with records that never had a timestamp.
      skippedNoService += 1;
      continue;
    }
    if (createdYear <= minYear) {
      skippedOk += 1;
      continue;
    }
    // Anchor to Jan 1st UTC of (minYear − 1). Time-of-day doesn't matter for
    // the Year column, and picking a stable canonical instant makes the write
    // idempotent — re-running on a fixed record produces the same document.
    const newCreatedAt = new Date(Date.UTC(minYear - 1, 0, 1, 0, 0, 0));
    rows.push({
      _id: client._id,
      clientId: client.clientId || "",
      name: client.clientCompany,
      currentCreatedAt: client.createdAt,
      currentYear: createdYear,
      minServiceYear: minYear,
      newCreatedAt,
      newYear: minYear - 1,
    });
  }

  console.log(`Affected: ${rows.length}`);
  console.log(`Skipped — already consistent: ${skippedOk}`);
  console.log(`Skipped — no parseable service year or no createdAt: ${skippedNoService}\n`);

  if (!rows.length) {
    await mongoose.disconnect();
    return;
  }

  console.log(
    ["clientId", "name", "current createdAt (UTC)", "cur yr", "min svc yr", "→ new yr"].join(" | ")
  );
  console.log("-".repeat(96));
  for (const row of rows) {
    console.log(
      [
        (row.clientId || "-").padEnd(12),
        (row.name || "-").padEnd(32).slice(0, 32),
        new Date(row.currentCreatedAt).toISOString(),
        String(row.currentYear).padStart(6),
        String(row.minServiceYear).padStart(10),
        String(row.newYear).padStart(8),
      ].join(" | ")
    );
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN complete. Re-run with --apply to write these ${rows.length} update(s).\n`
    );
    await mongoose.disconnect();
    return;
  }

  // Write one at a time so a single failure doesn't strand the batch.
  // `updateOne` with `timestamps: false` writes ONLY createdAt: updatedAt
  // stays put, no other field is touched, no validators run against the
  // full document.
  let written = 0;
  for (const row of rows) {
    const result = await Client.updateOne(
      { _id: row._id },
      { $set: { createdAt: row.newCreatedAt } },
      { timestamps: false }
    );
    if (result.matchedCount === 1) written += 1;
    else console.warn(`WARN: no match for ${row._id} (${row.name})`);
  }
  console.log(`\nWrote createdAt on ${written}/${rows.length} client(s).\n`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
