// Draws the repo map in the side panel, using the real analysis engine in lib/.

import {
  analyzeRepo,
  explainFileLive,
  explainFileInDepthLive,
  askHowItWorks,
  fileFromGithubUrl,
  repoUrlFromTab,
} from "./lib/analyze.js";

const ROLE_COLORS = {
  entry: "#ff7b54",
  ui: "#58a6ff",
  logic: "#bc8cff",
  data: "#3fb9a8",
  util: "#f2cc60",
  config: "#8b949e",
  test: "#6e7681",
};
const ROLE_NAMES = {
  entry: "Starting point",
  ui: "Screen / UI",
  logic: "Logic",
  data: "Data",
  util: "Helpers",
  config: "Settings",
  test: "Tests",
};

const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("status-text");
const repoEl = document.getElementById("repo");
const overviewEl = document.getElementById("overview");
const detailsEl = document.getElementById("details");
const legendEl = document.getElementById("legend");
const DEFAULT_DETAILS = `<span class="hint">Click a dot to see what that file does.</span>`;

let graph = null; // the current repo's graph from analyzeRepo()
let currentRepo = null; // "https://github.com/owner/repo"
let laidOut = false;

// Text from Gemma and GitHub goes into innerHTML, so escape it first
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Friendlier wording for the engine's progress messages
function setStatus(msg) {
  if (!msg) {
    statusEl.hidden = true;
    return;
  }
  const friendly = [
    [/^Reading repo info/, "Opening the repo"],
    [/^Listing files/, "Listing every file"],
    [/^Reading files… (\d+)\/(\d+)/, "Reading the code ($1 of $2 files)"],
    [/^Reading \d+ files/, "Reading the code"],
    [/^Finding connections/, "Following the imports"],
    [/^Naming the neighborhoods/, "Gemma is reading the README and naming each part. Explore the map meanwhile"],
  ];
  let text = msg;
  for (const [re, nice] of friendly) if (re.test(msg)) text = msg.replace(re, nice);
  statusTextEl.textContent = text;
  statusEl.hidden = false;
}

// ---------- Map ----------

// Neighborhood boxes use a stable id ("hood:0"), so when Gemma renames a
// neighborhood we only change its label instead of rebuilding the map.
function toElements(g) {
  const hoodOf = {};
  g.neighborhoods.forEach((h, i) => h.files.forEach((f) => (hoodOf[f] = i)));
  const hoods = g.neighborhoods.map((h, i) => ({ data: { id: "hood:" + i, label: h.name } }));
  const files = g.nodes.map((n) => ({
    data: {
      id: n.id,
      parent: "hood:" + hoodOf[n.id],
      label: n.id.split("/").pop(),
      role: n.role,
      importance: n.importance,
    },
  }));
  const edges = g.edges.map((e) => ({ data: { id: e.from + "->" + e.to, source: e.from, target: e.to } }));
  // Invisible "glue" edges keep each folder's files together in the layout,
  // even when the files don't import each other
  const glue = g.neighborhoods.flatMap((h) =>
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
  minZoom: 0.3,
  maxZoom: 3,
  style: [
    {
      selector: "node",
      style: {
        label: "data(label)",
        "font-size": 10,
        color: "#e6edf3",
        "text-outline-color": "#0d1117",
        "text-outline-width": 2,
        "transition-property": "opacity, border-width",
        "transition-duration": "0.2s",
      },
    },
    {
      selector: "node[role]",
      style: {
        "background-color": (n) => ROLE_COLORS[n.data("role")] || "#888",
        width: "mapData(importance, 1, 10, 14, 44)",
        height: "mapData(importance, 1, 10, 14, 44)",
        "text-valign": "bottom",
        "text-margin-y": 4,
        "border-width": 0,
      },
    },
    {
      selector: ":parent",
      style: {
        shape: "round-rectangle",
        "background-color": "#161b22",
        "background-opacity": 1,
        "border-color": "#30363d",
        "border-width": 1,
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -4,
        "font-size": 11,
        "font-weight": "bold",
        color: "#8b949e",
        "text-outline-width": 0,
        padding: 14,
      },
    },
    {
      selector: "edge",
      style: {
        width: 1.2,
        "line-color": "#3d444d",
        "target-arrow-shape": "triangle",
        "target-arrow-color": "#3d444d",
        "arrow-scale": 0.7,
        "curve-style": "bezier",
        "transition-property": "opacity, line-color, width",
        "transition-duration": "0.2s",
      },
    },
    { selector: ".faded", style: { opacity: 0.12 } },
    { selector: "node.selected", style: { "border-width": 3, "border-color": "#e6edf3" } },
    { selector: "edge.lit", style: { "line-color": "#58a6ff", "target-arrow-color": "#58a6ff", width: 2 } },
    { selector: ".here", style: { "border-width": 3, "border-color": "#e6edf3", "border-style": "dashed" } },
    { selector: "node.start", style: { "border-width": 3, "border-color": "#3fb950" } },
    { selector: "node.traced", style: { "border-width": 4, "border-color": "#f59e0b" } },
    { selector: "edge.traced", style: { width: 3, "line-color": "#f59e0b", "target-arrow-color": "#f59e0b" } },
    { selector: "edge.glue", style: { opacity: 0, events: "no" } },
  ],
  layout: { name: "preset" },
});

