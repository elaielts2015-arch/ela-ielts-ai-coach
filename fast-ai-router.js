#!/usr/bin/env node
/**
 * ELA Fast Open-Source AI Router (Zero Antigravity Quota Burn)
 * Routes text/script/prompt/translation/SEO generation to ultra-fast, trustworthy
 * open-source model inference APIs in speed priority order:
 *   1. Cerebras Cloud   (~1,850–3,000 tok/s, free developer tier)
 *   2. Groq Cloud       (~300–1,000 tok/s, permanent free tier)
 *   3. OpenRouter Free  (20+ :free open-source models, automatic backup)
 *   4. Gemini Free API  (Google AI Studio free tier, separate from Antigravity quota)
 *
 * Usage:
 *   node fast-ai-router.js --status
 *   node fast-ai-router.js --benchmark
 *   node fast-ai-router.js "Draft a 45-second Band 8 IELTS cue card script"
 *   node fast-ai-router.js --file prompt.txt --out output.md --system "You are @ieltsela..."
 *
 * Module usage:
 *   const { generateFastAI } = require("./fast-ai-router");
 *   const res = await generateFastAI({ prompt: "...", system: "..." });
 */

const fs = require("fs");
const path = require("path");

const ENV_FILE = path.join(__dirname, ".env.ai");

function loadEnvAi() {
  const vars = { ...process.env };
  if (fs.existsSync(ENV_FILE)) {
    const lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v && !v.startsWith("PASTE_")) {
        vars[k] = v;
      }
    }
  }
  return vars;
}

const PROVIDERS = [
  {
    id: "cerebras",
    name: "Cerebras Cloud (Wafer-Scale Open-Source)",
    envKey: "CEREBRAS_API_KEY",
    signupUrl: "https://cloud.cerebras.ai",
    baseUrl: "https://api.cerebras.ai/v1",
    preferredModels: ["gpt-oss-120b", "qwen-3.8-27b", "llama3.1-8b"],
    expectedSpeed: "~1,850–3,000 tok/s",
    timeoutMs: 15000
  },
  {
    id: "groq",
    name: "Groq Cloud (LPU Open-Source)",
    envKey: "GROQ_API_KEY",
    signupUrl: "https://console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
    preferredModels: [
      "qwen/qwen3.8-27b",
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b"
    ],
    expectedSpeed: "~300–1,000 tok/s",
    timeoutMs: 15000
  },
  {
    id: "openrouter",
    name: "OpenRouter (:free Open-Source Backup)",
    envKey: "OPENROUTER_API_KEY",
    signupUrl: "https://openrouter.ai/keys",
    baseUrl: "https://openrouter.ai/api/v1",
    preferredModels: [
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "particle-ai/particle-1:free",
      "nvidia/nemotron-3.5-super-vl:free",
      "google/gemma-4-26b-a4b-it:free",
      "google/gemma-4-31b-it:free"
    ],
    extraHeaders: {
      "HTTP-Referer": "https://elaielts.org",
      "X-Title": "ELA Fast AI Router"
    },
    expectedSpeed: "~60–250 tok/s",
    timeoutMs: 25000
  },
  {
    id: "gemini_free",
    name: "Google AI Studio Gemini API (Separate Quota)",
    envKey: "GEMINI_API_KEY",
    signupUrl: "https://aistudio.google.com/apikey",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    preferredModels: ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash", "gemini-flash-latest"],
    expectedSpeed: "~120–250 tok/s",
    timeoutMs: 20000
  }
];

function getConfiguredProviders(env = loadEnvAi(), onlyProviderId = null) {
  return PROVIDERS.filter((p) => {
    if (onlyProviderId && p.id !== onlyProviderId) return false;
    return Boolean(env[p.envKey]);
  }).map((p) => ({ ...p, apiKey: env[p.envKey] }));
}

