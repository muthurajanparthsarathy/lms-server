// Object storage, on Cloudinary.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS LOOKS LIKE THE SUPABASE CLIENT
//
// Uploads used to go to Supabase Storage, called as
// `supabase.storage.from("smartlms").upload(path, data, { contentType })` from
// about thirty places across eight controllers. This module exposes that exact
// shape — `.storage.from(bucket).upload/remove/getPublicUrl/copy`, each
// returning `{ data, error }` and never throwing — so those call sites moved to
// Cloudinary by swapping which module they require, and nothing else.
//
// That is deliberate: rewriting thirty call sites by hand to a new API is
// thirty chances to get an error check or an await wrong, in code paths that
// only run when somebody uploads a file. The shape is the seam; behind it,
// nothing Supabase remains.
//
// ─────────────────────────────────────────────────────────────────────────────
// PATHS AND URLs
//
// Callers still speak in storage PATHS ("courses/modules/…/file.pdf"), and
// several build the public URL from the path alone, with no upload in hand.
// So a path has to map to a URL deterministically, both ways:
//
//   path  →  public_id  →  https://res.cloudinary.com/<cloud>/<type>/upload/…
//   url   →  public_id  →  path            (needed to delete by stored URL)
//
// Cloudinary treats the extension differently per resource type — `raw` keeps
// it inside the public_id, `image` and `video` split it off into the format —
// so the two cases are handled explicitly below rather than hoped over.
//
// ─────────────────────────────────────────────────────────────────────────────
// FILES UPLOADED BEFORE THIS CHANGE
//
// They are still in Supabase, and the URLs stored against them in Mongo still
// point there — reading one is a plain GET of a URL, so they keep working for
// as long as that project serves them. What this module does NOT do is delete
// them: `remove()` deletes from Cloudinary only. A legacy object therefore
// lingers rather than being cleaned up. That is the deliberate trade — the
// alternative is every delete making a blocking call to a service this
// deployment can no longer reach, which is the failure that prompted the move.
// `isLegacySupabaseUrl()` is exported so a caller can tell the two apart.

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  // Off, or the SDK appends a `?_a=…` telemetry token to every URL it builds.
  // These URLs are PERSISTED in Mongo and compared as strings elsewhere, so a
  // tracking parameter riding along would be stored forever and would make two
  // URLs for the same file compare unequal.
  analytics: false,
});

// Everything lands under one folder, the way everything used to land in one
// bucket. Keeping the old bucket name means the stored paths are unchanged.
const ROOT = (process.env.CLOUDINARY_FOLDER || "smartlms").replace(/^\/+|\/+$/g, "");

// How a Supabase public URL was spelled, so a stored one can still be read.
const SUPABASE_PUBLIC_MARKER = "/storage/v1/object/public/";

// ── Path handling ────────────────────────────────────────────────────────────

// Cloudinary public_ids tolerate far less than a filesystem does, and an
// uploaded file's name is whatever the user called it — spaces, brackets,
// accents, the lot. Sanitising in ONE place is what keeps upload and URL
// derivation agreeing: both go through here, so they cannot disagree about
// where a file lives. Slashes survive, because they are the folder structure.
const sanitizePath = (path) =>
  String(path || "")
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]+/g, "_"))
    .filter(Boolean)
    .join("/");

const extensionOf = (path) => {
  const last = String(path || "").split("/").pop() || "";
  const dot = last.lastIndexOf(".");
  // `dot > 0` so a dotfile ("…/.gitkeep") is a name, not an extension.
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : "";
};

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "avif", "tiff"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v", "ogv", "mp3", "wav", "m4a", "aac", "ogg"]);

/** Which of Cloudinary's three asset types a file is.
 *
 *  Audio rides under `video`, which is Cloudinary's own grouping, not a slip.
 *  Everything else — PDF, PPTX, ZIP, JSON — is `raw`, and raw is also the
 *  fallback when the extension says nothing, because raw is the type that
 *  stores bytes back exactly as they arrived. */
