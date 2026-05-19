/**
 * GitHub connection — OAuth, repo sync, issue/PR/branch/push operations.
 *
 * Shared GitHub OAuth client credentials come from _config/github-oauth.json.
 * User tokens are stored in _config/github.json inside the vault.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

/** Shared repos directory — all SE agents work here. */
const REPOS_BASE_DIR = resolve(homedir(), ".straja", "repos");
import { getGitHubOAuthClientConfig, hasGitHubOAuthClientConfig } from "./github-oauth-config.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubConfig {
  accessToken: string;
  username?: string;
  avatarUrl?: string;
  selectedRepos: GitHubRepoRef[];
  lastSync?: string;
  pollEnabled?: boolean;
  pollIntervalMinutes?: number; // 5 | 15 | 30 | 60
  syncIssues?: boolean;
  syncPRs?: boolean;
  authErrorCode?: string;
  authErrorMessage?: string;
  authErrorAt?: string;
}

export interface GitHubRepoRef {
  owner: string;
  name: string;
  fullName: string;
}

export interface GitHubRepo extends GitHubRepoRef {
  private: boolean;
  defaultBranch: string;
  description?: string;
  language?: string;
  updatedAt?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  body?: string;
  labels: string[];
  user: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  body?: string;
  head: string;
  base: string;
  user: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  merged: boolean;
}

export interface GitHubSyncResult {
  /** Number of repos successfully cloned/pulled to disk */
  imported: number;
  skipped: number;
  total: number;
  errors: string[];
}

export interface GitHubSyncOptions {
  config: GitHubConfig;
  upsertDocument: (
    collection: string,
    path: string,
    content: string,
    title: string,
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";
const PROTECTED_BRANCH_NAMES = new Set(["main", "master"]);

// Maximum file size to import (skip large binaries)
// ---------------------------------------------------------------------------
// OAuth helpers
// ---------------------------------------------------------------------------

export function hasClientCredentials(): boolean {
  return hasGitHubOAuthClientConfig();
}

export function generateAuthUrl(redirectUri: string): string {
  const { clientId } = getGitHubOAuthClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo read:user",
    state: crypto.randomUUID(),
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCode(
  code: string,
): Promise<{ accessToken: string; username: string; avatarUrl?: string }> {
  const { clientId, clientSecret } = getGitHubOAuthClientConfig();

  const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!tokenResp.ok) {
    throw new Error(`GitHub token exchange failed: ${tokenResp.status}`);
  }

  const tokenData = (await tokenResp.json()) as { access_token?: string; error?: string; error_description?: string };
  if (tokenData.error || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "No access token received");
  }

  // Fetch user profile
  const userResp = await ghFetch(tokenData.access_token, "/user");
  const user = (await userResp.json()) as { login: string; avatar_url?: string };

  return {
    accessToken: tokenData.access_token,
    username: user.login,
    avatarUrl: user.avatar_url,
  };
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

async function ghFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  return resp;
}

async function ghFetchJSON<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const resp = await ghFetch(token, path, init);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub API error ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<T>;
}

export function isGitHubAuthError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes("401") || err.message.includes("Bad credentials");
  }
  return false;
}

export function clearGitHubAuthError(config: GitHubConfig): void {
  delete config.authErrorCode;
  delete config.authErrorMessage;
  delete config.authErrorAt;
}

export function markGitHubAuthError(config: GitHubConfig): void {
  config.authErrorCode = "bad_credentials";
  config.authErrorMessage = "GitHub authorization expired or was revoked. Reconnect GitHub.";
  config.authErrorAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Repo listing
// ---------------------------------------------------------------------------

export async function listUserRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const batch = await ghFetchJSON<Array<{
      full_name: string;
      owner: { login: string };
      name: string;
      private: boolean;
      default_branch: string;
      description?: string;
      language?: string;
      updated_at?: string;
    }>>(token, `/user/repos?sort=updated&per_page=100&page=${page}&type=all`);

    for (const r of batch) {
      repos.push({
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        description: r.description ?? undefined,
        language: r.language ?? undefined,
        updatedAt: r.updated_at ?? undefined,
      });
    }

    if (batch.length < 100) break;
    page++;
  }

  return repos;
}

// ---------------------------------------------------------------------------
// Branch operations
// ---------------------------------------------------------------------------

export async function getDefaultBranch(token: string, owner: string, repo: string): Promise<string> {
  const data = await ghFetchJSON<{ default_branch: string }>(token, `/repos/${owner}/${repo}`);
  return data.default_branch;
}