// Zoom to some elements, but never closer than maxZoom (so dots don't get huge)
function zoomTo(eles, padding = 40, maxZoom = 1.3) {
  cy.stop();
  const bb = eles.boundingBox();
  const w = cy.width(), h = cy.height();
  const zoom = Math.min(maxZoom, (w - 2 * padding) / Math.max(bb.w, 1), (h - 2 * padding) / Math.max(bb.h, 1));
  cy.animate({ zoom, center: { eles } }, { duration: 300 });
}
const fitMap = () => zoomTo(cy.elements(), 24, 2);

// Keep the map the right size when the details panel grows or shrinks
new ResizeObserver(() => cy.resize()).observe(document.getElementById("map-wrap"));
document.getElementById("fit").addEventListener("click", fitMap);

function runLayout() {
  cy.layout({
    name: "cose",
    animate: false,
    padding: 24,
    nodeRepulsion: () => 9000,
    idealEdgeLength: () => 70,
    nestingFactor: 0.9,
    componentSpacing: 60,
    gravity: 0.6,
    numIter: 1500,
  }).run();
  // Fit after the panel has its final size (extra padding leaves room for the legend)
  requestAnimationFrame(() => {
    cy.resize();
    cy.fit(undefined, 36);
  });
}

function renderLegend(g) {
  const used = [...new Set(g.nodes.map((n) => n.role))];
  legendEl.innerHTML = Object.keys(ROLE_COLORS)
    .filter((r) => used.includes(r))
    .map((r) => `<span style="--c:${ROLE_COLORS[r]}">${ROLE_NAMES[r]}</span>`)
    .join("");
}

// Called every time the engine has something new (map first, then summaries)
function onGraphUpdate(g) {
  graph = g;
  repoEl.textContent = `${g.repo.owner}/${g.repo.repo}`;
  if (!laidOut) {
    cy.elements().remove();
    cy.add(toElements(g));
    runLayout();
    laidOut = true;
    renderLegend(g);
    showYouAreHereFromActiveTab();
  }
  // Update neighborhood names and roles as Gemma fills them in
  g.neighborhoods.forEach((h, i) => cy.getElementById("hood:" + i).data("label", h.name));
  g.nodes.forEach((n) => cy.getElementById(n.id).data("role", n.role));
  cy.nodes().removeClass("start");
  if (g.startHere) cy.getElementById(g.startHere).addClass("start");
  renderOverview(g);
  // Refresh the open file if its summary just arrived
  if (selected) {
    const file = g.nodes.find((n) => n.id === selected);
    if (file?.summary && detailsEl.querySelector(".summary .loading")) renderFile(file);
  }
}

