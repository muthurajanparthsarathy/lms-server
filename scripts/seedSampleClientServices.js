// Seed sample clients (Client Management) AND their service mappings (Service
// Mapping) for local development / QA.
//
// Clients are spread across the last three years — five created two years ago,
// five last year, five this year (2024 / 2025 / 2026 when run in 2026) — so the
// "Created Year" filter has something to choose between. Each client then gets
// one to three services. The "service providing year" is MOSTLY the current
// year, with older years on the longer-standing clients so every year filter
// has rows too. A mapping is never older than its client (the same rule
// fixClientCreatedYear.js enforces): a 2024 client can carry 2024, 2025 and
// 2026 services, a 2026 client only 2026 ones.
//
// Nothing is written by hand. Every record goes through the SAME controller the
// UI calls (createClient / createMapping, invoked with a stand-in req/res), so
// Client IDs come from the counter, service codes from ensureServiceCode, the
// payload is validated and normalised exactly as the Map Service wizard's would
// be, and client.services[] is re-synced. Afterwards only the mapping's
// timestamps are back-dated into its service year (nothing else touched), so
// the lists sort and read like real history. A re-run re-applies those dates
// to the mappings it made before.
//
// Idempotent: a client is skipped when its name already exists in the
// institution (the controller's own duplicate rule), and a mapping is skipped
// when the client already has one with the same year + service model + course
// (+ degree). Re-running only fills in what is missing.
//
// Everything created here is tagged createdBy "seed:sampleClientServices", and
// --remove deletes exactly those records again through the controllers' own
// cascade (courses, user links and client.services included).
//
// Usage from the server folder:
//   node scripts/seedSampleClientServices.js
//   node scripts/seedSampleClientServices.js --institution <idOrName>
//   node scripts/seedSampleClientServices.js --remove [--institution <idOrName>]
// Without --institution the script picks the institution that already holds
// the most clients — the one actually in use.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const ClientManagement = require("../models/ClientManagementModel");
const ServiceMapping = require("../models/ServiceMappingModel");
const Institution = require("../models/InstitutionModal");
const CourseStructureDynamic = require("../models/dynamicContent/courseStructureDynamicModal");
const clientController = require("../controllers/clientManagementController");
const mappingController = require("../controllers/serviceMappingController");

const SEED_TAG = "seed:sampleClientServices";
const REMOVE = process.argv.includes("--remove");
const ARG_INSTITUTION = (process.argv.find((a) => a.startsWith("--institution=")) || "").split("=")[1]
  || (process.argv.includes("--institution") ? process.argv[process.argv.indexOf("--institution") + 1] : "");

// Years are relative so the data stays valid next year too — the controller
// refuses a createdYear later than the current one.
const CUR = new Date().getFullYear();
const Y0 = CUR;       // this year
const Y1 = CUR - 1;   // last year
const Y2 = CUR - 2;   // two years ago

// ── Mapping shapes ──────────────────────────────────────────────────────────
// Each builder returns the body the Map Service wizard would POST for that
// flow (see servicemapping/page.tsx → save). The service name and the model
// spellings are resolved against the institution's own catalog at run time.

const PATH_SEP = " ▸ ";
const ALL_LEVELS = ["Batch", "Phase", "Degree", "Department", "Section", "Semester"];
const levels = (active) =>
  ALL_LEVELS.map((level) => ({ level, enabled: active.includes(level), mandatory: active.includes(level) }));

// Every flow that is not Degree Program / Placement Training: one course,
// optional named batches. HTD, TD, COE, CSR, Skilling, DIV and B2C use it.
const batchFlow = ({ models = [], category, course, batches = [], partners }) => ({
  serviceModels: models,
  hierarchy: levels(["Batch"]),
  masterData: [{ level: "Batch", values: batches }],
  courseName: course,
  category,
  courses: [{ category, courseName: course, path: "", batchesEnabled: false, batches: [] }],
  batchConfigs: batches.map((name) => ({ name, degree: "", departments: [], phases: [] })),
  ...(partners ? { partners } : {}),
});