async function discoverFallbackChatModel(provider) {
  try {
    const res = await fetch(`${provider.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        ...(provider.extraHeaders || {})
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const list = Array.isArray(data?.data) ? data.data : [];
    const usable = list
      .map((m) => m.id)
      .filter(
        (id) =>
          id &&
          !/whisper|tts|audio|embed|guard|safeguard|vision-only|moderation|rerank|playai/i.test(id)
      );
    if (provider.id === "openrouter") {
      const freeOnly = usable.filter((id) => id.endsWith(":free"));
      return freeOnly[0] || null;
    }
    const preferredOrder = usable.find((id) => /qwen|gpt-oss|llama-3\.3|llama-3|gemma/i.test(id));
    return preferredOrder || usable[0] || null;
  } catch {
    return null;
  }
}

async function callOpenAICompatible(provider, model, { prompt, system, maxTokens, temperature }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const started = Date.now();
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...(provider.extraHeaders || {})
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 1500
    }),
    signal: AbortSignal.timeout(provider.timeoutMs)
  });

  const elapsedMs = Date.now() - started;
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const err = new Error(`${provider.id}/${model} HTTP ${res.status}: ${errText.slice(0, 220)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`${provider.id}/${model} returned empty content`);
  }

  const completionTokens =
    data?.usage?.completion_tokens || Math.max(1, Math.round(text.split(/\s+/).length * 1.33));
  const tokensPerSec = Number(((completionTokens / Math.max(elapsedMs, 1)) * 1000).toFixed(1));

  return {
    provider: provider.id,
    providerName: provider.name,
    model,
    text,
    elapsedMs,
    completionTokens,
    tokensPerSec
  };
}

async function generateFastAI({
  prompt,
  system = "",
  maxTokens = 1500,
  temperature = 0.7,
  provider: onlyProviderId = null,
  model: explicitModel = null
}) {
  const env = loadEnvAi();
  const configured = getConfiguredProviders(env, onlyProviderId);
  if (configured.length === 0) {
    throw new Error(
      `No fast open-source AI API keys configured yet. Copy .env.ai.example to .env.ai and add at least one free key (recommended: GROQ_API_KEY from https://console.groq.com/keys or CEREBRAS_API_KEY from https://cloud.cerebras.ai).`
    );
  }

  const errors = [];
  for (const p of configured) {
    const modelsToTry = explicitModel ? [explicitModel] : [...p.preferredModels];
    let triedDiscovery = false;

    for (let i = 0; i < modelsToTry.length; i++) {
      const m = modelsToTry[i];
      try {
        return await callOpenAICompatible(p, m, { prompt, system, maxTokens, temperature });
      } catch (err) {
        errors.push(err.message);
        // On 401/403 auth error, jump straight to next provider; on 429, only skip provider if not OpenRouter (where 429 is per upstream free model)
        if ([401, 403].includes(err.status) || (err.status === 429 && p.id !== "openrouter")) break;
        // On 404/400 (model deprecated/renamed), discover an active model once
        if ([400, 404].includes(err.status) && i === modelsToTry.length - 1 && !triedDiscovery && !explicitModel) {
          triedDiscovery = true;
          const liveModel = await discoverFallbackChatModel(p);
          if (liveModel && !modelsToTry.includes(liveModel)) {
            modelsToTry.push(liveModel);
          }
        }
      }
    }
  }

  throw new Error(`All configured fast AI providers failed:\n- ${errors.join("\n- ")}`);
}

function printStatus() {
  const env = loadEnvAi();
  console.log("=== ELA Fast Open-Source AI Router Status ===");
  console.log(`Config file: ${ENV_FILE} (${fs.existsSync(ENV_FILE) ? "FOUND" : "NOT CREATED YET"})`);
  let readyCount = 0;
  for (const p of PROVIDERS) {
    const active = Boolean(env[p.envKey]);
    if (active) readyCount++;
    console.log(
      `- [${active ? "READY" : "NOT SET"}] ${p.name} | ${p.envKey} | Speed: ${p.expectedSpeed} | Free key: ${p.signupUrl}`
    );
  }
  if (readyCount === 0) {
    console.log(
      "\nNext step (30 sec): Copy .env.ai.example to .env.ai and paste a free GROQ_API_KEY or CEREBRAS_API_KEY (no credit card needed)."
    );
  } else {
    console.log(`\n${readyCount} fast open-source provider(s) active. Ready for zero-Antigravity-quota generation!`);
  }
}

async function runBenchmark() {
  const env = loadEnvAi();
  const configured = getConfiguredProviders(env);
  if (configured.length === 0) {
    printStatus();
    process.exit(1);
  }
  console.log("Benchmarking configured open-source AI providers for delivery speed...\n");
  for (const p of configured) {
    try {
      const res = await generateFastAI({
        provider: p.id,
        prompt: "Give 3 Band 8 English collocations for IELTS Speaking in 3 short bullet points.",
        maxTokens: 120,
        temperature: 0.3
      });
      console.log(
        `[PASS] ${res.providerName} (${res.model}) -> ${res.elapsedMs} ms | ~${res.tokensPerSec} tok/s`
      );
    } catch (err) {
      console.log(`[FAIL] ${p.name} -> ${err.message}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printStatus();
    return;
  }
  if (args.includes("--status")) {
    printStatus();
    return;
  }
  if (args.includes("--benchmark")) {
    await runBenchmark();
    return;
  }

  let system = "";
  let filePath = null;
  let outPath = null;
  let provider = null;
  let model = null;
  let maxTokens = 1500;
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--system") system = args[++i] || "";
    else if (a === "--file") filePath = args[++i];
    else if (a === "--out") outPath = args[++i];
    else if (a === "--provider") provider = args[++i];
    else if (a === "--model") model = args[++i];
    else if (a === "--max-tokens") maxTokens = Number(args[++i] || 1500);
    else positional.push(a);
  }

  const prompt = filePath ? fs.readFileSync(filePath, "utf8") : positional.join(" ").trim();
  if (!prompt) {
    console.error("Error: Provide a prompt string or --file <path>.");
    process.exit(1);
  }

  const result = await generateFastAI({ prompt, system, maxTokens, provider, model });
  if (outPath) {
    fs.writeFileSync(outPath, result.text + "\n", "utf8");
    console.error(
      `[FastAI] ${result.provider}/${result.model} | ${result.elapsedMs} ms | ~${result.tokensPerSec} tok/s -> Saved to ${outPath}`
    );
  } else {
    console.error(
      `[FastAI] ${result.provider}/${result.model} | ${result.elapsedMs} ms | ~${result.tokensPerSec} tok/s`
    );
    process.stdout.write(result.text + "\n");
  }
}

module.exports = { generateFastAI, loadEnvAi, getConfiguredProviders, PROVIDERS };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
