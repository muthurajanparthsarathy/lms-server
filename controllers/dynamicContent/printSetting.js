// controllers/dynamicContent/printSetting.js
//
// Print layouts for System Settings ▸ Dynamic Field Settings ▸ Print Setting.
//
// One layout describes how a printed page is drawn: header text, logos,
// typography, watermark, signature/seal and footer. Pages that print read the
// RESOLVED layout for whichever client they are printing for.
//
// SCOPE is the point of this module:
//   clientId: null   the COMMON layout — used by any client without its own
//   clientId: <id>   that client's layout, which overrides the common one
//
// Two things changed here beyond adding that scope:
//   1. Every query is now filtered by req.user.institution. It previously had
//      none, so one tenant's layouts were visible to every other tenant, and
//      getAll was not even authenticated.
//   2. Images go to CLOUDINARY (utils/printAssetStorage.js) instead of the
//      Supabase bucket, which was out of space and refusing TLS connections.

const mongoose = require("mongoose");
const PrintSetting = require("../../models/dynamicContent/PrintSettingModels");
const { uploadPrintAsset, deletePrintAsset } = require("../../utils/printAssetStorage");

const isValidId = (value) => !!value && mongoose.Types.ObjectId.isValid(String(value));
const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const fail = (res, status, value) =>
  res.status(status).json({ message: [{ key: "error", value }] });

const ok = (res, value, extra = {}) =>
  res.status(200).json({ message: [{ key: "success", value }], ...extra });

const requireInstitution = (req) => {
  const institution = req.user && req.user.institution;
  return institution ? toObjectId(institution) : null;
};

/**
 * express-fileupload + multipart means nested objects arrive BOTH as real
 * objects (JSON body) and as bracketed string keys ("logoSettings[opacity]").
 * The original controller hand-unpacked each field, which is why adding one
 * meant editing five places. This reads whichever shape arrived.
 */
const section = (body, name, spec) => {
  const nested = body[name] && typeof body[name] === "object" ? body[name] : {};
  const out = {};
  for (const [key, cast] of Object.entries(spec)) {
    const raw = body[`${name}[${key}]`] !== undefined ? body[`${name}[${key}]`] : nested[key];
    if (raw === undefined || raw === "") continue;
    out[key] = cast(raw);
  }
  return out;
};

const asBool = (value) => value === true || value === "true";
const asInt = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const asStr = (value) => String(value);

const SPEC = {
  headerData: {
    name: asStr,
    address: asStr,
    text: asStr,
    description: asStr,
    alignment: asStr,
    logoPosition: asStr,
    logoPlacement: asStr,
    showLogo: asBool,
    background: asStr,
  },
  footerData: { text: asStr, alignment: asStr },
  pageSettings: {
    pageSize: asStr,
    orientation: asStr,
    showHeader: asBool,
    showFooter: asBool,
  },
  logoSettings: {
    showLeftLogo: asBool,
    showRightLogo: asBool,
    leftLogoSize: asStr,
    rightLogoSize: asStr,
    leftLogoHeight: asInt,
    rightLogoHeight: asInt,
  },
  watermarkSettings: {
    showWatermark: asBool,
    type: asStr,
    opacity: asInt,
    rotation: asInt,
    scale: asInt,
    size: asStr,
    text: asStr,
    position: asStr,
    fontStyle: asStr,
    fontWeight: asStr,
    fontSize: asStr,
    letterSpacing: asStr,
    imageWidth: asInt,
    fontFamily: asStr,
    color: asStr,
  },
  signature: {
    signatureHeight: asInt,
    sealHeight: asInt,
  },
  footerSetting: {
    showSignatory: asBool,
    showDate: asBool,
    showSeal: asBool,
    signatoryPosition: asInt,
    datePosition: asInt,
    sealPosition: asInt,
  },
};

/** Page margins are a nested object inside pageSettings, so they are unpacked
 *  separately rather than bending the flat SPEC reader out of shape. */
const marginsFrom = (body) => {
  const nested = body.pageSettings?.margins || {};
  const out = {};
  for (const side of ["top", "bottom", "left", "right"]) {
    const raw =
      body[`pageSettings[margins][${side}]`] !== undefined
        ? body[`pageSettings[margins][${side}]`]
        : nested[side];
    if (raw === undefined || raw === "") continue;
    const value = parseInt(raw, 10);
    if (Number.isFinite(value)) out[side] = Math.max(0, Math.min(100, value));
  }
  return out;
};