function renderOverview(g) {
  if (!g.overview) {
    overviewEl.innerHTML = "";
    return;
  }
  overviewEl.innerHTML = `
    <p>${esc(g.overview)}</p>
    ${g.startHere ? `<a href="#" class="start" data-file="${esc(g.startHere)}">⭐ Start here: ${esc(g.startHere.split("/").pop())}</a>` : ""}`;
}

overviewEl.addEventListener("click", (e) => {
  const file = e.target.closest("[data-file]")?.dataset.file;
  if (!file) return;
  e.preventDefault();
  selectFile(file, { zoom: true });
});

// ---------- Load the repo in the current tab ----------

let loadRun = 0;

async function loadRepo(repoUrl) {
  if (repoUrl === currentRepo) return;
  const run = ++loadRun;
  currentRepo = repoUrl;
  graph = null;
  laidOut = false;
  selected = null;
  cy.elements().remove();
  detailsEl.innerHTML = DEFAULT_DETAILS;
  overviewEl.innerHTML = "";
  legendEl.innerHTML = "";
  repoEl.textContent = "";

  if (!repoUrl) {
    statusTextEl.textContent = "Open a GitHub repository to see its map.";
    statusEl.hidden = false;
    statusEl.querySelector(".bar").hidden = true;
    return;
  }
  statusEl.querySelector(".bar").hidden = false;
  try {
    await analyzeRepo(repoUrl, {
      onProgress: (msg) => run === loadRun && setStatus(msg === "Done" || msg === "Loaded from cache" ? "" : msg),
      onUpdate: (g) => run === loadRun && onGraphUpdate(g),
    });
  } catch (e) {
    if (run === loadRun) {
      statusTextEl.innerHTML = `<span class="error">⚠️ ${esc(e.message)}</span>`;
      statusEl.querySelector(".bar").hidden = true;
      statusEl.hidden = false;
    }
  }
}

async function checkActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await loadRepo(repoUrlFromTab(tab?.url));
}

// ---------- "Thinking" indicator ----------
// Shows changing status words (like "Reading main.py…") until Gemma's first words arrive.

function startThinking(el, phrases) {
  let i = 0;
  const show = () => (el.innerHTML = `<span class="thinking">${esc(phrases[i % phrases.length])}</span>`);
  show();
  const timer = setInterval(() => {
    i++;
    if (i < phrases.length) show(); // stay on the last phrase instead of looping
  }, 1300);
  return () => clearInterval(timer);
}

// Shows streamed text; the first words stop the thinking animation
function streamInto(getEl, stopThinking, render = (t) => esc(t)) {
  let started = false;
  return (text) => {
    const el = getEl();
    if (!el) return;
    if (!started) {
      started = true;
      stopThinking();
    }
    el.innerHTML = render(text) + `<span class="cursor"></span>`;
  };
}

// Tiny formatter for the detailed tour: "## Heading", "- item: text", plain lines
function renderTour(text) {
  let html = "";
  let inList = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/\*\*/g, "");
    if (!line) continue;
    if (/^#{1,4}\s/.test(line)) {
      if (inList) (html += "</ul>"), (inList = false);
      html += `<h4>${esc(line.replace(/^#+\s*/, ""))}</h4>`;
    } else if (/^[-*•]\s/.test(line)) {
      if (!inList) (html += "<ul>"), (inList = true);
      const item = line.replace(/^[-*•]\s*/, "");
      const m = item.match(/^([^:]{1,40}):\s*(.*)$/);
      html += m ? `<li><b>${esc(m[1])}</b>: ${esc(m[2])}</li>` : `<li>${esc(item)}</li>`;
    } else {
      if (inList) (html += "</ul>"), (inList = false);
      html += `<p>${esc(line)}</p>`;
    }
  }
  return html + (inList ? "</ul>" : "");
}

