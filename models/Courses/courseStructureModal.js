// models/CourseStructure.js
const mongoose = require("mongoose");

// Group Schema
const groupSchema = new mongoose.Schema({
  groupName: {
    type: String,
    required: true,
    trim: true,
  },
  groupDescription: {
    type: String,
    trim: true,
    default: "",
  },
  members: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-User",
    required: true,
  }],
  groupLeader: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-User",
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'archived'],
    default: 'active',
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

groupSchema.index({ groupName: 1, course: 1 }, { unique: true });

// Enrollment Schema for single participants
const enrollmentSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-User",
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'completed', 'dropped'],
    default: 'active',
  },
  enableEnrolmentDates: {
    type: Boolean,
    default: false,
  },
  enrolmentStartsDate: {
    type: Date,
    default: null,
  },
  enrolmentEndsDate: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const fileResourceSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  maxSize: { type: Number, default: 0 },
  aiChat: { type: Boolean, default: false },
  aiSummary: { type: Boolean, default: false },
  allowedFormats: [{ type: String }]
}, { _id: false });

const resourceConfigSchema = new mongoose.Schema({
  video: fileResourceSchema,
  ppt: fileResourceSchema,
  pdf: fileResourceSchema,
  url: { enabled: { type: Boolean, default: false } },
  aiChat:  { enabled: { type: Boolean, default: false } },
  aiSummary:  { enabled: { type: Boolean, default: false } },
  notes: { enabled: { type: Boolean, default: false } }
}, { _id: false });

const pedagogyResourceSchema = new mongoose.Schema({
  iDo: resourceConfigSchema,
  weDo: resourceConfigSchema,
  youDo: resourceConfigSchema
}, { _id: false });

// Programming Languages Schema for Test Configuration
const programmingLanguagesSchema = new mongoose.Schema({
  coreProgram: [{
    type: String,
    default: []
  }],
  frontend: [{
    type: String,
    default: []
  }],
  database: [{
    type: String,
    default: []
  }]
}, { _id: false });

// Course Structure Schema
const courseStructureSchema = new mongoose.Schema({
  institution: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-Institution",
    required: true,
  },

  // Course Configuration
  clientName: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course-Structure-Dynamic",
    required: true,
  },
  serviceType: {
    type: String,
    required: true,
  },
  serviceModal: {
    type: String,
    required: true,
  },

  // Course Details
  category: {
    type: String,
    required: true,
  },
  courseCode: {
    type: String,
  },
  courseName: {
    type: String,
    required: true,
  },
  courseDescription: {
    type: String,
  },
  courseDuration: {
    type: String,
  },
  courseLevel: {
    type: String,
  },
  courseImage: {
    type: String,
  },

  // Resources Type - Now using the new pedagogy-based structure
  resourcesType: {
    type: pedagogyResourceSchema,
  },
  aiChatGlobal: { type: Boolean, default: false },

  // Skill Set Configuration
  testConfiguration: {
    type: programmingLanguagesSchema,
    default: () => ({})
  },

  courseHierarchy: [{
    type: String,
  }],
  
  // Pedagogy elements (keeping existing structure)
  I_Do: [{
    type: String,
  }],
  We_Do: [{
    type: String,
  }],
  You_Do: [{
    type: String,
  }],
  
  singleParticipants: [enrollmentSchema],
  groups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course-Group",
  }],

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

enrollmentSchema.pre('save', function(next) {
  if (!this.enrolmentEndsDate && this.enrolmentStartsDate && this.enrolmentDuration) {
    const endDate = new Date(this.enrolmentStartsDate);
    endDate.setDate(endDate.getDate() + this.enrolmentDuration);
    this.enrolmentEndsDate = endDate;
  }
  next();
});

module.exports = mongoose.model("Course-Structure", courseStructureSchema);