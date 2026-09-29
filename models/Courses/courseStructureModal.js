// models/CourseStructure.js
const mongoose = require("mongoose");
 
// Group Schema
const groupSchema = new mongoose.Schema({
  groupName: {
    type: String,
    required: true,
    trim: true,
  },
  groupDescription: {
    type: String,
    trim: true,
    default: "",
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-User",
    required: true,
  }],
  groupLeader: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-User",
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'archived'],
    default: 'active',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: String,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  updatedBy: {
    type: String,
  },
});
 
groupSchema.index({ groupName: 1, course: 1 }, { unique: true });
 
const batchUserSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-User",
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'completed', 'dropped'],
    default: 'active',
  },
  // Hierarchy node this participant was enrolled at
  // (batch → degree → department → section → semester)
  degree: { type: String, default: "" },
  department: { type: String, default: "" },
  section: { type: String, default: "" },
  semester: { type: String, default: "" },

  joinedAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});
 
// Batch Schema
const batchSchema = new mongoose.Schema({
  batchName: {
    type: String,
    required: true,
    trim: true,
  },
  // Which phase of the course this batch belongs to ("Phase I"), or '' when the
  // course does not run in phases.
  //
  // A course is ONE record even when it runs in several phases, and each phase
  // carries its own cohort — so the batch name alone cannot identify a batch:
  // a mapping routinely gives every phase the same batch names ("phase 1",
  // "phase 2"). Without this field Phase II's "phase 1" resolves to Phase I's
  // batch and the two cohorts merge. Identity is (phase, batchName).
  //
  // Empty is the honest value for an unphased course, and is what every batch
  // written before this field existed carries.
  phase: {
    type: String,
    trim: true,
    default: '',
  },
  // Degree Program only: the section this group belongs to ("A"), or '' for
  // every other service. A degree course runs for each section/batch of its
  // department + semester, and batch names repeat across sections ("Batch 1"
  // in A and in B are different students), so — like `phase` — identity is
  // (section, batchName). A section with no batches is one group named after
  // the section itself. See utils/courseGroups.js.
  section: {
    type: String,
    trim: true,
    default: '',
  },
  // Set when the mapping sync archived this group because the mapping no
  // longer lists it — so the sync restores only what it retired, never a
  // group someone archived by hand.
  archivedBySync: {
    type: Boolean,
    default: false,
  },
  batchDescription: {
    type: String,
    trim: true,
    default: '',
  },
   batchStartDate: {
    type: Date,
    default: null,
  },
  batchEndDate: {
    type: Date,
    default: null,
  },
  users: [batchUserSchema], // Array of user objects with enrollment details
  status: {
    type: String,
    enum: ['active', 'suspended', 'archived'],
    default: 'active',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-User",
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-User",
  },
});
 
// Add index for batch name uniqueness within a course
batchSchema.index({ batchName: 1 }, { unique: false });
const fileResourceSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  maxSize: { type: Number, default: 0 },
  aiChat: { type: Boolean, default: false },
  aiSummary: { type: Boolean, default: false },
  // Per-type Notes toggle — this upload also carries its own notes, separate
  // from the standalone Notes resource type below.
  notes: { type: Boolean, default: false },
  allowedFormats: [{ type: String }]
}, { _id: false });
 
// Mirrors the Super Admin's Resource Management catalog (I Do upload types +
// We Do / You Do AI features) so a course can only turn on what the platform
// enabled for its institution. See models/superadmin/ResourceSettingModel.js —
// the two must stay in step or the course form has nowhere to store a type the
// Super Admin exposed.
const resourceConfigSchema = new mongoose.Schema({
  video: fileResourceSchema,
  ppt: fileResourceSchema,
  pdf: fileResourceSchema,
  image: fileResourceSchema,
  zip: fileResourceSchema,
  url: { enabled: { type: Boolean, default: false } },
  aiChat:  { enabled: { type: Boolean, default: false } },
  aiSummary:  { enabled: { type: Boolean, default: false } },
  notes: { enabled: { type: Boolean, default: false } },
  ai: { enabled: { type: Boolean, default: false } },
  // We Do / You Do only — pairs with aiChat ("AI Assistant") to match the
  // Super Admin's two per-phase toggles.
  autoQuestionGenerate: { enabled: { type: Boolean, default: false } }
}, { _id: false });
 
