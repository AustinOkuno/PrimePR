// parser.js — finds which files import which, with plain regex. No AI here,
// so every line on the map is a real connection.
// Supports JavaScript/TypeScript and Python.

export const JS_EXT = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"];
export const PY_EXT = [".py"];

export function langOf(path) {
  const p = path.toLowerCase();
  if (JS_EXT.some((e) => p.endsWith(e))) return "js";
  if (PY_EXT.some((e) => p.endsWith(e))) return "py";
  return null;
}

function dirname(p) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

// Turns "src/a/../b/./c" into "src/b/c"
function normalize(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

// ---------- JavaScript / TypeScript ----------

const JS_PATTERNS = [
  /\bimport\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g, // import x from 'y' / import 'y'
  /\bexport\s+[^'"`;]*?\s+from\s+['"]([^'"]+)['"]/g, // export { x } from 'y'
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, // require('y')
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, // import('y')
];

function extractJs(content) {
  const specs = new Set();
  for (const re of JS_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) specs.add(m[1]);
  }
  return [...specs];
}

// "@/x" and "~/x" usually mean "src/x" or the project root, depending on setup.
const ALIAS_PREFIXES = ["@/", "~/"];

function candidatesFor(base) {
  // ESM TypeScript often imports "./x.js" when the file is "./x.ts"
  const stripped = base.replace(/\.(m|c)?js$/, "");
  const out = [base];
  for (const b of [base, stripped]) {
    for (const ext of JS_EXT) out.push(b + ext);
    for (const ext of JS_EXT) out.push(b + "/index" + ext);
  }
  return out;
}

function resolveJs(fromPath, spec, fileSet) {
  let bases;
  if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") {
    bases = [normalize(dirname(fromPath) + "/" + spec)];
  } else if (spec.startsWith("/")) {
    bases = [normalize(spec)];
  } else if (ALIAS_PREFIXES.some((a) => spec.startsWith(a))) {
    const rest = spec.slice(2);
    // Try src/, the project root, and the root of a sub-project (monorepos)
    const parts = fromPath.split("/");
    bases = [normalize("src/" + rest), normalize(rest)];
    for (let i = parts.length - 1; i > 0; i--) bases.push(normalize(parts.slice(0, i).join("/") + "/" + rest));
  } else if (spec.startsWith("src/")) {
    bases = [normalize(spec)];
  } else {
    return null; // a package like "react": outside the repo, skip
  }
  for (const base of bases) {
    const hit = candidatesFor(base).find((c) => fileSet.has(c));
    if (hit) return hit;
  }
  return null;
}

// ---------- Python ----------

function extractPy(content) {
  const specs = [];
  // from .a.b import c, d   /   from pkg.mod import (x, y)
  const fromRe = /^[ \t]*from\s+(\.*[\w.]*)\s+import\s+\(?([^\n)#]+)/gm;
  let m;
  while ((m = fromRe.exec(content))) {
    const names = m[2]
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
      .filter((s) => /^\w+$/.test(s));
    specs.push({ module: m[1], names });
  }
  // import a.b, c as d
  const importRe = /^[ \t]*import\s+([\w., \t]+)/gm;
  while ((m = importRe.exec(content))) {
    for (const part of m[1].split(",")) {
      const mod = part.trim().split(/\s+as\s+/)[0].trim();
      if (mod) specs.push({ module: mod, names: [] });
    }
  }
  return specs;
}

function pyCandidates(modPath) {
  return [modPath + ".py", modPath + "/__init__.py"];
}

// Python projects often keep code under one of these folders
const PY_ROOTS = ["", "src/", "lib/", "app/"];

function resolvePy(fromPath, { module, names }, fileSet) {
  const results = [];
  let basePaths = [];

  const dots = module.match(/^\.*/)[0].length;
  const rest = module.slice(dots).replace(/\./g, "/");

  if (dots > 0) {
    // Relative import: one dot = same folder, two = parent, ...
    let dir = dirname(fromPath);
    for (let i = 1; i < dots; i++) dir = dirname(dir);
    basePaths = [normalize(dir + "/" + rest)];
  } else {
    basePaths = PY_ROOTS.map((root) => normalize(root + rest));
  }

  for (const base of basePaths) {
    // "from pkg import mod" can mean the file pkg/mod.py: check that first
    let allNamesAreModules = names.length > 0;
    for (const n of names) {
      const sub = pyCandidates(normalize(base + "/" + n)).find((c) => fileSet.has(c));
      if (sub) results.push(sub);
      else allNamesAreModules = false;
    }
    // Otherwise the names live inside the module itself
    if (!allNamesAreModules) {
      const hit = base ? pyCandidates(base).find((c) => fileSet.has(c)) : null;
      if (hit) results.push(hit);
    }
    if (results.length) break;
  }
  return results;
}

// ---------- Public ----------

// Returns the list of repo files that `path` imports.
export function findImports(path, content, fileSet) {
  const lang = langOf(path);
  if (!lang || !content) return [];
  const found = new Set();
  if (lang === "js") {
    for (const spec of extractJs(content)) {
      const hit = resolveJs(path, spec, fileSet);
      if (hit && hit !== path) found.add(hit);
    }
  } else {
    for (const spec of extractPy(content)) {
      for (const hit of resolvePy(path, spec, fileSet)) {
        if (hit !== path) found.add(hit);
      }
    }
  }
  return [...found];
}