// Placement Training, unphased: the course carries its batches and the
// structure lives in courseConfigurations; batchConfigs stays empty on purpose.
const placementFlow = ({ year, course, semester = "Sem VII", batches = ["Batch 1", "Batch 2"] }) => ({
  serviceModels: ["Placement Training"],
  hierarchy: levels(["Batch", "Phase"]),
  masterData: [{ level: "Batch", values: batches }],
  courseName: course,
  category: "Placement Training",
  courses: [{ category: "Placement Training", courseName: course, path: "", batchesEnabled: true, batches }],
  courseConfigurations: [{
    courseName: course,
    courseCategory: "Placement Training",
    academicBatch: String(year),
    semester,
    phaseConfigEnabled: false,
    batchesEnabled: true,
    phases: [],
    trainingBatches: batches.map((name) => ({ name, phaseId: null })),
  }],
  batchConfigs: [],
});

// Degree Program: Degree → Department → Semester 1 → Section, the intake year
// as the degree's academic start, courses hanging off each department's
// semester and every section running the same batches.
const degreeFlow = ({ year, degree, departments, courses, sections = ["A", "B"], batches = ["Batch 1", "Batch 2"], length = 4 }) => {
  const sem = "1";
  const semStart = new Date(year, 6, 1).toISOString();
  const semEnd = new Date(year, 11, 15).toISOString();
  const semPath = (dept) => `${degree}${PATH_SEP}${dept}${PATH_SEP}${sem}`;
  return {
    serviceModels: ["Degree Program"],
    hierarchy: [
      ...levels(["Batch", "Degree", "Department", "Semester", "Section"]),
      { level: "AcademicYear", enabled: true, mandatory: false },
      { level: "SemesterDates", enabled: true, mandatory: false },
    ],
    masterData: [
      { level: "Batch", values: batches },
      { level: "Degree", values: [degree] },
      { level: "Department", group: degree, values: departments },
      { level: "Semester", group: degree, values: [sem] },
      { level: "SemesterDates", group: `${degree}${PATH_SEP}${sem}`, values: [`${semStart}|${semEnd}`] },
      ...departments.map((d) => ({ level: "Section", group: `${degree}${PATH_SEP}${d}`, values: sections })),
      { level: "AcademicYear", group: degree, values: [String(year), String(year + length)] },
    ],
    courseName: "",
    category: "",
    courses: departments.flatMap((d) =>
      courses.map((c) => ({ category: "", courseName: c, path: semPath(d), batchesEnabled: false, batches: [] }))),
    studentGroups: departments.map((d) => ({
      path: semPath(d),
      sections: sections.map((name) => ({ name, batches })),
    })),
    batchConfigs: batches.map((name) => ({ name, degree: "", departments: [], phases: [] })),
  };
};

// ── The data ────────────────────────────────────────────────────────────────
// `on` is the month-day the mapping was made within its service year; a date
// that would land in the future is pulled back to yesterday.

const SD = "Software Development";
const T = "Testing";

