// Test the analysis from the terminal, no extension needed.
//   node test/run.mjs https://github.com/owner/repo          (connections only)
//   node test/run.mjs https://github.com/owner/repo --ai     (with Gemma, Ollama must be running)
//   node test/run.mjs https://github.com/owner/repo --ai --ask "how does login work?"

import { writeFileSync } from "node:fs";
import { analyzeRepo, askHowItWorks } from "../lib/analyze.js";

const url = process.argv[2];
const useAI = process.argv.includes("--ai");
const askIdx = process.argv.indexOf("--ask");
const question = askIdx > -1 ? process.argv[askIdx + 1] : null;

if (!url) {
  console.log("Usage: node test/run.mjs <github repo url> [--ai] [--ask \"question\"]");
  process.exit(1);
}

const t0 = Date.now();
const graph = await analyzeRepo(url, { useAI, onProgress: (m) => process.stdout.write(`\r${m.padEnd(50)}`) });
console.log(`\n\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
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

writeFileSync("graph.json", JSON.stringify(graph, null, 2));
console.log("\nSaved graph.json (send this to Person B as real test data)");
