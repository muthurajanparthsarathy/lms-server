const express = require("express");
const { userAuth } = require("../../middlewares/userAuth");
const {
  createPrintSetting,
  getPrintSettings,
  getPrintSettingById,
  resolvePrintSetting,
  updatePrintSetting,
  deletePrintSetting,
} = require("../../controllers/dynamicContent/printSetting");
const router = express.Router();

// userAuth on EVERY route, including getAll — it previously had none, and the
// controller had no institution filter either, so an unauthenticated caller
// could read every tenant's letterhead, logos and signature URLs.
router.post("/print-setting/create", userAuth, createPrintSetting);

router.get("/print-setting/getAll", userAuth, getPrintSettings);

// Declared BEFORE /getById/:id would be reachable by the same shape; kept
// explicit rather than parameterised so "resolve" can never be read as an id.
router.get("/print-setting/resolve", userAuth, resolvePrintSetting);

router.get("/print-setting/getById/:id", userAuth, getPrintSettingById);

router.put("/print-setting/update/:id", userAuth, updatePrintSetting);

router.delete("/print-setting/delete/:id", userAuth, deletePrintSetting);

module.exports = router;
