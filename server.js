import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.js";
import chatRoutes from "./routes/chat.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Allow your Vercel domain + localhost in development
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  `https://${process.env.VERCEL_URL}`,
  process.env.FRONTEND_URL, // add this in Vercel dashboard if needed
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(o => origin.includes(o.replace("https://", "")))) {
      return callback(null, true);
    }
    // In production, allow all vercel.app subdomains
    if (origin.endsWith(".vercel.app")) return callback(null, true);
    callback(null, true); // remove this line to enforce strict CORS
  },
  credentials: true
}));

app.use(express.json());

// Connect to MongoDB once (cached for serverless)
let isConnected = false;
async function connectDB() {
  if (isConnected) return;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    isConnected = true;
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
    throw err;
  }
}

// Middleware to ensure DB is connected on every request (important for Vercel serverless)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);

app.use(express.static(__dirname));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/") || req.path.includes(".")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(__dirname, "index.html"));
});

// Only start the server locally (Vercel handles this in production)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

// Export for Vercel serverless
export default app;
