// gemma.js — every Gemma 4 call goes through here.
//
// Two ways to run Gemma 4 (switch with `provider` below):
//   "ollama": local, private, free. Slow on a laptop without a graphics card.
//     Start it with OLLAMA_ORIGINS="chrome-extension://*" (see README).
//   "google": Gemma 4 through Google AI Studio's free API. Much faster.
//     Get a key at aistudio.google.com/apikey and paste it in googleApiKey.
//
// You can also set these from the terminal for testing:
//   $env:GEMMA_PROVIDER="google"; $env:GEMMA_API_KEY="..."; node test/run.mjs ...

import { codeOutline } from "./parser.js";

const env = typeof process !== "undefined" ? process.env : {};

export const config = {
  provider: env.GEMMA_PROVIDER || "ollama", // "ollama" or "google"

  // Ollama (local)
  baseUrl: "http://localhost:11434", // or a faster laptop's IP on the Wi-Fi
  model: env.GEMMA_MODEL || "gemma4:e2b", // E2B: fast enough on a laptop CPU. "gemma4:e4b" = better but ~2x slower

  // Google AI Studio (cloud). Check the exact Gemma 4 model name in AI Studio.
  googleApiKey: env.GEMMA_API_KEY || "",
  googleModel: env.GEMMA_GOOGLE_MODEL || "gemma-4-26b-a4b-it",

  temperature: 0.2,
  maxTokens: 300, // answers are short; this stops runaway replies
  contextSize: 8192, // big enough for questions about mid-size repos
  timeoutMs: 120_000,
};

// Pull the first {...} block out of a reply, in case the model adds extra text
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Gemma didn't return valid JSON: " + text.slice(0, 200));
  }
}

// The one function everything uses.
// image: optional "data:image/png;base64,..." string (for the Huh? hotkey)
export async function askGemma(prompt, opts = {}) {
  const text = config.provider === "google" ? await askGoogle(prompt, opts) : await askOllama(prompt, opts);
  return opts.json === false ? text : parseJson(text);
}

// ---------- Google AI Studio ----------
async function askGoogle(prompt, { image, system } = {}) {
  if (!config.googleApiKey) throw new Error("Set googleApiKey in lib/gemma.js (get one at aistudio.google.com/apikey)");
  // Gemma on this API has no separate system message, so put it at the top
  const parts = [{ text: (system ? system + "\n\n" : "") + prompt }];
  if (image) {
    const m = image.match(/^data:(image\/\w+);base64,(.*)$/);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.googleModel}:generateContent?key=${config.googleApiKey}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: config.temperature, maxOutputTokens: config.maxTokens * 2 },
      }),
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Google AI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || "")
    .join("");
}

