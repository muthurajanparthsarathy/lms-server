const mongoose = require("mongoose");

// Contact person sub-document for a standalone client.
//
// The `email` and `phoneNumber` columns are the person's Email + phone
// and are required on write. `secondaryEmail` and `secondaryPhoneNumber` are
// an ADDITIONAL email + phone belonging to the same person — kept on the same
// document rather than as a second contact so the pair is authored, stored
// and displayed as "another way to reach this contact", not as a separate
// contact person. Both are optional. Legacy records without them keep
// validating (they default to "").
const contactPersonSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
  },
  secondaryEmail: {
    type: String,
    default: "",
    trim: true,
  },
  secondaryPhoneNumber: {
    type: String,
    default: "",
    trim: true,
  },
  // Postal address of THIS contact person, stored as the same
  // newline-joined plain string the client-level `clientAddress` uses:
  //   line 1: {addressLine}   /   line 2: {city}, {state} - {pincode}
  // The form collects one per contact; contact 1's value is also mirrored
  // onto the client's own `clientAddress` so the details page, exports and
  // the report letterhead's {address} token keep reading a single field.
  // Empty on records saved before this column existed.
  address: {
    type: String,
    default: "",
    trim: true,
  },
  designation: {
    type: String,
  },
  // Free-text role — Primary / Secondary / Finance / HR / Technical / Management
  // / Other. Not an enum: the form offers suggestions but the backend accepts
  // whatever the user (or a future flow) types. Empty for legacy records.
  contactType: {
    type: String,
    default: "",
    trim: true,
  },
  isPrimary: {
    type: Boolean,
    default: false,
  },
});

// A service the client uses, with the service modals selected under it.
// Values are snapshots (names) pulled from the course-structure-dynamic
// service / serviceModal data via dynamic dropdowns on the client.
// A department with its own sections and one or more semesters
// (e.g. ME → [A, B] · Sem 1–4 ; CIVIL → [A, B] · Sem 1–2)
const departmentSectionSchema = new mongoose.Schema({
  department: { type: String },
  sections: [{ type: String }],
  semesters: [{ type: String }],
});

// One batch block: a single batch + degree, with multiple departments,
// each carrying its own sections and semester.
const degreeProgramSchema = new mongoose.Schema({
  batch: { type: String },
  degree: { type: String },
  departments: [departmentSectionSchema],
});

const clientServiceSchema = new mongoose.Schema({
  service: {
    type: String,
    required: true,
  },
  // e.g. degree-program clients train a fresh batch every year
  year: {
    type: String,
  },
  serviceModals: [
    {
      type: String,
    },
  ],
  // Company clients: one or more batches (batch-only)
  batches: [{ type: String }],
  // College clients: batch blocks (batch + degree + departments)
  degreePrograms: [degreeProgramSchema],
});

