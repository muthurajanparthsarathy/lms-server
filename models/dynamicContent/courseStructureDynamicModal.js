const mongoose = require("mongoose");
 
const contactPersonSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
  },
  isPrimary: {
    type: Boolean,
    default: false,
  },
});
 

// Define the client schema (embedded)
const clientSchema = new mongoose.Schema({
  contactPersons: [contactPersonSchema],
  clientCompany: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  clientAddress: {
    type: String,
  },
    clientLogo: {
    type: String,
  },
    status: {
    type: String,
    enum: ["active", "inactive"],
    default: "active",
  },

 
  createdAt: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: String,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  updatedBy: {
    type: String,
  },
});
  
const categorySchema = new mongoose.Schema({
  categoryName: {
    type: String,
    required: false,
  },
  categoryDescription: {
    type: String,
  },
  courseNames: [{
    type: String,
    trim: true
  }], // Array of course names
  createdAt: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: String,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  updatedBy: {
    type: String,
  },
}); 
// Define the service modal schema (embedded)
const serviceModalSchema = new mongoose.Schema({
  title: {
    type: String,
    required: false
  },
  description: {
    type: String,
    required: false
  },
  createdBy: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: String
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
});
 
// Define the service schema (embedded) - Updated to include serviceModal array
const serviceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: false
  },
  title: {
    type: String,
    required: false
  },
  description: {
    type: String,
    required: false
  },
  serviceModal: [serviceModalSchema], // Added serviceModal as an array
  createdBy: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: String
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
});
 
const courseStructureDynamicSchema = new mongoose.Schema({
  institution: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-Institution",
    required: false,
  },
 
  // Embedded arrays of different schemas
  client: [clientSchema],
  category: [categorySchema],
  service: [serviceSchema],
  // Removed serviceModal from here since it's now embedded in service schema
 
  // Additional fields for course structure
  createdAt: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: String,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  updatedBy: {
    type: String,
  },
});
 
// Pre-save middleware to update the updatedAt field
courseStructureDynamicSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});
 
// Methods for managing embedded documents
courseStructureDynamicSchema.methods.addClient = function(clientData) {
  this.client.push(clientData);
  return this.save();
};
 
courseStructureDynamicSchema.methods.addCategory = function(categoryData) {
  this.category.push(categoryData);
  return this.save();
};
 
courseStructureDynamicSchema.methods.addService = function(serviceData) {
  this.service.push(serviceData);
  return this.save();
};
 
// Updated method to add service modal to a specific service
courseStructureDynamicSchema.methods.addServiceModal = function(serviceId, serviceModalData) {
  const service = this.service.id(serviceId);
  if (service) {
    service.serviceModal.push(serviceModalData);
    return this.save();
  }
  throw new Error('Service not found');
};
 
module.exports = mongoose.model("Course-Structure-Dynamic", courseStructureDynamicSchema);
 