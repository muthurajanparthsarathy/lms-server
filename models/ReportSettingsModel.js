const mongoose = require("mongoose");

/**
 * Report page design — a canvas of positioned elements, one set per setting.
 *
 * Elements carry their position as a PERCENTAGE of the page rather than in
 * millimetres or pixels. Switching A4 → Letter or landscape → portrait then
 * keeps a layout intact instead of throwing everything off the sheet, and the
 * editor's preview can be any size on screen without a scale factor to keep in
 * step.
 *
 * One document per institution holding many named settings. Each setting names
 * the clients it applies to, so one design can cover six of them rather than
 * forcing six near-identical copies. Exactly one setting is the DEFAULT, used
 * by every client no setting claims.
 */
const elementSchema = new mongoose.Schema(
  {
    /** Stable across reorders and re-renders — the editor selects by it. */
    id: { type: String, required: true },
    // text        — a heading, a caption, a footer line, anything typed
    // logo        — an uploaded image
    // line        — a horizontal rule, e.g. under the header or above the footer
    // table       — the report data itself; exactly one per design
    // watermark   — drawn behind everything, usually rotated
    // signature   — a rule with a caption under it; a page can carry several
    // pageNumber  — "Page 1 of 3"
    kind: {
      type: String,
      enum: ["text", "logo", "line", "table", "watermark", "signature", "pageNumber"],
      required: true,
    },
    /** Percent of the page. x/y are the top-left corner. */
    x: { type: Number, default: 5 },
    y: { type: Number, default: 5 },
    w: { type: Number, default: 30 },
    h: { type: Number, default: 8 },

    text: { type: String, default: "" },
    /** Points, as a PDF measures type. The preview scales it to the sheet. */
    fontSize: { type: Number, default: 12 },
    bold: { type: Boolean, default: false },
    italic: { type: Boolean, default: false },
    align: { type: String, enum: ["left", "center", "right"], default: "left" },
    color: { type: String, default: "#101828" },
    opacity: { type: Number, default: 1 },
    rotation: { type: Number, default: 0 },
    /** Data URL for `logo`, so a design is self-contained. */
    dataUrl: { type: String, default: "" },
    /** Repeat on every page — headers, footers and watermarks usually do. */
    everyPage: { type: Boolean, default: false },
  },
  { _id: false }
);

const formatSchema = new mongoose.Schema(
  {
    name: { type: String, default: "Report setting" },
    /** The fallback, used by every client not named in another setting. */
    isDefault: { type: Boolean, default: false },
    /** Clients this setting applies to. Ignored when isDefault is true. */
    clients: [{ type: mongoose.Schema.Types.ObjectId, ref: "LMS-ClientManagement" }],

    // Paper. Margins are millimetres, the unit a printer dialog uses; the PDF
    // writer converts to points. Landscape by default — these reports are wide.
    page: {
      size: { type: String, enum: ["a4", "letter", "legal"], default: "a4" },
      orientation: { type: String, enum: ["portrait", "landscape"], default: "landscape" },
      marginTop: { type: Number, default: 14 },
      marginRight: { type: Number, default: 12 },
      marginBottom: { type: Number, default: 14 },
      marginLeft: { type: Number, default: 12 },
    },

    elements: { type: [elementSchema], default: [] },
  },
  { _id: false }
);

const reportSettingsSchema = new mongoose.Schema(
  {
    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LMS-Institution",
      required: true,
      // One settings document per institution — the upsert in the controller
      // relies on this to avoid racing two saves into two documents.
      unique: true,
      index: true,
    },
    formats: { type: [formatSchema], default: [] },
    updatedBy: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LMS-ReportSettings", reportSettingsSchema);