// ---------- Click a file ----------

const chips = (ids) =>
  ids.length
    ? ids.map((id) => `<span class="chip" data-file="${esc(id)}">${esc(id.split("/").pop())}</span>`).join(", ")
    : `<span class="hint">none</span>`;

function renderFile(file) {
  const color = ROLE_COLORS[file.role] || "#888";
  detailsEl.innerHTML = `
    <div class="file-title">${esc(file.id)}<span class="role" style="--c:${color}">${esc(ROLE_NAMES[file.role] || file.role)}</span></div>
    <p class="summary">${file.summary ? esc(file.summary) : ""}</p>
    <div class="links">
      <b>Uses</b><div>${chips(file.imports)}</div>
      <b>Used by</b><div>${chips(file.importedBy)}</div>
    </div>
    <div id="deep">${
      file.deepText
        ? renderTour(file.deepText)
        : file.deep
          ? renderDeep(file.deep)
          : `<button id="explain-more" type="button">🔍 Explain this file in detail</button>`
    }</div>`;
}

function renderDeep(d) {
  const parts = (d.parts || []).map((p) => `<li><b>${esc(p.name)}</b>: ${esc(p.what)}</li>`).join("");
  const terms = (d.terms || []).map((t) => `<li><b>${esc(t.term)}</b>: ${esc(t.meaning)}</li>`).join("");
  return `
    <h4>What it's for</h4><p>${esc(d.purpose)}</p>
    ${parts ? `<h4>Main parts</h4><ul>${parts}</ul>` : ""}
    ${d.connections ? `<h4>How it connects</h4><p>${esc(d.connections)}</p>` : ""}
    ${d.change_tips ? `<h4>⚠️ Careful when editing</h4><p>${esc(d.change_tips)}</p>` : ""}
    ${terms ? `<h4>Words to know</h4><ul>${terms}</ul>` : ""}`;
}

let selected = null;

async function selectFile(fileId, { zoom = false } = {}) {
  if (!graph) return;
  const file = graph.nodes.find((n) => n.id === fileId);
  const node = cy.getElementById(fileId);
  if (!file || node.empty()) return;
  selected = file.id;
  renderFile(file);
  detailsEl.scrollTop = 0;

  // Highlight this file and its direct connections, fade the rest
  cy.elements().removeClass("traced selected lit").addClass("faded");
  const near = node.closedNeighborhood().not(".glue");
  near.removeClass("faded");
  near.edges().addClass("lit");
  near.nodes().ancestors().removeClass("faded");
  node.addClass("selected");
  if (zoom) zoomTo(near.nodes());

  // No summary yet? Ask Gemma now, and stream the answer in
  if (!file.summary) {
    const name = file.id.split("/").pop();
    const getEl = () => (selected === file.id ? detailsEl.querySelector(".summary") : null);
    const stop = startThinking(getEl(), [
      `Opening ${name}`,
      `Skimming its functions and classes`,
      file.imports.length ? `Following ${file.imports.length} import${file.imports.length > 1 ? "s" : ""}` : `Checking what it depends on`,
      file.importedBy.length ? `Checking the ${file.importedBy.length} file${file.importedBy.length > 1 ? "s" : ""} that use it` : `Checking who uses it`,
      `Putting it in plain English`,
    ]);
    try {
      await explainFileLive(graph, file.id, streamInto(getEl, stop));
    } catch (e) {
      const el = getEl();
      if (el) el.innerHTML = `<span class="error">⚠️ ${esc(e.message)}</span>`;
    } finally {
      stop();
    }
    const el = getEl();
    if (el && file.summary) el.textContent = file.summary; // remove the cursor
  }
}

cy.on("tap", "node[role]", (evt) => selectFile(evt.target.id()));

