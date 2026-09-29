const mongoose = require("mongoose");
const ReportSettings = require("../models/ReportSettingsModel");
const {
  BRAND_MARK_PNG, BRAND_ACCENT, BRAND_INK, BRAND_MUTED, BRAND_HAIRLINE,
  BRAND_NAME, BRAND_ADDRESS, BRAND_CONTACT,
} = require("../config/brandMark");

/* The design a brand-new institution starts from - and, because GET below
 * returns it WITHOUT saving, the design every report actually prints on until
 * somebody opens Report Settings and presses Save. That makes it the letterhead
 * in practice rather than a placeholder, so it is a finished one:
 *
 *      [mark]        ORGANISATION            [mark]
 *                      address
 *                      contact
 *    ------------------------------------------------  accent rule
 *    ------------------------------------------------  hairline
 *    Report title                    scope | generated
 *    +----------------------------------------------+
 *    |                 the table                    |  <- mark, faint, centred
 *    +----------------------------------------------+
 *                                    ---------------
 *                                   Authorised signatory
 *    ------------------------------------------------  hairline
 *    Org | title                            Page 1 of 3
 *
 * Positions are a PERCENTAGE of the sheet, chosen against A4 landscape, so the
 * same design holds at Letter or in portrait. The masthead's wording is the
 * BRAND's and is fixed (see config/brandMark.js): a report out of this LMS
 * carries SmartCliff's letterhead whichever institution's data it shows. Only
 * {title}, {scope} and {generated} are substituted, from the report being run.
 *
 * Kept in step with letterheadElements() in the client's
 * reportsettings/api/reportSettingsService.ts, which is what a NEW setting
 * created in the editor starts from. */
const defaultElements = () => [
  // Masthead. The two marks are 6.5% x 9.5%, which on A4 landscape is
  // 19.3 x 20.0 mm - square, so the round mark is not squashed into an oval.
  { id: "markLeft", kind: "logo", x: 4.5, y: 3, w: 6.5, h: 9.5, dataUrl: BRAND_MARK_PNG, everyPage: true },
  { id: "org", kind: "text", x: 14, y: 3.2, w: 72, h: 7, text: BRAND_NAME, fontSize: 20, bold: true, align: "center", color: BRAND_INK, everyPage: true },
  { id: "address", kind: "text", x: 14, y: 9.4, w: 72, h: 4, text: BRAND_ADDRESS, fontSize: 9, align: "center", color: BRAND_MUTED, everyPage: true },
  { id: "contact", kind: "text", x: 14, y: 12.9, w: 72, h: 3.5, text: BRAND_CONTACT, fontSize: 8.5, align: "center", color: BRAND_MUTED, everyPage: true },
  { id: "markRight", kind: "logo", x: 89, y: 3, w: 6.5, h: 9.5, dataUrl: BRAND_MARK_PNG, everyPage: true },

  // Two rules, not one: the accent carries the mark's colour into the page, the
  // hairline under it gives the masthead a base to sit on.
  { id: "ruleAccent", kind: "line", x: 4.5, y: 17.2, w: 91, h: 0.3, color: BRAND_ACCENT, everyPage: true },
  { id: "ruleHair", kind: "line", x: 4.5, y: 18.3, w: 91, h: 0.1, color: BRAND_HAIRLINE, everyPage: true },

  // What this particular report is. First page only - repeated, it would read
  // as a second report starting.
  { id: "reportTitle", kind: "text", x: 4.5, y: 20.8, w: 58, h: 5, text: "{title}", fontSize: 12.5, bold: true, align: "left", color: BRAND_INK },
  { id: "reportMeta", kind: "text", x: 57.5, y: 21.3, w: 38, h: 4, text: "{scope}  \u00b7  Generated {generated}", fontSize: 8.5, align: "right", color: BRAND_MUTED },

  { id: "table", kind: "table", x: 4.5, y: 26, w: 91, h: 56 },

  // Behind the table and centred on the sheet. The box is wide because the type
  // inside it is fitted to the box: a long organisation name prints smaller, and
  // a wide box means it has to shrink less far. 6% opacity is enough to read as
  // a watermark on paper and faint enough to leave an 8pt cell legible.
  { id: "watermark", kind: "watermark", x: 8, y: 44.5, w: 84, h: 14, text: BRAND_NAME, fontSize: 54, bold: true, align: "center", color: BRAND_ACCENT, opacity: 0.06, rotation: -24, everyPage: true },

  // Sign-off, aligned right with the mark above it so the page closes on the
  // same vertical the masthead opened on.
  { id: "signature", kind: "signature", x: 70.5, y: 83, w: 25, h: 8, text: "Authorised signatory", fontSize: 9, align: "center", color: BRAND_INK, everyPage: true },

  { id: "ruleFoot", kind: "line", x: 4.5, y: 92, w: 91, h: 0.1, color: BRAND_HAIRLINE, everyPage: true },
  { id: "footNote", kind: "text", x: 4.5, y: 93.2, w: 50, h: 4, text: BRAND_NAME + "  \u00b7  {title}", fontSize: 8, align: "left", color: BRAND_MUTED, everyPage: true },
  { id: "pageno", kind: "pageNumber", x: 69.5, y: 93.2, w: 26, h: 4, fontSize: 8, align: "right", color: BRAND_MUTED, everyPage: true },
];

