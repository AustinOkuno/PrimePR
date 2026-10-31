// Test the analysis from the terminal, no extension needed.
//   node test/run.mjs https://github.com/owner/repo          (connections only)
//   node test/run.mjs https://github.com/owner/repo --ai     (with Gemma, Ollama must be running)
//   node test/run.mjs https://github.com/owner/repo --ai --ask "how does login work?"
//   node test/run.mjs https://github.com/owner/repo --ai --deep src/app.py   (detailed tour of one file)

import { writeFileSync } from "node:fs";
import { analyzeRepo, askHowItWorks, explainFileInDepth } from "../lib/analyze.js";

const url = process.argv[2];
const useAI = process.argv.includes("--ai");
const askIdx = process.argv.indexOf("--ask");
const question = askIdx > -1 ? process.argv[askIdx + 1] : null;

if (!url) {
  console.log("Usage: node test/run.mjs <github repo url> [--ai] [--ask \"question\"]");
  process.exit(1);
}

const deepIdx = process.argv.indexOf("--deep");
const deepFile = deepIdx > -1 ? process.argv[deepIdx + 1] : null;

const t0 = Date.now();
let mapAt = 0;
const graph = await analyzeRepo(url, {
  useAI,
  onProgress: (m) => process.stdout.write(`\r${m.padEnd(50)}`),
  onUpdate: () => {
    if (!mapAt) mapAt = Date.now();
  },
});
console.log(`\n\nMap ready in ${((mapAt - t0) / 1000).toFixed(1)}s, all summaries done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`Files mapped: ${graph.nodes.length} (of ${graph.repo.totalFiles} in repo)`);
console.log(`Connections:  ${graph.edges.length}`);
console.log(`Unconnected:  ${graph.nodes.filter((n) => !n.imports.length && !n.importedBy.length).length}`);

console.log("\nMost important files:");
for (const n of [...graph.nodes].sort((a, b) => b.importance - a.importance).slice(0, 10)) {
  console.log(`  ${String(n.importance).padStart(2)}  ${n.role.padEnd(6)} ${n.id}  (used by ${n.importedBy.length})`);
  if (n.summary) console.log(`        ${n.summary}`);
}

console.log("\nNeighborhoods:");
for (const g of graph.neighborhoods) console.log(`  ${g.name} (${g.files.length})${g.summary ? ": " + g.summary : ""}`);

if (graph.overview) console.log(`\nOverview: ${graph.overview}\nStart here: ${graph.startHere}`);

if (question && useAI) {
  const trace = await askHowItWorks(graph, question);
  console.log(`\nQ: ${question}\nA: ${trace.answer}`);
  trace.path.forEach((s, i) => console.log(`  ${i + 1}. ${s.file}: ${s.step}`));
}

if (deepFile && useAI) {
  const t1 = Date.now();
  const d = await explainFileInDepth(graph, deepFile);
  console.log(`\nDeep dive: ${deepFile} (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
  console.log(`  Purpose: ${d.purpose}`);
  for (const p of d.parts || []) console.log(`  - ${p.name}: ${p.what}`);
  console.log(`  Connections: ${d.connections}`);
  console.log(`  Careful: ${d.change_tips}`);
  for (const t of d.terms || []) console.log(`  [${t.term}] ${t.meaning}`);
}

writeFileSync("graph.json", JSON.stringify(graph, null, 2));
console.log("\nSaved graph.json (send this to Person B as real test data)");
