const express = require("express");
const router = express.Router();
const { GoogleGenAI } = require("@google/genai");

// Initialize Google GenAI with API key
const ai = new GoogleGenAI({
  apiKey: "AIzaSyBLw5A5gU-Ae539r-F7_6rnlB24GECuwKs"
});


// Clean formatting helper
const cleanSummaryText = (text) => {
    return text
        .replace(/\*\*\*/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\*+$/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`{3,}/g, '')
        .replace(/\s*\*\s*/g, '• ') // Convert asterisks to bullet points
        .trim();
};

// Streaming helper function
const setupStreamingResponse = (res) => {
    // Set headers for SSE (Server-Sent Events)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for nginx
    
    // Write initial connection message
    res.write('data: {"type": "connected", "timestamp": "' + new Date().toISOString() + '"}\n\n');
    
    return {
        write: (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        },
        end: () => {
            res.write('data: {"type": "complete", "timestamp": "' + new Date().toISOString() + '"}\n\n');
            res.end();
        },
        error: (error) => {
            res.write(`data: ${JSON.stringify({
                type: 'error',
                error: error.message || 'Streaming error',
                timestamp: new Date().toISOString()
            })}\n\n`);
            res.end();
        }
    };
};

// Main streaming summary endpoint
router.post("/generate-summary-stream", async (req, res) => {
    const stream = setupStreamingResponse(res);
    
    try {
        const { content, context = {}, fileData = {} } = req.body;

        
        if (!content) {
            stream.error(new Error("Content is required"));
            return;
        }

        // Build enhanced prompt with file context
        let prompt = `As an expert AI assistant, create a clear, comprehensive summary:\n\n`;

        // Add file context if available
        if (fileData.fileName) {
            prompt += `**File**: ${fileData.fileName}\n`;
        }
        
        if (fileData.fileType) {
            prompt += `**File Type**: ${fileData.fileType.toUpperCase()}\n`;
        }
        
        if (context?.title) {
            prompt += `**Title**: ${context.title}\n`;
        }
        
        if (context?.type) {
            prompt += `**Content Type**: ${context.type}\n`;
        }
        
        if (context?.hierarchy) {
            prompt += `**Hierarchy**: ${Array.isArray(context.hierarchy) ? context.hierarchy.join(' → ') : context.hierarchy}\n`;
        }

        prompt += `\n**Content to Summarize**:\n${content.substring(0, 6000)}${content.length > 6000 ? '...' : ''}\n\n`;

        // Add specific instructions based on file type
        if (fileData.fileType === 'video') {
            prompt += `**Special Instructions for Video Content**:\n`;
            prompt += `• Include important time references and timestamps\n`;
            prompt += `• Note key visual elements mentioned\n`;
            prompt += `• Capture chronological progression\n`;
            prompt += `• Highlight main speakers or narrators\n\n`;
        } else if (fileData.fileType === 'ppt') {
            prompt += `**Special Instructions for Presentation**:\n`;
            prompt += `• Organize by slides or sections\n`;
            prompt += `• Highlight key bullet points\n`;
            prompt += `• Note important diagrams or charts mentioned\n`;
            prompt += `• Include speaker notes if available\n\n`;
        }

        prompt += `**Summary Requirements**:\n`;
        prompt += `• Create a comprehensive, point-wise summary\n`;
        prompt += `• Use clear headings and proper spacing\n`;
        prompt += `• Include key concepts and main ideas\n`;
        prompt += `• Add practical applications and examples\n`;
        prompt += `• Provide study recommendations\n`;
        prompt += `• Format for easy reading and understanding\n`;
        prompt += `• Use bullet points and numbered lists where appropriate\n`;
        prompt += `• Include a conclusion or key takeaways section`;


        // Send initial metadata
        stream.write({
            type: 'metadata',
            model: 'gemini-2.5-flash-lite',
            timestamp: new Date().toISOString(),
            contentLength: content.length,
            hasFile: !!fileData.fileName
        });

        // Create streaming response
        const streamingResponse = await ai.models.generateContentStream({
            model: "gemini-2.5-flash-lite",
            contents: prompt,
            config: {
                temperature: 0.2,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 3072,
            }
        });

        let fullResponse = '';
        let chunkCount = 0;
        
        // Stream the response
        for await (const chunk of streamingResponse.stream) {
            if (chunk.text) {
                const textChunk = chunk.text;
                fullResponse += textChunk;
                chunkCount++;
                
                stream.write({
                    type: 'chunk',
                    content: textChunk,
                    chunkId: chunkCount,
                    timestamp: new Date().toISOString()
                });
                
                // Send progress updates every 5 chunks
                if (chunkCount % 5 === 0) {
                    stream.write({
                        type: 'progress',
                        chunkCount: chunkCount,
                        progress: Math.min(90, Math.floor((chunkCount * 10) / 5)),
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }


        // Send completion with cleaned summary
        const cleanedSummary = cleanSummaryText(fullResponse);
        
        stream.write({
            type: 'complete',
            content: cleanedSummary,
            fullResponse: cleanedSummary,
            summaryLength: cleanedSummary.length,
            chunkCount: chunkCount,
            timestamp: new Date().toISOString()
        });

        stream.end();

    } catch (error) {
        console.error('Error generating streaming summary:', error);
        stream.error(error);
    }
});

// Enhanced streaming summary endpoint
router.post("/generate-enhanced-summary-stream", async (req, res) => {
    const stream = setupStreamingResponse(res);
    
    try {
        const {
            content,
            context = {},
            fileData = {},
            options = {}
        } = req.body;

        if (!content) {
            stream.error(new Error("Content is required"));
            return;
        }


        // Build enhanced prompt
        let prompt = `As an expert educational AI assistant, create a comprehensive summary:\n\n`;

        // Add context
        if (context.hierarchy) {
            prompt += `**Context Hierarchy**: ${Array.isArray(context.hierarchy) ? context.hierarchy.join(' → ') : context.hierarchy}\n\n`;
        }

        if (fileData.fileName) {
            prompt += `**File**: ${fileData.fileName}\n`;
        }

        if (fileData.fileType) {
            prompt += `**File Type**: ${fileData.fileType.toUpperCase()}\n`;
        }

        prompt += `\n**Content to Summarize**:\n${content.substring(0, 6000)}${content.length > 6000 ? '...' : ''}\n\n`;

        // Add specific instructions based on file type
        if (fileData.fileType === 'video') {
            prompt += `**Video Analysis Instructions**:\n• Include important year/date/month references\n• Note chronological context and timelines\n• Mention key timestamps if available\n• Capture important temporal information\n\n`;
        }

        prompt += `**Summary Requirements**:\n• Create a comprehensive, point-wise summary\n• Use clear headings and proper spacing\n• Include key concepts and main ideas\n• Add practical applications and examples\n• Provide study recommendations\n• Format for easy reading and understanding`;

        // Send initial metadata
        stream.write({
            type: 'metadata',
            model: 'gemini-2.5-flash-lite-enhanced',
            timestamp: new Date().toISOString(),
            contentLength: content.length
        });

        // Create streaming response
        const streamingResponse = await ai.models.generateContentStream({
            model: "gemini-2.5-flash-lite",
            contents: prompt,
            config: {
                temperature: 0.2,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 3072,
            }
        });

        let fullResponse = '';
        
        // Stream the response
        for await (const chunk of streamingResponse.stream) {
            if (chunk.text) {
                const textChunk = chunk.text;
                fullResponse += textChunk;
                
                stream.write({
                    type: 'chunk',
                    content: textChunk,
                    timestamp: new Date().toISOString()
                });
            }
        }

        // Send completion with cleaned summary
        const cleanedSummary = cleanSummaryText(fullResponse);
        
        stream.write({
            type: 'complete',
            content: cleanedSummary,
            fullResponse: cleanedSummary,
            summaryLength: cleanedSummary.length,
            timestamp: new Date().toISOString()
        });

        stream.end();

    } catch (error) {
        console.error('Error generating enhanced streaming summary:', error);
        stream.error(error);
    }
});

// Streaming chat endpoint
router.post("/chat-stream", async (req, res) => {
    const stream = setupStreamingResponse(res);
    
    try {
        const { message, history = [], context = {} } = req.body;

        if (!message) {
            stream.error(new Error("Message is required"));
            return;
        }


        // Build conversation context
        let prompt = "You are a helpful AI assistant for educational content. ";

        if (context.title) {
            prompt += `We're discussing: ${context.title}\n\n`;
        }

        // Add conversation history if available
        if (history.length > 0) {
            prompt += "Previous conversation:\n";
            history.forEach((item, index) => {
                if (index < 5) { // Limit history to last 5 messages
                    prompt += `${item.role}: ${item.content}\n`;
                }
            });
            prompt += "\n";
        }

        prompt += `User: ${message}\n\nAssistant:`;

        // Send initial metadata
        stream.write({
            type: 'metadata',
            model: 'gemini-2.5-flash-lite-chat',
            timestamp: new Date().toISOString(),
            messageLength: message.length
        });

        // Create streaming response
        const streamingResponse = await ai.models.generateContentStream({
            model: "gemini-2.5-flash-lite",
            contents: prompt,
            config: {
                temperature: 0.3,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            }
        });

        let fullResponse = '';
        
        // Stream the response
        for await (const chunk of streamingResponse.stream) {
            if (chunk.text) {
                const textChunk = chunk.text;
                fullResponse += textChunk;
                
                stream.write({
                    type: 'chunk',
                    content: textChunk,
                    timestamp: new Date().toISOString()
                });
            }
        }

        // Send completion
        stream.write({
            type: 'complete',
            content: fullResponse.trim(),
            fullResponse: fullResponse.trim(),
            responseLength: fullResponse.length,
            timestamp: new Date().toISOString()
        });

        stream.end();

    } catch (error) {
        console.error('Streaming chat error:', error);
        stream.error(error);
    }
});

