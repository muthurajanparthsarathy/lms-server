const express = require("express");
const {
  addClient,
  getAllClients,
  getClientById,
  updateClient,
  deleteClient,
  addCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
  addService,
  getAllServices,
  getServiceById,
  updateService,
  deleteService,
  addServiceModal,
  getAllServiceModals,
  getServiceModalById,
  updateServiceModal,
  deleteServiceModal,
  getOrCreateCourseStructure,
  getAllCourseStructureWithPopulated,
  toggleClientStatus
} = require("../../controllers/dynamicContent/courseStructureDynamic");
const { userAuth } = require("../../middlewares/userAuth");
const router = express.Router();

// Course Structure Routes
router.get('/course-structure', getOrCreateCourseStructure);

router.get('/getAll/course-dynamic',userAuth, getAllCourseStructureWithPopulated);

// CLIENT ROUTES
router.post('/clients/create',userAuth, addClient);
router.get('/clients/getAll',userAuth, getAllClients);
router.get('/clients/getById/:clientId',userAuth, getClientById);
router.put('/clients/update/:clientId',userAuth, updateClient);
router.delete('/clients/delete/:clientId',userAuth, deleteClient);
router.put('/clients/toggle-status/:clientId',userAuth, toggleClientStatus);

// CATEGORY ROUTES
router.post('/categories/create',userAuth, addCategory);
router.get('/categories/getAll',userAuth, getAllCategories);
router.get('/categories/getById/:categoryId',userAuth, getCategoryById);
router.put('/categories/update/:categoryId',userAuth, updateCategory);
router.delete('/categories/delete/:categoryId',userAuth, deleteCategory);

// SERVICE ROUTES
// SERVICE ROUTES
router.post('/services/create',userAuth, addService);
router.get('/services/getAll',userAuth, getAllServices);
router.get('/services/getById/:serviceId',userAuth, getServiceById);
router.put('/services/update/:serviceId',userAuth, updateService);
router.delete('/services/delete/:serviceId',userAuth, deleteService);
 
// SERVICE MODAL ROUTES
router.post('/service-modals/create',userAuth, addServiceModal);
router.get('/service-modals/getAll',userAuth, getAllServiceModals);
router.get('/service-modals/getById/:serviceModalId',userAuth, getServiceModalById);
router.put('/service-modals/update/:serviceId/:modalId',userAuth, updateServiceModal);
router.delete('/service-modals/delete/:serviceId/:modalId', userAuth, deleteServiceModal);
 
module.exports = router;