// Standalone Client Management schema — its own top-level collection.
// This is intentionally independent of the embedded `client` inside
// Course-Structure-Dynamic; the two represent different concepts.
const clientManagementSchema = new mongoose.Schema(
  {
    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LMS-Institution",
      required: false,
    },
    // Human-readable Client ID (e.g. "CLT-000023"). Distinct from the Mongo
    // _id, which is the internal identifier and continues to be used as the
    // foreign key from Service Mapping, Course Structure, Backup, POC scope
    // and everywhere else. The clientId is what the UI displays and what a
    // human quotes on the phone or in an email.
    //
    // Optional at the schema level so:
    //   1. legacy records saved before this field existed keep validating;
    //   2. the create controller can allocate the id inside the transaction
    //      that saves the client (see clientManagementController.createClient)
    //      without a chicken-and-egg on required=true.
    // A one-line lazy backfill runs on GET (see the getAll/getById handlers)
    // for records that predate this column, so every visible row carries one.
    clientId: {
      type: String,
      trim: true,
      default: "",
    },
    clientCompany: {
      type: String,
      required: true,
      trim: true,
    },
    // Organization / office phone number. Distinct from any contact person's
    // mobile number — this is the switchboard, the front desk. Stored as one
    // free-text string ("+91 0422 1234567") to match how contactPersons store
    // phone numbers: the split control on the client presents it as country
    // code + number and re-joins them here on write, so the collection stays
    // self-consistent and no legacy record needs a migration.
    clientPhone: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
    },
    // Public website of the client organisation ("https://acme.com").
    // Free text, normalised to include a scheme on the client before it is
    // sent. Empty on records saved before this column existed.
    website: {
      type: String,
      default: "",
      trim: true,
    },
    clientAddress: {
      type: String,
    },
    clientLogo: {
      type: String,
    },
    // Where the client logo sits inside its circular crop frame. Stored
    // as a CSS object-position string ("50% 50%" by default) so every
    // render site (avatar, drawer, details page, cards) can hand it
    // straight to the `<img style={{ objectPosition }}>` — no math on
    // the read side. Empty on records saved before this existed; the
    // frontend falls back to center in that case.
    clientLogoPosition: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    // A client can be a college and/or a company
    type: {
      type: [String],
      enum: ["college", "company"],
      default: [],
    },
    // Business model this client is engaged under. Defined here on the client;
    // Service Mapping derives each mapping's service from it (the wizard no
    // longer has its own business-model select). Empty for legacy records.
    // "CSR" stays in the enum only so records saved when CSR was offered as a
    // business model keep validating — new writes only accept B2B/B2I/B2C
    // (enforced in the controller); CSR is a service model under B2B now.
    businessModel: {
      type: String,
      enum: ["B2B", "B2I", "B2C", "CSR", ""],
      default: "",
    },
    // Services (and their service modals) this client is engaged for
    services: [clientServiceSchema],
    contactPersons: [contactPersonSchema],
    createdBy: {
      type: String,
    },
    updatedBy: {
      type: String,
    },
  },
  { timestamps: true }
);

// The BM list query filters by institution and sorts by createdAt desc; this
// Include the ID tie-break so clients saved at the same time paginate stably.
clientManagementSchema.index({ institution: 1, createdAt: -1, _id: -1 });
// ── Indexes for the paginated client list ───────────────────────────────────
// The sortable columns, each ending in the controller's createdAt/_id
// tie-break: an index only serves a sort when it covers the WHOLE sort spec,
// so omitting the tie-break columns leaves every sorted page doing a blocking
// in-memory sort. Collation strength 1 matches the page's
// `localeCompare(undefined, { sensitivity: 'base' })` — a collated sort can
// only use an index built with the SAME collation.
const CLIENT_LIST_COLLATION = { locale: "en", strength: 1, numericOrdering: true };
clientManagementSchema.index(
  { institution: 1, clientCompany: 1, createdAt: -1, _id: -1 },
  { collation: CLIENT_LIST_COLLATION }
);
clientManagementSchema.index(
  { institution: 1, businessModel: 1, createdAt: -1, _id: -1 },
  { collation: CLIENT_LIST_COLLATION }
);
clientManagementSchema.index(
  { institution: 1, status: 1, createdAt: -1, _id: -1 },
  { collation: CLIENT_LIST_COLLATION }
);
// Client IDs sort in the listing (numerically, since they end in a zero-padded
// number) — cover the whole sort spec so a sorted page is an index scan, not
// an in-memory sort.
clientManagementSchema.index(
  { institution: 1, clientId: 1, createdAt: -1, _id: -1 },
  { collation: CLIENT_LIST_COLLATION }
);
// Client IDs are unique per institution. Partial, so records saved before the
// column existed (clientId = "") coexist without colliding on the empty value;
// the lazy backfill in the controller fills those in on read.
clientManagementSchema.index(
  { institution: 1, clientId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      clientId: { $exists: true, $type: "string", $gt: "" },
    },
  }
);

module.exports = mongoose.model("LMS-ClientManagement", clientManagementSchema);
