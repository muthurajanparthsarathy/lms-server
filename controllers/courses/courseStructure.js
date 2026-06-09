const CourseStructure = require("../../models/Courses/courseStructureModal");
const CourseStructureDynamic = require("../../models/dynamicContent/courseStructureDynamicModal");
const mongoose = require("mongoose");
const { createClient } = require("@supabase/supabase-js");
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;

const supabase = createClient(supabaseUrl, supabaseKey);
const User = require("../../models/UserModel");
const { sendEmail } = require("../../utils/sendEmail");


exports.createCourseStructure = async (req, res) => {
  try {
    console.log('=== Create Course Request ===');
    console.log('Has files:', !!req.files);
    console.log('Files keys:', req.files ? Object.keys(req.files) : 'none');
    
    let resourcesType = { iDo: {}, weDo: {}, youDo: {} };
    
    // Helper function to parse nested object fields with proper AI handling
    const parseNestedObject = (prefix) => {
      const result = {
        video: { 
          enabled: false, 
          maxSize: 50, 
          allowedFormats: ['mp4', 'mov', 'avi', 'webm'],
          aiChat: false,
          aiSummary: false
        },
        ppt: { 
          enabled: false, 
          maxSize: 20, 
          allowedFormats: ['ppt', 'pptx'],
          aiChat: false,
          aiSummary: false
        },
        pdf: { 
          enabled: false, 
          maxSize: 10, 
          allowedFormats: ['pdf'],
          aiChat: false,
          aiSummary: false
        },
        url: { enabled: false },
        aiChat: { enabled: false, config: { model: 'gpt-3.5-turbo', temperature: 0.7 } },
        aiSummary: { enabled: false, config: { length: 'medium', language: 'en' } },
        notes: { enabled: false }
      };
      
      // Parse video fields
      if (req.body[`${prefix}[video][enabled]`] !== undefined) {
        result.video.enabled = req.body[`${prefix}[video][enabled]`] === 'true';
      }
      if (req.body[`${prefix}[video][maxSize]`] !== undefined) {
        result.video.maxSize = parseFloat(req.body[`${prefix}[video][maxSize]`]);
      }
      // Parse video AI Chat
      if (req.body[`${prefix}[video][aiChat]`] !== undefined) {
        result.video.aiChat = req.body[`${prefix}[video][aiChat]`] === 'true';
      }
      // Parse video AI Summary
      if (req.body[`${prefix}[video][aiSummary]`] !== undefined) {
        result.video.aiSummary = req.body[`${prefix}[video][aiSummary]`] === 'true';
      }
      
      // Parse ppt fields
      if (req.body[`${prefix}[ppt][enabled]`] !== undefined) {
        result.ppt.enabled = req.body[`${prefix}[ppt][enabled]`] === 'true';
      }
      if (req.body[`${prefix}[ppt][maxSize]`] !== undefined) {
        result.ppt.maxSize = parseFloat(req.body[`${prefix}[ppt][maxSize]`]);
      }
      // Parse ppt AI Chat
      if (req.body[`${prefix}[ppt][aiChat]`] !== undefined) {
        result.ppt.aiChat = req.body[`${prefix}[ppt][aiChat]`] === 'true';
      }
      // Parse ppt AI Summary
      if (req.body[`${prefix}[ppt][aiSummary]`] !== undefined) {
        result.ppt.aiSummary = req.body[`${prefix}[ppt][aiSummary]`] === 'true';
      }
      
      // Parse pdf fields
      if (req.body[`${prefix}[pdf][enabled]`] !== undefined) {
        result.pdf.enabled = req.body[`${prefix}[pdf][enabled]`] === 'true';
      }
      if (req.body[`${prefix}[pdf][maxSize]`] !== undefined) {
        result.pdf.maxSize = parseFloat(req.body[`${prefix}[pdf][maxSize]`]);
      }
      // Parse pdf AI Chat
      if (req.body[`${prefix}[pdf][aiChat]`] !== undefined) {
        result.pdf.aiChat = req.body[`${prefix}[pdf][aiChat]`] === 'true';
      }
      // Parse pdf AI Summary
      if (req.body[`${prefix}[pdf][aiSummary]`] !== undefined) {
        result.pdf.aiSummary = req.body[`${prefix}[pdf][aiSummary]`] === 'true';
      }
      
      // Parse url
      if (req.body[`${prefix}[url][enabled]`] !== undefined) {
        result.url.enabled = req.body[`${prefix}[url][enabled]`] === 'true';
      }
      
      // Parse aiChat (global for I_Do)
      if (req.body[`${prefix}[aiChat][enabled]`] !== undefined) {
        result.aiChat.enabled = req.body[`${prefix}[aiChat][enabled]`] === 'true';
      }
      if (req.body[`${prefix}[aiChat][config][model]`] !== undefined) {
        result.aiChat.config.model = req.body[`${prefix}[aiChat][config][model]`];
      }
      if (req.body[`${prefix}[aiChat][config][temperature]`] !== undefined) {
        result.aiChat.config.temperature = parseFloat(req.body[`${prefix}[aiChat][config][temperature]`]);
      }
      
      // Parse aiSummary (global for I_Do)
      if (req.body[`${prefix}[aiSummary][enabled]`] !== undefined) {
        result.aiSummary.enabled = req.body[`${prefix}[aiSummary][enabled]`] === 'true';
      }
      if (req.body[`${prefix}[aiSummary][config][length]`] !== undefined) {
        result.aiSummary.config.length = req.body[`${prefix}[aiSummary][config][length]`];
      }
      if (req.body[`${prefix}[aiSummary][config][language]`] !== undefined) {
        result.aiSummary.config.language = req.body[`${prefix}[aiSummary][config][language]`];
      }
      
      // Parse notes
      if (req.body[`${prefix}[notes][enabled]`] !== undefined) {
        result.notes.enabled = req.body[`${prefix}[notes][enabled]`] === 'true';
      }
      
      return result;
    };
    
    // Parse resources for each pedagogy type
    resourcesType.iDo = parseNestedObject('resourcesType[iDo]');
    resourcesType.weDo = parseNestedObject('resourcesType[weDo]');
    resourcesType.youDo = parseNestedObject('resourcesType[youDo]');
    
    // Parse testConfiguration configuration (flat format: { coreProgram, frontend, database })
    const parseTestConfigurationConfig = () => {
      const result = { coreProgram: [], frontend: [], database: [] };
      const coreProgramPattern = /^testConfiguration\[coreProgram\](?:\[(\d+)\])?$/;
      const frontendPattern = /^testConfiguration\[frontend\](?:\[(\d+)\])?$/;
      const databasePattern = /^testConfiguration\[database\](?:\[(\d+)\])?$/;

      for (let key in req.body) {
        const value = req.body[key];
        if (!value) continue;
        if (coreProgramPattern.test(key) && !result.coreProgram.includes(value)) {
          result.coreProgram.push(value);
        } else if (frontendPattern.test(key) && !result.frontend.includes(value)) {
          result.frontend.push(value);
        } else if (databasePattern.test(key) && !result.database.includes(value)) {
          result.database.push(value);
        }
      }
      return result;
    };

    const testConfigurationConfig = parseTestConfigurationConfig();
    console.log('Parsed testConfiguration config:', JSON.stringify(testConfigurationConfig, null, 2));
    
    // Parse arrays from form data
    const parseArrayField = (fieldName) => {
      const values = [];
      for (let key in req.body) {
        if (key.startsWith(`${fieldName}[`) && key.endsWith(']')) {
          values.push(req.body[key]);
        }
      }
      if (req.body[fieldName] && Array.isArray(req.body[fieldName])) {
        return req.body[fieldName];
      }
      return values.length > 0 ? values : (req.body[fieldName] || []);
    };
    
    const courseHierarchy = parseArrayField('courseHierarchy');
    const I_Do = parseArrayField('I_Do');
    const We_Do = parseArrayField('We_Do');
    const You_Do = parseArrayField('You_Do');
    
    const {
      clientName,
      serviceType,
      serviceModal,
      category,
      courseCode,
      courseName,
      courseDescription,
      courseDuration,
      courseLevel,
      aiChatGlobal,
    } = req.body;
    
    console.log('Parsed resourcesType:', JSON.stringify(resourcesType, null, 2));
    
    // Check if courseCode already exists
    if (courseCode) {
      const existingCourse = await CourseStructure.findOne({ courseCode });
      if (existingCourse) {
        return res.status(403).json({
          message: [{ key: "error", value: "Course Code already exists" }],
        });
      }
    }
    
    // Required fields check
    if (!clientName || !serviceType || !serviceModal || !category || !courseName) {
      return res.status(400).json({
        message: [{ key: "error", value: "Required fields are missing" }],
      });
    }
    
    // Validate if clientName is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(clientName)) {
      return res.status(400).json({
        message: [{ key: "error", value: "Invalid client ID format" }],
      });
    }
    
    // Check if the client exists
    const dynamicStructure = await CourseStructureDynamic.findOne({
      "client._id": clientName,
      institution: req.user.institution,
    });
    
    if (!dynamicStructure) {
      return res.status(404).json({
        message: [{ key: "error", value: "Client not found in the system" }],
      });
    }
    
    // Image upload handler
    let imageUrl = undefined;
    
    const extractFileData = (fileInput) => {
      let fileObj = fileInput;
      if (Array.isArray(fileInput)) {
        fileObj = fileInput[0];
      }
      
      if (!fileObj) return null;
      
      let fileData = null;
      let fileName = null;
      let mimeType = null;
      
      if (fileObj.data) {
        fileData = fileObj.data;
        fileName = fileObj.name || fileObj.originalname || 'image';
        mimeType = fileObj.mimetype || fileObj.type || 'image/jpeg';
      } 
      else if (fileObj.buffer) {
        fileData = fileObj.buffer;
        fileName = fileObj.originalname || fileObj.name || 'image';
        mimeType = fileObj.mimetype || fileObj.type || 'image/jpeg';
      }
      else if (fileObj.path) {
        const fs = require('fs');
        if (fs.existsSync(fileObj.path)) {
          fileData = fs.readFileSync(fileObj.path);
          fileName = fileObj.originalname || fileObj.name || 'image';
          mimeType = fileObj.mimetype || fileObj.type || 'image/jpeg';
        }
      }
      
      return fileData ? { fileData, fileName, mimeType } : null;
    };
    
    if (req.files && req.files.courseImage) {
      try {
        const extracted = extractFileData(req.files.courseImage);
        
        if (extracted) {
          const { fileData, fileName, mimeType } = extracted;
          
          console.log('Processing image:', {
            fileName: fileName,
            fileSize: fileData.length,
            fileType: mimeType,
          });
          
          if (fileData.length > 5 * 1024 * 1024) {
            return res.status(400).json({
              message: [{ key: "error", value: "Image size should be less than 5MB" }],
            });
          }
          
          const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
          if (!validTypes.includes(mimeType)) {
            return res.status(400).json({
              message: [{ key: "error", value: "Only JPEG, JPG, PNG, WebP, and GIF formats are allowed" }],
            });
          }
          
          const timestamp = Date.now();
          const extension = mimeType.split('/')[1] || 'jpg';
          const baseFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
          const uniqueFileName = `${timestamp}_${baseFileName}`;
          
          console.log('Uploading to Supabase:', uniqueFileName);
          
          const { error: uploadError } = await supabase.storage
            .from("smartlms")
            .upload(`course/image/${uniqueFileName}`, fileData, {
              contentType: mimeType,
              cacheControl: '3600',
              upsert: false
            });
          
          if (!uploadError) {
            const { data: publicUrlData } = supabase.storage
              .from("smartlms")
              .getPublicUrl(`course/image/${uniqueFileName}`);
            
            imageUrl = publicUrlData.publicUrl;
            console.log('Image URL generated:', imageUrl);
          }
        }
      } catch (error) {
        console.error("Error processing image:", error);
      }
    }
    
    // Create and save course with testConfiguration configuration
    const newCourse = new CourseStructure({
      institution: req.user.institution,
      clientName,
      serviceType,
      serviceModal,
      category,
      courseCode,
      courseName,
      courseDescription: courseDescription || "",
      courseDuration: courseDuration || "",
      courseLevel,
      aiChatGlobal: aiChatGlobal === 'true' || aiChatGlobal === true,
      resourcesType: resourcesType,
      testConfiguration: testConfigurationConfig,
      courseHierarchy: courseHierarchy,
      I_Do: I_Do,
      We_Do: We_Do,
      You_Do: You_Do,
      courseImage: imageUrl,
      createdBy: req.user.email,
    });
    
    const savedCourse = await newCourse.save();
    
    console.log("Course saved successfully:", {
      id: savedCourse._id,
      courseName: savedCourse.courseName,
      testConfiguration: savedCourse.testConfiguration,
      resourcesType: {
        iDo: {
          video: { aiChat: savedCourse.resourcesType.iDo.video?.aiChat, aiSummary: savedCourse.resourcesType.iDo.video?.aiSummary },
          ppt: { aiChat: savedCourse.resourcesType.iDo.ppt?.aiChat, aiSummary: savedCourse.resourcesType.iDo.ppt?.aiSummary },
          pdf: { aiChat: savedCourse.resourcesType.iDo.pdf?.aiChat, aiSummary: savedCourse.resourcesType.iDo.pdf?.aiSummary }
        },
        weDo: {
          aiChat: savedCourse.resourcesType.weDo.aiChat?.enabled,
          aiSummary: savedCourse.resourcesType.weDo.aiSummary?.enabled,
          notes: savedCourse.resourcesType.weDo.notes?.enabled
        },
        youDo: {
          aiChat: savedCourse.resourcesType.youDo.aiChat?.enabled,
          aiSummary: savedCourse.resourcesType.youDo.aiSummary?.enabled,
          notes: savedCourse.resourcesType.youDo.notes?.enabled
        }
      }
    });
    
    return res.status(201).json({
      message: [{ key: "success", value: "Course structure created successfully" }],
      data: savedCourse,
    });
    
  } catch (error) {
    console.error("Error adding course structure:", error);
    return res.status(500).json({
      message: [{ key: "error", value: "Server error while adding course structure: " + error.message }],
    });
  }
};
exports.updateCourseStructure = async (req, res) => {
  try {
    const { courseId } = req.params;
    
    console.log('=== Update Course Request ===');
    console.log('Course ID:', courseId);
    console.log('Has files:', !!req.files);
    console.log('Files keys:', req.files ? Object.keys(req.files) : 'none');
    
    // Parse nested resourcesType configuration from form data (same as create)
    let resourcesType = { iDo: {}, weDo: {}, youDo: {} };
    
    // Helper function to parse nested object fields with proper AI handling
    const parseNestedObject = (prefix) => {
      const result = {
        video: { 
          enabled: false, 
          maxSize: 50, 
          allowedFormats: ['mp4', 'mov', 'avi', 'webm'],
          aiChat: false,
          aiSummary: false
        },
        ppt: { 
          enabled: false, 
          maxSize: 20, 
          allowedFormats: ['ppt', 'pptx'],
          aiChat: false,
          aiSummary: false
        },
        pdf: { 
          enabled: false, 
          maxSize: 10, 
          allowedFormats: ['pdf'],
          aiChat: false,
          aiSummary: false
        },
        url: { enabled: false },
        aiChat: { enabled: false, config: { model: 'gpt-3.5-turbo', temperature: 0.7 } },
        aiSummary: { enabled: false, config: { length: 'medium', language: 'en' } },
        notes: { enabled: false }
      };
      
      // Parse video fields
      if (req.body[`${prefix}[video][enabled]`] !== undefined) {
        result.video.enabled = req.body[`${prefix}[video][enabled]`] === 'true';
      }
      if (req.body[`${prefix}[video][maxSize]`] !== undefined) {
        result.video.maxSize = parseFloat(req.body[`${prefix}[video][maxSize]`]);
      }
      if (req.body[`${prefix}[video][aiChat]`] !== undefined) {
        result.video.aiChat = req.body[`${prefix}[video][aiChat]`] === 'true';
      }
      if (req.body[`${prefix}[video][aiSummary]`] !== undefined) {
        result.video.aiSummary = req.body[`${prefix}[video][aiSummary]`] === 'true';
      }
      
      // Parse ppt fields
      if (req.body[`${prefix}[ppt][enabled]`] !== undefined) {
        result.ppt.enabled = req.body[`${prefix}[ppt][enabled]`] === 'true';
      }
      if (req.body[`${prefix}[ppt][maxSize]`] !== undefined) {
        result.ppt.maxSize = parseFloat(req.body[`${prefix}[ppt][maxSize]`]);
      }
      if (req.body[`${prefix}[ppt][aiChat]`] !== undefined) {
        result.ppt.aiChat = req.body[`${prefix}[ppt][aiChat]`] === 'true';
      }
      if (req.body[`${prefix}[ppt][aiSummary]`] !== undefined) {
        result.ppt.aiSummary = req.body[`${prefix}[ppt][aiSummary]`] === 'true';
      }
      
      // Parse pdf fields
      if (req.body[`${prefix}[pdf][enabled]`] !== undefined) {
        result.pdf.enabled = req.body[`${prefix}[pdf][enabled]`] === 'true';
      }
      if (req.body[`${prefix}[pdf][maxSize]`] !== undefined) {
        result.pdf.maxSize = parseFloat(req.body[`${prefix}[pdf][maxSize]`]);
      }
      if (req.body[`${prefix}[pdf][aiChat]`] !== undefined) {
        result.pdf.aiChat = req.body[`${prefix}[pdf][aiChat]`] === 'true';
      }
      if (req.body[`${prefix}[pdf][aiSummary]`] !== undefined) {
        result.pdf.aiSummary = req.body[`${prefix}[pdf][aiSummary]`] === 'true';
      }
      
      // Parse url
      if (req.body[`${prefix}[url][enabled]`] !== undefined) {
        result.url.enabled = req.body[`${prefix}[url][enabled]`] === 'true';
      }
      
      // Parse aiChat
      if (req.body[`${prefix}[aiChat][enabled]`] !== undefined) {
        result.aiChat.enabled = req.body[`${prefix}[aiChat][enabled]`] === 'true';
      }
      if (req.body[`${prefix}[aiChat][config][model]`] !== undefined) {
        result.aiChat.config.model = req.body[`${prefix}[aiChat][config][model]`];
      }
      if (req.body[`${prefix}[aiChat][config][temperature]`] !== undefined) {
        result.aiChat.config.temperature = parseFloat(req.body[`${prefix}[aiChat][config][temperature]`]);
      }
      
      // Parse aiSummary
      if (req.body[`${prefix}[aiSummary][enabled]`] !== undefined) {
        result.aiSummary.enabled = req.body[`${prefix}[aiSummary][enabled]`] === 'true';
      }
      if (req.body[`${prefix}[aiSummary][config][length]`] !== undefined) {
        result.aiSummary.config.length = req.body[`${prefix}[aiSummary][config][length]`];
      }
      if (req.body[`${prefix}[aiSummary][config][language]`] !== undefined) {
        result.aiSummary.config.language = req.body[`${prefix}[aiSummary][config][language]`];
      }
      
      // Parse notes
      if (req.body[`${prefix}[notes][enabled]`] !== undefined) {
        result.notes.enabled = req.body[`${prefix}[notes][enabled]`] === 'true';
      }
      
      return result;
    };
    
    // Parse resources for each pedagogy type
    resourcesType.iDo = parseNestedObject('resourcesType[iDo]');
    resourcesType.weDo = parseNestedObject('resourcesType[weDo]');
    resourcesType.youDo = parseNestedObject('resourcesType[youDo]');
    
    // ========== Parse testConfiguration configuration (flat format) ==========
    const parseTestConfigurationConfig = () => {
      const result = { coreProgram: [], frontend: [], database: [] };
      const coreProgramPattern = /^testConfiguration\[coreProgram\](?:\[(\d+)\])?$/;
      const frontendPattern = /^testConfiguration\[frontend\](?:\[(\d+)\])?$/;
      const databasePattern = /^testConfiguration\[database\](?:\[(\d+)\])?$/;

      for (let key in req.body) {
        const value = req.body[key];
        if (!value) continue;
        if (coreProgramPattern.test(key) && !result.coreProgram.includes(value)) {
          result.coreProgram.push(value);
        } else if (frontendPattern.test(key) && !result.frontend.includes(value)) {
          result.frontend.push(value);
        } else if (databasePattern.test(key) && !result.database.includes(value)) {
          result.database.push(value);
        }
      }
      return result;
    };

    const testConfigurationConfig = parseTestConfigurationConfig();
    console.log('Update - Parsed testConfiguration config:', JSON.stringify(testConfigurationConfig, null, 2));
    // ========== END ==========
    
    // Parse arrays from form data
    const parseArrayField = (fieldName) => {
      const values = [];
      for (let key in req.body) {
        if (key.startsWith(`${fieldName}[`) && key.endsWith(']')) {
          values.push(req.body[key]);
        }
      }
      if (req.body[fieldName] && Array.isArray(req.body[fieldName])) {
        return req.body[fieldName];
      }
      return values.length > 0 ? values : (req.body[fieldName] || []);
    };
    
    const courseHierarchy = parseArrayField('courseHierarchy');
    const I_Do = parseArrayField('I_Do');
    const We_Do = parseArrayField('We_Do');
    const You_Do = parseArrayField('You_Do');
    
    const {
      clientName,
      serviceType,
      serviceModal,
      category,
      courseCode,
      courseName,
      courseDescription,
      courseDuration,
      courseLevel,
      removeImage,
      aiChatGlobal
    } = req.body;
    
    console.log('Update - Parsed resourcesType:', JSON.stringify(resourcesType, null, 2));
    console.log('Update - Received I_Do:', I_Do);
    console.log('Update - Received We_Do:', We_Do);
    console.log('Update - Received You_Do:', You_Do);
    console.log('Update - Received courseHierarchy:', courseHierarchy);
    console.log('Update - Remove Image Flag:', removeImage);
    
    // Check if course exists
    const existingCourse = await CourseStructure.findById(courseId);
    if (!existingCourse) {
      return res.status(404).json({
        message: [{ key: "error", value: "Course not found" }],
      });
    }
    
    // Check if courseCode already exists (excluding current course)
    if (courseCode && courseCode !== existingCourse.courseCode) {
      const courseWithSameCode = await CourseStructure.findOne({ 
        courseCode, 
        _id: { $ne: courseId } 
      });
      if (courseWithSameCode) {
        return res.status(403).json({
          message: [{ key: "error", value: "Course Code already exists" }],
        });
      }
    }
    
    // Required fields check
    if (!clientName || !serviceType || !serviceModal || !category || !courseName) {
      return res.status(400).json({
        message: [{ key: "error", value: "Required fields are missing" }],
      });
    }
    
    // Validate if clientName is a valid MongoDB ObjectId
    if (clientName && !mongoose.Types.ObjectId.isValid(clientName)) {
      return res.status(400).json({
        message: [{ key: "error", value: "Invalid client ID format" }],
      });
    }
    
    // Check if the client exists in Course-Structure-Dynamic (if client changed)
    if (clientName && clientName !== existingCourse.clientName.toString()) {
      const dynamicStructure = await CourseStructureDynamic.findOne({
        "client._id": clientName,
        institution: req.user.institution,
      });
      
      if (!dynamicStructure) {
        return res.status(404).json({
          message: [{ key: "error", value: "Client not found in the system" }],
        });
      }
    }
    
    // Helper function to extract file data from various formats
    const extractFileData = (fileInput) => {
      let fileObj = fileInput;
      if (Array.isArray(fileInput)) {
        fileObj = fileInput[0];
      }
      
      if (!fileObj) return null;
      
      let fileData = null;
      let fileName = null;
      let mimeType = null;
      
      if (fileObj.data) {
        fileData = fileObj.data;
        fileName = fileObj.name || fileObj.originalname || 'image';
        mimeType = fileObj.mimetype || fileObj.type || 'image/jpeg';
      } 
      else if (fileObj.buffer) {
        fileData = fileObj.buffer;
        fileName = fileObj.originalname || fileObj.name || 'image';
        mimeType = fileObj.mimetype || fileObj.type || 'image/jpeg';
      }
      else if (fileObj.path) {
        const fs = require('fs');
        if (fs.existsSync(fileObj.path)) {
          fileData = fs.readFileSync(fileObj.path);
          fileName = fileObj.originalname || fileObj.name || 'image';
          mimeType = fileObj.mimetype || fileObj.type || 'image/jpeg';
        }
      }
      
      return fileData ? { fileData, fileName, mimeType } : null;
    };
    
    // Handle image upload/removal
    let imageUrl = existingCourse.courseImage;
    const imageFile = req.files?.courseImage;
    
    // If removeImage flag is true, remove the image
    if (removeImage === 'true') {
      imageUrl = undefined;
      console.log('Image removal requested');
      
      if (existingCourse.courseImage) {
        try {
          const oldImagePath = existingCourse.courseImage.split('/').pop();
          if (oldImagePath) {
            await supabase.storage.from("smartlms").remove([`course/image/${oldImagePath}`]);
            console.log('Old image deleted on removal:', oldImagePath);
          }
        } catch (deleteError) {
          console.error('Error deleting old image on removal:', deleteError);
        }
      }
    }
    
    // If new image is uploaded, upload it
    if (imageFile && removeImage !== 'true') {
      try {
        const extracted = extractFileData(imageFile);
        
        if (extracted) {
          const { fileData, fileName, mimeType } = extracted;
          
          console.log('Processing new image for update:', {
            fileName: fileName,
            fileSize: fileData.length,
            fileType: mimeType
          });
          
          if (fileData.length > 5 * 1024 * 1024) {
            return res.status(400).json({
              message: [{ key: "error", value: "Image size should be less than 5MB" }],
            });
          }
          
          const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
          if (!validTypes.includes(mimeType)) {
            return res.status(400).json({
              message: [{ key: "error", value: "Only JPEG, JPG, PNG, WebP, and GIF formats are allowed" }],
            });
          }
          
          const timestamp = Date.now();
          const baseFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
          const uniqueFileName = `${timestamp}_${baseFileName}`;
          
          console.log('Uploading new image to Supabase:', uniqueFileName);
          
          const { error: uploadError } = await supabase.storage
            .from("smartlms")
            .upload(`course/image/${uniqueFileName}`, fileData, {
              contentType: mimeType,
              cacheControl: '3600',
              upsert: false
            });
          
          if (uploadError) {
            console.error("Error uploading image to Supabase:", uploadError);
            return res.status(500).json({
              message: [{ key: "error", value: "Error uploading image to Supabase: " + uploadError.message }],
            });
          }
          
          const { data: publicUrlData } = supabase.storage
            .from("smartlms")
            .getPublicUrl(`course/image/${uniqueFileName}`);
          
          imageUrl = publicUrlData.publicUrl;
          console.log('New image URL generated:', imageUrl);
          
          // Delete old image if it exists
          if (existingCourse.courseImage) {
            try {
              const oldImagePath = existingCourse.courseImage.split('/').pop();
              if (oldImagePath) {
                await supabase.storage.from("smartlms").remove([`course/image/${oldImagePath}`]);
                console.log('Old image deleted:', oldImagePath);
              }
            } catch (deleteError) {
              console.error('Error deleting old image:', deleteError);
            }
          }
        }
      } catch (error) {
        console.error("Error processing image update:", error);
        imageUrl = existingCourse.courseImage;
      }
    }
    
    // Prepare update data
    const updateData = {
      clientName,
      serviceType,
      serviceModal,
      category,
      courseCode,
      courseName,
      courseDescription: courseDescription || "",
      courseDuration: courseDuration || "",
      courseLevel,
      aiChatGlobal: aiChatGlobal === 'true' || aiChatGlobal === true,
      resourcesType: resourcesType,
      testConfiguration: testConfigurationConfig, // ADDED: Include testConfiguration in update
      courseHierarchy: courseHierarchy,
      I_Do: I_Do,
      We_Do: We_Do,
      You_Do: You_Do,
      updatedBy: req.user.email,
      updatedAt: new Date()
    };
    
    // Only update image if it was changed
    if (imageUrl !== existingCourse.courseImage) {
      updateData.courseImage = imageUrl;
    }
    
    // Remove undefined fields to avoid overwriting with undefined
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });
    
    // Update course
    const updatedCourse = await CourseStructure.findByIdAndUpdate(
      courseId,
      updateData,
      { new: true, runValidators: true }
    );
    
    if (!updatedCourse) {
      return res.status(404).json({
        message: [{ key: "error", value: "Course not found" }],
      });
    }
    
    console.log("Course updated successfully:", {
      id: updatedCourse._id,
      courseName: updatedCourse.courseName,
      courseCode: updatedCourse.courseCode,
      hasImage: !!updatedCourse.courseImage,
      testConfiguration: updatedCourse.testConfiguration,
      resourcesType: {
        iDo: {
          video: { aiChat: updatedCourse.resourcesType.iDo.video?.aiChat, aiSummary: updatedCourse.resourcesType.iDo.video?.aiSummary },
          ppt: { aiChat: updatedCourse.resourcesType.iDo.ppt?.aiChat, aiSummary: updatedCourse.resourcesType.iDo.ppt?.aiSummary },
          pdf: { aiChat: updatedCourse.resourcesType.iDo.pdf?.aiChat, aiSummary: updatedCourse.resourcesType.iDo.pdf?.aiSummary }
        },
        weDo: {
          aiChat: updatedCourse.resourcesType.weDo.aiChat?.enabled,
          aiSummary: updatedCourse.resourcesType.weDo.aiSummary?.enabled,
          notes: updatedCourse.resourcesType.weDo.notes?.enabled
        },
        youDo: {
          aiChat: updatedCourse.resourcesType.youDo.aiChat?.enabled,
          aiSummary: updatedCourse.resourcesType.youDo.aiSummary?.enabled,
          notes: updatedCourse.resourcesType.youDo.notes?.enabled
        }
      }
    });
    
    return res.status(200).json({
      message: [{ key: "success", value: "Course structure updated successfully" }],
      data: updatedCourse,
    });
    
  } catch (error) {
    console.error("Error updating course structure:", error);
    return res.status(500).json({
      message: [{ key: "error", value: "Server error while updating course structure: " + error.message }],
    });
  }
};

