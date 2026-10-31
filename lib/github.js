// github.js — gets files from GitHub.
// Uses only 2 API calls per repo (repo info + file tree). File contents come
// from raw.githubusercontent.com, which doesn't count against the API limit.

let GITHUB_TOKEN = null; // optional: raises the limit from 60 to 5,000 calls/hour

export function setGithubToken(token) {
  GITHUB_TOKEN = token || null;
}

// "https://github.com/owner/repo/tree/main/src" -> { owner, repo }
export function parseRepoUrl(url) {
  const m = String(url).match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/);
  if (!m) throw new Error("Not a GitHub repo URL: " + url);
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

async function api(path) {
  const headers = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 403 || res.status === 429) {
    throw new Error("GitHub rate limit hit. Add a token or wait a bit.");
  }
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  return res.json();
}

// API call 1: default branch + description
export async function getRepoInfo(owner, repo) {
  const r = await api(`/repos/${owner}/${repo}`);
  return {
    owner,
    repo,
    branch: r.default_branch,
    description: r.description || "",
    language: r.language || "",
  };
}

// API call 2: every file path in the repo, in one request
export async function getTree(owner, repo, branch) {
  const r = await api(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  return r.tree
    .filter((item) => item.type === "blob")
    .map((item) => ({ path: item.path, size: item.size || 0 }));
}

// File contents (not rate limited like the API)
export async function getFile(owner, repo, branch, path) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

// Fetch many files with a few at a time, so we don't flood the network
export async function getFiles(owner, repo, branch, paths, { concurrency = 8, onProgress } = {}) {
  const out = {};
  let i = 0;
  let done = 0;
  async function worker() {
    while (i < paths.length) {
      const p = paths[i++];
      try {
        out[p] = await getFile(owner, repo, branch, p);
      } catch {
        out[p] = null;
      }
      done++;
      onProgress?.(done, paths.length);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}
