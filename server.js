#!/usr/bin/env node
/**
 * ELA IELTS & PTE AI Coach App â€” Student Coaching & Passive Income PWA
 * Powered by fast-ai-router.js (Groq -> OpenRouter Free -> Gemini Free) at â‚¹0 cost.
 * Run: node ela-ielts-ai-coach/server.js
 * Open: http://localhost:3458
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { generateFastAI } = require("./fast-ai-router");

const PORT = Number(process.env.PORT || 3458);
const DIR = __dirname;
const QR_PATH = path.join(__dirname, "payment-qr.jpg");

const AGENT_PROMPTS = {
  writing: `You are an official Band 8.5+ IELTS & PTE Writing Evaluator for ELA IELTS (https://elaielts.org).
ALWAYS start your response with this exact 1-line score header (numbers between 4.0 and 9.0):
SCORES: Overall=6.5 | Task=6.5 | Coherence=6.5 | Vocabulary=6.5 | Grammar=6.0

Then evaluate the student's essay or paragraph thoroughly:
1. **Band Score Breakdown** (Task Response, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy).
2. **Line-by-Line Corrections** (exact mistake -> corrected Band 8+ version + brief reason).
3. **Band 8+ Upgraded Rewrite** of their weakest paragraph.
4. **Top 3 Action Tips** to jump +1.0 Band fast.`,

  speaking: `You are an IELTS Speaking & PTE Speaking Coach for ELA IELTS (@ieltsela).
For the given cue card, topic, or PTE Respond-to-a-Situation prompt:
1. **Natural Band 8+ Model Answer** (conversational, authentic, zero memorized robot templates, 120â€“160 words).
2. **5 High-Scoring C1 Vocabulary & Idioms Used** (with simple meanings).
3. **2 Follow-Up Part 3 Questions** with short Band 8+ answers.
If the student chose Punjabi or Hindi support, explain the tips and vocabulary meanings clearly in that language while keeping the model answer in natural Band 8+ English.`,

  grammar: `You are a Spoken English & C1 Grammar Coach for ELA IELTS (@ieltsela).
For the student's topic or sentence:
1. **5 "Stop Saying Basic English -> Say Band 8+ Native English" Upgrades**.
2. **Clear Grammar Rule Breakdown** (simple, memorable, zero boring textbook jargon).
3. **3 Interactive Mini-Quiz Questions** (with answers hidden at the bottom so the student can test themselves).`,

  planner: `You are an IELTS & PTE Study Strategist for ELA IELTS (https://elaielts.org).
Build a realistic, high-impact **15-day or 30-day Study Plan** based on the student's current level, target band/score, exam type (IELTS Academic, IELTS General, or PTE), and daily study hours.
Include:
- Weekly milestones
- Exact daily routine (Listening, Reading, Writing, Speaking)
- Mock test schedule & common score-killing traps to avoid.`,

  reading: `You are an IELTS Reading & PTE Reading Coach for ELA IELTS (https://elaielts.org).
Create a realistic exam practice set:
1. **Short Original Band 8 Academic Passage** (~160â€“200 words on the requested topic or a high-frequency IELTS/PTE topic).
2. **5 Exam Questions** (mix of True / False / Not Given for IELTS or Fill-in-the-Blanks Collocations for PTE).
3. **Answer Key + Exact Logic Explanation** at the bottom so the student learns how to avoid traps.`
};

// Simple per-IP rate limiter (20 requests per hour) for public launch protection
const ipHits = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= 20) return true;
  arr.push(now);
  ipHits.set(ip, arr);
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 200_000) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch { reject(new Error("Invalid JSON")); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(fs.readFileSync(path.join(DIR, "index.html"), "utf8"));
  }
  if (req.method === "GET" && url.pathname === "/manifest.json") {
    res.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8" });
    return res.end(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
  }
  if (req.method === "GET" && url.pathname === "/payment-qr.jpg" && fs.existsSync(QR_PATH)) {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    return res.end(fs.readFileSync(QR_PATH));
  }

  if (req.method === "POST" && url.pathname === "/api/coach") {
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "local").split(",")[0].trim();
    if (ip !== "127.0.0.1" && ip !== "::1" && isRateLimited(ip)) {
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: "Hourly limit reached (20 checks/hr). Please try again later." }));
    }
    try {
      const { agent = "writing", exam = "IELTS Academic", lang = "English", input = "" } = await readBody(req);
      const system = AGENT_PROMPTS[agent] || AGENT_PROMPTS.writing;
      const prompt = `Exam Target: ${exam}
Explanation Language Preference: ${lang}
Student Input / Topic:
${input || "Give me a Band 8+ practice lesson and quiz."}

Provide clear, encouraging, high-value coaching.`;

      const result = await generateFastAI({
        system,
        prompt,
        maxTokens: 1350,
        temperature: 0.65
      });

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({
        ok: true,
        text: result.text,
        provider: result.provider,
        model: result.model,
        ms: result.ms
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nðŸŽ“ ELA IELTS & PTE AI Coach App is LIVE at: http://localhost:${PORT}\n`);
});