exports.getCourseStructure = async (req, res) => {
  try {
    const courseStructures = await CourseStructure.find({
      institution: req.user.institution,
    });

    // Manually populate client data from Course-Structure-Dynamic
    const populatedCourses = await Promise.all(
      courseStructures.map(async (course) => {
        const dynamicStructure = await CourseStructureDynamic.findOne({
          "client._id": course.clientName,
        });

        if (dynamicStructure) {
          const client = dynamicStructure.client.find(
            (client) => client._id.toString() === course.clientName.toString()
          );

          // Create a new object with modified clientName
          const courseObj = course.toObject();

          return {
            ...courseObj,
            clientName: client ? client.clientCompany : courseObj.clientName,
            clientData: client,
          };
        }

        return course.toObject();
      })
    );

    return res.status(200).json({
      message: [
        { key: "success", value: "Course structures retrieved successfully" },
      ],
      data: populatedCourses,
    });
  } catch (error) {
    console.error("Error fetching course structures:", error);
    return res.status(500).json({
      message: [
        {
          key: "error",
          value: "Server error while fetching course structures",
        },
      ],
    });
  }
};


exports.getAllCoursesDataWithoutAINotes = async (req, res) => {
  try {

    // Find the course with participants and complete user data
 const course = await CourseStructure.find({
      institution: req.user.institution,
    }).populate({
        path: 'singleParticipants.user',
        select: '-notes -ai_history -password -tokens -__v -notifications',
        populate: [
          {
            path: 'role',
            select: 'name description'
          },
          {
            path: 'courses.courseId',
            select: 'courseName courseCode description'
          }
        ]
      })
      .lean();

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Course not found"
      });
    }

    // Get complete course progress for all participants
    const participantsWithFullData = await Promise.all(
      course.singleParticipants.map(async (participant) => {
        if (!participant.user) {
          return {
            ...participant,
            user_Data: null
          };
        }

        // Get the complete course progress data for this specific course
        const user = await User.findById(participant.user._id)
          .select('courses')
          .lean();

        // Find the full course progress for this specific course
        const fullCourseProgress = user?.courses?.find(
          course => course.courseId && course.courseId.toString() === course
        );

        // Merge the basic user data with complete course progress
        const userData = {
          ...participant.user,
          courses: fullCourseProgress ? [fullCourseProgress] : []
        };

        // Clean up the data
        const cleanUserData = JSON.parse(JSON.stringify(userData, (key, value) => {
          // Remove unwanted fields
          if (key === 'notes' || key === 'ai_history' || key === 'password' || 
              key === 'tokens' || key === '__v' || key === '$__' || 
              key === '$isNew' || value === undefined) {
            return undefined;
          }
          return value;
        }));

        return {
          _id: participant._id,
          status: participant.status,
          enableEnrolmentDates: participant.enableEnrolmentDates,
          enrolmentStartsDate: participant.enrolmentStartsDate,
          enrolmentEndsDate: participant.enrolmentEndsDate,
          createdAt: participant.createdAt,
          updatedAt: participant.updatedAt,
          user_Data: cleanUserData
        };
      })
    );

    // Fetch course structure components
    const [modules, subModules, topics, subTopics] = await Promise.all([
      Module1.find({ courses: course }).select('-__v -createdAt -updatedAt').lean(),
      SubModule1.find({ moduleId: { $in: await Module1.find({ courses: course }).distinct('_id') } })
        .select('-__v -createdAt -updatedAt').lean(),
      Topic1.find({
        $or: [
          { moduleId: { $in: await Module1.find({ courses: course }).distinct('_id') } },
          { subModuleId: { $in: await SubModule1.find().distinct('_id') } }
        ]
      }).select('-__v -createdAt -updatedAt').lean(),
      SubTopic1.find({ 
        topicId: { $in: await Topic1.find().distinct('_id') } 
      }).select('-__v -createdAt -updatedAt').lean()
    ]);

    // Structure modules with their relationships
    const structuredModules = modules.map(module => {
      const moduleSubModules = subModules.filter(
        sm => sm.moduleId?.toString() === module._id.toString()
      );

      const processedSubModules = moduleSubModules.map(subModule => {
        const subModuleTopics = topics.filter(
          t => t.subModuleId?.toString() === subModule._id.toString()
        );

        const processedTopics = subModuleTopics.map(topic => ({
          ...topic,
          subTopics: subTopics.filter(
            st => st.topicId?.toString() === topic._id.toString()
          )
        }));

        return {
          ...subModule,
          topics: processedTopics
        };
      });

      const moduleDirectTopics = topics.filter(
        t =>
          t.moduleId?.toString() === module._id.toString() &&
          (!t.subModuleId || !moduleSubModules.some(sm => sm._id.toString() === t.subModuleId?.toString()))
      );

      const processedDirectTopics = moduleDirectTopics.map(topic => ({
        ...topic,
        subTopics: subTopics.filter(
          st => st.topicId?.toString() === topic._id.toString()
        )
      }));

      return {
        ...module,
        subModules: processedSubModules,
        topics: processedDirectTopics
      };
    });

    // Construct final response
    const responseData = {
      _id: course._id,
      courseName: course.courseName,
      courseCode: course.courseCode,
      description: course.description,
      singleParticipants: participantsWithFullData,
      modules: structuredModules,
      meta: {
        participantsCount: participantsWithFullData.length,
        modulesCount: modules.length,
        subModulesCount: subModules.length,
        topicsCount: topics.length,
        subTopicsCount: subTopics.length
      }
    };

    res.status(200).json({
      success: true,
      data: responseData,
      message: "Course data with complete user progress fetched successfully"
    });

  } catch (error) {
    console.error("Error fetching course structure:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};
exports.getCourseStructureById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: [{ key: "error", value: "Invalid course ID format" }],
      });
    }

    const courseStructure = await CourseStructure.findOne({
      _id: id,
      institution: req.user.institution,
    });

    if (!courseStructure) {
      return res.status(404).json({
        message: [{ key: "error", value: "Course structure not found" }],
      });
    }

    // Manually populate client data
    const dynamicStructure = await CourseStructureDynamic.findOne({
      "client._id": courseStructure.clientName,
    });

    let populatedCourse = courseStructure.toObject();

    if (dynamicStructure) {
      const client = dynamicStructure.client.find(
        (client) =>
          client._id.toString() === courseStructure.clientName.toString()
      );

      if (client) {
        populatedCourse = {
          ...populatedCourse,
          clientId: populatedCourse.clientName,
          clientName: client.clientCompany,
          clientData: client,
        };
      }
    }

    return res.status(200).json({
      message: [
        { key: "success", value: "Course structure retrieved successfully" },
      ],
      data: populatedCourse,
    });
  } catch (error) {
    console.error("Error fetching course structure by ID:", error);
    return res.status(500).json({
      message: [
        { key: "error", value: "Server error while fetching course structure" },
      ],
    });
  }
};
;