const pedagogyResourceSchema = new mongoose.Schema({
  iDo: resourceConfigSchema,
  weDo: resourceConfigSchema,
  youDo: resourceConfigSchema
}, { _id: false });
 
 
// Each step names ONE specific person. The role narrows the picker; the user
// is who actually gets the notification and whose approve/reject call is
// accepted at this step. userId is required for chains saved after the
// person-specific rollout; legacy role-only rows persist with userId=null
// and fall back to any user of that role.
const approvalHierarchyStepSchema = new mongoose.Schema({
  order: { type: Number, required: true },
  roleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role", required: true },
  roleName: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "LMS-User", default: null },
  userName: { type: String, default: "" },
}, { _id: false });
 
// Programming Languages Schema for Test Configuration
const programmingLanguagesSchema = new mongoose.Schema({
  coreProgram: [{
    type: String,
    default: []
  }],
  frontend: [{
    type: String,
    default: []
  }],
  database: [{
    type: String,
    default: []
  }]
}, { _id: false });
 
// Degree Program: one group's content set — a whole section (batch "") or
// one of its batches. See batchResources.sets.
const contentSetSchema = new mongoose.Schema({
  section: { type: String, trim: true, required: true },
  batch: { type: String, trim: true, default: "" },
  set: { type: String, trim: true, required: true },
}, { _id: false });