// Quick streaming summary
router.post("/quick-summary-stream", async (req, res) => {
    const stream = setupStreamingResponse(res);
    
    try {
        const { content, maxLength = 1000 } = req.body;

        if (!content) {
            stream.error(new Error("Content is required"));
            return;
        }


        const prompt = `Provide a concise summary in under ${maxLength} characters:\n\n${content.substring(0, 2000)}`;

        // Send initial metadata
        stream.write({
            type: 'metadata',
            model: 'gemini-2.5-flash-lite-quick',
            timestamp: new Date().toISOString(),
            contentLength: content.length
        });

        // Create streaming response
        const streamingResponse = await ai.models.generateContentStream({
            model: "gemini-2.5-flash-lite",
            contents: prompt,
            config: {
                temperature: 0.1,
                topK: 20,
                topP: 0.9,
                maxOutputTokens: 500,
            }
        });

        let fullResponse = '';
        
        // Stream the response
        for await (const chunk of streamingResponse.stream) {
            if (chunk.text) {
                const textChunk = chunk.text;
                fullResponse += textChunk;
                
                stream.write({
                    type: 'chunk',
                    content: textChunk,
                    timestamp: new Date().toISOString()
                });
            }
        }

        // Send completion
        stream.write({
            type: 'complete',
            content: fullResponse.trim(),
            fullResponse: fullResponse.trim(),
            length: fullResponse.length,
            timestamp: new Date().toISOString()
        });

        stream.end();

    } catch (error) {
        console.error('Quick streaming summary error:', error);
        stream.error(error);
    }
});

