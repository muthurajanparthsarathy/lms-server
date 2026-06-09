const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");

const folderSchema = new mongoose.Schema({
  id: {
    type: String, // Changed from ObjectId to String
    required: true
  },
  name: {
    type: String,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  parentPath: {
    type: String,
  },
  depth: {
    type: Number,
    default: 0
  },
  fileCount: {
    type: Number,
    default: 0
  },
  subfolderCount: {
    type: Number,
    default: 0
  }
}, {
  _id: false, // Important: Don't create _id for subdocuments
  timestamps: false
});

// Update fileSchema
const fileSchema = new mongoose.Schema({
  id: {
    type: String, // Changed from ObjectId to String
    required: true
  },
  filename: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
  language: {
    type: String,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  folderPath: {
    type: String,
    default: '/'
  },
  size: {
    type: Number,
    default: 0
  },
  isEntryPoint: {
    type: Boolean,
    default: false
  },
      isQueryFile: { type: Boolean, default: false }, // Query file

  lastModified: {
    type: Date,
    default: Date.now
  }
}, {
  _id: false, // Important: Don't create _id for subdocuments
  timestamps: false
});

// Update questionAnswerSchema
const questionAnswerSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  questionTitle: {
    type: String,
  },
  // Store multiple files
  files: [fileSchema],
  // Store folder structure
  folders: [folderSchema],
  // Enhanced project structure
  projectStructure: {
    folders: [folderSchema],
    folderTree: mongoose.Schema.Types.Mixed,
    hasFolders: Boolean,
    totalFolders: Number,
    totalFiles: Number,
    entryPoints: [String],
    fileDistribution: {
      html: Number,
      css: Number,
      javascript: Number,
      other: Number,
      sql: Number
    }
  },
    sqlMetadata: {
    databaseType: { type: String, default: 'mysql' }, // mysql, postgresql, sqlite, etc.
    hasSchemaFiles: { type: Boolean, default: false },
    hasDataFiles: { type: Boolean, default: false },
    hasProcedureFiles: { type: Boolean, default: false },
    totalQueries: { type: Number, default: 0 },
    databases: [{ // Multiple databases in project
      name: String,
      tables: [String],
      fileIds: [String] // Files belonging to this database
    }]
  },

  entryPoints: [String],
  codeAnswer: {
    type: String,
    trim: true
  },
  // For Others question type: file-upload answers (Supabase URLs)
  othersFiles: [
    {
      name: { type: String },
      url: { type: String },
      mimeType: { type: String },
    }
  ],
  // For Others notion type: multi-page Notion editor answer (PageData[] JSON)
  notionPages: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  language: {
    type: String,
  },
  isCorrect: {
    type: Boolean,
    default: false
  },
  totalScore: {
    type: Number,
    default: 0
  },
  score: {
    type: Number,
    default: 0
  },
  feedback: {
    type: String
  },
  status: {
    type: String,
    enum: ['solved', 'attempted', 'skipped', 'submitted', 'evaluated'],
    default: 'attempted'
  },
  attempts: {
    type: Number,
    default: 0
  },
  submittedAt: {
    type: Date,
    default: Date.now
  },
  fileStructure: {
    totalFiles: Number,
    htmlFiles: Number,
    cssFiles: Number,
    jsFiles: Number,
    otherFiles: Number,
    sqlFiles: Number,
    folders: Number,
    sqlFiles: Number,
    folderStructure: [{
      name: String,
      path: String,
      fileCount: Number
    }]
  }
}, {
  timestamps: true
});

// Update exerciseProgressSchema
const exerciseProgressSchema = new mongoose.Schema({
  exerciseId: {
    type: mongoose.Schema.Types.ObjectId,
  },
  exerciseName: {
    type: String,
  },
  questions: [questionAnswerSchema],
  status: {
    type: String,
    enum: ['in-progress', 'completed', 'terminated'],
    default: 'in-progress'
  },
  isLocked: {
    type: Boolean,
    default: false,
    description: "If true, user cannot re-enter this exercise"
  },
  selectedProgrammingLanguage: {
    type: String,
  },
  // Context information
  nodeId: {
    type: String,
    trim: true
  },
  nodeName: {
    type: String,
    trim: true
  },
  nodeType: {
    type: String,
    trim: true
  },
  subcategory: {
    type: String,
    trim: true,
  },
  screenRecording: {
    type: String,
  },
  // Folder structure metadata
  hasFolderStructure: {
    type: Boolean,
    default: false
  },
  folderCount: {
    type: Number,
    default: 0
  },
  projectType: {
    type: String,
    enum: ['single-file', 'multi-file'],
    default: 'single-file'
  }
}, {
  timestamps: true
});
// Updated Answer Schema with Map structure
const answerSchema = new mongoose.Schema({
  I_Do: { 
    type: Map,
    of: [exerciseProgressSchema],
    default: new Map()
  },
  We_Do: { 
    type: Map,
    of: [exerciseProgressSchema],
    default: new Map()
  },
  You_Do: { 
    type: Map,
    of: [exerciseProgressSchema],
    default: new Map()
  },
});

// Individual Course Schema
const userCourseSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course-Structure",
  },
  answers: {
    type: answerSchema,
    default: () => ({
      I_Do: new Map(),
      We_Do: new Map(),
      You_Do: new Map()
    })
  },
  lastAccessed: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Update User Schema to use userCourseSchema directly