// Course Structure Schema
const courseStructureSchema = new mongoose.Schema({
  institution: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-Institution",
    required: true,
  },
 
  // Course Configuration
  // Reference to the Client Management client…
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-ClientManagement",
    required: true,
  },
  // …and the readable client company name (denormalized for display)
  clientName: {
    type: String,
  },
  serviceType: {
    type: String,
    required: true,
  },
  serviceModal: {
    type: String,
    required: true,
  },

  // Client-driven cascade (mirrors the User model fields; sourced from the
  // selected client's dynamic data). Only semester is a static 1–8 value.
  studentType: {
    type: String,
    enum: ["degree-program", "skilling", ""],
    default: "",
  },
  batch: {
    type: String,
  },
  // Skilling engagements can target multiple batches (multi-select)
  skillingBatches: [
    {
      type: String,
    },
  ],
  // The course's own batch names, copied from the service mapping's course
  // (MappedCourse.batches — the per-course batches the Degree Program flow
  // captures). getCourseBatches unions these with batch/skillingBatches to
  // materialise the enrolment page's batch tabs, so a course mapped with
  // b1/b2 enrols per batch instead of falling back to "Default".
  batches: [
    {
      type: String,
    },
  ],
  degree: {
    type: String,
  },
  // A course can span multiple departments, each with its own sections and
  // semester (e.g. ME → [A, B] · Sem 2 ; ECE → [A, B, C] · Sem 3)
  // (kept for back-compat — mirrors clientConfigurations[0])
  departmentSections: [
    {
      department: { type: String },
      sections: [{ type: String }],
      semesters: [{ type: String }],
    },
  ],
  // Multiple full client-configuration blocks. Each: a batch + degree and its
  // departments (each with sections + semesters). A course can serve several.
  clientConfigurations: [
    {
      batch: { type: String },
      degree: { type: String },
      departments: [
        {
          department: { type: String },
          sections: [{ type: String }],
          semesters: [{ type: String }],
        },
      ],
    },
  ],

  // Course Details
  category: {
    type: String,
    // Required for every flow EXCEPT Placement Training, whose courses carry no
    // category (the phase/name IS the course). A plain `required: true` made
    // Mongoose reject every placement course save with a validation error even
    // after the controller allowed it through.
    required: function () {
      // On .save() `this` is the document, so the sibling field reads directly.
      // Under findOneAndUpdate + runValidators `this` is the QUERY instead, where
      // this.serviceModal is undefined — the check then read "" as non-placement
      // and rejected every placement course EDIT with
      // "Path `category` is required". Read the sibling out of the update payload
      // in that case.
      let serviceModal = this.serviceModal;
      if (typeof this.getUpdate === "function") {
        const update = this.getUpdate() || {};
        const fromUpdate = update.serviceModal ?? update.$set?.serviceModal;
        if (fromUpdate !== undefined) serviceModal = fromUpdate;
      }
      return !/placement/i.test(String(serviceModal || ""));
    },
  },
  courseCode: {
    type: String,
  },
  // ServiceMapping _id this course was set up from. Course Setup identity is
  // clientId + mappingId + courseName, so the same course name under a
  // different service/mapping is a brand-new setup. Empty on legacy records,
  // which fall back to matching by clientId + courseName alone.
  mappingId: {
    type: String,
    default: "",
  },
  // WHERE inside that mapping the course sits — "B.E ▸ CSE ▸ A ▸ 3" for the
  // degree flow, a phase name for placement training, "" for the flat flows.
  // Course Setup identity is clientId + mappingId + coursePath + courseName, so
  // the same course name under two departments is two independent setups.
  // Empty on records created before this existed; those fall back to matching
  // without a path, and adopt one the first time they are edited.
  coursePath: {
    type: String,
    default: "",
  },
  // Whether the course's CONTENT is shared across its batches. Answered in
  // Course Setup (below Test configuration) — only meaningful for courses
  // whose mapping created batches. sameForAllBatches true (the default) is
  // today's behavior: one content set, every batch sees it. false means the
  // listed elements carry their own content per batch; anything not listed
  // stays shared. Elements use the record's own I_Do/We_Do/You_Do spelling.
  batchResources: {
    sameForAllBatches: { type: Boolean, default: true },
    batchwiseElements: [{ type: String, enum: ["I_Do", "We_Do", "You_Do"] }],
    // Degree Program only: sections whose batches each get their own content.
    // A section not listed keeps ONE set for all its batches. Empty for every
    // other service. See utils/courseGroups.js. Superseded by `sets` once a
    // course is saved with them.
    perBatchSections: [{ type: String, trim: true }],
    // Degree Program only: which content SET each section — or, when its
    // batches differ, each of its batches — is on. Groups on the same set
    // share one set of material. `batch` is "" for a whole section; `set` is
    // the set's number, which never changes (see utils/batchResources.js).
    sets: [contentSetSchema],
    // The highest set number ever saved, so a new set never reuses the number
    // (and so the material) of one that was given up.
    lastSet: { type: Number, default: 0 },
  },
  // Whether the Program Calendar is shared across the course's batches or
  // authored per batch. Sibling to batchResources but simpler: a calendar
  // either splits per batch or it doesn't, so there is no "which parts"
  // sub-choice. Answered in Course Setup (below Resources by batch) and
  // only meaningful for courses whose mapping created more than one batch;
  // legacy records without it read back as the default (shared).
  programCalendarByBatch: {
    sameForAllBatches: { type: Boolean, default: true },
    // Degree Program only: sections whose batches each get their own
    // calendar. Same meaning as batchResources.perBatchSections.
    perBatchSections: [{ type: String, trim: true }],
    // Degree Program only: which calendar SET each section or batch follows.
    // Same meaning as batchResources.sets.
    sets: [contentSetSchema],
    lastSet: { type: Number, default: 0 },
  },
  // Degree Program only: the sections (and their batches) this course runs
  // for, as they were when the course was last saved. The mapping stays the
  // source of truth — the group sync reads it live — and this snapshot only
  // stands in when the mapping can no longer be found.
  studentGroups: [{
    _id: false,
    section: { type: String, trim: true },
    batches: [{ type: String, trim: true }],
  }],
  courseName: {
    type: String,
    required: true,
  },
  courseDescription: {
    type: String,
  },
  courseDuration: {
    type: String,
  },
  courseLevel: {
    type: String,
  },
  courseImage: {
    type: String,
  },
 
  // Resources Type - Now using the new pedagogy-based structure
  resourcesType: {
    type: pedagogyResourceSchema,
  },
  aiChatGlobal: { type: Boolean, default: false },
 
  // Skill Set Configuration
  testConfiguration: {
    type: programmingLanguagesSchema,
    default: () => ({})
  },
 
  courseHierarchy: [{
    type: String,
  }],
 
  // Pedagogy elements (keeping existing structure)
  I_Do: [{
    type: String,
  }],
  We_Do: [{
    type: String,
  }],
  You_Do: [{
    type: String,
  }],
 
  batchAndParticipants: [batchSchema], // Array of batches
 
  groups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course-Group",
  }],
 
  // Sequential approval workflow template. When an assessment is created
  // under this course, snapshot `steps` onto the assessment doc.
  approvalHierarchy: {
    steps: { type: [approvalHierarchyStepSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "LMS-User", default: null },
    updatedAt: { type: Date, default: null },
  },
 
  createdAt: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: String,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  updatedBy: {
    type: String,
  },
});
 
// getCourseStructure filters by institution; mappingId (a String) is scanned
// by both collectMappingCourseIds during cascade delete and the wizard's
// per-mapping semester-lock logic. Neither had an index — trivial today,
// linear in the collection tomorrow.
courseStructureSchema.index({ institution: 1 });
courseStructureSchema.index({ mappingId: 1 });
// The create/update duplicate-code checks query by courseCode alone —
// unindexed that is a collection scan per save. Non-unique deliberately:
// legacy docs may share or omit codes.
courseStructureSchema.index({ courseCode: 1 });

module.exports = mongoose.model("Course-Structure", courseStructureSchema);
 