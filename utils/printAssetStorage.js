// utils/printAssetStorage.js
//
// Logos, signatures, seals and watermarks for print layouts live in CLOUDINARY.
//
// Same move, and the same reason, as utils/profileImageStorage.js: the Supabase
// bucket these used to go to ran out of space and started refusing TLS
// connections outright, so an upload failed for a reason that had nothing to do
// with the upload. Everything print-related now goes through here.

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = "lms/print-settings";

/** Logos and seals are line art at a few hundred pixels; 5 MB is generous. */
const MAX_BYTES = 5 * 1024 * 1024;

// SVG included on purpose: logos and seals are frequently supplied as vectors,
// and a vector stays crisp at print resolution where a 200px PNG does not.
const ALLOWED_MIME = /^image\/(jpe?g|png|webp|gif|avif|svg\+xml)$/i;

/** Sub-folder per asset kind, so the media library stays navigable. */
const KINDS = ["logos", "signatures", "seals", "watermarks"];

/**
 * Upload one express-fileupload file and return its secure URL.
 * Throws a plain Error with a user-safe message on a rejected file.
 */
async function uploadPrintAsset(file, kind = "logos") {
  if (!file || !file.data) throw new Error("No image file was provided");
  if (file.mimetype && !ALLOWED_MIME.test(file.mimetype)) {
    throw new Error("Print images must be JPEG, PNG, WebP, GIF, AVIF or SVG");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Print images must be 5 MB or smaller");
  }

  const folder = KINDS.includes(kind) ? kind : "logos";
  const result = await cloudinary.uploader.upload(
    `data:${file.mimetype || "image/png"};base64,${file.data.toString("base64")}`,
    {
      folder: `${FOLDER}/${folder}`,
      resource_type: "image",
      // Capped rather than resized: a watermark or seal is placed on a page at
      // print resolution, so downscaling to an avatar size would visibly
      // degrade it. quality:auto still trims the file.
      transformation: [{ width: 1600, height: 1600, crop: "limit" }, { quality: "auto:good" }],
    }
  );
  return result.secure_url;
}

/**
 * The Cloudinary public_id inside a delivery URL, or null when the URL is not
 * a Cloudinary one — every asset uploaded before this change is still a
 * Supabase URL and must be skipped rather than blowing up.
 */
function publicIdFromUrl(url) {
  if (typeof url !== "string" || !url.includes("res.cloudinary.com")) return null;
  const marker = "/upload/";
  const start = url.indexOf(marker);
  if (start === -1) return null;

  const path = url.slice(start + marker.length).split("?")[0];
  const isVersion = (segment) => /^v\d+$/.test(segment);
  const isTransform = (segment) =>
    segment.includes(",") || /^[a-z]{1,3}_[^/]+$/i.test(segment);

  const segments = path.split("/");
  while (segments.length > 1 && (isVersion(segments[0]) || isTransform(segments[0]))) {
    segments.shift();
  }
  return segments.join("/").replace(/\.[a-z0-9]+$/i, "") || null;
}

/**
 * Best-effort delete. Never throws: an orphaned logo is wasted bytes, not a
 * reason to fail the admin's save or delete.
 */
async function deletePrintAsset(url) {
  const publicId = publicIdFromUrl(url);
  if (!publicId) return false;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    return true;
  } catch (error) {
    console.warn("Print storage: could not delete", publicId, "-", error.message);
    return false;
  }
}

module.exports = { uploadPrintAsset, deletePrintAsset, publicIdFromUrl, PRINT_FOLDER: FOLDER };