const CLIENTS = [
  // ── Created two years ago ──
  {
    year: Y2, name: "Aspire Techniks Pvt Ltd", model: "B2B", website: "https://aspiretechniks.com",
    address: "12, Race Course Road\nCoimbatore, Tamil Nadu - 641018",
    primary: { name: "Ravi Shankar", email: "ravi@aspiretechniks.com", phone: "+91 9840012345", designation: "HR Manager" },
    services: [
      { year: Y2, on: "03-12", status: "inactive", ...batchFlow({ models: ["HTD"], category: SD, course: "Java Full Stack", batches: ["Batch A"] }) },
      { year: Y1, on: "02-20", status: "inactive", ...batchFlow({ models: ["HTD"], category: SD, course: "Java Full Stack", batches: ["Batch A", "Batch B"] }) },
      { year: Y0, on: "01-18", ...batchFlow({ models: ["TD"], category: SD, course: "MERN Development", batches: ["Batch 1", "Batch 2"] }) },
    ],
  },
  {
    year: Y2, name: "Kongu Engineering College", model: "B2I", website: "https://kongu.ac.in",
    address: "Thoppupalayam, Perundurai\nErode, Tamil Nadu - 638060",
    primary: { name: "Dr. Meena Kumari", email: "meena@kongu.edu", phone: "+91 9843012349", designation: "Placement Officer" },
    services: [
      { year: Y2, on: "07-05", ...degreeFlow({ year: Y2, degree: "B.E", departments: ["CSE", "ECE"], courses: ["Backend Development"] }) },
      { year: Y0, on: "06-10", ...placementFlow({ year: Y0, course: "Placement Readiness" }) },
    ],
  },
  {
    year: Y2, name: "Bosch India Ltd", model: "B2B", website: "https://bosch.in",
    address: "Hosur Road, Adugodi\nBengaluru, Karnataka - 560030",
    primary: { name: "Arun Prasad", email: "arun.prasad@bosch.in", phone: "+91 9880012347", designation: "L&D Head" },
    services: [
      { year: Y2, on: "09-02", status: "inactive", ...batchFlow({ models: ["TD"], category: T, course: "selenium testing", batches: ["Batch 1"] }) },
      { year: Y0, on: "04-22", ...batchFlow({ models: ["CSR"], category: SD, course: "Full Stack", partners: ["Kongu Engineering College", "PSG College of Technology"] }) },
    ],
  },
  {
    year: Y2, name: "PSG College of Technology", model: "B2I", website: "https://psgtech.edu",
    address: "Avinashi Road, Peelamedu\nCoimbatore, Tamil Nadu - 641004",
    primary: { name: "Kavitha Raman", email: "kavitha@psg.edu", phone: "+91 9842012348", designation: "Training Coordinator" },
    services: [
      { year: Y1, on: "08-14", ...batchFlow({ models: ["Skilling"], category: SD, course: "Frontend Devlopment", batches: ["Batch 1", "Batch 2"] }) },
      { year: Y0, on: "07-08", ...degreeFlow({ year: Y0, degree: "B.Tech", departments: ["IT", "AI&DS"], courses: ["Full Stack"] }) },
    ],
  },
  {
    year: Y2, name: "Freshmart Retail India", model: "B2C", website: "https://freshmart.co.in",
    address: "14, 2nd Avenue, Anna Nagar East\nChennai, Tamil Nadu - 600102",
    primary: { name: "Ganesh V.", email: "ganesh@freshmart.co.in", phone: "+91 9884412356", designation: "Operations Lead" },
    services: [
      { year: Y2, on: "11-06", status: "inactive", ...batchFlow({ category: T, course: "Python testing" }) },
      { year: Y0, on: "03-03", ...batchFlow({ category: SD, course: "Frontend Devlopment", batches: ["Weekend Batch"] }) },
    ],
  },

  // ── Created last year ──
  {
    year: Y1, name: "Karpagam Academy of Higher Education", model: "B2I", website: "https://karpagam.edu.in",
    address: "Pollachi Main Road, Eachanari\nCoimbatore, Tamil Nadu - 641021",
    primary: { name: "Prof. S. Balaji", email: "balaji@karpagam.ac.in", phone: "+91 9843012350", designation: "Dean - Placements" },
    services: [
      { year: Y1, on: "06-16", ...placementFlow({ year: Y1, course: "Placement Boot Camp" }) },
      { year: Y0, on: "02-09", ...batchFlow({ models: ["DIV"], category: SD, course: "MERN Development", batches: ["Batch 1", "Batch 2"] }) },
    ],
  },
  {
    year: Y1, name: "Vaigai Info Tech", model: "B2B", website: "https://vaigaiinfotech.com",
    address: "TIDEL Park, Vilankurichi Road\nCoimbatore, Tamil Nadu - 641014",
    primary: { name: "Harish Kumar", email: "harish@vaigaiinfotech.com", phone: "+91 9840012351", designation: "Talent Acquisition" },
    services: [
      { year: Y1, on: "04-11", status: "inactive", ...batchFlow({ models: ["HTD"], category: SD, course: ".NET Full Stack", batches: ["Batch 1"] }) },
      { year: Y0, on: "05-19", ...batchFlow({ models: ["HTD"], category: SD, course: "Backend Development", batches: ["Batch 1", "Batch 2"] }) },
    ],
  },
  {
    year: Y1, name: "SNS Group of Institutions", model: "B2I", website: "https://snsgroups.com",
    address: "Sathy Main Road, Vazhiyampalayam\nCoimbatore, Tamil Nadu - 641035",
    primary: { name: "Dr. R. Ilango", email: "ilango@snsgroups.com", phone: "+91 9843112352", designation: "Principal" },
    services: [
      { year: Y1, on: "07-21", ...degreeFlow({ year: Y1, degree: "B.E", departments: ["CSE", "Mechanical"], courses: ["MERN Development"] }) },
      { year: Y0, on: "01-27", ...batchFlow({ models: ["Skilling"], category: T, course: "Python testing", batches: ["Batch 1"] }) },
    ],
  },
  {
    year: Y1, name: "Zoho Corporation", model: "B2B", website: "https://zoho.com",
    address: "Estancia IT Park, Vallancherry\nChengalpattu, Tamil Nadu - 603202",
    primary: { name: "Priya Sundaram", email: "priya.s@zohocorp.com", phone: "+91 9840112353", designation: "Campus Relations" },
    services: [
      { year: Y1, on: "10-07", ...batchFlow({ models: ["TD"], category: T, course: "selenium testing", batches: ["Batch 1", "Batch 2"] }) },
      { year: Y0, on: "03-24", ...batchFlow({ models: ["COE"], category: SD, course: "Full Stack", partners: ["SNS Group of Institutions", "Karpagam Academy of Higher Education"] }) },
    ],
  },
  {
    year: Y1, name: "TVS Sundaram Motors", model: "B2C", website: "https://tvsmotor.com",
    address: "Jawaharlal Nehru Road, Ekkaduthangal\nChennai, Tamil Nadu - 600032",
    primary: { name: "Karthik R.", email: "karthik@tvsmotor.com", phone: "+91 9884412357", designation: "Training Manager" },
    services: [
      { year: Y0, on: "04-02", ...batchFlow({ category: SD, course: "Full Stack", batches: ["Evening Batch"] }) },
    ],
  },

  // ── Created this year ──
  {
    year: Y0, name: "Hindusthan College of Engineering", model: "B2I", website: "https://hindusthan.net",
    address: "Pollachi Main Road, Othakkalmandapam\nCoimbatore, Tamil Nadu - 641032",
    primary: { name: "Dr. N. Saravanan", email: "saravanan@hindusthan.net", phone: "+91 9843212360", designation: "Head - Training" },
    services: [
      { year: Y0, on: "02-15", ...placementFlow({ year: Y0, course: "SDE Readiness" }) },
      { year: Y0, on: "07-12", ...degreeFlow({ year: Y0, degree: "B.E", departments: ["CSE", "IT"], courses: ["Backend Development", "Full Stack"] }) },
    ],
  },
  {
    year: Y0, name: "Nexora Software Labs", model: "B2B", website: "https://nexoralabs.in",
    address: "3rd Floor, KGiSL Campus, Saravanampatti\nCoimbatore, Tamil Nadu - 641035",
    primary: { name: "Deepa Menon", email: "deepa@nexoralabs.in", phone: "+91 9840312361", designation: "Engineering Manager" },
    services: [
      { year: Y0, on: "03-30", ...batchFlow({ models: ["HTD"], category: SD, course: "Java Full Stack", batches: ["Batch 1", "Batch 2"] }) },
    ],
  },
  {
    year: Y0, name: "Coimbatore Institute of Management Studies", model: "B2I", website: "https://cims.edu.in",
    address: "Civil Aerodrome Post, Avinashi Road\nCoimbatore, Tamil Nadu - 641014",
    primary: { name: "Prof. Lakshmi Narayanan", email: "lakshmi@cims.edu.in", phone: "+91 9843412362", designation: "Director" },
    services: [
      { year: Y0, on: "05-06", ...batchFlow({ models: ["Skilling"], category: SD, course: "Frontend Devlopment", batches: ["Batch 1"] }) },
    ],
  },
  {
    year: Y0, name: "Brightpath Learners Academy", model: "B2C", website: "https://brightpathacademy.in",
    address: "22, Cross Cut Road, Gandhipuram\nCoimbatore, Tamil Nadu - 641012",
    primary: { name: "Suresh Babu", email: "suresh@brightpathacademy.in", phone: "+91 9884512363", designation: "Founder" },
    services: [
      { year: Y0, on: "06-01", ...batchFlow({ category: SD, course: "MERN Development", batches: ["Morning Batch", "Evening Batch"] }) },
    ],
  },
  {
    year: Y0, name: "Techvantage Solutions", model: "B2B", website: "https://techvantage.co.in",
    address: "SIDCO Industrial Estate, Guindy\nChennai, Tamil Nadu - 600032",
    primary: { name: "Anitha Joseph", email: "anitha@techvantage.co.in", phone: "+91 9840612364", designation: "HR Business Partner" },
    services: [
      { year: Y0, on: "04-28", ...batchFlow({ models: ["TD"], category: T, course: "selenium testing", batches: ["Batch 1"] }) },
      { year: Y0, on: "08-19", ...batchFlow({ models: ["HTD"], category: SD, course: "Backend Development", batches: ["Batch 1", "Batch 2"] }) },
    ],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

// Runs a controller handler with a stand-in req/res and resolves with the
// status + JSON body it answered with.
const invoke = (handler, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    Promise.resolve(handler(req, res)).catch((err) =>
      resolve({ status: 500, body: { message: err.message } }));
  });

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Accepts an ObjectId or the institution's `inst_name`; a bare run picks the
// institution holding the most clients, falling back to the first one.
async function resolveInstitution(input) {
  if (input && mongoose.Types.ObjectId.isValid(input)) {
    const byId = await Institution.findById(input);
    if (byId) return byId;
  }
  if (input) {
    const byName = await Institution.findOne({ inst_name: new RegExp(`^${escapeRegex(input)}$`, "i") });
    if (byName) return byName;
    throw new Error(`Institution "${input}" not found`);
  }
  const [busiest] = await ClientManagement.aggregate([
    { $match: { institution: { $ne: null } } },
    { $group: { _id: "$institution", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]);
  const inst = busiest ? await Institution.findById(busiest._id) : null;
  if (inst) return inst;
  const first = await Institution.findOne().sort({ createdAt: 1 });
  if (!first) throw new Error("No institution exists — seed one first.");
  return first;
}

// The institution's own service catalog (Dynamic field settings). Mapping
// service names and model spellings are taken from it so seeded rows look
// exactly like wizard-made ones; missing entries fall back to the literals.
const SERVICE_PATTERNS = {
  B2B: /^\s*(b2b|business[\s\-_]*to[\s\-_]*business)\s*$/i,
  B2I: /^\s*(b2i|business[\s\-_]*to[\s\-_]*institut(e|ion))\s*$/i,
  B2C: /^\s*(b2c|business[\s\-_]*to[\s\-_]*(customer|consumer|client))\s*$/i,
};
const matchKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

async function loadCatalog(institutionId) {
  const docs = await CourseStructureDynamic.find({ institution: institutionId }, { service: 1 }).lean();
  const services = docs.flatMap((d) => d.service || []);
  const catalog = {};
  Object.entries(SERVICE_PATTERNS).forEach(([bm, re]) => {
    const svc = services.find((s) => re.test(s.name || ""));
    catalog[bm] = {
      name: svc ? String(svc.name).trim() : bm,
      models: svc ? (svc.serviceModal || []).map((m) => String(m.title || "").trim()).filter(Boolean) : [],
    };
  });
  return catalog;
}

const resolveModels = (wanted, catalogModels) =>
  wanted.map((w) => catalogModels.find((m) => matchKey(m) === matchKey(w)) || w);

const mappingSignature = ({ year, serviceModels, courseName, masterData }) => {
  const degree = ((masterData || []).find((m) => m.level === "Degree") || {}).values || [];
  return [year, (serviceModels || []).map(matchKey).join(","), matchKey(courseName), matchKey(degree[0])].join("|");
};

// A date inside the service year, never in the future.
const mappingDate = (year, on) => {
  const [m, d] = on.split("-").map(Number);
  const when = new Date(year, m - 1, d, 10, 30);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return when > yesterday ? yesterday : when;
};

// Moves a mapping's timestamps into its service year; nothing else is touched.
// Written through the native collection on purpose: with `timestamps` on,
// Mongoose marks createdAt immutable and silently strips it from any
// Model.updateOne — even with { timestamps: false } — so that route would
// report a match and write nothing.
const backdate = (mappingId, when) =>
  ServiceMapping.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(String(mappingId)) },
    { $set: { createdAt: when, updatedAt: when } }
  );

// ── Seed ────────────────────────────────────────────────────────────────────

async function seed(institution, req) {
  const catalog = await loadCatalog(institution._id);
  console.log("Services:", Object.entries(catalog).map(([bm, s]) => `${bm} → "${s.name}"`).join(", "));

  const idByName = new Map();
  const stats = { clientsCreated: 0, clientsSkipped: 0, mapsCreated: 0, mapsSkipped: 0, failed: 0 };

  // Pass 1 — clients, so partner institutions exist before any CSR/COE mapping.
  console.log("\nClients");
  for (const c of CLIENTS) {
    const existing = await ClientManagement.findOne({
      institution: institution._id,
      clientCompany: new RegExp(`^${escapeRegex(c.name)}$`, "i"),
    }, { _id: 1, clientId: 1, createdAt: 1 }).lean();
    if (existing) {
      idByName.set(c.name, existing._id);
      console.log(`  = ${String(existing.clientId || "").padEnd(12)} ${existing.createdAt.getFullYear()}  ${c.name} — already exists (skip)`);
      stats.clientsSkipped += 1;
      continue;
    }
    const { status, body } = await invoke(clientController.createClient, {
      ...req,
      body: {
        clientCompany: c.name,
        createdYear: String(c.year),
        businessModel: c.model,
        clientAddress: c.address,
        website: c.website || "",
        status: "active",
        contactPersons: [{
          name: c.primary.name,
          email: c.primary.email,
          phoneNumber: c.primary.phone,
          address: c.address,
          designation: c.primary.designation || "",
          contactType: "Primary",
          isPrimary: true,
        }],
      },
    });
    if (status !== 201) {
      console.log(`  ! ${c.name} — ${body && body.message}`);
      stats.failed += 1;
      continue;
    }
    idByName.set(c.name, body.data._id);
    console.log(`  + ${body.data.clientId.padEnd(12)} ${c.year}  ${c.model}  ${c.name}`);
    stats.clientsCreated += 1;
  }

  // Pass 2 — service mappings, oldest first within each client.
  console.log("\nService mappings");
  for (const c of CLIENTS) {
    const clientId = idByName.get(c.name);
    if (!clientId) continue;
    const client = await ClientManagement.findById(clientId, { createdAt: 1 }).lean();
    const clientYear = client.createdAt.getFullYear();
    const existing = await ServiceMapping.find({ client: clientId }, { year: 1, serviceModels: 1, courseName: 1, masterData: 1, createdBy: 1 }).lean();
    const have = new Map(existing.map((m) => [mappingSignature(m), m]));
    const svc = catalog[c.model];

    for (const s of [...c.services].sort((a, b) => a.year - b.year || a.on.localeCompare(b.on))) {
      const { year, on, status, partners, ...shape } = s;
      const serviceModels = resolveModels(shape.serviceModels, svc.models);
      const label = `${c.name} · ${serviceModels.join(", ") || c.model} · ${shape.courseName || ((shape.masterData.find((m) => m.level === "Degree") || {}).values || [])[0]} · ${year}`;

      if (year < clientYear) {
        console.log(`  ! ${label} — service year is before the client's created year ${clientYear} (skip)`);
        stats.mapsSkipped += 1;
        continue;
      }
      const already = have.get(mappingSignature({ year: String(year), serviceModels, courseName: shape.courseName, masterData: shape.masterData }));
      if (already) {
        // One this script made earlier keeps its back-dated timestamps.
        if (already.createdBy === SEED_TAG) await backdate(already._id, mappingDate(year, on));
        console.log(`  = ${label} — already mapped (skip)`);
        stats.mapsSkipped += 1;
        continue;
      }

      const partnerIds = (partners || []).map((n) => idByName.get(n)).filter(Boolean);
      const { status: code, body } = await invoke(mappingController.createMapping, {
        ...req,
        body: {
          ...shape,
          client: String(clientId),
          partnerInstitutions: partnerIds.map(String),
          service: svc.name,
          year: String(year),
          serviceModels,
          status: status || "active",
        },
      });
      if (code !== 201) {
        console.log(`  ! ${label} — ${body && body.message}`);
        stats.failed += 1;
        continue;
      }

      await backdate(body.data._id, mappingDate(year, on));
      console.log(`  + ${String(body.data.serviceCode || "—").padEnd(16)} ${label}${status === "inactive" ? "  (inactive)" : ""}`);
      stats.mapsCreated += 1;
    }
  }

  console.log(
    `\nClients: ${stats.clientsCreated} created, ${stats.clientsSkipped} skipped.` +
    `  Mappings: ${stats.mapsCreated} created, ${stats.mapsSkipped} skipped.` +
    (stats.failed ? `  ${stats.failed} failed.` : "")
  );
  return stats;
}

// ── Remove ──────────────────────────────────────────────────────────────────
// Deletes only what this script created, through the same cascade the UI uses.

async function remove(institution, req) {
  const mappings = await ServiceMapping.find({ institution: institution._id, createdBy: SEED_TAG }, { _id: 1 }).lean();
  for (const m of mappings) {
    const { status, body } = await invoke(mappingController.deleteMapping, { ...req, params: { mappingId: String(m._id) } });
    if (status !== 200) console.log(`  ! mapping ${m._id} — ${body && body.message}`);
  }
  const clients = await ClientManagement.find({ institution: institution._id, createdBy: SEED_TAG }, { _id: 1, clientId: 1, clientCompany: 1 }).lean();
  for (const c of clients) {
    const { status, body } = await invoke(clientController.deleteClient, { ...req, params: { clientId: String(c._id) } });
    console.log(status === 200 ? `  - ${String(c.clientId).padEnd(12)} ${c.clientCompany}` : `  ! ${c.clientCompany} — ${body && body.message}`);
  }
  console.log(`\nRemoved ${mappings.length} mapping(s) and ${clients.length} client(s).`);
}

async function run() {
  if (!process.env.MONGOURI) throw new Error("MONGOURI not set in server/.env");
  await mongoose.connect(process.env.MONGOURI);

  const institution = await resolveInstitution(ARG_INSTITUTION);
  console.log(`\n${REMOVE ? "Removing sample data from" : "Seeding into"} institution: ${institution.inst_name}  (${institution._id})`);

  // Stand-in for the logged-in admin. The tag doubles as createdBy on every
  // record, which is what --remove keys on.
  const req = { user: { institution: institution._id, email: SEED_TAG }, pocScope: null, params: {}, query: {} };

  let failed = 0;
  if (REMOVE) await remove(institution, req);
  else ({ failed } = await seed(institution, req));

  await mongoose.disconnect();
  if (failed) process.exit(1);
}

run().catch(async (err) => {
  console.error("\nSeed failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
