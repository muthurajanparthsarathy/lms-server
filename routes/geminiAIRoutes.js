const express = require('express');
const router = express.Router();
const {
  generateAIResponse,
  clearChatHistory,
  getChatSessions
} = require('../controllers/geminiAIController');

const { userAuth } = require('../middlewares/userAuth');

// AI Chat endpoint (requires authentication)
router.post('/chat', userAuth, generateAIResponse);

// Get chat sessions
router.get('/sessions', userAuth, getChatSessions);

// Clear chat history
router.delete('/clear', userAuth, clearChatHistory);

// Public test endpoint (no auth required)
router.post('/test', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Message is required"
      });
    }

    // Use Gemini AI directly - same initialization as in gemini.js
const { GoogleGenAI } = require("@google/genai");

    // Initialize Google GenAI with API key - same as gemini.js
    const ai = new GoogleGenAI({
      apiKey: "AIzaSyBLw5A5gU-Ae539r-F7_6rnlB24GECuwKs"
    });
    
    // Use the same model "gemini-2.5-flash" as in gemini.js
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: message,
    });
    
    return res.status(200).json({
      success: true,
      response: response.text
    });
  } catch (error) {
    console.error("Test endpoint error:", error);
    return res.status(500).json({
      success: false,
      error: "AI service unavailable",
      message: error.message
    });
  }
});

module.exports = router;