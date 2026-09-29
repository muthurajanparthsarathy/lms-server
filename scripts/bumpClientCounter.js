// Bump the Client ID counter past every existing CLT-###### number for an
// institution — a one-shot fix when the counter was created after some
// records already carried Client IDs. Usage:
//   node scripts/bumpClientCounter.js [--institution <id>]

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const C = require("../models/ClientManagementModel");
const Counter = require("../models/CounterModel");

const ARG = (process.argv.find((a) => a.startsWith("--institution=")) || "").split("=")[1]
  || (process.argv.includes("--institution") ? process.argv[process.argv.indexOf("--institution") + 1] : "");

(async () => {
  await mongoose.connect(process.env.MONGOURI);
  const Institution = require("../models/InstitutionModal");
  const inst = ARG ? (await Institution.findById(ARG) || await Institution.findOne({ inst_name: new RegExp(`^${ARG}$`, 'i') })) : await Institution.findOne().sort({ createdAt: 1 });
  if (!inst) throw new Error("No institution");
  const rows = await C.find({ institution: inst._id }, { clientId: 1 }).lean();
  let maxN = 0;
  for (const r of rows) {
    const m = /^CLT-(\d+)$/.exec(String(r.clientId || ""));
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  }
  console.log(`Institution: ${inst.inst_name} (${inst._id})`);
  console.log(`Rows scanned: ${rows.length}, max CLT number: ${maxN}`);
  const id = `client:${inst._id}`;
  await Counter.updateOne({ _id: id }, { $max: { seq: maxN } }, { upsert: true });
  const c = await Counter.findOne({ _id: id });
  console.log(`Counter now at: ${c.seq}`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