/** Typography is two levels deep, so it is unpacked on its own. */
const typographyFrom = (body) => {
  const nested = body.typography && typeof body.typography === "object" ? body.typography : {};
  const pick = (group) => {
    const source = nested[group] || {};
    const out = {};
    for (const key of [
      "family",
      "size",
      "weight",
      "color",
      "style",
      "align",
      "letterSpacing",
    ]) {
      const raw =
        body[`typography[${group}][${key}]`] !== undefined
          ? body[`typography[${group}][${key}]`]
          : source[key];
      if (raw !== undefined && raw !== "") out[key] = String(raw);
    }
    return out;
  };
  return {
    headerData: pick("headerData"),
    headerDescription: pick("headerDescription"),
    footerData: pick("footerData"),
  };
};

/** The five uploadable assets, and where each lands on the document. */
const ASSETS = [
  { field: "leftLogo", kind: "logos", path: ["logoSettings", "leftLogoUrl"] },
  { field: "rightLogo", kind: "logos", path: ["logoSettings", "rightLogoUrl"] },
  { field: "signature", kind: "signatures", path: ["signature", "signatureUrl"] },
  { field: "seal", kind: "seals", path: ["signature", "sealUrl"] },
  { field: "watermark", kind: "watermarks", path: ["watermarkSettings", "watermarkUrl"] },
];

/**
 * Which stored images this request asks to CLEAR, as `removeAssets`.
 *
 * Uploading a replacement was previously the only way to change an image,
 * which left no way to say "no logo at all". A removal is applied before the
 * uploads below, so remove-and-replace in one request still ends up with the
 * new file rather than nothing.
 */
const removalsFrom = (body) => {
  const raw = body.removeAssets;
  if (!raw) return [];
  const wanted = String(raw)
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return ASSETS.filter((asset) => wanted.includes(asset.field));
};

const collectAssetUrls = (doc) =>
  ASSETS.map(({ path }) => (doc?.[path[0]] || {})[path[1]]).filter(Boolean);

/** Normalises the incoming clientId: "", "null" and "common" all mean COMMON. */
const parseClientId = (raw) => {
  const value = String(raw ?? "").trim();
  if (!value || value === "null" || value === "common") return { ok: true, clientId: null };
  if (!isValidId(value)) return { ok: false };
  return { ok: true, clientId: toObjectId(value) };
};

const CANVAS_KINDS = ["text", "image", "line", "signature", "body"];
const CANVAS_BINDS = ["", "headerTitle", "headerDescription", "leftLogo", "rightLogo", "watermark", "signature", "seal", "date", "footerText"];
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

const clampNum = (value, min, max, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

/** Drag-and-drop layout sent as one JSON field. undefined = not sent; null = unreadable
 *  (usually truncated by the 1 MB multipart field limit). */
const canvasFrom = (body) => {
  let raw = body.canvasElements;
  if (raw === undefined) return undefined;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw || "[]");
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw)) return null;
  return raw
    .filter((el) => el && CANVAS_KINDS.includes(el.kind) && typeof el.id === "string")
    .slice(0, 80)
    .map((el) => ({
      id: el.id.slice(0, 60),
      kind: el.kind,
      bind: CANVAS_BINDS.includes(el.bind) ? el.bind : "",
      x: clampNum(el.x, -20, 120, 0),
      y: clampNum(el.y, -20, 120, 0),
      w: clampNum(el.w, 0.1, 100, 10),
      h: clampNum(el.h, 0.1, 100, 5),
      text: String(el.text ?? "").slice(0, 2000),
      fontSize: clampNum(el.fontSize, 4, 400, 12),
      bold: el.bold === true,
      italic: el.italic === true,
      align: ["left", "center", "right"].includes(el.align) ? el.align : "left",
      color: HEX_COLOR.test(el.color) ? el.color : "#111827",
      opacity: clampNum(el.opacity, 0, 1, 1),
      rotation: clampNum(el.rotation, -180, 180, 0),
      dataUrl:
        typeof el.dataUrl === "string" && el.dataUrl.length <= 700000 && DATA_IMAGE.test(el.dataUrl)
          ? el.dataUrl
          : "",
    }));
};

const CANVAS_UNREADABLE = "The layout could not be read — remove large images from the design and try again.";

// ── CREATE ───────────────────────────────────────────────────────────────────