exports.deleteCourseStructure = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate if ID is a valid MongoDB ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: [{ key: "error", value: "Invalid course ID format" }],
      });
    }

    // Find the existing course
    const existingCourse = await CourseStructure.findOne({
      _id: id,
      institution: req.user.institution,
    });

    if (!existingCourse) {
      return res.status(404).json({
        message: [{ key: "error", value: "Course structure not found" }],
      });
    }

    // Delete the associated image from Supabase (if it's not a default image)
    if (
      existingCourse.courseImage &&
      !existingCourse.courseImage.includes("default_profile_image")
    ) {
      try {
        const imagePath = existingCourse.courseImage.split("/").pop();
        const { error: deleteError } = await supabase.storage
          .from("smartlms")
          .remove([`course/image/${imagePath}`]);

        if (deleteError) {
          console.error("Error deleting image from Supabase:", deleteError);
          // Don't return error here, continue with course deletion
        }
      } catch (deleteErr) {
        console.error("Error extracting image path for deletion:", deleteErr);
        // Don't return error here, continue with course deletion
      }
    }

    // Delete the course from database
    await CourseStructure.findByIdAndDelete(id);

    return res.status(200).json({
      message: [
        { key: "success", value: "Course structure deleted successfully" },
      ],
    });
  } catch (error) {
    console.error("Error deleting course structure:", error);
    return res.status(500).json({
      message: [
        { key: "error", value: "Server error while deleting course structure" },
      ],
    });
  }
};

