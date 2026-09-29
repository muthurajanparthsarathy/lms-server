// utils/profileImageStorage.js
//
// Profile pictures live in CLOUDINARY. This module is the only place that
// knows that, so the controllers just say "upload this" / "delete that".
//
// Why it moved off Supabase: the free Supabase storage bucket was running out
// of room, and the bucket had also started refusing TLS connections outright
// ("Client network socket disconnected before secure TLS connection was
// established"), which made AddUser fail for a reason that had nothing to do
// with adding a user.
//
// Two behaviours are deliberately different from the Supabase implementation:
//
//   1. The DEFAULT avatar is ONE shared asset, not a per-user copy. The old
//      code ran a storage `.copy()` on every signup to make
//      default_profile_image_<timestamp>.jpg — a fresh duplicate of the same
//      bytes for every user, and a network round trip that could (and did)
//      fail the whole request. Now a user with no picture just stores the one
//      default URL. Nothing is copied and no network call happens at all.
//
//   2. Deleting is best-effort and never fails the request. A profile picture
//      that outlives its user is litter; a 500 that stops an admin deleting a
//      user because a CDN was briefly unreachable is an outage.
//
// The default URL still contains the string "default_profile_image", because
// the controllers use `profile.includes("default_profile_image")` to decide
// whether an old picture is safe to delete. Renaming it would make every user
// sharing the default delete it out from under the others.

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = "lms/users/profile";
const DEFAULT_PUBLIC_ID = `${FOLDER}/default_profile_image`;

/** Anything larger is a photo nobody needs for a 96px avatar. */
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = /^image\/(jpe?g|png|webp|gif|avif)$/i;

/**
 * A neutral placeholder avatar, inlined so the app has no asset to ship and
 * no file to lose. Uploaded to Cloudinary once, on first use (see
 * ensureDefaultProfileImage), then served from the CDN like any other picture.
 */
const DEFAULT_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#e5e7eb"/>
  <circle cx="256" cy="200" r="82" fill="#9ca3af"/>
  <path d="M256 310c-84 0-152 54-152 121v81h304v-81c0-67-68-121-152-121z" fill="#9ca3af"/>
</svg>`;

const svgDataUri = () =>
  `data:image/svg+xml;base64,${Buffer.from(DEFAULT_AVATAR_SVG).toString("base64")}`;

/**
 * Resolved once per process. The first caller may upload the placeholder; every
 * later caller gets the memoised URL without touching the network — which is
 * the entire point of moving off the per-user `.copy()`.
 */
let defaultUrlPromise = null;

async function ensureDefaultProfileImage() {
  // An explicit override wins, so an institution can point at its own artwork
  // without redeploying.
  if (process.env.DEFAULT_PROFILE_IMAGE_URL) {
    return process.env.DEFAULT_PROFILE_IMAGE_URL;
  }

  try {
    const uploaded = await cloudinary.uploader.upload(svgDataUri(), {
      public_id: DEFAULT_PUBLIC_ID,
      resource_type: "image",
      format: "png",
      // Re-uploading the same public_id is how this stays idempotent: the
      // first process to get here creates it, everyone after overwrites it
      // with identical bytes. No existence check, so no extra round trip.
      overwrite: true,
      invalidate: false,
    });
    return uploaded.secure_url;
  } catch (error) {
    console.error("Profile storage: could not seed default avatar:", error.message);
    // Deterministic delivery URL. If the asset does exist (a previous process
    // seeded it) this still works; if it does not, the caller gets a URL that
    // 404s rather than a failed signup.
    return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/${DEFAULT_PUBLIC_ID}.png`;
  }
}

/** The shared default avatar URL. Cached for the life of the process. */
function getDefaultProfileImageUrl() {
  if (!defaultUrlPromise) {
    defaultUrlPromise = ensureDefaultProfileImage().catch((error) => {
      // Never cache a rejection — a transient failure would otherwise poison
      // every signup until the server restarts.
      defaultUrlPromise = null;
      throw error;
    });
  }
  return defaultUrlPromise;
}

/**
 * Upload one express-fileupload file (`req.files.profile`) and return its
 * secure URL.
 *
 * Throws a plain Error with a user-safe `message` on a rejected file, so the
 * caller can surface it as a 400 rather than a generic 500.
 */
async function uploadProfileImage(imageFile) {
  if (!imageFile || !imageFile.data) {
    throw new Error("No image file was provided");
  }
  if (imageFile.mimetype && !ALLOWED_MIME.test(imageFile.mimetype)) {
    throw new Error("Profile picture must be a JPEG, PNG, WebP, GIF or AVIF image");
  }
  if (imageFile.size > MAX_BYTES) {
    throw new Error("Profile picture must be 5 MB or smaller");
  }

  const result = await cloudinary.uploader.upload(
    `data:${imageFile.mimetype || "image/jpeg"};base64,${imageFile.data.toString("base64")}`,
    {
      folder: FOLDER,
      resource_type: "image",
      // Avatars are only ever shown small; storing the original megapixels
      // burns the free plan's quota for pixels nothing renders.
      transformation: [
        { width: 512, height: 512, crop: "limit" },
        { quality: "auto:good" },
        { fetch_format: "auto" },
      ],
    }
  );

  return result.secure_url;
}

/**
 * The Cloudinary public_id inside a delivery URL, or null when the URL is not
 * a Cloudinary one (every user created before this change still holds a
 * Supabase URL, and those must be skipped rather than blowing up).
 *
 *   https://res.cloudinary.com/<cloud>/image/upload/v173.../lms/users/profile/abc.png
 *     -> lms/users/profile/abc
 */
function publicIdFromUrl(url) {
  if (typeof url !== "string" || !url.includes("res.cloudinary.com")) return null;

  const marker = "/upload/";
  const start = url.indexOf(marker);
  if (start === -1) return null;

  const path = url.slice(start + marker.length).split("?")[0];

  // Everything between /upload/ and the public_id is some mix of transformation
  // segments and an optional version, in either order
  // (".../upload/w_512,h_512/v173.../id" and ".../upload/v173.../id" both
  // occur). So drop leading segments while they look like one of those, rather
  // than assuming a fixed order — stripping the version first leaves the
  // version behind whenever a transformation precedes it.
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
 * Best-effort delete. Never throws and never rejects: a picture that could not
 * be removed is leftover bytes, not a reason to fail the user's request.
 *
 * Refuses to delete the shared default, which every picture-less user points at.
 */
async function deleteProfileImage(profileUrl) {
  if (!profileUrl || profileUrl.includes("default_profile_image")) return false;

  const publicId = publicIdFromUrl(profileUrl);
  if (!publicId) {
    // A pre-migration Supabase URL. Nothing to do here — the Supabase bucket
    // is being retired, and failing the caller over it would be worse.
    return false;
  }

  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    return true;
  } catch (error) {
    console.warn("Profile storage: could not delete", publicId, "-", error.message);
    return false;
  }
}

module.exports = {
  uploadProfileImage,
  deleteProfileImage,
  getDefaultProfileImageUrl,
  publicIdFromUrl,
  PROFILE_FOLDER: FOLDER,
};