detailsEl.addEventListener("click", async (e) => {
  // Click a file name under "Uses" / "Used by" to jump to it
  const jump = e.target.closest(".chip")?.dataset.file;
  if (jump) return selectFile(jump, { zoom: true });

  if (e.target.id !== "explain-more" || !selected) return;
  const fileId = selected;
  const name = fileId.split("/").pop();
  const getEl = () => (selected === fileId ? document.getElementById("deep") : null);
  const stop = startThinking(getEl(), [
    `Reading ${name} line by line`,
    `Finding the main parts`,
    `Tracing how it connects`,
    `Looking for tricky spots`,
    `Writing your tour`,
  ]);
  try {
    const text = await explainFileInDepthLive(graph, fileId, streamInto(getEl, stop, renderTour));
    if (getEl()) getEl().innerHTML = renderTour(text);
  } catch (err) {
    if (getEl())
      getEl().innerHTML = `<p class="error">⚠️ ${esc(err.message)}</p><button id="explain-more" type="button">Try again</button>`;
  } finally {
    stop();
  }
});

// Tap empty space to clear
cy.on("tap", (evt) => {
  if (evt.target === cy) {
    selected = null;
    cy.elements().removeClass("faded traced selected lit");
    detailsEl.innerHTML = DEFAULT_DETAILS;
  }
});

// ---------- "You are here" ----------

function showYouAreHere(url) {
  cy.nodes().removeClass("here");
  const id = fileFromGithubUrl(url) || "";
  const node = cy.getElementById(id);
  if (node.nonempty()) {
    node.addClass("here");
    selectFile(id);
  }
}

async function showYouAreHereFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  showYouAreHere(tab?.url);
}

chrome.tabs.onActivated.addListener(async () => {
  await checkActiveTab();
  showYouAreHereFromActiveTab();
});
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info.url || !tab.active) return;
  await loadRepo(repoUrlFromTab(info.url));
  if (laidOut) showYouAreHere(info.url);
});

// ---------- Feature tracing: light up each step's file in order ----------

let traceRun = 0;

async function playTrace(trace) {
  const run = ++traceRun;
  selected = null;
  cy.elements().removeClass("traced here selected lit").addClass("faded");
  detailsEl.innerHTML = `<p>${esc(trace.answer)}</p><ol id="trace-steps"></ol>`;
  const stepsEl = document.getElementById("trace-steps");
  const pathNodes = cy.collection();

  let prev = null;
  for (const step of trace.path || []) {
    if (run !== traceRun) return; // a newer trace started
    const node = cy.getElementById(step.file);
    pathNodes.merge(node);
    node.removeClass("faded").addClass("traced");
    node.ancestors().removeClass("faded");
    if (prev) prev.edgesTo(node).not(".glue").removeClass("faded").addClass("traced");
    stepsEl.insertAdjacentHTML(
      "beforeend",
      `<li><span class="chip" data-file="${esc(step.file)}"><b>${esc(step.file.split("/").pop())}</b></span>: ${esc(step.step)}</li>`
    );
    prev = node;
    await new Promise((r) => setTimeout(r, 600));
  }
  if (pathNodes.nonempty()) zoomTo(pathNodes, 50);
}

document.getElementById("ask").addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = document.getElementById("question").value.trim();
  if (!question || !graph) return;
  const button = e.target.querySelector("button");
  button.disabled = true;
  button.textContent = "Tracing…";
  selected = null;
  const stop = startThinking(detailsEl, [
    `Understanding your question`,
    `Scanning ${graph.nodes.length} files`,
    `Following ${graph.edges.length} connections`,
    `Finding where it starts`,
    `Putting the steps in order`,
    `Double-checking the path`,
  ]);
  try {
    const trace = await askHowItWorks(graph, question);
    stop();
    playTrace(trace);
  } catch (err) {
    stop();
    detailsEl.innerHTML = `<p class="error">⚠️ ${esc(err.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "Trace";
  }
});

checkActiveTab();
