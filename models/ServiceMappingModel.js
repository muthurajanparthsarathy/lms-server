const mongoose = require("mongoose");

// One hierarchy level in a mapping's configuration. Levels are stored as data,
// not fixed schema fields, so new levels can be added without a schema change.
const hierarchyLevelSchema = new mongoose.Schema(
  {
    level: { type: String, required: true }, // e.g. "Degree", "Department", "Course", "Batch", "Semester", "Section"
    enabled: { type: Boolean, default: false },
    // Locked levels the user cannot uncheck (e.g. Degree Program → Degree + Department)
    mandatory: { type: Boolean, default: false },
  },
  { _id: false }
);

// Master-data values configured for one enabled hierarchy level
// (e.g. level "Degree" → ["B.Sc", "B.E", "MBA"]).
// `group` scopes the values to a parent-level value, e.g.
// { level: "Department", group: "BE", values: ["CSE"] } = departments of BE.
const masterDataSchema = new mongoose.Schema(
  {
    level: { type: String, required: true },
    group: { type: String },
    values: [{ type: String }],
  },
  { _id: false }
);

// One batch of the mapping's course. Every flow ends in Course → Batch(es);
// PRT Department mode additionally ties each batch to a degree + departments
// (e.g. Batch 1 → B.E → [CSE], Batch 2 → B.E → [EEE]).
const batchConfigSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    degree: { type: String, default: "" },
    departments: [{ type: String }],
    // Stages a batch runs through — "Phase 1", "Phase 2", … Opt-in per batch and
    // free-text, since a programme may call them Foundation / Advanced.
    phases: [{ type: String }],
  },
  { _id: false }
);

// One course the mapping covers. Under Degree Program courses are entered per
// semester inside the hierarchy, so `path` records exactly where: the semester's
// full path, e.g. "B.E ▸ CSE ▸ A ▸ 3". Flows that attach a course to the mapping
// as a whole leave `path` unset.
//
// This is what Course Setup reads to know which courses exist and where they
// run; without it the hierarchy the user built in the wizard is unrecoverable.
const mappedCourseSchema = new mongoose.Schema(
  {
    category: { type: String, default: "" },
    courseName: { type: String, default: "" },
    path: { type: String, default: "" },
    // Whether this course splits into batches, and their names once it does.
    batchesEnabled: { type: Boolean, default: false },
    batches: [{ type: String }],
  },
  { _id: false }
);

// ── Placement Training structure ──────────────────────────────────────────────
// Course → course configuration → phases → training batches, stored as nested
// subdocuments of the mapping rather than as their own collections. That is this
// codebase's convention (hierarchy, masterData and courses all live inline), and
// it buys atomicity for free: the whole structure is one document, so a save is
// a single write that either lands completely or not at all. No transaction, and
// no window where a batch can point at a phase that was never written.
//
// These carry REAL _ids, unlike the older subdocuments above. A phase and a
// batch have to be identifiable — a batch references its phase by id, the same
// batch name may legitimately appear in two phases, and reordering must not
// change what a record IS.

// One phase of a placement course configuration ("Phase I", "Phase II").
const mappingPhaseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Display order within its configuration. Stored rather than implied by
    // array position so a reorder is a data change, not an accident of how the
    // client happened to send the array.
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

// One training batch. `phaseId` is the ONLY thing that says whether a batch
// belongs to a phase or straight to the configuration — null means the latter,
// which is what "phase configuration unchecked" saves. Never a placeholder
// phase; absence is recorded as absence.
//
// NOTE: a training batch ("Batch I") is not the academic batch ("2026"). The
// academic batch is a year on the configuration below; these are the parallel
// groups sitting the course. Two different concepts, two different fields.
const trainingBatchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phaseId: { type: mongoose.Schema.Types.ObjectId, default: null },
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

// One course as this mapping delivers it: which course, to which academic batch
// and semester, and how its training batches are organised.
const courseConfigurationSchema = new mongoose.Schema(
  {
    courseName: { type: String, required: true, trim: true },
    // The category the course was chosen from, kept for display and for
    // resolving the course again if the master list changes.
    courseCategory: { type: String, default: "" },
    // The ACADEMIC batch — an intake year such as "2026".
    academicBatch: { type: String, default: "" },
    semester: { type: String, default: "" },
    // Both flags are stored explicitly rather than inferred from whether the
    // arrays are empty: "phases off" and "phases on but none added yet" are
    // different states, and only the user can tell them apart.
    phaseConfigEnabled: { type: Boolean, default: false },
    batchesEnabled: { type: Boolean, default: false },
    phases: [mappingPhaseSchema],
    trainingBatches: [trainingBatchSchema],
  },
  { _id: true }
);

// Step 3 (Resources) of the Map Service wizard — the resource configuration
// courses created under this mapping start from. Deliberately the SAME shape as
// a course's own `resourcesType` (models/Courses/courseStructureModal.js), so
// applying the default to a new course is a straight copy rather than a
// translation that could drift. Narrower than what the institution's Resource
// Management allows, never wider. Absent → a new course starts with nothing
// checked, same as before this existed.
const mappingFileResourceSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    maxSize: { type: Number, default: 0 },
    aiChat: { type: Boolean, default: false },
    aiSummary: { type: Boolean, default: false },
    notes: { type: Boolean, default: false },
    allowedFormats: [{ type: String }],
  },
  { _id: false }
);