exports.singleAddParticipants = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { participantIds, enrollmentData = {} } = req.body;

    // Validate input
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide valid participant IDs'
      });
    }

    // Validate ObjectIds
    const validParticipantIds = participantIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    
    if (validParticipantIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid participant IDs provided'
      });
    }

    // Find the course
    const course = await CourseStructure.findById(courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // CRITICAL FIX: Ensure resourcesType has proper structure before saving
    // This fixes the validation error by ensuring resourcesType is an object, not an array
    if (course.resourcesType) {
      // Check if any of the pedagogy sections are arrays instead of objects
      const needsFix = 
        Array.isArray(course.resourcesType.iDo) ||
        Array.isArray(course.resourcesType.weDo) ||
        Array.isArray(course.resourcesType.youDo);
      
      if (needsFix) {
        console.log('Fixing malformed resourcesType data...');
        
        // Default resource config structure
        const defaultResourceConfig = {
          video: { enabled: false, maxSize: 50, allowedFormats: [], aiChat: false, aiSummary: false },
          ppt: { enabled: false, maxSize: 20, allowedFormats: [], aiChat: false, aiSummary: false },
          pdf: { enabled: false, maxSize: 10, allowedFormats: [], aiChat: false, aiSummary: false },
          url: { enabled: false },
          aiChat: { enabled: false },
          aiSummary: { enabled: false },
          notes: { enabled: false }
        };
        
        // Fix each pedagogy section
        if (Array.isArray(course.resourcesType.iDo)) {
          console.log('Fixing iDo: converting from array to object');
          course.resourcesType.iDo = { ...defaultResourceConfig };
        }
        
        if (Array.isArray(course.resourcesType.weDo)) {
          console.log('Fixing weDo: converting from array to object');
          course.resourcesType.weDo = { ...defaultResourceConfig };
        }
        
        if (Array.isArray(course.resourcesType.youDo)) {
          console.log('Fixing youDo: converting from array to object');
          course.resourcesType.youDo = { ...defaultResourceConfig };
        }
        
        // Save the fixed structure immediately
        await course.save();
        console.log('Fixed and saved malformed resourcesType');
      }
    }

    // Find all valid participants
    const participants = await User.find({
      _id: { $in: validParticipantIds }
    });

    if (participants.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No valid participants found'
      });
    }

    // Prepare enrollment data for each participant
    const enrollmentToAdd = [];
    const notificationsToSend = [];
    const emailsToSend = [];
    
    for (const participant of participants) {
      // Check if participant already exists in the course
      const existingEnrollment = course.singleParticipants.find(
        enrollment => enrollment.user.toString() === participant._id.toString()
      );

      if (!existingEnrollment) {
        // Prepare enrollment object
        enrollmentToAdd.push({
          user: participant._id,
          status: enrollmentData.status || 'active',
          enableEnrolmentDates: enrollmentData.enableEnrolmentDates || false,
          enrolmentStartsDate: enrollmentData.enrolmentStartsDate || null,
          enrolmentEndsDate: enrollmentData.enrolmentEndsDate || null,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        // Prepare notification for user
        const notification = {
          title: 'New Course Enrollment',
          message: `You have been enrolled in the course "${course.courseName}"`,
          type: 'success',
          relatedEntity: 'enrollment',
          relatedEntityId: courseId,
          enrolledBy: req.user?.id,
          metadata: new Map([
            ['Course Name', course.courseName],
            ['Course Code', course.courseCode || 'N/A'],
            ['Enrollment Date', new Date().toISOString()],
          ]),
        };

        notificationsToSend.push({
          userId: participant._id,
          notification: notification
        });

        // Prepare email for ALL users
        emailsToSend.push({
          email: participant.email,
          name: `${participant.firstName} ${participant.lastName || ''}`.trim(),
          courseName: course.courseName,
          courseCode: course.courseCode || 'N/A',
          enrollmentDate: new Date().toLocaleDateString(),
          institutionId: course.institution,
          userId: participant._id,
          user: participant
        });
      }
    }

    if (enrollmentToAdd.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'All selected participants are already enrolled in the course',
        data: course
      });
    }

    // Add new participants to the course
    course.singleParticipants.push(...enrollmentToAdd);
    course.updatedAt = new Date();
    course.updatedBy = req.user?.id || 'system';

    // Validate the document before saving
    try {
      await course.validate();
    } catch (validationError) {
      console.error('Validation error before save:', validationError);
      
      // If validation fails due to resourcesType, try to reset it
      if (validationError.errors && validationError.errors['resourcesType.iDo']) {
        console.log('Resetting resourcesType to fix validation');
        
        // Reset to default structure
        const defaultResourceConfig = {
          video: { enabled: false, maxSize: 50, allowedFormats: [], aiChat: false, aiSummary: false },
          ppt: { enabled: false, maxSize: 20, allowedFormats: [], aiChat: false, aiSummary: false },
          pdf: { enabled: false, maxSize: 10, allowedFormats: [], aiChat: false, aiSummary: false },
          url: { enabled: false },
          aiChat: { enabled: false },
          aiSummary: { enabled: false },
          notes: { enabled: false }
        };
        
        course.resourcesType = {
          iDo: { ...defaultResourceConfig },
          weDo: { ...defaultResourceConfig },
          youDo: { ...defaultResourceConfig }
        };
        
        // Save with fixed structure
        await course.save();
      } else {
        throw validationError;
      }
    }

    await course.save();

    // Add notifications to users' profiles
    const notificationPromises = notificationsToSend.map(async ({ userId, notification }) => {
      try {
        const user = await User.findById(userId);
        if (user) {
          await user.addNotification(notification);
        }
      } catch (error) {
        console.error(`Failed to add notification for user ${userId}:`, error);
      }
    });

    await Promise.all(notificationPromises);

    // Send emails in background
    if (emailsToSend.length > 0) {
      const emailPromises = emailsToSend.map(async (emailData) => {
        try {
          const emailSubject = `Enrollment Confirmation: ${emailData.courseName}`;
          const emailBody = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #2c3e50;">Course Enrollment Confirmation</h2>
              <p>Dear ${emailData.name},</p>
              <p>You have been successfully enrolled in the following course:</p>
              <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3 style="margin-top: 0;">${emailData.courseName}</h3>
                <p><strong>Course Code:</strong> ${emailData.courseCode}</p>
                <p><strong>Enrollment Date:</strong> ${emailData.enrollmentDate}</p>
              </div>
              <p>You can access the course material by logging into your LMS account.</p>
              <p>If you have any questions, please contact your course instructor or system administrator.</p>
              <br>
              <p>Best regards,<br>LMS Team</p>
            </div>
          `;

          const emailSent = await sendEmail(
            [emailData.email],
            emailSubject,
            emailBody,
            []
          );

          return { success: emailSent };
        } catch (error) {
          console.error(`Failed to send email to ${emailData.email}:`, error);
          return { success: false, error: error.message };
        }
      });

      // Send emails in background (don't wait for completion)
      Promise.all(emailPromises)
        .then(results => {
          const successful = results.filter(r => r && r.success).length;
          const failed = results.filter(r => !r || !r.success).length;
          
          results.forEach((result, index) => {
            if (!result || !result.success) {
              console.error(`Failed to send email to ${emailsToSend[index]?.email}:`, result?.error || 'Unknown error');
            }
          });
        })
        .catch(error => {
          console.error('Error in email sending process:', error);
        });
    }

    // Populate user details for response
    const populatedCourse = await CourseStructure.findById(courseId)
      .populate({
        path: 'singleParticipants.user',
        select: 'firstName lastName email phone role status degree department year semester batch gender profile createdAt'
      });

    const enrolledUsers = await User.find({
      _id: { $in: enrollmentToAdd.map(e => e.user) }
    }).select('firstName lastName email notifications unreadNotificationCount');

    res.status(200).json({
      success: true,
      message: `${enrollmentToAdd.length} participant(s) added successfully`,
      data: {
        course: populatedCourse,
        addedParticipants: enrolledUsers.map(user => ({
          id: user._id,
          name: `${user.firstName} ${user.lastName || ''}`.trim(),
          email: user.email,
          notificationsCount: user.unreadNotificationCount
        })),
        notificationsSent: notificationsToSend.length,
        emailsSent: emailsToSend.length
      }
    });

  } catch (error) {
    console.error('Error adding participants:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add participants',
      error: error.message
    });
  }
};
exports.updateParticipantEnrollment = async (req, res) => {
  try {
    const { courseId, participantId } = req.params;
    const { status, enableEnrolmentDates, enrolmentStartsDate, enrolmentEndsDate } = req.body;

    // Validate at least one field is provided
    if (!status && enableEnrolmentDates === undefined && !enrolmentStartsDate && !enrolmentEndsDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one field to update'
      });
    }

    // Find the course
    const course = await CourseStructure.findById(courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Find the participant enrollment
    const enrollmentIndex = course.singleParticipants.findIndex(
      enrollment => enrollment.user.toString() === participantId
    );

    if (enrollmentIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Participant not found in this course'
      });
    }

    // Update enrollment fields
    const enrollment = course.singleParticipants[enrollmentIndex];
    
    if (status) {
      enrollment.status = status;
    }
    
    // Handle enableEnrolmentDates
    if (enableEnrolmentDates !== undefined) {
      enrollment.enableEnrolmentDates = enableEnrolmentDates;
      
      if (enableEnrolmentDates === false) {
        // If disabling dates, set them to null
        enrollment.enrolmentStartsDate = null;
        enrollment.enrolmentEndsDate = null;
      } else if (enableEnrolmentDates === true) {
        // If enabling dates, use provided dates or set to current date
        if (enrolmentStartsDate) {
          enrollment.enrolmentStartsDate = new Date(enrolmentStartsDate);
        } else if (!enrollment.enrolmentStartsDate) {
          // Set to current date if not already set
          enrollment.enrolmentStartsDate = new Date();
        }
        
        // Set end date based on start date + default duration (365 days)
        if (enrolmentEndsDate) {
          enrollment.enrolmentEndsDate = new Date(enrolmentEndsDate);
        } else if (enrollment.enrolmentStartsDate && !enrollment.enrolmentEndsDate) {
          const endDate = new Date(enrollment.enrolmentStartsDate);
          endDate.setDate(endDate.getDate() + 365); // Default 1 year
          enrollment.enrolmentEndsDate = endDate;
        }
      }
    }
    
    // Update specific dates if provided (only when dates are enabled)
    if (enrollment.enableEnrolmentDates === true) {
      if (enrolmentStartsDate) {
        enrollment.enrolmentStartsDate = new Date(enrolmentStartsDate);
      }
      
      if (enrolmentEndsDate) {
        enrollment.enrolmentEndsDate = new Date(enrolmentEndsDate);
      }
      
      // Ensure end date is after start date
      if (enrollment.enrolmentStartsDate && enrollment.enrolmentEndsDate) {
        if (enrollment.enrolmentEndsDate < enrollment.enrolmentStartsDate) {
          return res.status(400).json({
            success: false,
            message: 'End date must be after start date'
          });
        }
      }
    }
    
    enrollment.updatedAt = new Date();

    // Save the updated course
    course.updatedAt = new Date();
    course.updatedBy = req.user?.id || 'system';
    await course.save();

    // Populate user details for response
    const populatedCourse = await CourseStructure.findById(courseId)
      .populate({
        path: 'singleParticipants.user',
        select: 'firstName lastName email phone role status degree department year semester batch gender profile createdAt'
      });

    res.status(200).json({
      success: true,
      message: 'Enrollment updated successfully',
      data: populatedCourse
    });

  } catch (error) {
    console.error('Error updating enrollment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update enrollment',
      error: error.message
    });
  }
};


// Backend API - Remove participant from course
exports.deleteAddParticipants = async (req, res) => {
  try {
    const { courseId, userId } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format'
      });
    }

    // Find the course
    const course = await CourseStructure.findById(courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Check if course has singleParticipants array
    if (!course.singleParticipants || !Array.isArray(course.singleParticipants)) {
      return res.status(404).json({
        success: false,
        message: 'No participants found in this course'
      });
    }

    // Find the participant to be removed
    let participantToRemove = null;
    let participantId = null;
    
    // Find the participant in singleParticipants
    for (const enrollment of course.singleParticipants) {
      // Handle both cases: enrollment object with user field or direct user ID
      if (enrollment.user && enrollment.user.toString() === userId) {
        participantToRemove = enrollment;
        participantId = enrollment.user.toString();
        break;
      } else if (enrollment.toString() === userId) {
        participantId = enrollment.toString();
        break;
      }
    }

    if (!participantId) {
      return res.status(404).json({
        success: false,
        message: 'Participant not found in this course'
      });
    }

    // Get participant details before removal - DON'T use .select() to preserve schema methods
    const participant = await User.findById(participantId);
    // Alternative: Use lean() if you need specific fields but still want to call methods
    // const participant = await User.findById(participantId).lean();

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove the participant from singleParticipants
    const initialLength = course.singleParticipants.length;
    
    // For new schema (array of objects)
    course.singleParticipants = course.singleParticipants.filter(
      enrollment => {
        // Handle both cases: enrollment object with user field or direct user ID
        if (enrollment.user) {
          return enrollment.user.toString() !== userId;
        } else {
          return enrollment.toString() !== userId;
        }
      }
    );

    if (course.singleParticipants.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'Participant not found in this course'
      });
    }

    // Update course
    course.updatedAt = new Date();
    course.updatedBy = req.user?.id || 'system';
    
    await course.save();

    // Send notification to the removed user
    let notificationSent = false;
    let notificationError = null;
    
    try {
      const notification = {
        title: 'Course Enrollment Removed',
        message: `You have been removed from the course "${course.courseName}"`,
        type: 'warning',
        relatedEntity: 'enrollment',
        relatedEntityId: courseId,
        removedBy: req.user?.email,
        metadata: new Map([
          ['Course Name', course.courseName],
          ['Course Code', course.courseCode],
          ['Removal Date', new Date().toISOString()],
          ['Removed By', req.user?.email || 'system'],
        ]),
      };

      // Check if the participant object has the addNotification method
      if (typeof participant.addNotification === 'function') {
        await participant.addNotification(notification);
        notificationSent = true;
      } else {
    
        const updatedUser = await User.findByIdAndUpdate(
          participantId,
          {
            $push: {
              notifications: {
                $each: [{
                  title: notification.title,
                  message: notification.message,
                  type: notification.type,
                  relatedEntity: notification.relatedEntity,
                  relatedEntityId: notification.relatedEntityId,
                  read: false,
                  createdAt: new Date()
                }],
                $position: 0
              }
            },
            $inc: { unreadNotificationCount: 1 }
          },
          { new: true }
        );
        
        if (updatedUser) {
          notificationSent = true;
        }
      }
    } catch (error) {
      notificationError = error.message;
      console.error(`Failed to send notification to user ${participantId}:`, error);
      // Don't fail the whole operation if notification fails
    }

    // Send email to the removed user
    let emailSent = false;
    let emailError = null;
    
    try {
      const emailSubject = `Course Enrollment Removed: ${course.courseName}`;
      const emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2c3e50;">Course Enrollment Update</h2>
          <p>Dear ${participant.firstName} ${participant.lastName || ''},</p>
          <p>Your enrollment in the following course has been removed:</p>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #e74c3c;">
            <h3 style="margin-top: 0; color: #e74c3c;">${course.courseName}</h3>
            <p><strong>Course Code:</strong> ${course.courseCode}</p>
            <p><strong>Removal Date:</strong> ${new Date().toLocaleDateString()}</p>
            <p><strong>Removed By:</strong> ${req.user?.email ? 'System Administrator' : 'System'}</p>
          </div>
          <p>If you believe this is an error or have any questions, please contact your course instructor or system administrator.</p>
          <p>You will no longer have access to the course material through your LMS account.</p>
          <br>
          <p>Best regards,<br>LMS Team</p>
        </div>
      `;

      // Send the email using your existing function
      const emailResult = await sendEmail(
        [participant.email],  // to
        emailSubject,         // subject
        emailBody,            // body
        []                    // cc (empty array)
      );

      emailSent = emailResult ? true : false;
    } catch (error) {
      emailError = error.message;
      console.error(`Failed to send email to ${participant.email}:`, error);
      // Don't fail the whole operation if email fails
    }

    // Return success response with updated course
    const updatedCourse = await CourseStructure.findById(courseId)
      .populate({
        path: 'singleParticipants.user',
        select: 'firstName lastName email phone role status'
      });

    res.status(200).json({
      success: true,
      message: 'Participant removed successfully',
      data: {
        course: updatedCourse,
        removedParticipant: {
          id: participant._id,
          name: `${participant.firstName} ${participant.lastName || ''}`.trim(),
          email: participant.email,
          removedAt: new Date(),
          removedBy: req.user?.email || 'system'
        },
        notification: {
          sent: notificationSent,
          error: notificationError
        },
        email: {
          sent: emailSent,
          error: emailError
        }
      }
    });

  } catch (error) {
    console.error('Error removing participant:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove participant',
      error: error.message
    });
  }
};