const defaultFormat = (name = "Default setting", isDefault = true) => ({
  name,
  isDefault,
  clients: [],
  page: { size: "a4", orientation: "landscape", marginTop: 14, marginRight: 12, marginBottom: 14, marginLeft: 12 },
  elements: defaultElements(),
});

const ALIGNS = ["left", "center", "right"];
const KINDS = ["text", "logo", "line", "table", "watermark", "signature", "pageNumber"];
const pickAlign = (value, fallback) => (ALIGNS.includes(value) ? value : fallback);
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (value, max) => String(value ?? "").slice(0, max);

/** GET /report-settings/:institutionId */
exports.getReportSettings = async (req, res) => {
  try {
    const { institutionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(institutionId)) {
      return res.status(400).json({ message: [{ key: "error", value: "Invalid institution id" }] });
    }
    const doc = await ReportSettings.findOne({ institution: institutionId }).lean();
    // Never 404 for "not configured yet" — the editor should open on the
    // default design and save it on the first Save, not show an error.
    return res.status(200).json({
      message: [{ key: "success", value: "Report settings retrieved" }],
      settings: doc || { institution: institutionId, formats: [defaultFormat()] },
    });
  } catch (error) {
    console.error("getReportSettings:", error.message);
    return res.status(500).json({ message: [{ key: "error", value: "Could not load report settings" }] });
  }
};