// Regular (non-streaming) endpoints for fallback

// Generate summary endpoint
router.post("/generate-summary", async (req, res) => {
    try {
        const { content, context = {}, fileData = {} } = req.body;

        if (!content) {
            return res.status(400).json({
                success: false,
                error: "Content is required"
            });
        }


        // Build prompt
        let prompt = `As an expert AI assistant, create a clear, well-organized summary of the following content:\n\n`;

        if (fileData.fileName) {
            prompt += `**File**: ${fileData.fileName}\n`;
        }
        
        if (fileData.fileType) {
            prompt += `**File Type**: ${fileData.fileType.toUpperCase()}\n`;
        }
        
        if (context?.title) {
            prompt += `**Title/Context**: ${context.title}\n\n`;
        }

        if (context?.type) {
            prompt += `**Content Type**: ${context.type}\n\n`;
        }

        prompt += `**Content to Summarize**:\n${content.substring(0, 5000)}${content.length > 5000 ? '...' : ''}\n\n`;

        prompt += `**Instructions**:\n• Create a comprehensive, point-wise summary\n• Use clear headings and bullet points\n• Focus on key concepts and main ideas\n• Make it easy to read and understand\n• Keep proper spacing between sections`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: prompt,
            config: {
                temperature: 0.3,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 2048,
            }
        });

        const summary = response.text;
        const cleanedSummary = cleanSummaryText(summary);

        res.json({
            success: true,
            summary: cleanedSummary,
            model: "gemini-2.5-flash-lite",
            timestamp: new Date().toISOString(),
            contentLength: content.length,
            summaryLength: cleanedSummary.length
        });

    } catch (error) {
        console.error('Error generating summary:', error);
        res.status(500).json({
            success: false,
            error: "Failed to generate summary",
            details: error.message
        });
    }
});