exports.deleteMultipleParticipants = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { participantIds } = req.body;

    // Validate input
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'participantIds must be a non-empty array'
      });
    }

    // Validate ObjectIds
    const validParticipantIds = participantIds.filter(id => 
      mongoose.Types.ObjectId.isValid(id)
    );

    if (validParticipantIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid participant IDs provided'
      });
    }

    // Find course
    const course = await CourseStructure.findById(courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Course not found'
      });
    }

    // Check if course has singleParticipants
    if (!course.singleParticipants || !Array.isArray(course.singleParticipants)) {
      return res.status(404).json({
        success: false,
        message: 'No participants found in this course'
      });
    }

    // Get all participants to be removed
    const participantsToRemove = await User.find({
      _id: { $in: validParticipantIds }
    }).select('_id firstName lastName email');

    if (participantsToRemove.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No valid users found with the provided IDs'
      });
    }

    const participantMap = new Map();
    participantsToRemove.forEach(participant => {
      participantMap.set(participant._id.toString(), participant);
    });

    const initialCount = course.singleParticipants.length;
    let removedCount = 0;
    const removedParticipants = [];
    const removedParticipantIds = [];

    // Check schema type by examining first item
    const firstItem = course.singleParticipants[0];
    
    if (firstItem && typeof firstItem === 'object' && firstItem.user) {
      // New schema: array of objects with user field
      course.singleParticipants = course.singleParticipants.filter(enrollment => {
        if (enrollment.user && validParticipantIds.includes(enrollment.user.toString())) {
          const participantId = enrollment.user.toString();
          const participant = participantMap.get(participantId);
          if (participant) {
            removedParticipants.push(participant);
            removedParticipantIds.push(participantId);
          }
          removedCount++;
          return false; // Remove this enrollment
        }
        return true; // Keep this enrollment
      });
    } else {
      // Old schema: array of ObjectIds
      course.singleParticipants = course.singleParticipants.filter(participantId => {
        const idStr = participantId.toString();
        if (validParticipantIds.includes(idStr)) {
          const participant = participantMap.get(idStr);
          if (participant) {
            removedParticipants.push(participant);
            removedParticipantIds.push(idStr);
          }
          removedCount++;
          return false; // Remove this participant
        }
        return true; // Keep this participant
      });
    }

    if (removedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'No matching participants found in this course'
      });
    }

    // Update metadata
    course.updatedAt = new Date();
    course.updatedBy = req.user?.id || 'system';

    await course.save();

    // Send notifications to all removed users
    const notificationResults = [];
    const notificationPromises = removedParticipants.map(async (participant) => {
      try {
        const notification = {
          title: 'Course Enrollment Removed',
          message: `You have been removed from the course "${course.courseName}"`,
          type: 'warning',
          relatedEntity: 'enrollment',
          relatedEntityId: courseId,
          removedBy: req.user?.email,
          metadata: new Map([
            ['Course Name', course.courseName],
            ['Course Code', course.courseCode],
            ['Removal Date', new Date().toISOString()],
            ['Removed By', req.user?.email || 'system'],
          ]),
        };

        // Get full user document to ensure methods are available
        const userDoc = await User.findById(participant._id);
        
        if (userDoc && typeof userDoc.addNotification === 'function') {
          await userDoc.addNotification(notification);
          notificationResults.push({
            userId: participant._id,
            success: true,
            email: participant.email
          });
        } else {
          // Fallback: Update notifications directly
          await User.findByIdAndUpdate(
            participant._id,
            {
              $push: {
                notifications: {
                  $each: [{
                    title: notification.title,
                    message: notification.message,
                    type: notification.type,
                    relatedEntity: notification.relatedEntity,
                    relatedEntityId: notification.relatedEntityId,
                    read: false,
                    createdAt: new Date()
                  }],
                  $position: 0
                }
              },
              $inc: { unreadNotificationCount: 1 }
            }
          );
          notificationResults.push({
            userId: participant._id,
            success: true,
            email: participant.email,
            method: 'fallback'
          });
        }
      } catch (error) {
        console.error(`Failed to send notification to user ${participant._id}:`, error);
        notificationResults.push({
          userId: participant._id,
          success: false,
          email: participant.email,
          error: error.message
        });
      }
    });

    await Promise.all(notificationPromises);

    // Send emails to all removed users
    const emailResults = [];
    const emailPromises = removedParticipants.map(async (participant) => {
      try {
        const emailSubject = `Course Enrollment Removed: ${course.courseName}`;
        const emailBody = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #2c3e50;">Course Enrollment Update</h2>
            <p>Dear ${participant.firstName} ${participant.lastName || ''},</p>
            <p>Your enrollment in the following course has been removed:</p>
            <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #e74c3c;">
              <h3 style="margin-top: 0; color: #e74c3c;">${course.courseName}</h3>
              <p><strong>Course Code:</strong> ${course.courseCode}</p>
              <p><strong>Removal Date:</strong> ${new Date().toLocaleDateString()}</p>
              <p><strong>Removed By:</strong> ${req.user?.email ? 'System Administrator' : 'System'}</p>
            </div>
            <p>If you believe this is an error or have any questions, please contact your course instructor or system administrator.</p>
            <p>You will no longer have access to the course material through your LMS account.</p>
            <br>
            <p>Best regards,<br>LMS Team</p>
          </div>
        `;

        const emailSent = await sendEmail(
          [participant.email],
          emailSubject,
          emailBody,
          []
        );

        emailResults.push({
          userId: participant._id,
          email: participant.email,
          success: emailSent ? true : false
        });

      } catch (error) {
        console.error(`Failed to send email to ${participant.email}:`, error);
        emailResults.push({
          userId: participant._id,
          email: participant.email,
          success: false,
          error: error.message
        });
      }
    });

    // Send emails in background (don't wait for completion)
    Promise.all(emailPromises)
      .then(results => {
        const successfulEmails = results.filter(r => r && r.success).length;
        const failedEmails = results.filter(r => !r || !r.success).length;
      })
      .catch(error => {
        console.error('Error in email sending process:', error);
      });

    // Populate the response with user data
    const updatedCourse = await CourseStructure.findById(courseId)
      .populate({
        path: 'singleParticipants.user',
        select: 'firstName lastName email'
      });

    // Calculate statistics
    const successfulNotifications = notificationResults.filter(r => r.success).length;
    const failedNotifications = notificationResults.filter(r => !r.success).length;
    
    const successfulEmails = emailResults.filter(r => r.success).length;
    const failedEmails = emailResults.filter(r => !r.success).length;

    res.status(200).json({
      success: true,
      message: `${removedCount} participant(s) removed successfully`,
      data: {
        course: updatedCourse,
        removalSummary: {
          totalRemoved: removedCount,
          removedParticipants: removedParticipants.map(p => ({
            id: p._id,
            name: `${p.firstName} ${p.lastName || ''}`.trim(),
            email: p.email
          })),
          removedAt: new Date(),
          removedBy: req.user?.id || 'system'
        },
        notifications: {
          total: notificationResults.length,
          successful: successfulNotifications,
          failed: failedNotifications,
          details: notificationResults
        },
        emails: {
          total: emailResults.length,
          successful: successfulEmails,
          failed: failedEmails,
          details: emailResults
        }
      }
    });

  } catch (error) {
    console.error('Error removing participants:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove participants',
      error: error.message
    });
  }
};