const resourceTypeFor = (path, contentType = "") => {
  const ext = extensionOf(path);
  if (IMAGE_EXT.has(ext)) return "image";
  if (VIDEO_EXT.has(ext)) return "video";
  if (ext) return "raw";
  const mime = String(contentType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return "video";
  return "raw";
};

/** path → { publicId, resourceType, format }.
 *
 *  `raw` keeps the extension inside the public_id; `image` and `video` must
 *  not, or Cloudinary serves them back as "name.png.png". */
const locate = (path, contentType = "") => {
  const clean = sanitizePath(path);
  const resourceType = resourceTypeFor(clean, contentType);
  const withRoot = ROOT ? `${ROOT}/${clean}` : clean;
  if (resourceType === "raw") {
    return { publicId: withRoot, resourceType, format: "" };
  }
  const format = extensionOf(clean);
  const publicId = format ? withRoot.slice(0, -(format.length + 1)) : withRoot;
  return { publicId, resourceType, format };
};

/** The public URL a path resolves to — no upload needed, no version segment.
 *
 *  Version-less URLs are stable as long as uploads overwrite in place, which
 *  they do below. A versioned URL would be pinned to one upload and would go
 *  stale the moment a file was replaced. */
const publicUrlFor = (path, contentType = "") => {
  const { publicId, resourceType, format } = locate(path, contentType);
  return cloudinary.url(publicId, {
    resource_type: resourceType,
    secure: true,
    // No `/v1/` segment. The SDK inserts one by default for a public_id that
    // contains slashes, and a version that is not the asset's real one can be
    // refused outright once strict versioning is enabled on the account. The
    // version-less form always resolves to the current asset, which is what a
    // URL derived from a path is supposed to mean.
    force_version: false,
    ...(format ? { format } : {}),
  });
};

/** True for a URL this deployment stores a file at — Cloudinary now, Supabase
 *  for anything uploaded before the move.
 *
 *  Used as an SSRF guard by the handlers that fetch a stored file server-side:
 *  they must download OUR files and nothing else, so a bare "starts with the
 *  storage base URL" test is the check, and it has to know both bases or every
 *  newly uploaded file starts failing it. Tied to the configured cloud name, so
 *  another tenant's Cloudinary URL is not ours either. */
const isManagedUrl = (url) => {
  const value = String(url || "");
  if (!value) return false;
  if (isLegacySupabaseUrl(value)) return true;
  const cloud = process.env.CLOUDINARY_CLOUD_NAME || "";
  return Boolean(cloud) && value.startsWith(`https://res.cloudinary.com/${cloud}/`);
};

/** True for a URL written before this migration, still served by Supabase. */
const isLegacySupabaseUrl = (url) =>
  typeof url === "string" && url.includes(SUPABASE_PUBLIC_MARKER);

/** url → the storage path it was uploaded under, or "" if it is not ours.
 *
 *  Understands BOTH spellings: a Cloudinary URL written since the migration,
 *  and a Supabase one written before it. Callers that delete by stored URL hold
 *  a mix of the two for as long as pre-migration files exist, so a parser that
 *  knew only the new shape would silently stop recognising half the estate. */
const storagePathFromUrl = (url) => {
  const value = String(url || "");
  if (!value) return "";

  if (isLegacySupabaseUrl(value)) {
    // ".../public/<bucket>/<path>" — drop the bucket segment too.
    const tail = value.split(SUPABASE_PUBLIC_MARKER)[1] || "";
    const slash = tail.indexOf("/");
    return slash >= 0 ? tail.slice(slash + 1) : "";
  }

  const match = value.match(/\/(?:image|video|raw)\/upload\/(.+)$/);
  if (!match) return "";
  const withoutVersion = match[1]
    .replace(/^(?:[a-z_]+_[^/]+\/)*/, "") // any transformation segments
    .replace(/^v\d+\//, "");
  const decoded = decodeURIComponent(withoutVersion.split("?")[0]);
  return ROOT && decoded.startsWith(`${ROOT}/`) ? decoded.slice(ROOT.length + 1) : decoded;
};

// ── The Supabase-shaped surface ──────────────────────────────────────────────

const uploadBuffer = (buffer, { publicId, resourceType }) =>
  new Promise((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        public_id: publicId,
        resource_type: resourceType,
        // Always replace. Supabase refused an upload onto an existing object
        // unless the caller passed `upsert`, and most callers did not because
        // they mint a unique name anyway — so overwriting can only turn a
        // spurious "already exists" into the write the caller intended.
        overwrite: true,
        invalidate: true,
        // The public_id IS the path; never let Cloudinary add its own suffix
        // or re-derive a name from the file, or the URL stops being derivable.
        use_filename: false,
        unique_filename: false,
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    upload.end(buffer);
  });

const asBuffer = (data) => {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === "string") return Buffer.from(data);
  if (data && typeof data === "object" && data.data) return asBuffer(data.data);
  return Buffer.from(data);
};

const bucketApi = () => ({
  /** `.upload(path, data, { contentType })`, Supabase's signature.
   *  Resolves `{ data, error }` — never rejects, because every call site tests
   *  `error` rather than catching. */
  async upload(path, data, options = {}) {
    try {
      const target = locate(path, options.contentType);
      const result = await uploadBuffer(asBuffer(data), target);
      return {
        data: {
          path: sanitizePath(path),
          publicId: target.publicId,
          // Handed back so a caller can store the exact URL Cloudinary served
          // rather than re-deriving it.
          publicUrl: result?.secure_url || publicUrlFor(path, options.contentType),
        },
        error: null,
      };
    } catch (error) {
      return { data: null, error: normalizeError(error) };
    }
  },

  /** `.remove([path, …])`. Cloudinary deletes one asset per call, and the type
   *  has to be named, so each path is resolved before it is destroyed. */
  async remove(paths) {
    const list = Array.isArray(paths) ? paths : [paths];
    try {
      const results = await Promise.all(
        list.filter(Boolean).map(async (path) => {
          const { publicId, resourceType } = locate(path);
          const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType,
            invalidate: true,
          });
          return { path: sanitizePath(path), result: result?.result };
        })
      );
      return { data: results, error: null };
    } catch (error) {
      return { data: null, error: normalizeError(error) };
    }
  },

  /** `.getPublicUrl(path)` → `{ data: { publicUrl } }`, Supabase's shape. */
  getPublicUrl(path) {
    return { data: { publicUrl: publicUrlFor(path) }, error: null };
  },

  /** `.copy(fromPath, toPath)`.
   *
   *  Cloudinary has no server-side copy, but it will fetch a URL and store the
   *  result — so the source's own public URL is handed back to it. That keeps
   *  the bytes on Cloudinary's side of the wire instead of pulling them down
   *  here only to push them straight back up. */
  async copy(fromPath, toPath) {
    try {
      const source = publicUrlFor(fromPath);
      const target = locate(toPath);
      const result = await cloudinary.uploader.upload(source, {
        public_id: target.publicId,
        resource_type: target.resourceType,
        overwrite: true,
        invalidate: true,
        use_filename: false,
        unique_filename: false,
      });
      return {
        data: { path: sanitizePath(toPath), publicUrl: result?.secure_url },
        error: null,
      };
    } catch (error) {
      return { data: null, error: normalizeError(error) };
    }
  },
});

// Call sites read `error.message`; Cloudinary's rejections are not always Error
// instances, so anything thrown is flattened to something with one.
const normalizeError = (error) => {
  if (!error) return new Error("Unknown storage error");
  if (error instanceof Error) return error;
  const message = error.message || error.error?.message || JSON.stringify(error);
  const wrapped = new Error(message);
  if (error.http_code) wrapped.statusCode = error.http_code;
  return wrapped;
};

module.exports = {
  // The seam: `storage.from(bucket)`. The bucket argument is accepted and
  // ignored — there is one root folder now — so the call sites keep reading
  // `.from("smartlms")` and need no edit.
  storage: { from: () => bucketApi() },
  publicUrlFor,
  storagePathFromUrl,
  isLegacySupabaseUrl,
  isManagedUrl,
  resourceTypeFor,
  sanitizePath,
  cloudinary,
};
