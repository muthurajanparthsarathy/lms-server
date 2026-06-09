const mongoose = require("mongoose");

const testCaseSchema = new mongoose.Schema(
  {
    input: { type: String },
    expectedOutput: { type: String },
    isSample: { type: Boolean },
    isHidden: { type: Boolean },
    points: { type: Number },
    explanation: String,
  },
  { _id: true }
);

const solutionSchema = new mongoose.Schema(
  {
    startedCode: { type: String },
    functionName: { type: String },
    language: { type: String },
  },
  { _id: true }
);

const hintSchema = new mongoose.Schema(
  {
    hintText: { type: String },
    pointsDeduction: { type: Number },
    isPublic: { type: Boolean },
    sequence: { type: Number },
  },
  { _id: true }
);

const optionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  isCorrect: { type: Boolean, default: false },
  imageUrl: { type: String, default: null },
  imageAlignment: { type: String, enum: ['left', 'center', 'right'] },
  imageSizePercent: { type: Number }
});

const titleandDescriptionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  imageUrl: { type: String, default: null },
  imageAlignment: { type: String, enum: ['left', 'center', 'right'] },
  imageSizePercent: { type: Number }
});
const matchingPairSchema = new mongoose.Schema({
  left: { type: String, required: true },
  right: { type: String, required: true }
}, { _id: true });

const orderingItemSchema = new mongoose.Schema({
  text: { type: String, required: true },
  order: { type: Number, required: true }
}, { _id: true });

const questionsSchema = new mongoose.Schema({
  // Common Fields
  questionCategory: {
    type: String,
    required: true,
  },
  questionType: {
    type: String,
    required: true,
    // Lowercase values are the current convention (mcq + the programming sub-types).
    // "MCQ" / "Programming" are kept for backward compatibility with existing data.
    enum: ["mcq", "programming", "frontend", "database", "MCQ", "Programming"]
  },

  // MCQ Specific Fields
    mcqQuestionTitle: { type: mongoose.Schema.Types.Mixed },
  mcqQuestionDescription: titleandDescriptionSchema,
  mcqQuestionType: { 
    type: String, 
    enum: [
      'multiple_choice', 
      'multiple_select', 
      'true_false', 
      'dropdown', 
      'short_answer', 
      'essay',
      'matching',
      'ordering',
      'numeric'
    ],
  },
  mcqQuestionDifficulty: { 
    type: String, 
    enum: ['easy', 'medium', 'hard'],
    default: 'medium' 
  },
  mcqQuestionTimeLimit: { type: Number },
  isActive: { type: Boolean, default: true },
  mcqQuestionOptionsPerRow: { type: Number },
  mcqQuestionRequired: { type: Boolean },
  mcqQuestionOptions: [optionSchema],
  mcqQuestionCorrectAnswers: [{ type: String }],
  
  // True/False specific
  trueFalseAnswer: { type: Boolean, default: null },

  // Short Answer specific
  shortAnswer: { type: String, default: '' },

  // Matching specific
  matchingPairs: [matchingPairSchema],

  // Ordering specific
  orderingItems: [orderingItemSchema],

  // Numeric specific
  numericAnswer: { type: Number, default: null },
  numericTolerance: { type: Number, default: null },

  // Explanation
  hasExplanation: { type: Boolean, default: false },
  explanation: { type: String },

  // Programming Specific Fields
  title: {
    type: String,
    trim: true,
  },
  description: {
    type: String,
  },
  difficulty: {
    type: String,
  },
  sampleInput: { type: String },
  sampleOutput: { type: String },
  // Database sub-type fields
  sampleQuery: { type: String },
  expectedResult: { type: String },
  score: { type: Number, min: 0, max: 100 },
  constraints: [{ type: String }],
  hints: [hintSchema],
  testCases: [testCaseSchema],
  solutions: solutionSchema,
  timeLimit: { type: Number, min: 0, max: 10000 },
  memoryLimit: { type: Number, min: 0, max: 1024 },
  
  // Metadata
  createdBy: { type: String },
  updatedBy: { type: String },
  updatedAt: { type: String }
}, { 
  timestamps: true,
  minimize: true,
  toJSON: { 
    transform: function(doc, ret) {
      if (Array.isArray(ret.constraints) && ret.constraints.length === 0) {
        delete ret.constraints;
      }
      if (Array.isArray(ret.hints) && ret.hints.length === 0) {
        delete ret.hints;
      }
      if (Array.isArray(ret.testCases) && ret.testCases.length === 0) {
        delete ret.testCases;
      }
      if (ret.solutions && Object.keys(ret.solutions).length === 0) {
        delete ret.solutions;
      }
      if (Array.isArray(ret.matchingPairs) && ret.matchingPairs.length === 0) {
        delete ret.matchingPairs;
      }
      if (Array.isArray(ret.orderingItems) && ret.orderingItems.length === 0) {
        delete ret.orderingItems;
      }
      return ret;
    }
  }
});

const questionbankSchema = new mongoose.Schema({
  institution: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LMS-Institution",
    required: true 
  },
  questions: [questionsSchema],
}, { 
  timestamps: true,
  minimize: true 
});

// Add middleware to clean empty arrays before saving
questionbankSchema.pre('save', function(next) {
  const doc = this;
  
  if (Array.isArray(doc.questions) && doc.questions.length === 0) {
    doc.questions = undefined;
  }
  
  if (Array.isArray(doc.questions) && doc.questions.length > 0) {
    doc.questions = doc.questions.map(question => {
      if (Array.isArray(question.constraints) && question.constraints.length === 0) {
        question.constraints = undefined;
      }
      if (Array.isArray(question.hints) && question.hints.length === 0) {
        question.hints = undefined;
      }
      if (Array.isArray(question.testCases) && question.testCases.length === 0) {
        question.testCases = undefined;
      }
      if (question.solutions && Object.keys(question.solutions).length === 0) {
        question.solutions = undefined;
      }
      if (Array.isArray(question.matchingPairs) && question.matchingPairs.length === 0) {
        question.matchingPairs = undefined;
      }
      if (Array.isArray(question.orderingItems) && question.orderingItems.length === 0) {
        question.orderingItems = undefined;
      }
      return question;
    });
  }
  
  next();
});

const Question = mongoose.model("QuestionBank", questionbankSchema);
module.exports = Question;