export async function getBranchSha(token: string, owner: string, repo: string, branch: string): Promise<string> {
  const data = await ghFetchJSON<{ object: { sha: string } }>(token, `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  return data.object.sha;
}

export async function isProtectedBranch(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<boolean> {
  if (PROTECTED_BRANCH_NAMES.has(branch)) return true;
  const defaultBranch = await getDefaultBranch(token, owner, repo);
  return branch === defaultBranch;
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  fromBranch?: string,
): Promise<{ ref: string; sha: string }> {
  const base = fromBranch || await getDefaultBranch(token, owner, repo);
  const baseSha = await getBranchSha(token, owner, repo, base);

  const data = await ghFetchJSON<{ ref: string; object: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/refs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    },
  );

  return { ref: data.ref, sha: data.object.sha };
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export async function createIssue(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body?: string,
  labels?: string[],
): Promise<GitHubIssue> {
  const payload: Record<string, unknown> = { title };
  if (body) payload.body = body;
  if (labels?.length) payload.labels = labels;

  const data = await ghFetchJSON<{
    number: number; title: string; state: string; body?: string;
    labels: Array<{ name: string }>; user: { login: string };
    created_at: string; updated_at: string; html_url: string;
  }>(token, `/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return {
    number: data.number,
    title: data.title,
    state: data.state,
    body: data.body ?? undefined,
    labels: data.labels.map((l) => l.name),
    user: data.user.login,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    htmlUrl: data.html_url,
  };
}

export async function listIssues(
  token: string,
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
): Promise<GitHubIssue[]> {
  const data = await ghFetchJSON<Array<{
    number: number; title: string; state: string; body?: string;
    labels: Array<{ name: string }>; user: { login: string };
    created_at: string; updated_at: string; html_url: string;
    pull_request?: unknown;
  }>>(token, `/repos/${owner}/${repo}/issues?state=${state}&per_page=100`);

  return data
    .filter((d) => !d.pull_request) // GitHub API returns PRs as issues too
    .map((d) => ({
      number: d.number,
      title: d.title,
      state: d.state,
      body: d.body ?? undefined,
      labels: d.labels.map((l) => l.name),
      user: d.user.login,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      htmlUrl: d.html_url,
    }));
}

// ---------------------------------------------------------------------------
// Pull Requests
// ---------------------------------------------------------------------------

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string | undefined,
  head: string,
  base?: string,
): Promise<GitHubPullRequest> {
  const baseBranch = base || await getDefaultBranch(token, owner, repo);
  const payload: Record<string, unknown> = { title, head, base: baseBranch };
  if (body) payload.body = body;

  const data = await ghFetchJSON<{
    number: number; title: string; state: string; body?: string;
    head: { ref: string }; base: { ref: string };
    user: { login: string };
    created_at: string; updated_at: string; html_url: string; merged: boolean;
  }>(token, `/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return {
    number: data.number,
    title: data.title,
    state: data.state,
    body: data.body ?? undefined,
    head: data.head.ref,
    base: data.base.ref,
    user: data.user.login,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    htmlUrl: data.html_url,
    merged: data.merged,
  };
}

export async function listPullRequests(
  token: string,
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open",
): Promise<GitHubPullRequest[]> {
  const data = await ghFetchJSON<Array<{
    number: number; title: string; state: string; body?: string;
    head: { ref: string }; base: { ref: string };
    user: { login: string };
    created_at: string; updated_at: string; html_url: string; merged: boolean;
  }>>(token, `/repos/${owner}/${repo}/pulls?state=${state}&per_page=100`);

  return data.map((d) => ({
    number: d.number,
    title: d.title,
    state: d.state,
    body: d.body ?? undefined,
    head: d.head.ref,
    base: d.base.ref,
    user: d.user.login,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    htmlUrl: d.html_url,
    merged: d.merged,
  }));
}

// ---------------------------------------------------------------------------
// Push (via Git Data API — NO force push possible)
// ---------------------------------------------------------------------------

export async function pushWorkspaceChanges(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  files: Array<{ path: string; content: string }>,
  commitMessage: string,
): Promise<{ sha: string }> {
  // Safety: reject protected branches
  if (await isProtectedBranch(token, owner, repo, branch)) {
    throw new Error(
      `Refused to push to protected branch "${branch}". ` +
      `Create a feature branch and push there instead.`,
    );
  }

  // 1. Get latest commit SHA on the branch
  const branchSha = await getBranchSha(token, owner, repo, branch);

  // 2. Get the tree SHA of that commit
  const commitData = await ghFetchJSON<{ tree: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/commits/${branchSha}`,
  );
  const baseTreeSha = commitData.tree.sha;

  // 3. Create blobs for each file
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const file of files) {
    const blob = await ghFetchJSON<{ sha: string }>(
      token,
      `/repos/${owner}/${repo}/git/blobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
      },
    );
    treeEntries.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  // 4. Create a new tree
  const newTree = await ghFetchJSON<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    },
  );

  // 5. Create a new commit
  const newCommit = await ghFetchJSON<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        tree: newTree.sha,
        parents: [branchSha],
      }),
    },
  );

  // 6. Update the branch ref
  await ghFetchJSON<unknown>(
    token,
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommit.sha }),
    },
  );

  return { sha: newCommit.sha };
}

// ---------------------------------------------------------------------------
// Repo sync — clone repos to ~/.straja/repos/, sync issues/PRs to _github
// ---------------------------------------------------------------------------

export async function syncGitHubRepos(opts: GitHubSyncOptions): Promise<GitHubSyncResult> {
  const { config, upsertDocument } = opts;
  const token = config.accessToken;

  let imported = 0;
  const skipped = 0;
  const total = 0;
  const errors: string[] = [];

  for (const repoRef of config.selectedRepos) {
    const { owner, name } = repoRef;

    try {
      // ---------------------------------------------------------------
      // Clone/pull to persistent repos dir (~/.straja/repos/{name})
      // ---------------------------------------------------------------
      await mkdir(REPOS_BASE_DIR, { recursive: true });
      const repoDir = join(REPOS_BASE_DIR, name);
      const cleanUrl = `https://github.com/${owner}/${name}.git`;
      // Use GIT_ASKPASS to supply the token without embedding it in the remote URL.
      // This prevents the token from persisting in .git/config where agents can read it.
      const askpassScript = `#!/bin/sh\necho "x-access-token:${token}"`;
      const { tmpdir } = await import("node:os");
      const askpassPath = join(tmpdir(), `.git-askpass-${process.pid}-${Date.now()}`);
      await writeFile(askpassPath, askpassScript, { mode: 0o700 });
      const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: askpassPath };

      try {
        if (existsSync(join(repoDir, ".git"))) {
          // Repo already on disk — ensure remote URL is clean (fix legacy token-in-URL clones)
          await execFileAsync("git", ["remote", "set-url", "origin", cleanUrl], {
            cwd: repoDir,
            timeout: 10_000,
          }).catch(() => {});
          // Pull latest
          await execFileAsync("git", ["pull", "--ff-only"], {
            cwd: repoDir,
            timeout: 120_000,
            env: gitEnv,
          }).catch(() => {
            // Pull may fail (detached HEAD, conflicts, etc.) — not fatal
          });
        } else {
          // Fresh clone
          await rm(repoDir, { recursive: true, force: true }).catch(() => {});
          await execFileAsync("git", ["clone", "--depth=1", "--single-branch", cleanUrl, repoDir], {
            timeout: 120_000,
            env: gitEnv,
          });
        }
      } finally {
        await rm(askpassPath, { force: true }).catch(() => {});
      }
      imported++;

      // Sync issues if enabled
      if (config.syncIssues !== false) {
        try {
          const issues = await listIssues(token, owner, name, "open");
          for (const issue of issues) {
            const issuePath = `${owner}/${name}/issues/${issue.number}.md`;
            const content = formatIssueMarkdown(issue, owner, name);
            await upsertDocument("_github", issuePath, content, `#${issue.number}: ${issue.title}`);
          }
        } catch (err: any) {
          errors.push(`Failed to sync issues for ${owner}/${name}: ${err?.message}`);
        }
      }

      // Sync PRs if enabled
      if (config.syncPRs !== false) {
        try {
          const prs = await listPullRequests(token, owner, name, "open");
          for (const pr of prs) {
            const prPath = `${owner}/${name}/pulls/${pr.number}.md`;
            const content = formatPullRequestMarkdown(pr, owner, name);
            await upsertDocument("_github", prPath, content, `PR #${pr.number}: ${pr.title}`);
          }
        } catch (err: any) {
          errors.push(`Failed to sync PRs for ${owner}/${name}: ${err?.message}`);
        }
      }
    } catch (err: any) {
      errors.push(`Failed to sync ${owner}/${name}: ${err?.message}`);
    }
  }

  return { imported, skipped, total, errors };
}