/** PUT /report-settings/:institutionId — body: { formats: [...] } */
exports.saveReportSettings = async (req, res) => {
  try {
    const { institutionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(institutionId)) {
      return res.status(400).json({ message: [{ key: "error", value: "Invalid institution id" }] });
    }

    const incoming = Array.isArray(req.body?.formats) ? req.body.formats : null;
    if (!incoming) {
      return res.status(400).json({ message: [{ key: "error", value: "formats must be an array" }] });
    }

    // Logos arrive as data URLs and ride inside the document. Cap the total:
    // Mongo's limit is 16 MB per document, and several designs each carrying a
    // full-resolution PNG would hit it — as a write failure on save rather than
    // anything the uploader could have predicted.
    const logoBytes = incoming.reduce((total, format) => total
      + (Array.isArray(format?.elements) ? format.elements : [])
        .reduce((n, element) => n + String(element?.dataUrl || "").length, 0), 0);
    if (logoBytes > 6_000_000) {
      return res.status(400).json({
        message: [{ key: "error", value: "Those images are too large altogether — keep each logo under about 1 MB" }],
      });
    }

    // Exactly one default, and each client claimed by at most one setting.
    // Two settings claiming a client would resolve by array order, which is
    // invisible until an export comes out with the wrong design — so the first
    // setting to claim one keeps it.
    const cleaned = [];
    let seenDefault = false;
    const claimed = new Set();

    for (const raw of incoming) {
      const base = defaultFormat();
      let isDefault = raw?.isDefault === true;
      if (isDefault && seenDefault) isDefault = false;
      if (isDefault) seenDefault = true;

      const clients = isDefault ? [] : [...new Set((Array.isArray(raw?.clients) ? raw.clients : [])
        .map(String)
        .filter((id) => mongoose.Types.ObjectId.isValid(id)))]
        .filter((id) => {
          if (claimed.has(id)) return false;
          claimed.add(id);
          return true;
        });

      const page = raw?.page || {};
      const seenIds = new Set();
      let tableSeen = false;

      const elements = (Array.isArray(raw?.elements) ? raw.elements : [])
        .filter((element) => KINDS.includes(element?.kind))
        .filter((element) => {
          // Exactly one table: it is the report itself, and a second would
          // print the data twice.
          if (element.kind !== "table") return true;
          if (tableSeen) return false;
          tableSeen = true;
          return true;
        })
        .map((element, index) => {
          let id = text(element.id, 40) || `el-${index}`;
          while (seenIds.has(id)) id = `${id}-${index}`;
          seenIds.add(id);
          return {
            id,
            kind: element.kind,
            // Kept inside the page, and never smaller than a grab handle —
            // an element dragged to 0×0 could not be selected again.
            x: clamp(element.x, -5, 100, 5),
            y: clamp(element.y, -5, 100, 5),
            w: clamp(element.w, 3, 100, 30),
            // A rule is meant to be a hairline, so it gets a far smaller floor
            // than the 2% that stops other elements shrinking out of reach.
            h: element.kind === "line" ? clamp(element.h, 0.1, 100, 0.4) : clamp(element.h, 2, 100, 8),
            text: text(element.text, 400),
            fontSize: clamp(element.fontSize, 5, 96, 12),
            bold: element.bold === true,
            italic: element.italic === true,
            align: pickAlign(element.align, "left"),
            color: /^#[0-9a-fA-F]{3,8}$/.test(element.color || "") ? element.color : "#101828",
            opacity: clamp(element.opacity, 0.02, 1, 1),
            rotation: clamp(element.rotation, -180, 180, 0),
            dataUrl: String(element.dataUrl || ""),
            everyPage: element.everyPage === true,
          };
        });

      cleaned.push({
        name: text(raw?.name, 120) || base.name,
        isDefault,
        clients,
        page: {
          size: ["a4", "letter", "legal"].includes(page.size) ? page.size : base.page.size,
          orientation: ["portrait", "landscape"].includes(page.orientation) ? page.orientation : base.page.orientation,
          // 0–50 mm. Wider than that leaves no usable width on A4 landscape and
          // the table would silently overflow the page.
          marginTop: clamp(page.marginTop, 0, 50, base.page.marginTop),
          marginRight: clamp(page.marginRight, 0, 50, base.page.marginRight),
          marginBottom: clamp(page.marginBottom, 0, 50, base.page.marginBottom),
          marginLeft: clamp(page.marginLeft, 0, 50, base.page.marginLeft),
        },
        // A design with no table prints no data, which is never what was meant.
        elements: elements.length ? elements : defaultElements(),
      });
    }
    // Something must catch the clients nobody claimed.
    if (!seenDefault) cleaned.unshift(defaultFormat());

    const saved = await ReportSettings.findOneAndUpdate(
      { institution: institutionId },
      { $set: { formats: cleaned, updatedBy: req.user?.email || req.user?.firstName || "" } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    return res.status(200).json({
      message: [{ key: "success", value: "Report settings saved" }],
      settings: saved,
    });
  } catch (error) {
    console.error("saveReportSettings:", error.message);
    return res.status(500).json({ message: [{ key: "error", value: "Could not save report settings" }] });
  }
};