// ---------- Ollama (local) ----------
async function askOllama(prompt, { image, json = true, system } = {}) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  const msg = { role: "user", content: prompt };
  if (image) msg.images = [image.replace(/^data:image\/\w+;base64,/, "")];
  messages.push(msg);

  const send = async (withThink) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);
    try {
      return await fetch(`${config.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          // Gemma 4 "thinks" before answering by default, which is very slow.
          // We only need short explanations, so turn it off.
          ...(withThink ? { think: false } : {}),
          keep_alive: "30m", // keep the model loaded between calls
          ...(json ? { format: "json" } : {}),
          options: { temperature: config.temperature, num_predict: config.maxTokens, num_ctx: config.contextSize },
        }),
      });
    } catch (e) {
      throw new Error(
        "Can't reach Ollama. Is it running with OLLAMA_ORIGINS=\"chrome-extension://*\"? (" + e.message + ")"
      );
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await send(true);
  // Older Ollama versions or models without a thinking mode reject "think": retry without it
  if (res.status === 400) res = await send(false);
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content ?? "";
}

const SYSTEM = `You explain code to beginners who are new to a project.
Use plain, friendly words. Keep sentences short. If you use a technical term,
explain it in a few words. Never invent files or connections that aren't listed.
Always answer with JSON only.`;

const ROLES = "entry, ui, logic, data, util, config, test";

// ---------- Job 1: summarize one file ----------
export async function summarizeFile({ path, content, imports, importedBy, repoDescription, language = "English" }) {
  // An outline (comments + function/class lines) is ~5x shorter than the raw code,
  // covers the whole file, and is much faster for Gemma to read.
  const head = codeOutline(path, content);
  const prompt = `Project: ${repoDescription || "(no description)"}
File: ${path}
This file uses: ${imports.join(", ") || "nothing else in the project"}
Used by: ${importedBy.join(", ") || "no other files"}

Outline of the file (its comments and the functions/classes it defines):
\`\`\`
${head}
\`\`\`

Reply in ${language} with JSON:
{"summary": "ONE sentence, under 25 words: what this file does"}`;
  // Short answers are what make this fast on a laptop CPU: writing words is the slow part.
  // Roles come from the file path instead (graph.js guessRole), details from the deep dive.
  const prev = config.maxTokens;
  config.maxTokens = 80;
  try {
    return await askGemma(prompt, { system: SYSTEM });
  } finally {
    config.maxTokens = prev;
  }
}

// ---------- Job 2: name the neighborhoods ----------
export async function nameNeighborhoods({ repoDescription, readme, groups, language = "English" }) {
  const list = groups
    .map((g) => `Folder "${g.name}":\n` + g.files.slice(0, 12).map((f) => `  - ${f.id}${f.summary ? ": " + f.summary : ""}`).join("\n"))
    .join("\n");
  const prompt = `Project: ${repoDescription || "(no description)"}
README (start):
${(readme || "").slice(0, 2000)}

Groups of files:
${list}

Reply in ${language} with JSON:
{"overview": "2-3 sentences: what this project does, for a beginner",
 "start_here": "the single best file to read first (exact path from the list)",
 "neighborhoods": [{"folder": "exact folder name from above",
   "name": "short friendly name, like 'Login & accounts'",
   "summary": "one sentence about the whole group (not a single file): what this part of the project is for"}]}`;
  return askGemma(prompt, { system: SYSTEM });
}

// ---------- Job 3: trace a feature ----------
export async function traceFeature({ question, nodes, edges, language = "English" }) {
  // Only send the important part so it fits and stays fast
  const fileList = nodes
    .slice(0, 80)
    .map((n) => `- ${n.id} [${n.role}]${n.summary ? ": " + n.summary : ""}`)
    .join("\n");
  const ids = new Set(nodes.slice(0, 80).map((n) => n.id));
  const links = edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .slice(0, 300)
    .map((e) => `${e.from} -> ${e.to}`)
    .join("\n");
  const prompt = `A beginner asks: "${question}"

Files in the project:
${fileList}

Which file uses which (A -> B means A imports B):
${links}

Trace the path through the files that answers the question, in the order the code runs.
Rules:
- The path MUST have 3 to 6 files. Start from where things begin (an entry file),
  then follow the links (A -> B) step by step to where the work gets done.
- Use only exact file paths from the list. Don't repeat a file.
- Each step says what happens in that file for THIS question.
Reply in ${language} with JSON:
{"answer": "2-3 sentences answering the question simply",
 "path": [{"file": "exact path", "step": "one sentence"},
          {"file": "exact path", "step": "one sentence"},
          {"file": "exact path", "step": "one sentence"}]}`;
  const out = await askGemma(prompt, { system: SYSTEM });
  // Safety: drop any file Gemma made up, and duplicates
  const all = new Set(nodes.map((n) => n.id));
  const seen = new Set();
  out.path = (out.path || []).filter((s) => all.has(s.file) && !seen.has(s.file) && seen.add(s.file));
  return out;
}

// ---------- Job 5: deep dive on one file (the "Explain more" button) ----------
export async function deepExplainFile({ path, content, imports, importedBy, summary, language = "English" }) {
  const code = (content || "").split("\n").slice(0, 200).join("\n").slice(0, 7000);
  const prompt = `File: ${path}
${summary ? "In short: " + summary : ""}
This file uses: ${imports.join(", ") || "nothing else in the project"}
Used by: ${importedBy.join(", ") || "no other files"}

Code:
\`\`\`
${code}
\`\`\`

Give a beginner a detailed tour of this file. Reply in ${language} with JSON:
{"purpose": "2-3 sentences: what this file is for and why the project needs it",
 "parts": [{"name": "function or class name", "what": "one sentence: what it does"}],
 "connections": "2 sentences: how it works with the files it uses and the files that use it",
 "change_tips": "1-2 sentences: what a beginner should be careful about when editing it",
 "terms": [{"term": "jargon word", "meaning": "a few words"}]}
List up to 6 parts and up to 4 terms.`;
  const prev = config.maxTokens;
  config.maxTokens = 700; // detailed answers need more room
  try {
    return await askGemma(prompt, { system: SYSTEM });
  } finally {
    config.maxTokens = prev;
  }
}

// ---------- Job 4: Huh? hotkey (screenshot) ----------
export async function explainSnip({ image, filePath, fileSummary, neighbors = [], language = "English" }) {
  const prompt = `The beginner is looking at ${filePath || "a file"} and got confused by the part in the image.
${fileSummary ? "About this file: " + fileSummary : ""}
Connected files: ${neighbors.join(", ") || "none"}

Reply in ${language} with JSON:
{"explanation": "3 short sentences: what this code does, in plain words",
 "connections": "1 sentence: how it relates to the connected files, if it does",
 "terms": [{"term": "jargon word", "meaning": "a few words"}]}`;
  return askGemma(prompt, { image, system: SYSTEM });
}