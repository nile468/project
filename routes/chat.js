import express from "express";
import authMiddleware from "../middleware/auth.js";
import Chat from "../models/Chat.js";
import { askAI, rankResponses, synthesizeResponses } from "../services/aiService.js";

const router = express.Router();
const AVAILABLE_MODELS = ["gemini", "llama", "deepseek", "qwen"];

router.post("/ask", authMiddleware, async (req, res) => {
  try {
    const { prompt, models: requestedModels, mode, systemPrompt, temperature, history } = req.body;
    
    if (!prompt || prompt.trim() === "") {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const modelsToUse = requestedModels?.length > 0
      ? requestedModels.filter(m => AVAILABLE_MODELS.includes(m))
      : AVAILABLE_MODELS;

    if (modelsToUse.length === 0) {
      return res.status(400).json({ error: "No valid models selected", available: AVAILABLE_MODELS });
    }

    const responses = {};
    await Promise.all(
      modelsToUse.map(async (model) => {
        responses[model] = await askAI(prompt, model, { systemPrompt, temperature, history: history || [] });
      })
    );

    let bestModel, synthesis;
    if (mode === "super" && modelsToUse.length > 1) {
      [bestModel, synthesis] = synthesizeResponses(responses, prompt);
    } else {
      bestModel = rankResponses(responses, prompt);
    }

    const chat = await Chat.create({
      userId: req.user.id,
      prompt: prompt.trim(),
      responses,
      bestModel,
      synthesis: mode === "super" ? synthesis : undefined,
      mode: mode || "single",
      modelsUsed: modelsToUse,
      temperature: temperature || 0.7
    });

    res.status(201).json({
      chat: { id: chat._id, prompt: chat.prompt, createdAt: chat.createdAt, mode: chat.mode, modelsUsed: chat.modelsUsed },
      bestModel,
      responses,
      synthesis: mode === "super" ? synthesis : undefined,
      meta: {
        modelsQueried: modelsToUse.length,
        successfulResponses: Object.values(responses).filter(r => r && !r.startsWith("[")).length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error("❌ Chat route error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

router.get("/history", authMiddleware, async (req, res) => {
  try {
    const { limit = 20, mode } = req.query;
    const query = { userId: req.user.id };
    if (mode && mode !== "all") query.mode = mode;
    const chats = await Chat.find(query).sort({ createdAt: -1 }).limit(parseInt(limit)).select("title prompt bestModel mode createdAt modelsUsed updatedAt");
    res.json({ chats, total: chats.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

export default router;