// Draws the repo map in the side panel.

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
  const hoods = graph.neighborhoods.map((h) => ({
    data: { id: "hood:" + h.name, label: h.name },
  }));
  const files = graph.nodes.map((n) => ({
    data: {
      id: n.id,
      parent: "hood:" + n.group,
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
  elements: toElements(getGraph()),
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
        { selector: "edge.glue", style: { opacity: 0, events: "no" } },
  ],
  layout: { name: "preset" },
});

requestAnimationFrame(() => cy.layout({ name: "cose", animate: false, padding: 10 }).run());
window.addEventListener("resize", () => cy.resize().fit(undefined, 10));