// Chat endpoint (non-streaming)
router.post("/chat", async (req, res) => {
    try {
        const { message, history = [], context = {} } = req.body;

        if (!message) {
            return res.status(400).json({
                success: false,
                error: "Message is required"
            });
        }


        let prompt = "You are a helpful AI assistant for educational content. ";

        if (context.title) {
            prompt += `We're discussing: ${context.title}\n\n`;
        }

        if (history.length > 0) {
            prompt += "Previous conversation:\n";
            history.forEach((item, index) => {
                if (index < 5) {
                    prompt += `${item.role}: ${item.content}\n`;
                }
            });
            prompt += "\n";
        }

        prompt += `User: ${message}\n\nAssistant:`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: prompt,
            config: {
                temperature: 0.3,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
            }
        });

        const aiResponse = response.text;

        res.json({
            success: true,
            response: aiResponse.trim(),
            model: "gemini-2.5-flash-lite-chat",
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({
            success: false,
            error: "Failed to process chat message",
            details: error.message
        });
    }
});

// Generate multiple summaries endpoint
router.post("/generate-multi-summary", async (req, res) => {
    try {
        const { items, context = {} } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                error: "Items array is required"
            });
        }


        // Combine all content
        let combinedContent = "";
        items.forEach((item, index) => {
            combinedContent += `Item ${index + 1}: ${item.title || `Item ${index + 1}`}\n`;
            if (item.content) {
                combinedContent += `Content: ${item.content.substring(0, 1000)}${item.content.length > 1000 ? '...' : ''}\n\n`;
            }
        });

        // Build prompt
        let prompt = `As an expert AI assistant, create a comprehensive summary of the following ${items.length} items:\n\n`;

        if (context.title) {
            prompt += `**Context**: ${context.title}\n\n`;
        }

        prompt += `**Items to Summarize**:\n${combinedContent}\n\n`;

        prompt += `**Instructions**:\n• Create a unified summary that covers all items\n• Identify common themes and connections\n• Highlight key points from each item\n• Provide an overall conclusion\n• Use clear headings and bullet points`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite",
            contents: prompt,
            config: {
                temperature: 0.3,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 3072,
            }
        });

        const summary = response.text;
        const cleanedSummary = cleanSummaryText(summary);

        res.json({
            success: true,
            summary: cleanedSummary,
            model: "gemini-2.5-flash-lite",
            timestamp: new Date().toISOString(),
            itemCount: items.length,
            summaryLength: cleanedSummary.length
        });

    } catch (error) {
        console.error('Error generating multi-summary:', error);
        res.status(500).json({
            success: false,
            error: "Failed to generate multi-summary",
            details: error.message
        });
    }
});

// Health check endpoint
router.get("/health", (req, res) => {
    res.json({
        success: true,
        message: "Gemini AI service is running",
        timestamp: new Date().toISOString(),
        model: "gemini-2.5-flash-lite",
        features: ["streaming", "summarization", "chat", "multi-summary"],
        endpoints: [
            "POST /generate-summary-stream",
            "POST /generate-enhanced-summary-stream",
            "POST /chat-stream",
            "POST /quick-summary-stream",
            "POST /generate-summary",
            "POST /chat",
            "POST /generate-multi-summary"
        ]
    });
});

// Test endpoint
router.get("/test", (req, res) => {
    res.json({
        success: true,
        message: "Gemini AI service is operational",
        timestamp: new Date().toISOString(),
        status: "active",
        apiKeyConfigured: !!ai.config.apiKey
    });
});

module.exports = router;