exports.createPrintSetting = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    if (!institution) return fail(res, 400, "User institution not found");

    const { title, description } = req.body;
    if (!title) return fail(res, 400, "Title is required");

    const parsed = parseClientId(req.body.clientId);
    if (!parsed.ok) return fail(res, 400, "Invalid client");

    // One layout per scope. Without this an institution accumulates several
    // rows for the same client and "which one prints?" becomes a coin toss —
    // the resolver would have to invent a tie-break the admin never chose.
    const clash = await PrintSetting.findOne({ institution, clientId: parsed.clientId });
    if (clash) {
      return fail(
        res,
        409,
        parsed.clientId
          ? "This client already has a print setting. Edit that one instead."
          : "A common print setting already exists. Edit it instead."
      );
    }

    const canvasElements = canvasFrom(req.body);
    if (canvasElements === null) return fail(res, 400, CANVAS_UNREADABLE);

    const doc = {
      institution,
      clientId: parsed.clientId,
      canvasElements: canvasElements || [],
      title,
      description,
      status: req.body.status === "inactive" ? "inactive" : "active",
      headerData: section(req.body, "headerData", SPEC.headerData),
      footerData: section(req.body, "footerData", SPEC.footerData),
      pageSettings: {
        ...section(req.body, "pageSettings", SPEC.pageSettings),
        ...(Object.keys(marginsFrom(req.body)).length
          ? { margins: marginsFrom(req.body) }
          : {}),
      },
      logoSettings: section(req.body, "logoSettings", SPEC.logoSettings),
      watermarkSettings: section(req.body, "watermarkSettings", SPEC.watermarkSettings),
      footerSetting: section(req.body, "footerSetting", SPEC.footerSetting),
      typography: typographyFrom(req.body),
      signature: {},
    };

    for (const asset of ASSETS) {
      const file = req.files?.[asset.field];
      if (!file) continue;
      doc[asset.path[0]] = doc[asset.path[0]] || {};
      // eslint-disable-next-line no-await-in-loop
      doc[asset.path[0]][asset.path[1]] = await uploadPrintAsset(file, asset.kind);
    }

    const saved = await PrintSetting.create(doc);
    return res.status(201).json({
      message: [{ key: "success", value: "Print setting created" }],
      printSetting: saved,
    });
  } catch (error) {
    console.error("createPrintSetting error:", error);
    return fail(res, 500, error.message || "Could not create the print setting");
  }
};

// ── LIST ─────────────────────────────────────────────────────────────────────

exports.getPrintSettings = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    if (!institution) return fail(res, 400, "User institution not found");

    const settings = await PrintSetting.find({ institution })
      .populate("clientId", "clientCompany status")
      // Common first, then clients alphabetically — the common layout is the
      // fallback for everything else, so it reads as the parent of the list.
      .sort({ clientId: 1, updatedAt: -1 })
      .lean();

    return ok(res, "Print settings retrieved", { printSettings: settings });
  } catch (error) {
    console.error("getPrintSettings error:", error);
    return fail(res, 500, "Could not load print settings");
  }
};

// ── GET ONE ──────────────────────────────────────────────────────────────────

exports.getPrintSettingById = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    if (!institution) return fail(res, 400, "User institution not found");
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid print setting id");

    const setting = await PrintSetting.findOne({
      _id: toObjectId(req.params.id),
      institution,
    }).populate("clientId", "clientCompany status");

    if (!setting) return fail(res, 404, "Print setting not found");
    return ok(res, "Print setting retrieved", { printSetting: setting });
  } catch (error) {
    console.error("getPrintSettingById error:", error);
    return fail(res, 500, "Could not load the print setting");
  }
};

// ── RESOLVE (what a printing page actually calls) ────────────────────────────

/**
 * GET /print-setting/resolve?clientId=<id>
 *
 * The client's own layout if it has one, otherwise the institution's common
 * layout, otherwise null. This is the ONE place the fallback rule lives, so a
 * page that prints never has to implement it (and never gets it subtly wrong).
 */
exports.resolvePrintSetting = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    if (!institution) return fail(res, 400, "User institution not found");

    const parsed = parseClientId(req.query.clientId);
    if (!parsed.ok) return fail(res, 400, "Invalid client");

    let setting = null;
    let source = "none";

    if (parsed.clientId) {
      setting = await PrintSetting.findOne({
        institution,
        clientId: parsed.clientId,
        status: "active",
      }).lean();
      if (setting) source = "client";
    }

    if (!setting) {
      setting = await PrintSetting.findOne({
        institution,
        clientId: null,
        status: "active",
      }).lean();
      if (setting) source = "common";
    }

    return ok(res, "Print setting resolved", { printSetting: setting, source });
  } catch (error) {
    console.error("resolvePrintSetting error:", error);
    return fail(res, 500, "Could not resolve a print setting");
  }
};

// ── UPDATE ───────────────────────────────────────────────────────────────────

