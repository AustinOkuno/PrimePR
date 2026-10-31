// Test the parser + graph on a repo cloned to your disk (no GitHub API needed).
//   node test/local.mjs path/to/cloned/repo

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pickFiles, buildGraph, topFiles } from "../lib/graph.js";

const root = process.argv[2];
const tree = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else tree.push({ path: relative(root, full).split("\\").join("/"), size: st.size });
  }
})(root);

const paths = pickFiles(tree);
const contents = Object.fromEntries(paths.map((p) => [p, readFileSync(join(root, p), "utf8")]));
const g = buildGraph(paths, contents);

console.log(`Files mapped: ${g.nodes.length} | connections: ${g.edges.length} | unconnected: ${
  g.nodes.filter((n) => !n.imports.length && !n.importedBy.length).length
}`);
console.log("Top files:");
for (const id of topFiles(g, 8)) {
  const n = g.nodes.find((x) => x.id === id);
  console.log(`  ${String(n.importance).padStart(2)} ${n.role.padEnd(6)} ${id} (used by ${n.importedBy.length})`);
}
console.log("Neighborhoods:", g.neighborhoods.map((x) => `${x.name}(${x.files.length})`).join(", "));