const permissionItemSchema = new mongoose.Schema({
  permissionName: { 
    type: String, 
    required: [true, "Permission name is required"],
    trim: true
  },
  permissionKey: { 
    type: String, 
    required: [true, "Permission key is required"],
    trim: true,
    unique: true
  },
  permissionFunctionality: [{ 
    type: String, 
    trim: true 
  }],
  icon: {
    type: String,
    required: [true, "Icon name is required"],
    trim: true,
    default: "Shield"
  },
  color: {
    type: String,
    required: [true, "Color is required"],
    trim: true,
    default: "blue"
  },
  description: {
    type: String,
    trim: true,
    default: ""
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

const tokenSchema = new mongoose.Schema({
  token: { type: String, required: true },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400,
  },
});

const noteSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, "Note title is required"],
    trim: true,
    maxlength: 200,
    default: "Untitled Note"
  },
  content: {
    type: String,
    default: ""
  },
  tags: [{
    type: String,
    trim: true
  }],
  isPinned: {
    type: Boolean,
    default: false
  },
  color: {
    type: String,
    default: "#ffffff"
  },
  lastEdited: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});
const aiHistorySchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    default: () => `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  title: {
    type: String,
    default: "New Chat",
    trim: true,
    maxlength: 100
  },
  messages: [{
    content: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    metadata: {
      context: {
        topicTitle: String,
        fileName: String,
        fileType: String,
        isDocumentView: Boolean
      }
    }
  }],
  context: {
    topicTitle: String,
    fileName: String,
    fileType: String,
    isDocumentView: Boolean
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  },
  messageCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

const notificationSchema = new mongoose.Schema({
  title: {
    type: String,
    trim: true
  },
  message: {
    type: String,
  },
  type: {
    type: String,
    enum: ['info', 'success', 'warning', 'error', 'enrollment'],
    default: 'info'
  },
  relatedEntity: {
    type: String,
    enum: ['course', 'assignment', 'announcement', 'enrollment', 'system',],
    default: 'enrollment'
  },
  relatedEntityId: {
    type: mongoose.Schema.Types.ObjectId
  },
  isRead: {
    type: Boolean,
    default: false
  },
  metadata: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: new Map()
  },
  // Add enrolledBy as a separate reference
  enrolledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LMS-User',
    default: null
  },
  isFavorite: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
  }
}, {
  timestamps: true
});

// Updated User Schema - Remove firstSchema and secondSchema
const userSchema = new mongoose.Schema({
  institution: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-Institution",
  },
  email: {
    type: String,
    required: [true, "Your email address is required"],
    unique: true,
    lowercase: true,
    validate: (value) => {
      return validator.isEmail(value);
    },
  },
  firstName: {
    type: String,
    required: true,
  },
  lastName: {
    type: String,
  },
  phone: {
    type: String,
    required: true,
  },
  gender: {
    type: String,
  },
  password: {
    type: String,
    required: [true, "Your password is required"],
  },
  profile: {
    type: String,
  },
  role: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Role",
    default: null,
  },
  degree: {
    type: String,
  },
  department: {
    type: String,
  },
  year: {
    type: String,
  },
  semester: {
    type: String,
  },
  batch: {
    type: String,
  },
  permissions: [permissionItemSchema],
  status: {
    type: String,
    enum: ["active", "inactive"],
  },
  notes: [noteSchema],
    ai_history: [aiHistorySchema],

      notifications: [notificationSchema],

  createdAt: {
    type: Date,
    default: new Date(),
  },
  createdBy: {
    type: String,
  },
  // Simple courses array with userCourseSchema
  courses: [userCourseSchema],
  tokens: [tokenSchema],
}, {
  timestamps: true
});

// Pre-save hook for password hashing
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    this.password = await bcrypt.hash(this.password, 12);
    next();
  } catch (error) {
    next(error);
  }
});
userSchema.methods.addNotification = async function(notificationData) {
  try {
    const notification = {
      ...notificationData,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.notifications.unshift(notification); // Add to beginning for newest first
    this.unreadNotificationCount = this.notifications.filter(n => !n.isRead).length;
    
    await this.save();
    return notification;
  } catch (error) {
    console.error('Error adding notification:', error);
    throw error;
  }
};

// Method to mark notification as read
userSchema.methods.markNotificationAsRead = async function(notificationId) {
  const notification = this.notifications.id(notificationId);
  if (notification && !notification.isRead) {
    notification.isRead = true;
    notification.updatedAt = new Date();
    this.unreadNotificationCount = Math.max(0, this.unreadNotificationCount - 1);
    await this.save();
  }
  return notification;
};

// Method to mark all notifications as read
userSchema.methods.markAllNotificationsAsRead = async function() {
  this.notifications.forEach(notification => {
    if (!notification.isRead) {
      notification.isRead = true;
      notification.updatedAt = new Date();
    }
  });
  this.unreadNotificationCount = 0;
  await this.save();
};

// Pre-save hook to update unread notification count
userSchema.pre('save', function(next) {
  if (this.isModified('notifications')) {
    this.unreadNotificationCount = this.notifications.filter(n => !n.isRead).length;
  }
  next();
});
// Update lastEdited timestamp before saving notes
userSchema.pre('save', function(next) {
  if (this.isModified('notes')) {
    this.notes.forEach(note => {
      if (note.isModified()) {
        note.lastEdited = new Date();
      }
    });
  }
  next();
});

module.exports = mongoose.model("LMS-User", userSchema);