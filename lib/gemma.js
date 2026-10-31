// gemma.js — every Gemma 4 call goes through here.
// Gemma runs locally in Ollama. Start it with:
//   OLLAMA_ORIGINS="chrome-extension://*" ollama serve
// Check your exact model name with `ollama list` and set GEMMA_MODEL below.

export const config = {
  baseUrl: "http://localhost:11434", // or another laptop's IP on the Wi-Fi
  model: "gemma4:e4b", // TODO: confirm with `ollama list`
  temperature: 0.2,
  maxTokens: 400, // answers are short; this stops runaway replies
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
export async function askGemma(prompt, { image, json = true, system } = {}) {
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
          options: { temperature: config.temperature, num_predict: config.maxTokens },
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
  const text = data.message?.content ?? "";
  return json ? parseJson(text) : text;
}

const SYSTEM = `You explain code to beginners who are new to a project.
Use plain, friendly words. Keep sentences short. If you use a technical term,
explain it in a few words. Never invent files or connections that aren't listed.
Always answer with JSON only.`;

const ROLES = "entry, ui, logic, data, util, config, test";

// ---------- Job 1: summarize one file ----------
export async function summarizeFile({ path, content, imports, importedBy, repoDescription, language = "English" }) {
  // The first 80 lines are enough to tell what a file does, and less to read is faster
  const head = (content || "").split("\n").slice(0, 80).join("\n").slice(0, 4000);
  const prompt = `Project: ${repoDescription || "(no description)"}
File: ${path}
This file uses: ${imports.join(", ") || "nothing else in the project"}
Used by: ${importedBy.join(", ") || "no other files"}

First lines of the file:
\`\`\`
${head}
\`\`\`

Reply in ${language} with JSON:
{"summary": "1-2 sentences: what this file does and why it exists",
 "role": "one of: ${ROLES}",
 "key_items": ["up to 3 important functions/classes, each as 'name: what it does'"]}`;
  return askGemma(prompt, { system: SYSTEM });
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

Find the path through the files that answers the question, in the order the code runs.
Use only file paths from the list. Prefer following real links.
Reply in ${language} with JSON:
{"answer": "2-3 sentences answering the question simply",
 "path": [{"file": "exact path", "step": "one sentence: what happens in this file"}]}`;
  const out = await askGemma(prompt, { system: SYSTEM });
  // Safety: drop any file Gemma made up
  const all = new Set(nodes.map((n) => n.id));
  out.path = (out.path || []).filter((s) => all.has(s.file));
  return out;
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