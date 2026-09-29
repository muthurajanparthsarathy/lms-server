// Seed 10 sample clients for local development / QA.
//
// Half are dated to 2024, half to 2025, so the Client Management list has
// something to filter on and the year picker actually chooses between values.
// Each client goes through the SAME allocation path the API uses
// (`nextClientCode` in utils/clientCode.js), so every record ends up with a
// real "CLT-000NNN" identifier that increments the counter for its
// institution — nothing is faked.
//
// Idempotent by NAME within an institution: a re-run skips any client whose
// `clientCompany` already exists in that institution. Deleting a client and
// re-running WILL create a new record (with a fresh Client ID), because the
// counter never rolls back.
//
// Usage from the server folder:
//   node scripts/seedSampleClients.js
//   node scripts/seedSampleClients.js --institution <idOrName>
// Without --institution the script picks the first institution it finds.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const ClientManagement = require("../models/ClientManagementModel");
const Institution = require("../models/InstitutionModal");
const { nextClientCode } = require("../utils/clientCode");

const ARG_INSTITUTION = (process.argv.find((a) => a.startsWith("--institution=")) || "").split("=")[1]
  || (process.argv.includes("--institution") ? process.argv[process.argv.indexOf("--institution") + 1] : "");

// ── The clients ─────────────────────────────────────────────────────────────
//
// One primary contact each, all fields populated so the list, table, cards
// and details pages have something to render. Phones use "+91 <10 digits>"
// so the split control on the form parses them cleanly. `createdYear` will
// override Mongoose's automatic timestamp so the "Year" column matches.

const SAMPLES = [
  { year: 2024, name: "Aspire Techniks Pvt Ltd",         model: "B2B", address: "12, Race Course Road, Coimbatore, Tamil Nadu, 641018",  primary: { name: "Ravi Shankar",    email: "ravi@aspiretechniks.com",    phone: "+91 9840012345" } },
  { year: 2024, name: "Kongu Engineering College",       model: "B2I", address: "Perundurai, Erode, Tamil Nadu, 638060",                 primary: { name: "Dr. Meena Kumari", email: "meena@kongu.edu",            phone: "+91 9843012349" } },
  { year: 2024, name: "Bosch India Ltd",                  model: "B2B", address: "Hosur Road, Bangalore, Karnataka, 560030",              primary: { name: "Arun Prasad",      email: "arun.prasad@bosch.in",       phone: "+91 9880012347" } },
  { year: 2024, name: "PSG College of Technology",       model: "B2I", address: "Peelamedu, Coimbatore, Tamil Nadu, 641004",             primary: { name: "Kavitha Raman",    email: "kavitha@psg.edu",            phone: "+91 9842012348" } },
  { year: 2024, name: "Freshmart Retail India",          model: "B2C", address: "Anna Nagar East, Chennai, Tamil Nadu, 600102",          primary: { name: "Ganesh V.",        email: "ganesh@freshmart.co.in",     phone: "+91 9884412356" } },
  { year: 2025, name: "Karpagam Academy of Higher Education", model: "B2I", address: "Pollachi Main Road, Eachanari, Coimbatore, Tamil Nadu, 641021", primary: { name: "Prof. S. Balaji",  email: "balaji@karpagam.ac.in",      phone: "+91 9843012350" } },
  { year: 2025, name: "Vaigai Info Tech",                model: "B2B", address: "TIDEL Park, Coimbatore, Tamil Nadu, 641014",            primary: { name: "Harish Kumar",     email: "harish@vaigaiinfotech.com",  phone: "+91 9840012351" } },
  { year: 2025, name: "SNS Group of Institutions",       model: "B2I", address: "Vazhiyampalayam, Coimbatore, Tamil Nadu, 641035",       primary: { name: "Dr. R. Ilango",    email: "ilango@snsgroups.com",       phone: "+91 9843112352" } },
  { year: 2025, name: "Zoho Corporation",                model: "B2B", address: "Estancia IT Park, Chennai, Tamil Nadu, 603202",         primary: { name: "Priya Sundaram",   email: "priya.s@zohocorp.com",       phone: "+91 9840112353" } },
  { year: 2025, name: "TVS Sundaram Motors",             model: "B2C", address: "Jawaharlal Nehru Road, Chennai, Tamil Nadu, 600032",    primary: { name: "Karthik R.",       email: "karthik@tvsmotor.com",       phone: "+91 9884412357" } },
];

// ── Institution resolver ────────────────────────────────────────────────────
// Copied from seedLDHead's helper so the script accepts either an ObjectId
// or the institution's own `inst_name`; a bare run picks the first one.
async function resolveInstitution(input) {
  if (input && mongoose.Types.ObjectId.isValid(input)) {
    const byId = await Institution.findById(input);
    if (byId) return byId;
  }
  if (input) {
    const byName = await Institution.findOne({ inst_name: new RegExp(`^${input}$`, "i") });
    if (byName) return byName;
    throw new Error(`Institution "${input}" not found`);
  }
  const first = await Institution.findOne().sort({ createdAt: 1 });
  if (!first) throw new Error("No institution exists — seed one first.");
  return first;
}

async function run() {
  if (!process.env.MONGOURI) throw new Error("MONGOURI not set in server/.env");
  await mongoose.connect(process.env.MONGOURI);

  const institution = await resolveInstitution(ARG_INSTITUTION);
  console.log(`\nSeeding into institution: ${institution.inst_name}  (${institution._id})`);

  let created = 0;
  let skipped = 0;

  for (const s of SAMPLES) {
    // Skip a name that already exists — case-insensitive, exact match. The
    // controller enforces the same rule, so this stays consistent with the
    // API's own duplicate detection.
    const dup = await ClientManagement.findOne({
      institution: institution._id,
      clientCompany: new RegExp(`^${s.name}$`, "i"),
    });
    if (dup) {
      console.log(`  = ${s.name} — already exists (skip)`);
      skipped += 1;
      continue;
    }

    const clientId = await nextClientCode(institution._id);
    // Jan 1 of the picked year — so the "Year" column shows the requested
    // year regardless of when the script was actually run. `updatedAt` is
    // pinned to the same instant so timestamps line up.
    const createdAt = new Date(s.year, 0, 1);

    const doc = await ClientManagement.create({
      institution: institution._id,
      clientId,
      clientCompany: s.name,
      businessModel: s.model,
      clientAddress: s.address,
      clientPhone: "",
      description: "",
      clientLogo: "",
      clientLogoPosition: "",
      status: "active",
      type: [],
      services: [],
      contactPersons: [
        {
          name: s.primary.name,
          email: s.primary.email,
          phoneNumber: s.primary.phone,
          secondaryEmail: "",
          secondaryPhoneNumber: "",
          designation: "",
          contactType: "Primary",
          isPrimary: true,
        },
      ],
      createdBy: "seed:sampleClients",
      createdAt,
      updatedAt: createdAt,
    });
    console.log(`  + ${clientId.padEnd(12)} ${s.year}  ${doc.clientCompany}`);
    created += 1;
  }

  console.log(`\n${created} created, ${skipped} skipped.`);
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("\nSeed failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
