const express = require("express");
const { userAuth } = require("../../middlewares/userAuth");
const {
  createCourseStructure,
  getCourseStructure,
  getCourseStructureById,
  updateCourseStructure,
  deleteCourseStructure,
  singleAddParticipants,
  deleteAddParticipants,
  deleteMultipleParticipants,
  updateParticipantEnrollment,
} = require("../../controllers/courses/courseStructure");
const router = express.Router();

router.post("/courses-structure/create", userAuth, createCourseStructure);

router.get("/courses-structure/getAll", userAuth, getCourseStructure);

router.get("/courses-structure/getById/:id", userAuth, getCourseStructureById);
router.put("/courses-structure/update/:courseId", userAuth, updateCourseStructure);
router.delete("/courses-structure/delete/:id", userAuth, deleteCourseStructure);

router.post("/add-participants/:courseId", userAuth, singleAddParticipants);
router.delete("/delete/participant/:courseId/:userId", userAuth, deleteAddParticipants);
router.delete("/delete-participants/multiple/:courseId", userAuth, deleteMultipleParticipants);
router.put('/update-enrollment/:courseId/:participantId',userAuth, updateParticipantEnrollment);

module.exports = router;deleteMultipleParticipants 
