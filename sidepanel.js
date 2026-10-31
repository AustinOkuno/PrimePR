// Draws the repo map in the side panel.
import { analyzeRepo, askHowItWorks, fileFromGithubUrl } from "./lib/analyze.js";

let currentGraph = null; // the repo map being shown


const ROLE_COLORS = {
  entry: "#e4572e",
  ui: "#4f86f7",
  logic: "#8e6bd8",
  data: "#2a9d8f",
  util: "#f4a259",
  config: "#9a9a9a",
  test: "#c9c9c9",
};

// Turn the graph from getGraph() into Cytoscape's format
function toElements(graph) {
      // Box ids use the folder, which never changes; Gemma renames the label later
  const hoodId = (h) => "hood:" + (h.folder || h.name);
  const hoodOf = {};
  for (const h of graph.neighborhoods) for (const f of h.files) hoodOf[f] = hoodId(h);

  const hoods = graph.neighborhoods.map((h) => ({
    data: { id: hoodId(h), label: h.name },
  }));
  const files = graph.nodes.map((n) => ({
    data: {
      id: n.id,
      parent: hoodOf[n.id],                           
      label: n.id.split("/").pop(),
      role: n.role,
      importance: n.importance,
    },
  }));
  const edges = graph.edges.map((e) => ({
    data: { id: e.from + "->" + e.to, source: e.from, target: e.to },
  }));
    // Invisible "glue" edges keep each folder's files together in the layout,
  // even when the files don't import each other
  const glue = graph.neighborhoods.flatMap((h) =>
    h.files.slice(1).map((f, i) => ({
      data: { id: "glue:" + f, source: h.files[i], target: f },
      classes: "glue",
    }))
  );
  return [...hoods, ...files, ...edges, ...glue];

}

const cy = cytoscape({
  container: document.getElementById("map"),
  elements: [],
  style: [
    { selector: "node", style: { label: "data(label)", "font-size": 8 } },
    {
      selector: "node[role]",
      style: {
        "background-color": (n) => ROLE_COLORS[n.data("role")] || "#888",
        width: "mapData(importance, 1, 10, 12, 40)",
        height: "mapData(importance, 1, 10, 12, 40)",
        "text-valign": "bottom",
        "text-margin-y": 3,
      },
    },
    {
      selector: ":parent",
      style: {
        shape: "round-rectangle",
        "background-color": "#f3f4f6",
        "border-color": "#d1d5db",
        "border-width": 1,
        "text-valign": "top",
        "font-size": 10,
        "font-weight": "bold",
        padding: 10,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1,
        "line-color": "#cbd5e1",
        "target-arrow-shape": "triangle",
        "target-arrow-color": "#cbd5e1",
        "arrow-scale": 0.6,
        "curve-style": "bezier",
      },
    },
        { selector: ".faded", style: { opacity: 0.15 } },
            { selector: ".here", style: { "border-width": 4, "border-color": "#111827" } },
                { selector: "node.traced", style: { "border-width": 4, "border-color": "#f59e0b" } },
                    { selector: "edge.traced", style: { width: 3, "line-color": "#f59e0b", "target-arrow-color": "#f59e0b" } },
                        { selector: "edge.glue", style: { opacity: 0, events: "no" } },


  ],
  layout: { name: "preset" },
});


window.addEventListener("resize", () => cy.resize().fit(undefined, 10));

// Show a file's details when it's clicked
const detailsEl = document.getElementById("details");

cy.on("tap", "node[role]", (evt) => {
  const file = currentGraph.nodes.find((n) => n.id === evt.target.id());
  const list = (ids) => (ids.length ? ids.map((id) => id.split("/").pop()).join(", ") : "none");

  detailsEl.innerHTML = `
    <strong>${file.id}</strong> <em>(${file.role})</em>
    <p>${file.summary || "No summary yet."}</p>
    <p><b>Uses:</b> ${list(file.imports)}</p>
    <p><b>Used by:</b> ${list(file.importedBy)}</p>
  `;

  // Fade everything except this file and its direct connections
  cy.elements().addClass("faded");
  evt.target.closedNeighborhood().removeClass("faded");
  evt.target.ancestors().removeClass("faded");
});

// Tap empty space to clear
cy.on("tap", (evt) => {
  if (evt.target === cy) {
        cy.elements().removeClass("faded traced");
    detailsEl.textContent = "Click a file to see what it does.";
  }
});

// Load the repo open in the current tab and draw its map
let currentRepo = null; // "owner/repo" being shown

function drawGraph(graph) {
  if (graph !== currentGraph) {
    // A new repo: draw everything and lay it out
    currentGraph = graph;
    cy.elements().remove();
    cy.add(toElements(graph));
    cy.layout({ name: "cose", animate: false, padding: 10 }).run();
  } else {
    // Same repo with new AI names: update the box labels, keep positions
    for (const h of graph.neighborhoods) cy.getElementById("hood:" + (h.folder || h.name)).data("label", h.name);
  }
}

async function loadRepo(url) {
  const m = (url || "").match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/);
  if (!m) {
    detailsEl.textContent = "Open a GitHub repo to see its map.";
    return;
  }
  const key = m[1] + "/" + m[2];
  if (key === currentRepo) return; // already showing it
  currentRepo = key;
  try {
    await analyzeRepo(url, {
      useAI: false, // connections only for now; Gemma comes next
      refresh: true,
      onProgress: (msg) => (detailsEl.textContent = msg),
      onUpdate: drawGraph,
    });
  } catch (e) {
    currentRepo = null;
    detailsEl.textContent = "Couldn't load this repo: " + e.message;
  }
}


// "You are here": highlight the file open in the current GitHub tab

// github.com/owner/repo/blob/branch/path/to/file.js -> "path/to/file.js"
function filePathFromUrl(url) {
  const m = (url || "").match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function showYouAreHere(url) {
  cy.nodes().removeClass("here");
  const node = cy.getElementById(filePathFromUrl(url) || "");
  if (node.nonempty()) {
    node.addClass("here");
    node.emit("tap"); // reuse the click handler to show details
  }
}

async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await loadRepo(tab?.url);
  showYouAreHere(tab?.url);
}

chrome.tabs.onActivated.addListener(checkActiveTab);
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url && tab.active) checkActiveTab();
});
checkActiveTab();


// Feature tracing: light up each step's file in order
let traceRun = 0;

async function playTrace(trace) {
  const run = ++traceRun;
  cy.elements().removeClass("traced here").addClass("faded");
  detailsEl.innerHTML = `<p>${trace.answer}</p><ol id="trace-steps"></ol>`;
  const stepsEl = document.getElementById("trace-steps");

  let prev = null;
  for (const step of trace.steps) {
    if (run !== traceRun) return; // a newer trace started
    const node = cy.getElementById(step.file);
    node.removeClass("faded").addClass("traced");
    node.ancestors().removeClass("faded");
    if (prev) prev.edgesTo(node).not(".glue").removeClass("faded").addClass("traced");
    stepsEl.insertAdjacentHTML("beforeend", `<li><b>${step.file.split("/").pop()}</b>: ${step.note}</li>`);
    prev = node;
    await new Promise((r) => setTimeout(r, 600));
  }
}

document.getElementById("ask").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = document.getElementById("question").value.trim();
  if (question) playTrace(await traceFeature(null, null, question));
});



