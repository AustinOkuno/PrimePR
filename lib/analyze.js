// analyze.js — the main entry point Person B calls.
//
//   import { analyzeRepo, explainFile, askHowItWorks, explainScreenshot } from "./lib/analyze.js";
//   const graph = await analyzeRepo("https://github.com/owner/repo", { onProgress: msg => ... });
//
// analyzeRepo returns the map data right after parsing (fast), then fills in
// AI summaries. Use onUpdate to redraw when summaries arrive.

import { parseRepoUrl, getRepoInfo, getTree, getFiles, getFile } from "./github.js";
import { pickFiles, buildGraph, topFiles } from "./graph.js";
import { summarizeFile, nameNeighborhoods, traceFeature, explainSnip, deepExplainFile } from "./gemma.js";

// ---- tiny cache (chrome.storage in the extension, memory elsewhere) ----
const memory = {};
const hasChrome = typeof chrome !== "undefined" && chrome.storage?.local;
async function cacheGet(key) {
  if (hasChrome) return (await chrome.storage.local.get(key))[key];
  return memory[key];
}
async function cacheSet(key, value) {
  if (hasChrome) {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch {
      /* storage full: keep going without cache */
    }
  } else memory[key] = value;
}

// File text is kept in memory only (too big for storage)
const contentsByRepo = {};

/**
 * Builds the map for a repo.
 * options:
 *   onProgress(message)   status text for a loading screen
 *   onUpdate(graph)       called each time new AI summaries arrive
 *   useAI (default true)  false = connections only, no Gemma (good for testing)
 *   topN (default 15)     how many files get summaries up front
 *   language              "English", "Spanish", ...
 *   refresh               ignore the cache
 */
export async function analyzeRepo(url, opts = {}) {
  const {
    onProgress = () => {},
    onUpdate = () => {},
    useAI = true,
    topN = 8, // more files get explained when clicked
    language = "English",
    refresh = false,
    includeTests = false,
  } = opts;
  const { owner, repo } = parseRepoUrl(url);
  const key = `repomap:${owner}/${repo}:${language}`;

  if (!refresh) {
    const cached = await cacheGet(key);
    if (cached) {
      onProgress("Loaded from cache");
      onUpdate(cached);
      return cached;
    }
  }

  onProgress("Reading repo info…");
  const info = await getRepoInfo(owner, repo);

  onProgress("Listing files…");
  const tree = await getTree(owner, repo, info.branch);
  const paths = pickFiles(tree, { includeTests });
  if (!paths.length) throw new Error("No JavaScript, TypeScript or Python files found in this repo.");

  onProgress(`Reading ${paths.length} files…`);
  const contents = await getFiles(owner, repo, info.branch, paths, {
    onProgress: (d, t) => onProgress(`Reading files… ${d}/${t}`),
  });
  contentsByRepo[`${owner}/${repo}`] = contents;

  onProgress("Finding connections…");
  const graph = buildGraph(paths, contents);
  graph.repo = { ...info, url: `https://github.com/${owner}/${repo}`, language, totalFiles: tree.length };
  graph.overview = "";
  graph.startHere = "";
  onUpdate(graph); // Person B can draw the map now

  if (!useAI) {
    await cacheSet(key, graph);
    return graph;
  }

  // Summaries for the most important files (one at a time: Ollama is single-threaded)
  const top = topFiles(graph, topN);
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  for (let i = 0; i < top.length; i++) {
    const node = byId[top[i]];
    onProgress(`Explaining files… ${i + 1}/${top.length}`);
    await fillSummary(node, contents[node.id], info.description, language);
    onUpdate(graph);
  }

  // Name the neighborhoods + overview
  onProgress("Naming the neighborhoods…");
  try {
    const readme = await findReadme(owner, repo, info.branch, tree);
    const groups = graph.neighborhoods.map((g) => ({ name: g.name, files: g.files.map((f) => byId[f]) }));
    const out = await nameNeighborhoods({ repoDescription: info.description, readme, groups, language });
    graph.overview = out.overview || "";
    graph.startHere = byId[out.start_here] ? out.start_here : top[0] || "";
    for (const nb of out.neighborhoods || []) {
      const g = graph.neighborhoods.find((x) => x.name === nb.folder);
      if (!g) continue;
      g.folder = g.name;
      g.name = nb.name || g.name;
      g.summary = nb.summary || "";
      for (const f of g.files) byId[f].group = g.name;
    }
  } catch (e) {
    console.warn("Neighborhood naming failed, keeping folder names:", e);
  }

  onProgress("Done");
  onUpdate(graph);
  await cacheSet(key, graph);
  return graph;
}

async function fillSummary(node, content, description, language) {
  try {
    const s = await summarizeFile({
      path: node.id,
      content,
      imports: node.imports,
      importedBy: node.importedBy,
      repoDescription: description,
      language,
    });
    node.summary = s.summary || "";
    node.keyItems = s.key_items || [];
    if (s.role && /^(entry|ui|logic|data|util|config|test)$/.test(s.role)) node.role = s.role;
  } catch (e) {
    node.summary = "";
    node.error = e.message;
  }
}

async function findReadme(owner, repo, branch, tree) {
  const r = tree.find((f) => /^readme(\.md|\.rst|\.txt)?$/i.test(f.path));
  return r ? (await getFile(owner, repo, branch, r.path)) || "" : "";
}

/** Called when a user clicks a file that has no summary yet. */
export async function explainFile(graph, fileId) {
  const node = graph.nodes.find((n) => n.id === fileId);
  if (!node) throw new Error("Unknown file: " + fileId);
  if (node.summary) return node;
  const { owner, repo, branch, description, language } = graph.repo;
  let content = contentsByRepo[`${owner}/${repo}`]?.[fileId];
  if (content == null) content = await getFile(owner, repo, branch, fileId);
  await fillSummary(node, content, description, language);
  return node;
}

/**
 * "Explain more" button: a detailed tour of one file.
 * -> { purpose, parts: [{name, what}], connections, change_tips, terms: [{term, meaning}] }
 * Cached on the node as node.deep.
 */
export async function explainFileInDepth(graph, fileId) {
  const node = graph.nodes.find((n) => n.id === fileId);
  if (!node) throw new Error("Unknown file: " + fileId);
  if (node.deep) return node.deep;
  const { owner, repo, branch, language } = graph.repo;
  let content = contentsByRepo[`${owner}/${repo}`]?.[fileId];
  if (content == null) content = await getFile(owner, repo, branch, fileId);
  node.deep = await deepExplainFile({
    path: node.id,
    content,
    imports: node.imports,
    importedBy: node.importedBy,
    summary: node.summary,
    language,
  });
  return node.deep;
}

/** "How does login work?" -> { answer, path: [{file, step}] } */
export async function askHowItWorks(graph, question) {
  const nodes = [...graph.nodes].sort((a, b) => b.importance - a.importance);
  return traceFeature({ question, nodes, edges: graph.edges, language: graph.repo.language });
}

/** Huh? hotkey: image is a "data:image/png;base64,..." string */
export async function explainScreenshot(graph, image, filePath) {
  const node = graph?.nodes.find((n) => n.id === filePath);
  return explainSnip({
    image,
    filePath,
    fileSummary: node?.summary,
    neighbors: node ? [...node.imports, ...node.importedBy].slice(0, 10) : [],
    language: graph?.repo?.language || "English",
  });
}

/** Turns a GitHub file URL into the file's path, for "You are here" */
export function fileFromGithubUrl(url) {
  const m = String(url).match(/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/(.+?)(?:[?#]|$)/);
  return m ? decodeURIComponent(m[1]) : null;
}