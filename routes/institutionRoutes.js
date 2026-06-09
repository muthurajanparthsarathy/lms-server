const express = require('express');
const router = express.Router();
const { userAuth } = require('../middlewares/userAuth.js');
const { userRole } = require('../middlewares/userRole.js');
const { createInstitution, getAllInstitution, getInstitutionById, deleteInstitution, updateInstitution } = require('../controllers/institution.js');

router.post('/create/institution', createInstitution);

router.get('/getAll/institution', getAllInstitution);

router.get('/getById/institution/:id', userAuth, getInstitutionById);

router.delete('/delete/institution/:id', userAuth, userRole(['super_admin']), deleteInstitution);

router.put('/update/institution/:id', userAuth, userRole(['super_admin']), updateInstitution);

module.exports = router;