const mappingResourceConfigSchema = new mongoose.Schema(
  {
    video: mappingFileResourceSchema,
    ppt: mappingFileResourceSchema,
    pdf: mappingFileResourceSchema,
    image: mappingFileResourceSchema,
    zip: mappingFileResourceSchema,
    url: { enabled: { type: Boolean, default: false } },
    aiChat: { enabled: { type: Boolean, default: false } },
    aiSummary: { enabled: { type: Boolean, default: false } },
    notes: { enabled: { type: Boolean, default: false } },
    ai: { enabled: { type: Boolean, default: false } },
    autoQuestionGenerate: { enabled: { type: Boolean, default: false } },
  },
  { _id: false }
);

const resourceDefaultsSchema = new mongoose.Schema(
  {
    iDo: mappingResourceConfigSchema,
    weDo: mappingResourceConfigSchema,
    youDo: mappingResourceConfigSchema,
  },
  { _id: false }
);

// Client ↔ Service mapping — the standalone Service Mapping module's collection.
// This replaces the `services` array previously edited inside Client Management.
// The embedded client.services array is kept in sync as a legacy read model for
// existing consumers (e.g. Add Course Structure) — see
// serviceMappingController.syncClientServices.
const serviceMappingSchema = new mongoose.Schema(
  {
    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LMS-Institution",
      required: false,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LMS-ClientManagement",
      required: true,
    },
    // CSR / COE only: the existing Client Management records where the sponsored
    // training is delivered. References to other clients (never duplicated orgs) —
    // the corporate stays the primary `client`, these are the partner institutions.
    // One or more allowed; empty for every non-partner mapping.
    partnerInstitutions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "LMS-ClientManagement",
      },
    ],
    // Snapshot names pulled from the course-structure-dynamic service data
    service: {
      type: String,
      required: true,
    },
    year: {
      type: String,
    },
    // Selected service model names (e.g. Skilling, DIV, Degree Program)
    serviceModels: [
      {
        type: String,
      },
    ],
    hierarchy: [hierarchyLevelSchema],
    masterData: [masterDataSchema],
    // ── Course captured by the mapping ──────────────────────────────────────
    // Every mapping ends in one course for students; the course record in
    // Course Management is auto-created from these fields when the mapping is
    // saved (there is no separate "New course" flow anymore).
    // Step 3 of the wizard — see resourceDefaultsSchema above.
    resourceDefaults: { type: resourceDefaultsSchema, default: () => ({}) },
    courseName: {
      type: String,
      default: "",
    },
    // Course category display name (drives standard course-name suggestions)
    category: {
      type: String,
      default: "",
    },
    // Every course the mapping covers. `courseName`/`category` above mirror the
    // first entry so older readers keep working; this carries the full list and
    // is the only place a Degree Program's per-semester courses survive.
    courses: [mappedCourseSchema],
    // Degree → department → semester → student groups → section → batches.
    studentGroups: [{
      _id: false,
      path: { type: String, required: true },
      sections: [{
        _id: false,
        name: { type: String, required: true },
        batches: [{ type: String }],
      }],
    }],
    // Placement Training's structure in the shape the wizard now edits: one
    // configuration per course, carrying its own phases and training batches.
    //
    // It sits BESIDE `courses` / `masterData` rather than replacing them —
    // mappings saved before this existed carry their phases in masterData and
    // their batches on the course, and the controller converts those on read so
    // an old mapping opens correctly and is rewritten in this shape on its next
    // save. Nothing is migrated in place.
    courseConfigurations: [courseConfigurationSchema],
    // Placement Training only: 'general' (course + batches, like B2B) or
    // 'department' (each batch tied to a degree + departments). Empty for
    // every other service model.
    prtMode: {
      type: String,
      enum: ["", "general", "department"],
      default: "",
    },
    // Batches of this course (names; PRT department mode adds degree + depts)
    batchConfigs: [batchConfigSchema],
    // Link to the auto-created Course Structure record
    courseId: {
      type: String,
      default: "",
    },
    courseCode: {
      type: String,
      default: "",
    },
    // Human-readable service id like "b2i-deg-be-1" — <business model>-<service
    // model>-<degree>-<n>. Generated once the mapping is complete (see
    // serviceMappingController.ensureServiceCode) and stable thereafter; never sent
    // by the client.
    serviceCode: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    createdBy: {
      type: String,
    },
    updatedBy: {
      type: String,
    },
  },
  { timestamps: true }
);

serviceMappingSchema.index({ institution: 1, client: 1 });
// The paginated list's DEFAULT order (and the tie-break under every sort).
// Covers the whole sort spec, so an unsorted page is an index scan rather than
// a blocking in-memory sort.
//
// The five sortable COLUMNS cannot be indexed: Client sorts on the joined
// client's name, and Model on the first element of an array, so both are
// computed inside the aggregation. That is inherent to sorting on a value the
// document does not store — fixing it would mean denormalising the client name
// onto the mapping.
serviceMappingSchema.index({ institution: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("LMS-ServiceMapping", serviceMappingSchema);
