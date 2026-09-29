const mongoose = require("mongoose");

const printSettongSchema = new mongoose.Schema(
  {
    // ── Scope ────────────────────────────────────────────────────────────
    // Added when print settings became per-client. Before this the collection
    // had no tenant field at all, so every institution shared two demo rows.
    institution: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LMS-Institution",
      required: true,
      index: true,
    },

    /**
     * WHICH client this layout is for.
     *
     *   null  -> the COMMON setting: used by any client that has none of its
     *            own, and by prints that are not tied to a client at all.
     *   <id>  -> that client's own layout, which wins over the common one.
     *
     * Deliberately nullable rather than two collections or a boolean +
     * clientId pair: "is there a row for this client, else the row with no
     * client" is one query and one rule, and the rule is the whole feature.
     */
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LMS-ClientManagement",
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },

    title: {
      type: String,
    },
    description: {
      type: String,
    },
    headerData: {
      name: { type: String },
      /** Legacy name for the sub-line. `description` supersedes it; kept so
       *  rows written before the rename still print. */
      address: { type: String },
      /** The header TITLE. Falls back to `name` when empty. */
      text: { type: String },
      /** The sub-line under the title, styled independently of it. */
      description: { type: String },
      /** The logo Yes/No gate. When false no logo prints, whatever is stored
       *  in logoSettings — so turning it off never loses the upload. */
      showLogo: { type: Boolean, default: true },
      alignment: {
        type: String,
        enum: ["left", "center", "right"],
        default: "left",
      },
      /**
       * Which logo slot(s) the header prints.
       *   left    one logo on the left, header text to its right
       *   right   one logo on the right, header text to its left
       *   both    a logo on each side, header text between them
       */
      logoPosition: {
        type: String,
        enum: ["left", "right", "both"],
        default: "left",
      },
      /**
       * How far out the logo sits.
       *   corner  pinned to the page edge, header text taking the rest
       *   center  tucked against the text, the pair centred as one group
       */
      logoPlacement: {
        type: String,
        enum: ["corner", "center"],
        default: "corner",
      },
      background: { type: String, default: "#FFFFFF" },
    },

    /**
     * Footer TEXT, separate from footerSetting (which is the signatory/date/seal
     * row). Supports the tokens {{date}}, {{page}} and {{totalPages}}, which the
     * printing page substitutes — they are stored literally so the same layout
     * paginates correctly for any document length.
     */
    footerData: {
      text: {
        type: String,
        default: "Generated on {{date}} | Page {{page}} of {{totalPages}}",
      },
      alignment: {
        type: String,
        enum: ["left", "center", "right"],
        default: "center",
      },
    },
    pageSettings: {
      pageSize: {
        type: String,
        enum: ["A4", "A3", "Letter"],
        default: "A4",
      },
      orientation: {
        type: String,
        enum: ["portrait", "landscape"],
        default: "portrait",
      },
      showHeader: {
        type: Boolean,
        default: true,
      },
      showFooter: {
        type: Boolean,
        default: true,
      },
      /** Millimetres, matching the unit printers and @page use. */
      margins: {
        top: { type: Number, default: 12, min: 0, max: 100 },
        bottom: { type: Number, default: 12, min: 0, max: 100 },
        left: { type: Number, default: 12, min: 0, max: 100 },
        right: { type: Number, default: 12, min: 0, max: 100 },
      },
    },
    typography: {
      /** The header TITLE. */
      headerData: {
        family: {
          type: String,
          default: "Arial, sans-serif",
        },
        size: {
          type: String,
          default: "16px",
        },
        weight: {
          type: String,
          default: "bold",
        },
        color: {
          type: String,
          default: "#000000",
        },
        align: {
          type: String,
          enum: ["left", "center", "right"],
          default: "left",
        },
        /** CSS letter-spacing, e.g. "0.5px". Empty means normal. */
        letterSpacing: { type: String, default: "" },
      },

      /** The header DESCRIPTION, styled apart from the title above it. */
      headerDescription: {
        family: {
          type: String,
          default: "Arial, sans-serif",
        },
        size: {
          type: String,
          default: "11px",
        },
        weight: {
          type: String,
          default: "normal",
        },
        color: {
          type: String,
          default: "#6B7280",
        },
        align: {
          type: String,
          enum: ["left", "center", "right"],
          default: "left",
        },
        /** CSS letter-spacing, e.g. "0.5px". Empty means normal. */
        letterSpacing: { type: String, default: "" },
      },

      footerData: {
        family: {
          type: String,
          default: "Arial, sans-serif",
        },
        size: {
          type: String,
          default: "14px",
        },
        weight: {
          type: String,
          default: "normal",
        },
        color: {
          type: String,
          default: "#000000",
        },
        align: {
          type: String,
          enum: ["left", "center", "right"],
          default: "center",
        },
        /** CSS letter-spacing, e.g. "0.5px". Empty means normal. */
        letterSpacing: { type: String, default: "" },
      },
    },

    signature: {
      signatureUrl: {
        type: String,
      },
      sealUrl: {
        type: String,
      },
      /** Printed heights in px, the same way the header logos express theirs. */
      signatureHeight: { type: Number, min: 8, max: 400, default: 36 },
      sealHeight: { type: Number, min: 8, max: 400, default: 56 },
    },
    logoSettings: {
      showLeftLogo: {
        type: Boolean,
      },
      showRightLogo: {
        type: Boolean,
      },
      /** Legacy t-shirt sizes. Superseded by the *Height fields below, and
       *  kept only so rows written before them still print the same. */
      leftLogoSize: {
        type: String,
        enum: ["small", "medium", "large"],
        default: "medium",
      },
      rightLogoSize: {
        type: String,
        enum: ["small", "medium", "large"],
        default: "medium",
      },
      /** Printed height in px. Wins over the size enum when set. */
      leftLogoHeight: { type: Number, min: 8, max: 400 },
      rightLogoHeight: { type: Number, min: 8, max: 400 },
      leftLogoUrl: {
        type: String,
      },
      rightLogoUrl: {
        type: String,
      },
    },
    watermarkSettings: {
      showWatermark: {
        type: Boolean,
        default: true,
      },
      opacity: {
        type: Number,
        default: 10,
        min: 0,
        max: 100,
      },
      size: {
        type: String,
        enum: ["small", "medium", "large"],
        default: "medium",
      },

      watermarkUrl: String,

      /**
       * Which watermark is printed. Previously inferred from whether
       * watermarkUrl was set, which made "keep my text but also keep the
       * artwork on file" impossible to express. Now both can be stored and
       * this decides.
       */
      type: {
        type: String,
        enum: ["text", "image"],
        default: "text",
      },
      /** Degrees. `position` anchors the stamp; this turns it. */
      rotation: { type: Number, default: 0, min: -180, max: 180 },
      /** Percent of the natural width, for an IMAGE watermark. */
      scale: { type: Number, default: 100, min: 10, max: 400 },
      fontWeight: { type: String, default: "normal" },
      /** Font size in px, matching how header and footer express theirs.
       *  Wins over the small/medium/large `size` enum when set. */
      fontSize: { type: String, default: "" },
      letterSpacing: { type: String, default: "" },
      /** Printed width in px for an IMAGE watermark. Wins over `scale`. */
      imageWidth: { type: Number, min: 16, max: 2000 },

      /**
       * A TEXT watermark ("CONFIDENTIAL", "DRAFT"). Independent of
       * watermarkUrl: an institution can stamp text without supplying artwork,
       * which is the common case and the reason this exists.
       */
      text: { type: String, default: "" },
      position: {
        type: String,
        enum: ["center", "diagonal", "top", "bottom"],
        default: "center",
      },
      fontStyle: {
        type: String,
        enum: ["normal", "italic", "bold"],
        default: "italic",
      },
      fontFamily: { type: String, default: "Arial, sans-serif" },
      color: { type: String, default: "#9CA3AF" },
    },
    footerSetting: {
      showSignatory: {
        type: Boolean,
        default: true,
      },
      showDate: {
        type: Boolean,
        default: true,
      },
      showSeal: {
        type: Boolean,
        default: true,
      },
      signatoryPosition: {
        type: Number,
        enum: [1, 2, 3],
        default: 1,
      },
      datePosition: {
        type: Number,
        enum: [1, 2, 3],
        default: 2,
      },
      sealPosition: {
        type: Number,
        enum: [1, 2, 3],
        default: 3,
      },
    },
    // Drag-and-drop layout. Empty means the classic flow layout above.
    canvasElements: {
      type: [
        new mongoose.Schema(
          {
            id: { type: String, required: true },
            kind: { type: String, enum: ["text", "image", "line", "signature", "body"], required: true },
            bind: { type: String, default: "" },
            x: Number,
            y: Number,
            w: Number,
            h: Number,
            text: { type: String, default: "" },
            fontSize: { type: Number, default: 12 },
            bold: { type: Boolean, default: false },
            italic: { type: Boolean, default: false },
            align: { type: String, enum: ["left", "center", "right"], default: "left" },
            color: { type: String, default: "#111827" },
            opacity: { type: Number, default: 1 },
            rotation: { type: Number, default: 0 },
            dataUrl: { type: String, default: "" },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// The lookup the resolver makes on every print: this institution's row for a
// client, falling back to its common row.
printSettongSchema.index({ institution: 1, clientId: 1 });

printSettongSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model("print-Setting", printSettongSchema);
