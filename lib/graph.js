// graph.js — turns files + imports into the map data Person B draws.
// Output format (agreed with Person B):
// { nodes: [{ id, group, role, summary, importance, imports, importedBy }],
//   edges: [{ from, to }],
//   neighborhoods: [{ name, summary, files }] }

import { langOf, findImports } from "./parser.js";

// Folders that are never worth mapping
const SKIP_DIRS = /(^|\/)(node_modules|dist|build|out|vendor|\.next|\.nuxt|coverage|__pycache__|\.venv|venv|site-packages|\.git|examples?|docs?|fixtures?)\//i;
const SKIP_FILES = /\.(min|bundle)\.js$|\.d\.ts$|(^|\/)(setup|conftest)\.py$/i;

export const MAX_FILES = 250; // keeps big repos fast
export const MAX_FILE_BYTES = 150_000;

const TEST_FILES = /(^|\/)(tests?|__tests__|spec|e2e|cypress)\/|\.(test|spec)\.[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.py$/i;

// Choose which code files to analyze (shallow files first: they matter more).
// Tests are hidden by default: they crowd the map and beginners don't start there.
export function pickFiles(tree, { includeTests = false } = {}) {
  return tree
    .filter((f) => langOf(f.path))
    .filter((f) => !SKIP_DIRS.test(f.path) && !SKIP_FILES.test(f.path))
    .filter((f) => includeTests || !TEST_FILES.test(f.path))
    .filter((f) => f.size <= MAX_FILE_BYTES)
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES)
    .map((f) => f.path);
}

// Quick guess at a file's role from its path. Gemma can refine it later.
export function guessRole(path) {
  const p = path.toLowerCase();
  const name = p.split("/").pop();
  if (/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.|^test_|_test\.py$/.test(p)) return "test";
  if (/config|settings|\.config\.|constants?\./.test(name)) return "config";
  if (/^(main|index|app|server|cli|__main__|manage|wsgi|asgi)\.(js|jsx|ts|tsx|mjs|py|html)$/.test(name) && p.split("/").length <= 3)
    return "entry";
  if (/(components?|pages?|views?|ui|screens?|layouts?|templates?)\//.test(p) || /\.(jsx|tsx|vue|svelte)$/.test(p)) return "ui";
  if (/(models?|db|database|schemas?|migrations?|store|stores|entities|repositories)\//.test(p) || /(model|schema|store)\./.test(name))
    return "data";
  if (/(utils?|helpers?|common|shared)\//.test(p) || /util|helper/.test(name)) return "util";
  return "logic";
}

// Default neighborhood = the first meaningful folder (Gemma renames these later)
// e.g. "src/flask/sansio/app.py" -> "flask/sansio", "lib/express.js" -> "lib"
export function folderGroup(path) {
  const dirs = path.split("/").slice(0, -1);
  if (!dirs.length) return "Project root";
  const generic = new Set(["src", "lib", "app", "packages", "source"]);
  let i = 0;
  while (i < dirs.length && generic.has(dirs[i])) i++;
  const rest = dirs.slice(i);
  if (!rest.length) return dirs[dirs.length - 1];
  return rest.slice(0, 2).join("/");
}

// contents: { path: fileText }
export function buildGraph(paths, contents) {
  const fileSet = new Set(paths);
  const nodes = new Map();
  const edges = [];

  for (const p of paths) {
    nodes.set(p, {
      id: p,
      group: folderGroup(p),
      role: guessRole(p),
      summary: "",
      importance: 0,
      imports: [],
      importedBy: [],
    });
  }

  for (const p of paths) {
    const targets = findImports(p, contents[p], fileSet);
    for (const t of targets) {
      edges.push({ from: p, to: t });
      nodes.get(p).imports.push(t);
      nodes.get(t).importedBy.push(p);
    }
  }

  // Importance: how many files use this one (plus a little for using others).
  // Scaled to 1-10 so Person B can size the dots directly.
  const raw = [...nodes.values()].map((n) => n.importedBy.length * 2 + n.imports.length * 0.5);
  const max = Math.max(1, ...raw);
  [...nodes.values()].forEach((n, i) => {
    n.importance = Math.max(1, Math.round((raw[i] / max) * 10));
    if (n.role === "entry") n.importance = Math.max(n.importance, 6);
  });

  // Starter neighborhoods from folders
  const byGroup = {};
  for (const n of nodes.values()) (byGroup[n.group] ||= []).push(n.id);
  const neighborhoods = Object.entries(byGroup).map(([name, files]) => ({ name, summary: "", files }));

  return { nodes: [...nodes.values()], edges, neighborhoods };
}

// The most important files: these get AI summaries up front
export function topFiles(graph, n = 15) {
  return [...graph.nodes]
    .filter((x) => x.role !== "test")
    .sort((a, b) => b.importance - a.importance || b.importedBy.length - a.importedBy.length)
    .slice(0, n)
    .map((x) => x.id);
}