// ---------------------------------------------------------------------------
// Markdown formatters for issues/PRs
// ---------------------------------------------------------------------------

function formatIssueMarkdown(issue: GitHubIssue, owner: string, repo: string): string {
  const lines: string[] = [
    "---",
    `number: ${issue.number}`,
    `title: "${issue.title.replace(/"/g, '\\"')}"`,
    `state: ${issue.state}`,
    `author: ${issue.user}`,
    `created: ${issue.createdAt}`,
    `updated: ${issue.updatedAt}`,
    `repo: ${owner}/${repo}`,
    `url: ${issue.htmlUrl}`,
  ];
  if (issue.labels.length) {
    lines.push(`labels: [${issue.labels.join(", ")}]`);
  }
  lines.push("---", "", `# #${issue.number}: ${issue.title}`, "");
  if (issue.body) {
    lines.push(issue.body, "");
  }
  return lines.join("\n");
}

function formatPullRequestMarkdown(pr: GitHubPullRequest, owner: string, repo: string): string {
  const lines: string[] = [
    "---",
    `number: ${pr.number}`,
    `title: "${pr.title.replace(/"/g, '\\"')}"`,
    `state: ${pr.state}`,
    `author: ${pr.user}`,
    `head: ${pr.head}`,
    `base: ${pr.base}`,
    `merged: ${pr.merged}`,
    `created: ${pr.createdAt}`,
    `updated: ${pr.updatedAt}`,
    `repo: ${owner}/${repo}`,
    `url: ${pr.htmlUrl}`,
    "---",
    "",
    `# PR #${pr.number}: ${pr.title}`,
    "",
    `**${pr.head}** → **${pr.base}**`,
    "",
  ];
  if (pr.body) {
    lines.push(pr.body, "");
  }
  return lines.join("\n");
}
