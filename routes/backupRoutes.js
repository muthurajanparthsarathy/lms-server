// routes/backupRoutes.js
//
// Mounted in server.js as `app.use("/", backupRoutes)`, so every path here is
// ABSOLUTE and starts with /backup — and the router-level middleware is bound to
// the "/backup" PREFIX, never pathless (a pathless router.use on a router
// mounted at "/" would run for every request in the whole app).

const express = require("express");
const router = express.Router();

const Role = require("../models/RoleModel");
const { userAuth } = require("../middlewares/userAuth");
const {
  getBackupTargets,
  previewBackup,
  createBackup,
  listBackups,
  getBackup,
  downloadBackup,
  restoreBackup,
  deleteBackup,
  getBackupSchedule,
  updateBackupSchedule,
} = require("../controllers/backupController");

// utils/superAdminPermissions.js is the shared matcher for super-admin-style
// role names ("Super Administrator", "superadmin", …). Loaded defensively so a
// missing export can never take the whole router down.
let isSuperAdminRoleName;
try {
  // eslint-disable-next-line global-require
  ({ isSuperAdminRoleName } = require("../utils/superAdminPermissions"));
} catch (err) {
  isSuperAdminRoleName = null;
}
if (typeof isSuperAdminRoleName !== "function") {
  isSuperAdminRoleName = (name) =>
    String(name || "").toLowerCase().replace(/[\s_-]+/g, "").includes("superadmin");
}

// Same normalisation middlewares/userRole.js uses, so "Super Admin",
// "super_admin" and "superadmin" all compare equal.
const normalizeRoleName = (name) =>
  String(name || "").toLowerCase().replace(/[\s_-]+/g, "_");

const ALLOWED_ROLES = ["admin", "super_admin"].map(normalizeRoleName);

/**
 * Admin guard for the Backup module.
 *
 * This is middlewares/userRole.js's logic, not a re-invention: userAuth attaches
 * an UNPOPULATED user, so req.user.role is an ObjectId and a string compare
 * against it silently fails — the Role document has to be loaded and matched on
 * roleValue / renameRole / originalRole. userRole(["admin", "super_admin"])
 * would resolve the role identically, but it denies with the legacy shape
 * `{ message: [{ key: "error", value: "Access denied" }] }`, and this module's
 * API contract is frozen on `{ success: false, message: "<string>" }` for every
 * error including 403. So the resolution is copied and only the envelope differs.
 */
const requireBackupAdmin = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || !user.role) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Backups are restricted to administrators.",
      });
    }

    // Support both a populated role object and a raw ObjectId.
    const roleDoc =
      user.role.roleValue || user.role.originalRole
        ? user.role
        : await Role.findById(user.role)
            .select("originalRole renameRole roleValue")
            .lean();

    if (!roleDoc) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Backups are restricted to administrators.",
      });
    }

    const rawNames = [roleDoc.roleValue, roleDoc.renameRole, roleDoc.originalRole].filter(
      Boolean
    );
    const isSuperAdmin = rawNames.some(isSuperAdminRoleName);
    const isAllowed =
      rawNames.map(normalizeRoleName).some((name) => ALLOWED_ROLES.includes(name)) || isSuperAdmin;

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Backups are restricted to administrators.",
      });
    }

    // Consulted by requireBackupFunction below: a super admin holds every
    // function implicitly (matching every other admin surface in this app),
    // an ordinary admin only holds what Assign Permission actually granted.
    req.isBackupSuperAdmin = isSuperAdmin;
    return next();
  } catch (error) {
    console.error("Backup requireBackupAdmin error:", error);
    return res.status(500).json({ success: false, message: "Could not verify your role" });
  }
};

/**
 * Per-function gate matching the four functions the permission tree defines
 * under admin-backup ("Create Backup", "Restore Backup", "Download Backup",
 * "Delete Backup" — client/src/app/lms/pages/usermanagement/config/
 * permissions.tree.ts). requireBackupAdmin above only proves the caller is
 * SOME admin; the UI additionally gates each action on the caller's stored
 * permissions (client/src/app/lms/pages/backup/features/BackupPage.tsx), and
 * that finer check was UI-only — nothing stopped an admin who was denied
 * "Delete Backup" from firing the request directly. This is the same check,
 * enforced server-side against the same field the UI reads it from.
 */
const requireBackupFunction = (fnLabel) => (req, res, next) => {
  if (req.isBackupSuperAdmin) return next();

  const perms = Array.isArray(req.user && req.user.permissions) ? req.user.permissions : [];
  const node = perms.find((p) => String(p.permissionKey || "").toLowerCase() === "backup");
  const fns = Array.isArray(node && node.permissionFunctionality)
    ? node.permissionFunctionality
    : [];
  const hasFunction = fns.some((fn) => String(fn).toLowerCase() === fnLabel.toLowerCase());

  if (!node || !hasFunction) {
    return res.status(403).json({
      success: false,
      message: `Access denied. You do not have the "${fnLabel}" backup permission.`,
    });
  }
  return next();
};

router.use("/backup", userAuth, requireBackupAdmin);

// Literal paths are registered BEFORE /backup/:id so "targets" and "list" are
// never swallowed by the id parameter.
//
// targets/list/preview/get carry no function guard: they are read-only and
// already institution-scoped by requireBackupAdmin + findOwnedBackup — any
// admin holding the base admin-backup grant can see what backups exist, the
// same way Audit Logs has no separate "view" permission. create/download/
// restore/delete are exactly the four functions the tree defines, so each
// gets its matching guard.
router.get("/backup/targets", getBackupTargets);
// The schedule is configuration, not a backup: reading it needs only the base
// admin grant, saving it is gated on "Create Backup" because enabling a
// schedule is how backups get created from then on.
router.get("/backup/schedule", getBackupSchedule);
router.put("/backup/schedule", requireBackupFunction("Create Backup"), updateBackupSchedule);
router.get("/backup/list", listBackups);
router.post("/backup/preview", previewBackup);
router.post("/backup/create", requireBackupFunction("Create Backup"), createBackup);

router.get("/backup/:id/download", requireBackupFunction("Download Backup"), downloadBackup);
router.post("/backup/:id/restore", requireBackupFunction("Restore Backup"), restoreBackup);
router.get("/backup/:id", getBackup);
router.delete("/backup/:id", requireBackupFunction("Delete Backup"), deleteBackup);

module.exports = router;
