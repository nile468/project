export async function askAI(prompt, model, options = {}) {
  const { systemPrompt, temperature = 0.7, history = [] } = options;
  
  try {
    const fullSystemPrompt = systemPrompt || "You are a helpful, intelligent AI assistant named NeuralMesh.";

    // 🔹 GEMINI
    if (model === "gemini") {
      if (!process.env.GEMINI_API_KEY) return "[gemini error: GEMINI_API_KEY not configured]";
      
      const contents = history.map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      }));
      contents.push({ role: "user", parts: [{ text: prompt }] });

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents, generationConfig: { temperature } })
        }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response from Gemini";
    }

    // 🔹 GROQ (LLaMA) & DEEPSEEK
    if (model === "llama" || model === "deepseek") {
      const isGroq = model === "llama";
      const apiKey = isGroq ? process.env.GROQ_API_KEY : process.env.DEEPSEEK_API_KEY;
      const url = isGroq ? "https://api.groq.com/openai/v1/chat/completions" : "https://api.deepseek.com/chat/completions";
      const modelId = isGroq ? "llama-3.3-70b-versatile" : "deepseek-chat";

      if (!apiKey) return `[${model} error: API Key not configured]`;

      const messages = [
        { role: "system", content: fullSystemPrompt },
        ...history.map(msg => ({ role: msg.role, content: msg.content })),
        { role: "user", content: prompt }
      ];

      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, messages, temperature })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.choices?.[0]?.message?.content || `No response from ${model}`;
    }

    // 🔹 QWEN (Ollama)
    if (model === "qwen") {
      const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
      const ollamaModel = process.env.QWEN_OLLAMA_MODEL || "qwen2.5:7b";
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        let contextText = `${fullSystemPrompt}\n`;
        history.forEach(msg => {
          const roleLabel = msg.role === "user" ? "User" : "Assistant";
          contextText += `${roleLabel}: ${msg.content}\n`;
        });
        contextText += `User: ${prompt}`;

        const res = await fetch(`${ollamaHost}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: ollamaModel,
            prompt: contextText,
            stream: false,
            options: { temperature, num_predict: 1024 }
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
        const data = await res.json();
        return data.response?.trim() || "No response from Qwen";
      } catch (err) {
        clearTimeout(timeout);
        if (err.name === "AbortError") return "[qwen error: Request timed out]";
        return `[qwen error: ${err.message}]`;
      }
    }

    return `[${model} error: Unknown model]`;
  } catch (err) {
    console.error(`[askAI] Error:`, err);
    return `[${model} error: ${err.message}]`;
  }
}

export function rankResponses(responses, prompt) {
  const keywords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  const scores = {};
  for (const [model, text] of Object.entries(responses)) {
    if (!text || text.startsWith(`[${model} error:`)) { scores[model] = -100; continue; }
    const lower = text.toLowerCase();
    scores[model] = Math.min(text.length / 100, 10) + keywords.filter(k => lower.includes(k)).length * 2;
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 && sorted[0][1] > -50 ? sorted[0][0] : "unknown";
}

export function synthesizeResponses(responses, prompt) {
  const validResponses = Object.entries(responses)
    .filter(([_, text]) => text && !text.startsWith("[") && !text.startsWith("[error"))
    .map(([model, text]) => ({ model, text }));

  if (validResponses.length === 0) return [null, "❌ All models returned errors."];
  if (validResponses.length === 1) return [validResponses[0].model, validResponses[0].text];

  const sorted = validResponses.sort((a, b) => b.text.length - a.text.length);
  let synthesis = sorted[0].text.trim();
  const baseKeywords = new Set(synthesis.toLowerCase().match(/\b[a-z]{4,}\b/g) || []);
  const additionalInsights = [];

  for (let i = 1; i < sorted.length; i++) {
    const { model, text } = sorted[i];
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);
    for (const sentence of sentences) {
      const words = sentence.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
      const hasUnique = words.some(w => !baseKeywords.has(w));
      if (hasUnique && !synthesis.toLowerCase().includes(sentence.toLowerCase().substring(0, 50))) {
        additionalInsights.push({ model, sentence: sentence.trim() });
        words.forEach(w => baseKeywords.add(w));
        break;
      }
    }
  }

  if (additionalInsights.length > 0) {
    synthesis += "\n\n---\n\nAdditional Insights:\n" + additionalInsights.map(({ model, sentence }) => `• **${model.toUpperCase()}:** ${sentence}`).join("\n");
  }
  synthesis += `\n\n✨ Collaborative synthesis from ${validResponses.map(r => r.model.toUpperCase()).join(" + ")}`;
  return [sorted[0].model, synthesis.trim()];
}