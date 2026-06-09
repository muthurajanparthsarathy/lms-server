const Question = require('../../models/Courses/QuestionbankModal');
const { createClient } = require("@supabase/supabase-js");
const mongoose = require('mongoose');

const supabaseKey = process.env.SUPABASE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to clean empty fields
const cleanEmptyFields = (obj) => {
  Object.keys(obj).forEach(key => {
    if (obj[key] && typeof obj[key] === 'object') {
      cleanEmptyFields(obj[key]);
    }
    
    if (Array.isArray(obj[key]) && obj[key].length === 0) {
      delete obj[key];
    }
    else if (obj[key] && typeof obj[key] === 'object' && 
             Object.keys(obj[key]).length === 0) {
      delete obj[key];
    }
    else if (obj[key] === undefined || obj[key] === null) {
      delete obj[key];
    }
  });
  return obj;
};

// Image upload helper
async function uploadImageToSupabase(file, folderPath) {
  try {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
    const fileName = `${timestamp}_${randomString}_${sanitizedName}`;
    const filePath = `question-bank/${folderPath}/${fileName}`;

    const { data, error } = await supabase.storage
      .from("smartlms")
      .upload(filePath, file.data || file.buffer, {
        contentType: file.mimetype || 'image/jpeg',
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    const imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/${filePath}`;
    return imageUrl;
  } catch (error) {
    console.error("❌ Image upload failed:", error);
    throw error;
  }
}

// Update the normalizeMCQQuestion function
const normalizeMCQQuestion = (question) => {
  // Normalize mcqQuestionTitle
  if (question.mcqQuestionTitle) {
    if (typeof question.mcqQuestionTitle === 'string') {
      question.mcqQuestionTitle = {
        text: question.mcqQuestionTitle,
        imageUrl: null,
        imageAlignment: 'center',
        imageSizePercent: 60
      };
    } else if (typeof question.mcqQuestionTitle === 'object') {
      // Ensure all required fields exist
      if (!question.mcqQuestionTitle.imageUrl) {
        question.mcqQuestionTitle.imageUrl = null;
      }
      if (!question.mcqQuestionTitle.imageAlignment) {
        question.mcqQuestionTitle.imageAlignment = 'center';
      }
      if (!question.mcqQuestionTitle.imageSizePercent) {
        question.mcqQuestionTitle.imageSizePercent = 60;
      }
    }
  } else if (question.questionTitle && typeof question.questionTitle === 'string') {
    question.mcqQuestionTitle = {
      text: question.questionTitle,
      imageUrl: null,
      imageAlignment: 'center',
      imageSizePercent: 60
    };
  }

  // Normalize mcqQuestionDescription
  if (question.mcqQuestionDescription) {
    if (typeof question.mcqQuestionDescription === 'string') {
      question.mcqQuestionDescription = {
        text: question.mcqQuestionDescription,
        imageUrl: null,
        imageAlignment: 'center',
        imageSizePercent: 60
      };
    } else if (typeof question.mcqQuestionDescription === 'object') {
      // Ensure all required fields exist
      if (!question.mcqQuestionDescription.imageUrl) {
        question.mcqQuestionDescription.imageUrl = null;
      }
      if (!question.mcqQuestionDescription.imageAlignment) {
        question.mcqQuestionDescription.imageAlignment = 'center';
      }
      if (!question.mcqQuestionDescription.imageSizePercent) {
        question.mcqQuestionDescription.imageSizePercent = 60;
      }
    }
  }

  return question;
};

// Update your createQuestionBank function - FIXED VERSION
exports.createQuestionBank = async (req, res) => {
  try {
    const institutionId = req.user?.institution?._id || req.user?.institution;
    
    if (!institutionId) {
      return res.status(400).json({
        success: false,
        message: 'User institution not found'
      });
    }

    // Parse questionsData from FormData
    let questionsData = [];
    
    if (req.body.questionsData) {
      if (typeof req.body.questionsData === 'string') {
        try {
          questionsData = JSON.parse(req.body.questionsData);
          console.log('✅ Parsed questionsData:', questionsData.length, 'questions');
        } catch (e) {
          return res.status(400).json({
            success: false,
            message: 'Invalid questionsData format - must be valid JSON array'
          });
        }
      } else if (Array.isArray(req.body.questionsData)) {
        questionsData = req.body.questionsData;
      }
    } else if (Array.isArray(req.body)) {
      questionsData = req.body;
    } else if (req.body.questionType) {
      questionsData = [req.body];
    }

    questionsData = questionsData.filter(q => q != null);

    if (!Array.isArray(questionsData) || questionsData.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'questionsData must be a non-empty array'
      });
    }

    const processedQuestions = [];

    for (let i = 0; i < questionsData.length; i++) {
      let question = questionsData[i];
      
      // Normalize the question data first
      question = normalizeMCQQuestion(question);
      
      const isMCQ = question.questionType === 'MCQ' || 
                    question.questionType === 'mcq' ||
                    question.mcqQuestionTitle || 
                    question.mcqQuestionType;

      let processedQuestion;

      if (isMCQ) {
        console.log(`📝 Question ${i + 1}: Processing as MCQ`);
        
        // Handle mcqQuestionTitle as object (already normalized)
        let mcqTitleObj = question.mcqQuestionTitle || { text: '' };
        
        if (typeof mcqTitleObj === 'string') {
          mcqTitleObj = { text: mcqTitleObj };
        }

        // Handle mcqQuestionDescription as object (already normalized)
        let mcqDescriptionObj = question.mcqQuestionDescription || null;
        
        if (mcqDescriptionObj && typeof mcqDescriptionObj === 'string') {
          mcqDescriptionObj = { text: mcqDescriptionObj };
        }

        const mcqType = question.mcqQuestionType || 'multiple_choice';
        const mcqOptions = question.mcqQuestionOptions || question.options || [];
        const mcqCorrectAnswers = question.mcqQuestionCorrectAnswers || 
                                 question.correctAnswers || 
                                 (question.correctAnswer ? [question.correctAnswer] : []);
        
        // Validate MCQ required fields
        if (!mcqTitleObj.text || !mcqTitleObj.text.trim()) {
          return res.status(400).json({
            success: false,
            message: `Question ${i + 1}: MCQ question title text is required`
          });
        }

        const choiceBasedTypes = ['multiple_choice', 'multiple_select', 'dropdown'];
        
        if (choiceBasedTypes.includes(mcqType)) {
          if (!Array.isArray(mcqOptions) || mcqOptions.length < 2) {
            return res.status(400).json({
              success: false,
              message: `Question ${i + 1}: At least 2 options are required for ${mcqType}`
            });
          }

          if (!Array.isArray(mcqCorrectAnswers) || mcqCorrectAnswers.length === 0) {
            return res.status(400).json({
              success: false,
              message: `Question ${i + 1}: At least one correct answer is required`
            });
          }
        }

        if (mcqType === 'true_false') {
          if (question.trueFalseAnswer === undefined || question.trueFalseAnswer === null) {
            return res.status(400).json({
              success: false,
              message: `Question ${i + 1}: True/False answer is required`
            });
          }
        }

        if (mcqType === 'matching') {
          const matchingPairs = question.matchingPairs || [];
          if (matchingPairs.length < 2) {
            return res.status(400).json({
              success: false,
              message: `Question ${i + 1}: At least 2 matching pairs are required`
            });
          }
          const hasEmptyPairs = matchingPairs.some(p => !p.left?.trim() || !p.right?.trim());
          if (hasEmptyPairs) {
            return res.status(400).json({
              success: false,
              message: `Question ${i + 1}: All matching pairs must be filled`
            });
          }
        }

        if (mcqType === 'ordering') {
          const orderingItems = question.orderingItems || [];
          if (orderingItems.length < 2) {
            return res.status(400).json({
              success: false,
              message: `Question ${i + 1}: At least 2 ordering items are required`
            });
          }
          const hasEmptyItems = orderingItems.some(item => !item.text?.trim());
          if (hasEmptyItems) {
            return res.status(400).json({
              success: false,
              message: `Question ${i + 1}: All ordering items must be filled`
            });
          }
        }

        if (mcqType === 'numeric') {
          if (question.numericAnswer === undefined || question.numericAnswer === null) {
            return res.status(400).json({
              success: false,
              message: `Question ${i + 1}: Numeric answer is required`
            });
          }
        }

        // ========== FIX: Process mcqQuestionTitle image upload ==========
        let titleImageUrl = mcqTitleObj.imageUrl || null;
        const titleImageField = `question_${i}_image`; // Changed to match frontend
        const titleImageFile = req.files?.[titleImageField];

        if (titleImageFile) {
          try {
            titleImageUrl = await uploadImageToSupabase(
              titleImageFile,
              `mcq/title/${Date.now()}_${i}`
            );
            console.log(`✅ Uploaded title image for question ${i + 1}:`, titleImageUrl);
          } catch (uploadError) {
            console.error(`Error uploading title image for question ${i + 1}:`, uploadError);
          }
        }

        // Process mcqQuestionDescription image upload
        let descriptionImageUrl = mcqDescriptionObj?.imageUrl || null;
        const descriptionImageField = `question_${i}_explanation_image`;
        const descriptionImageFile = req.files?.[descriptionImageField];

        if (descriptionImageFile) {
          try {
            descriptionImageUrl = await uploadImageToSupabase(
              descriptionImageFile,
              `mcq/description/${Date.now()}_${i}`
            );
            console.log(`✅ Uploaded description image for question ${i + 1}:`, descriptionImageUrl);
          } catch (uploadError) {
            console.error(`Error uploading description image for question ${i + 1}:`, uploadError);
          }
        }

        let explanationImageUrl = null;
        const explanationImageField = `question_${i}_explanation_image`;
        const explanationImageFile = req.files?.[explanationImageField];

        if (explanationImageFile) {
          try {
            explanationImageUrl = await uploadImageToSupabase(
              explanationImageFile,
              `mcq/explanation/${Date.now()}_${i}`
            );
            console.log(`✅ Uploaded explanation image for question ${i + 1}:`, explanationImageUrl);
          } catch (uploadError) {
            console.error(`Error uploading explanation image for question ${i + 1}:`, uploadError);
          }
        }

        // Build mcqQuestionDescription object (explanation) with image
        let finalMcqDescriptionObj = mcqDescriptionObj ? { ...mcqDescriptionObj } : null;
        
        if (explanationImageUrl) {
          if (!finalMcqDescriptionObj) {
            finalMcqDescriptionObj = {};
          }
          finalMcqDescriptionObj.imageUrl = explanationImageUrl;
          if (!finalMcqDescriptionObj.imageAlignment) finalMcqDescriptionObj.imageAlignment = 'center';
          if (!finalMcqDescriptionObj.imageSizePercent) finalMcqDescriptionObj.imageSizePercent = 60;
        }

        // Process options with images
        let processedOptions = [];
        if (choiceBasedTypes.includes(mcqType)) {
          processedOptions = await Promise.all(
            mcqOptions.map(async (option, optIndex) => {
              let imageUrl = option.imageUrl || null;
              
              const imageField = `question_${i}_option_${optIndex}_image`;
              const imageFile = req.files?.[imageField];

              if (imageFile) {
                try {
                  imageUrl = await uploadImageToSupabase(
                    imageFile,
                    `mcq/option/${Date.now()}_${i}_${optIndex}`
                  );
                  console.log(`✅ Uploaded option ${optIndex} image for question ${i + 1}:`, imageUrl);
                } catch (uploadError) {
                  console.error(`Error uploading image for option ${optIndex}:`, uploadError);
                }
              }

              return {
                _id: new mongoose.Types.ObjectId(),
                text: option.text || '',
                isCorrect: option.isCorrect || false,
                imageUrl: imageUrl,
                imageAlignment: option.imageAlignment || 'left',
                imageSizePercent: option.imageSizePercent || 100
              };
            })
          );
        }

        // ========== FIX: Build mcqQuestionTitle object with uploaded image URL ==========
        const finalMcqTitleObj = {
          text: mcqTitleObj.text,
          ...(titleImageUrl && { imageUrl: titleImageUrl }),
          ...(mcqTitleObj.imageAlignment && { imageAlignment: mcqTitleObj.imageAlignment }),
          ...(mcqTitleObj.imageSizePercent && { imageSizePercent: mcqTitleObj.imageSizePercent })
        };

        // Build base MCQ question object
        processedQuestion = {
          _id: new mongoose.Types.ObjectId(),
          questionCategory: question.questionCategory || 'General',
          questionType: 'mcq',
          isActive: question.isActive !== undefined ? question.isActive : true,
          mcqQuestionTitle: finalMcqTitleObj, // Now includes the uploaded image URL
          ...(finalMcqDescriptionObj && finalMcqDescriptionObj.text && { mcqQuestionDescription: finalMcqDescriptionObj }),
          mcqQuestionType: mcqType,
          mcqQuestionDifficulty: question.mcqQuestionDifficulty || question.difficulty || 'medium',
          mcqQuestionScore: question.mcqQuestionScore || question.score || 10,
          mcqQuestionTimeLimit: question.mcqQuestionTimeLimit || question.timeLimit || 0,
          mcqQuestionOptionsPerRow: question.mcqQuestionOptionsPerRow || question.optionsPerRow || 1,
          mcqQuestionRequired: question.mcqQuestionRequired === true,
          createdBy: req.user?.email || 'system',
          updatedBy: req.user?.email || 'system',
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Add type-specific fields
        if (choiceBasedTypes.includes(mcqType)) {
          processedQuestion.mcqQuestionOptions = processedOptions;
          processedQuestion.mcqQuestionCorrectAnswers = mcqCorrectAnswers;
        }

        if (mcqType === 'true_false') {
          processedQuestion.trueFalseAnswer = question.trueFalseAnswer;
        }

        if (mcqType === 'short_answer') {
          processedQuestion.shortAnswer = question.shortAnswer || '';
        }

        if (mcqType === 'matching') {
          processedQuestion.matchingPairs = (question.matchingPairs || []).map(p => ({
            _id: new mongoose.Types.ObjectId(),
            left: p.left || '',
            right: p.right || ''
          }));
        }

        if (mcqType === 'ordering') {
          processedQuestion.orderingItems = (question.orderingItems || []).map(item => ({
            _id: new mongoose.Types.ObjectId(),
            text: item.text || '',
            order: item.order || 0
          }));
        }

        if (mcqType === 'numeric') {
          processedQuestion.numericAnswer = question.numericAnswer;
          processedQuestion.numericTolerance = question.numericTolerance || null;
        }

        if (question.hasExplanation || (finalMcqDescriptionObj && finalMcqDescriptionObj.text)) {
          processedQuestion.hasExplanation = true;
          processedQuestion.explanation = finalMcqDescriptionObj?.text || question.explanation || '';
        }

      } else {
        // Programming question processing (unchanged)
        console.log(`📝 Question ${i + 1}: Processing as Programming`);
        
        if (!question.title) {
          return res.status(400).json({
            success: false,
            message: `Question ${i + 1}: Programming question title is required`
          });
        }

        if (!question.description) {
          return res.status(400).json({
            success: false,
            message: `Question ${i + 1}: Programming question description is required`
          });
        }

        const testCases = (question.testCases || []).map(tc => ({
          _id: new mongoose.Types.ObjectId(),
          input: tc.input || '',
          expectedOutput: tc.expectedOutput || '',
          isSample: tc.isSample || false,
          isHidden: tc.isHidden || false,
          points: tc.points || 0,
          explanation: tc.explanation || ''
        }));

        const hints = (question.hints || []).map((h, idx) => ({
          _id: new mongoose.Types.ObjectId(),
          hintText: h.hintText || '',
          pointsDeduction: h.pointsDeduction || 0,
          isPublic: h.isPublic || false,
          sequence: h.sequence || idx
        }));

        let solutions = null;
        if (question.solutions) {
          solutions = {
            _id: new mongoose.Types.ObjectId(),
            startedCode: question.solutions.startedCode || '',
            functionName: question.solutions.functionName || '',
            language: question.solutions.language || 'javascript'
          };
        }

        processedQuestion = {
          _id: new mongoose.Types.ObjectId(),
          questionCategory: question.questionCategory || 'Programming',
          // Specific sub-type: programming (core) / frontend / database.
          questionType: (question.questionType || 'programming').toLowerCase(),
          title: question.title,
          description: question.description,
          difficulty: question.difficulty ? question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1).toLowerCase() : 'medium',
          sampleInput: question.sampleInput || '',
          sampleOutput: question.sampleOutput || '',
          // Database sub-type fields (were previously dropped).
          sampleQuery: question.sampleQuery || '',
          expectedResult: question.expectedResult || '',
          score: question.score,
          constraints: question.constraints || [],
          hints: hints,
          testCases: testCases,
          solutions: solutions,
          timeLimit: question.timeLimit || 2000,
          memoryLimit: question.memoryLimit || 256,
          isActive: question.isActive !== undefined ? question.isActive : true,
          createdBy: req.user?.email || 'system',
          updatedBy: req.user?.email || 'system',
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }

      // Remove undefined fields
      Object.keys(processedQuestion).forEach(key => {
        if (processedQuestion[key] === undefined || processedQuestion[key] === null) {
          delete processedQuestion[key];
        }
      });

      processedQuestions.push(processedQuestion);
    }

    console.log(`✅ Processed ${processedQuestions.length} questions successfully`);

    let questionBank = await Question.findOne({ institution: institutionId });

    if (questionBank) {
      questionBank.questions.push(...processedQuestions);
      await questionBank.save();
      console.log(`✅ Added ${processedQuestions.length} question(s) to existing question bank`);
    } else {
      questionBank = await Question.create({
        institution: institutionId,
        questions: processedQuestions
      });
      console.log(`✅ Created new question bank with ${processedQuestions.length} question(s)`);
    }

    const isMcq = (q) => (q.questionType || '').toLowerCase() === 'mcq';
    const mcqQuestions = processedQuestions.filter(isMcq);
    const programmingQuestions = processedQuestions.filter(q => !isMcq(q));

    const addedQuestions = processedQuestions.map(q => ({
      questionId: q._id.toString(),
      questionType: q.questionType,
      title: isMcq(q) ? q.mcqQuestionTitle?.text : q.title,
      mcqQuestionType: q.mcqQuestionType,
      difficulty: isMcq(q) ? q.mcqQuestionDifficulty : q.difficulty,
      score: isMcq(q) ? q.mcqQuestionScore : q.score
    }));

    const totalMCQMarks = mcqQuestions.reduce((sum, q) => sum + (q.mcqQuestionScore || 0), 0);
    const totalProgrammingMarks = programmingQuestions.reduce((sum, q) => sum + (q.score || 0), 0);

    return res.status(201).json({
      success: true,
      message: `Successfully added ${addedQuestions.length} question(s) to question bank`,
      data: {
        questionBankId: questionBank._id.toString(),
        totalQuestionsInBank: questionBank.questions.length,
        summary: {
          totalQuestions: addedQuestions.length,
          totalMarks: totalMCQMarks + totalProgrammingMarks,
          byType: {
            MCQ: {
              count: mcqQuestions.length,
              totalMarks: totalMCQMarks
            },
            Programming: {
              count: programmingQuestions.length,
              totalMarks: totalProgrammingMarks
            }
          }
        },
        addedQuestions
      }
    });

  } catch (error) {
    console.error("❌ Error adding questions:", error);
    return res.status(500).json({
      success: false,
      message: 'Error creating questions in question bank',
      error: error.message
    });
  }
};

// Get all questions with institution filtering
exports.getAllQuestionsbank = async (req, res) => {
  try {
    const {
      questionType,
      category,
      difficulty,
      isActive,
    } = req.query;

    const institutionId = req.user?.institution?._id || req.user?.institution;
    
    if (!institutionId) {
      return res.status(400).json({
        success: false,
        message: 'User institution not found'
      });
    }

    const query = { institution: institutionId };
    
    if (questionType) query['questions.questionType'] = questionType;
    if (category) query['questions.questionCategory'] = category;
    if (difficulty) query['questions.mcqQuestionDifficulty'] = difficulty;
    if (isActive !== undefined) query['questions.isActive'] = isActive === 'true';

    const questionBank = await Question.findOne({ institution: institutionId })
      .populate('institution', 'inst_name inst_id');

    if (!questionBank) {
      return res.status(200).json({
        success: true,
        total: 0,
        institution: institutionId,
        questions: []
      });
    }

    let filteredQuestions = questionBank.questions || [];
    
    if (questionType) {
      filteredQuestions = filteredQuestions.filter(q => q.questionType === questionType);
    }
    if (category) {
      filteredQuestions = filteredQuestions.filter(q => q.questionCategory === category);
    }
    if (difficulty) {
      filteredQuestions = filteredQuestions.filter(q => q.mcqQuestionDifficulty === difficulty);
    }
    if (isActive !== undefined) {
      filteredQuestions = filteredQuestions.filter(q => q.isActive === (isActive === 'true'));
    }

    filteredQuestions.sort((a, b) => b.createdAt - a.createdAt);

    res.status(200).json({
      success: true,
      total: filteredQuestions.length,
      institution: institutionId,
      questions: filteredQuestions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching questions',
      error: error.message
    });
  }
};

// Get single question by ID with institution check
exports.getQuestionBankById = async (req, res) => {
  try {
    const institutionId = req.user?.institution?._id || req.user?.institution;
    
    if (!institutionId) {
      return res.status(400).json({
        success: false,
        message: 'User institution not found'
      });
    }

    const questionBank = await Question.findOne({
      institution: institutionId,
      'questions._id': req.params.id
    })
      .populate('institution', 'name')
      .populate('questions.createdBy', 'name email')
      .populate('questions.updatedBy', 'name email');

    if (!questionBank) {
      return res.status(404).json({
        success: false,
        message: 'Question not found or you do not have access'
      });
    }

    const question = questionBank.questions.find(q => 
      q._id.toString() === req.params.id
    );

    if (!question) {
      return res.status(404).json({
        success: false,
        message: 'Question not found'
      });
    }

    res.status(200).json({
      success: true,
      question
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching question',
      error: error.message
    });
  }
};

// Update question with institution check - FIXED VERSION
exports.updateQuestionBank = async (req, res) => {
  try {
    const institutionId = req.user?.institution?._id || req.user?.institution;
    
    if (!institutionId) {
      return res.status(400).json({
        success: false,
        message: 'User institution not found'
      });
    }

    const { id } = req.params; // This is the question ID to update
    
    // Parse questionsData from FormData
    let questionsData = [];
    
    if (req.body.questionsData) {
      if (typeof req.body.questionsData === 'string') {
        try {
          questionsData = JSON.parse(req.body.questionsData);
          console.log('✅ Parsed questionsData for update:', questionsData.length, 'questions');
        } catch (e) {
          return res.status(400).json({
            success: false,
            message: 'Invalid questionsData format - must be valid JSON array'
          });
        }
      } else if (Array.isArray(req.body.questionsData)) {
        questionsData = req.body.questionsData;
      }
    } else if (Array.isArray(req.body)) {
      questionsData = req.body;
    } else if (req.body.questionType) {
      questionsData = [req.body];
    }

    if (!Array.isArray(questionsData) || questionsData.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'questionsData must be a non-empty array for update'
      });
    }

    // Get the existing question bank
    const questionBank = await Question.findOne({ institution: institutionId });
    
    if (!questionBank) {
      return res.status(404).json({
        success: false,
        message: 'Question bank not found for this institution'
      });
    }

    // Find the existing question index
    const existingQuestionIndex = questionBank.questions.findIndex(
      q => q._id.toString() === id
    );

    if (existingQuestionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Question not found in the question bank'
      });
    }

    // Get the question data (should be the first/only question in the array for update)
    let question = questionsData[0];
    
    // Normalize the question data first
    question = normalizeMCQQuestion(question);
    
    const isMCQ = question.questionType === 'MCQ' || 
                  question.questionType === 'mcq' ||
                  question.mcqQuestionTitle || 
                  question.mcqQuestionType;

    let processedQuestion;

    if (isMCQ) {
      console.log(`📝 Updating MCQ Question with ID: ${id}`);
      
      // Handle mcqQuestionTitle as object (already normalized)
      let mcqTitleObj = question.mcqQuestionTitle || { text: '' };
      
      if (typeof mcqTitleObj === 'string') {
        mcqTitleObj = { text: mcqTitleObj };
      }

      // Handle mcqQuestionDescription as object (already normalized)
      let mcqDescriptionObj = question.mcqQuestionDescription || null;
      
      if (mcqDescriptionObj && typeof mcqDescriptionObj === 'string') {
        mcqDescriptionObj = { text: mcqDescriptionObj };
      }

      const mcqType = question.mcqQuestionType || 'multiple_choice';
      const mcqOptions = question.mcqQuestionOptions || question.options || [];
      const mcqCorrectAnswers = question.mcqQuestionCorrectAnswers || 
                               question.correctAnswers || 
                               (question.correctAnswer ? [question.correctAnswer] : []);
      
      // Process mcqQuestionTitle image upload
      let titleImageUrl = mcqTitleObj.imageUrl || null;
      const titleImageField = `question_0_image`;
      const titleImageFile = req.files?.[titleImageField];

      // Check if it's a new image upload or existing URL
      if (titleImageFile) {
        try {
          titleImageUrl = await uploadImageToSupabase(
            titleImageFile,
            `mcq/title/${Date.now()}_update`
          );
          console.log(`✅ Uploaded title image for update:`, titleImageUrl);
        } catch (uploadError) {
          console.error(`Error uploading title image:`, uploadError);
        }
      } else if (titleImageUrl && titleImageUrl.startsWith('data:')) {
        // Handle base64 image
        try {
          const fileName = `title_${Date.now()}_update.jpg`;
          const imageFile = {
            name: fileName,
            data: Buffer.from(titleImageUrl.split(',')[1], 'base64'),
            mimetype: 'image/jpeg'
          };
          titleImageUrl = await uploadImageToSupabase(imageFile, `mcq/title/${Date.now()}_update`);
          console.log(`✅ Uploaded base64 title image:`, titleImageUrl);
        } catch (uploadError) {
          console.error(`Error uploading base64 title image:`, uploadError);
        }
      }

      // Process mcqQuestionDescription image upload
      let descriptionImageUrl = mcqDescriptionObj?.imageUrl || null;
      const descriptionImageField = `question_0_explanation_image`;
      const descriptionImageFile = req.files?.[descriptionImageField];

      if (descriptionImageFile) {
        try {
          descriptionImageUrl = await uploadImageToSupabase(
            descriptionImageFile,
            `mcq/description/${Date.now()}_update`
          );
          console.log(`✅ Uploaded description image for update:`, descriptionImageUrl);
        } catch (uploadError) {
          console.error(`Error uploading description image:`, uploadError);
        }
      }

      // Process options with images
      let processedOptions = [];
      const choiceBasedTypes = ['multiple_choice', 'multiple_select', 'dropdown'];
      
      if (choiceBasedTypes.includes(mcqType)) {
        processedOptions = await Promise.all(
          mcqOptions.map(async (option, optIndex) => {
            let imageUrl = option.imageUrl || null;
            
            const imageField = `question_0_option_${optIndex}_image`;
            const imageFile = req.files?.[imageField];

            if (imageFile) {
              try {
                imageUrl = await uploadImageToSupabase(
                  imageFile,
                  `mcq/option/${Date.now()}_update_${optIndex}`
                );
                console.log(`✅ Uploaded option ${optIndex} image for update:`, imageUrl);
              } catch (uploadError) {
                console.error(`Error uploading option image:`, uploadError);
              }
            } else if (imageUrl && imageUrl.startsWith('data:')) {
              // Handle base64 image
              try {
                const fileName = `option_${Date.now()}_update_${optIndex}.jpg`;
                const imageFile = {
                  name: fileName,
                  data: Buffer.from(imageUrl.split(',')[1], 'base64'),
                  mimetype: 'image/jpeg'
                };
                imageUrl = await uploadImageToSupabase(imageFile, `mcq/option/${Date.now()}_update_${optIndex}`);
                console.log(`✅ Uploaded base64 option image:`, imageUrl);
              } catch (uploadError) {
                console.error(`Error uploading base64 option image:`, uploadError);
              }
            }

            return {
              _id: option._id || new mongoose.Types.ObjectId(),
              text: option.text || '',
              isCorrect: option.isCorrect || false,
              imageUrl: imageUrl,
              imageAlignment: option.imageAlignment || 'left',
              imageSizePercent: option.imageSizePercent || 100
            };
          })
        );
      }

      // Build final objects
      const finalMcqTitleObj = {
        text: mcqTitleObj.text,
        ...(titleImageUrl && { imageUrl: titleImageUrl }),
        ...(mcqTitleObj.imageAlignment && { imageAlignment: mcqTitleObj.imageAlignment }),
        ...(mcqTitleObj.imageSizePercent && { imageSizePercent: mcqTitleObj.imageSizePercent })
      };

      let finalMcqDescriptionObj = mcqDescriptionObj ? { ...mcqDescriptionObj } : null;
      if (descriptionImageUrl) {
        if (!finalMcqDescriptionObj) {
          finalMcqDescriptionObj = {};
        }
        finalMcqDescriptionObj.imageUrl = descriptionImageUrl;
        if (!finalMcqDescriptionObj.imageAlignment) finalMcqDescriptionObj.imageAlignment = 'center';
        if (!finalMcqDescriptionObj.imageSizePercent) finalMcqDescriptionObj.imageSizePercent = 60;
      }

      // Get the existing question to preserve createdBy and createdAt
      const existingQuestion = questionBank.questions[existingQuestionIndex];
      
      // Build the processed question object - PRESERVE THE ORIGINAL _id
      processedQuestion = {
        _id: existingQuestion._id, // IMPORTANT: Keep the original ID
        questionCategory: question.questionCategory || existingQuestion.questionCategory || 'General',
        questionType: 'mcq',
        isActive: question.isActive !== undefined ? question.isActive : existingQuestion.isActive,
        mcqQuestionTitle: finalMcqTitleObj,
        ...(finalMcqDescriptionObj && finalMcqDescriptionObj.text && { mcqQuestionDescription: finalMcqDescriptionObj }),
        mcqQuestionType: mcqType,
        mcqQuestionDifficulty: question.mcqQuestionDifficulty || question.difficulty || existingQuestion.mcqQuestionDifficulty || 'medium',
        mcqQuestionScore: question.mcqQuestionScore || question.score || existingQuestion.mcqQuestionScore || 10,
        mcqQuestionTimeLimit: question.mcqQuestionTimeLimit || question.timeLimit || existingQuestion.mcqQuestionTimeLimit || 0,
        mcqQuestionOptionsPerRow: question.mcqQuestionOptionsPerRow || question.optionsPerRow || existingQuestion.mcqQuestionOptionsPerRow || 1,
        mcqQuestionRequired: question.mcqQuestionRequired === true || existingQuestion.mcqQuestionRequired === true,
        createdBy: existingQuestion.createdBy || req.user?.email || 'system',
        updatedBy: req.user?.email || 'system',
        createdAt: existingQuestion.createdAt || new Date(),
        updatedAt: new Date()
      };

      // Add type-specific fields
      if (choiceBasedTypes.includes(mcqType)) {
        processedQuestion.mcqQuestionOptions = processedOptions;
        processedQuestion.mcqQuestionCorrectAnswers = mcqCorrectAnswers;
      }

      if (mcqType === 'true_false') {
        processedQuestion.trueFalseAnswer = question.trueFalseAnswer;
      }

      if (mcqType === 'short_answer') {
        processedQuestion.shortAnswer = question.shortAnswer || '';
      }

      if (mcqType === 'matching') {
        processedQuestion.matchingPairs = (question.matchingPairs || []).map(p => ({
          _id: p._id || new mongoose.Types.ObjectId(),
          left: p.left || '',
          right: p.right || ''
        }));
      }

      if (mcqType === 'ordering') {
        processedQuestion.orderingItems = (question.orderingItems || []).map(item => ({
          _id: item._id || new mongoose.Types.ObjectId(),
          text: item.text || '',
          order: item.order || 0
        }));
      }

      if (mcqType === 'numeric') {
        processedQuestion.numericAnswer = question.numericAnswer;
        processedQuestion.numericTolerance = question.numericTolerance || null;
      }

      if (question.hasExplanation || (finalMcqDescriptionObj && finalMcqDescriptionObj.text)) {
        processedQuestion.hasExplanation = true;
        processedQuestion.explanation = finalMcqDescriptionObj?.text || question.explanation || '';
      }

    } else {
      // Programming question processing
      console.log(`📝 Updating Programming Question with ID: ${id}`);
      
      const existingQuestion = questionBank.questions[existingQuestionIndex];
      
      processedQuestion = {
        _id: existingQuestion._id, // IMPORTANT: Keep the original ID
        questionCategory: question.questionCategory || existingQuestion.questionCategory || 'Programming',
        // Specific sub-type: programming (core) / frontend / database.
        questionType: (question.questionType || existingQuestion.questionType || 'programming').toLowerCase(),
        title: question.title || existingQuestion.title,
        description: question.description || existingQuestion.description,
        difficulty: question.difficulty ? question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1).toLowerCase() : existingQuestion.difficulty || 'medium',
        sampleInput: question.sampleInput || existingQuestion.sampleInput || '',
        sampleOutput: question.sampleOutput || existingQuestion.sampleOutput || '',
        // Database sub-type fields (were previously dropped).
        sampleQuery: question.sampleQuery !== undefined ? question.sampleQuery : (existingQuestion.sampleQuery || ''),
        expectedResult: question.expectedResult !== undefined ? question.expectedResult : (existingQuestion.expectedResult || ''),
        score: question.score || existingQuestion.score || 0,
        constraints: question.constraints || existingQuestion.constraints || [],
        hints: (question.hints || existingQuestion.hints || []).map((h, idx) => ({
          _id: h._id || new mongoose.Types.ObjectId(),
          hintText: h.hintText || '',
          pointsDeduction: h.pointsDeduction || 0,
          isPublic: h.isPublic || false,
          sequence: h.sequence || idx
        })),
        testCases: (question.testCases || existingQuestion.testCases || []).map(tc => ({
          _id: tc._id || new mongoose.Types.ObjectId(),
          input: tc.input || '',
          expectedOutput: tc.expectedOutput || '',
          isSample: tc.isSample || false,
          isHidden: tc.isHidden || false,
          points: tc.points || 0,
          explanation: tc.explanation || ''
        })),
        solutions: (question.solutions || existingQuestion.solutions) ? {
          _id: (question.solutions || existingQuestion.solutions)?._id || new mongoose.Types.ObjectId(),
          startedCode: (question.solutions || existingQuestion.solutions)?.startedCode || '',
          functionName: (question.solutions || existingQuestion.solutions)?.functionName || '',
          language: (question.solutions || existingQuestion.solutions)?.language || 'javascript'
        } : null,
        timeLimit: question.timeLimit || existingQuestion.timeLimit || 2000,
        memoryLimit: question.memoryLimit || existingQuestion.memoryLimit || 256,
        isActive: question.isActive !== undefined ? question.isActive : existingQuestion.isActive,
        createdBy: existingQuestion.createdBy || req.user?.email || 'system',
        updatedBy: req.user?.email || 'system',
        createdAt: existingQuestion.createdAt || new Date(),
        updatedAt: new Date()
      };
    }

    // Remove undefined fields
    Object.keys(processedQuestion).forEach(key => {
      if (processedQuestion[key] === undefined || processedQuestion[key] === null) {
        delete processedQuestion[key];
      }
    });

    // Update the specific question in the array
    questionBank.questions[existingQuestionIndex] = processedQuestion;
    await questionBank.save();
    
    console.log(`✅ Updated question with ID: ${id} successfully`);

    return res.status(200).json({
      success: true,
      message: 'Question updated successfully',
      data: {
        questionBankId: questionBank._id.toString(),
        totalQuestionsInBank: questionBank.questions.length,
        updatedQuestion: processedQuestion
      }
    });

  } catch (error) {
    console.error("❌ Error updating question:", error);
    return res.status(500).json({
      success: false,
      message: 'Error updating question in question bank',
      error: error.message
    });
  }
};

// Delete question (soft delete) with institution check
exports.deleteQuestionBank = async (req, res) => {
  try {
    const institutionId = req.user?.institution?._id || req.user?.institution;
    
    if (!institutionId) {
      return res.status(400).json({
        success: false,
        message: 'User institution not found'
      });
    }

    const questionBank = await Question.findOneAndUpdate(
      {
        institution: institutionId
      },
      {
        $pull: {
          questions: { _id: req.params.id }
        }
      },
      {
        new: true
      }
    );

    if (!questionBank) {
      return res.status(404).json({
        success: false,
        message: 'Question bank not found for this institution'
      });
    }

    const questionExists = questionBank.questions.some(q => 
      q._id.toString() === req.params.id
    );

    if (questionExists) {
      return res.status(404).json({
        success: false,
        message: 'Question not found in the question bank'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Question deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting question',
      error: error.message
    });
  }
};

// Toggle question status
exports.toggleQuestionStatus = async (req, res) => {
  try {
    const { questionId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive must be a boolean value',
      });
    }

    const questionBank = await Question.findOne(
      { 'questions._id': questionId },
      { 'questions.$': 1 }
    );

    if (!questionBank) {
      return res.status(404).json({
        success: false,
        message: 'Question not found',
      });
    }

    const result = await Question.findOneAndUpdate(
      { 'questions._id': questionId },
      { 
        $set: { 
          'questions.$.isActive': isActive,
          'questions.$.updatedAt': new Date().toISOString()
        }
      },
      { new: true, runValidators: true }
    ).select('questions');

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Failed to update question status',
      });
    }

    const updatedQuestion = result.questions.find(q => q._id.toString() === questionId);

    res.status(200).json({
      success: true,
      message: `Question ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: updatedQuestion,
    });
  } catch (error) {
    console.error('Error toggling question status:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating question status',
      error: error.message,
    });
  }
};