exports.updatePrintSetting = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    if (!institution) return fail(res, 400, "User institution not found");
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid print setting id");

    const setting = await PrintSetting.findOne({
      _id: toObjectId(req.params.id),
      institution,
    });
    if (!setting) return fail(res, 404, "Print setting not found");

    if (req.body.clientId !== undefined) {
      const parsed = parseClientId(req.body.clientId);
      if (!parsed.ok) return fail(res, 400, "Invalid client");
      const moved = String(parsed.clientId || "") !== String(setting.clientId || "");
      if (moved) {
        const clash = await PrintSetting.findOne({
          institution,
          clientId: parsed.clientId,
          _id: { $ne: setting._id },
        });
        if (clash) {
          return fail(
            res,
            409,
            parsed.clientId
              ? "This client already has a print setting."
              : "A common print setting already exists."
          );
        }
        setting.clientId = parsed.clientId;
      }
    }

    if (req.body.title !== undefined) setting.title = req.body.title;
    if (req.body.description !== undefined) setting.description = req.body.description;
    if (req.body.status !== undefined) {
      setting.status = req.body.status === "inactive" ? "inactive" : "active";
    }

    for (const [name, spec] of Object.entries(SPEC)) {
      const patch = section(req.body, name, spec);
      if (Object.keys(patch).length) {
        setting[name] = { ...(setting[name] ? setting[name].toObject?.() ?? setting[name] : {}), ...patch };
      }
    }

    const margins = marginsFrom(req.body);
    if (Object.keys(margins).length) {
      const current = setting.pageSettings?.margins;
      setting.pageSettings = setting.pageSettings || {};
      setting.pageSettings.margins = {
        ...(current?.toObject?.() ?? current ?? {}),
        ...margins,
      };
    }

    const canvasElements = canvasFrom(req.body);
    if (canvasElements === null) return fail(res, 400, CANVAS_UNREADABLE);
    if (canvasElements !== undefined) setting.canvasElements = canvasElements;

    const typography = typographyFrom(req.body);
    for (const group of ["headerData", "headerDescription", "footerData"]) {
      if (Object.keys(typography[group]).length) {
        const current = setting.typography?.[group];
        setting.typography = setting.typography || {};
        setting.typography[group] = {
          ...(current?.toObject?.() ?? current ?? {}),
          ...typography[group],
        };
      }
    }

    // Explicit removals first, so a request that both clears and re-uploads
    // the same slot ends with the upload.
    for (const asset of removalsFrom(req.body)) {
      const previous = (setting[asset.path[0]] || {})[asset.path[1]];
      if (!previous) continue;
      setting[asset.path[0]] = setting[asset.path[0]] || {};
      setting[asset.path[0]][asset.path[1]] = "";
      // eslint-disable-next-line no-await-in-loop
      await deletePrintAsset(previous);
    }

    // New file replaces the old one, and the old one is binned only AFTER the
    // replacement exists — the same order as the profile-image path, for the
    // same reason: a failed upload must not leave the layout with no logo.
    for (const asset of ASSETS) {
      const file = req.files?.[asset.field];
      if (!file) continue;
      // eslint-disable-next-line no-await-in-loop
      const url = await uploadPrintAsset(file, asset.kind);
      const previous = (setting[asset.path[0]] || {})[asset.path[1]];
      setting[asset.path[0]] = setting[asset.path[0]] || {};
      setting[asset.path[0]][asset.path[1]] = url;
      // eslint-disable-next-line no-await-in-loop
      if (previous) await deletePrintAsset(previous);
    }

    await setting.save();
    return ok(res, "Print setting updated", { printSetting: setting });
  } catch (error) {
    console.error("updatePrintSetting error:", error);
    return fail(res, 500, error.message || "Could not update the print setting");
  }
};

// ── DELETE ───────────────────────────────────────────────────────────────────

exports.deletePrintSetting = async (req, res) => {
  try {
    const institution = requireInstitution(req);
    if (!institution) return fail(res, 400, "User institution not found");
    if (!isValidId(req.params.id)) return fail(res, 400, "Invalid print setting id");

    const setting = await PrintSetting.findOne({
      _id: toObjectId(req.params.id),
      institution,
    }).lean();
    if (!setting) return fail(res, 404, "Print setting not found");

    // Best-effort asset cleanup: a stranded logo is wasted bytes, not a reason
    // to refuse the delete.
    for (const url of collectAssetUrls(setting)) {
      // eslint-disable-next-line no-await-in-loop
      await deletePrintAsset(url);
    }

    await PrintSetting.deleteOne({ _id: setting._id });
    return ok(res, "Print setting deleted");
  } catch (error) {
    console.error("deletePrintSetting error:", error);
    return fail(res, 500, "Could not delete the print setting");
  }
};
