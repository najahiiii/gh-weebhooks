import { config } from "../config";

export class GithubApiError extends Error {
  status: number;
  documentationUrl?: string;
  responseBody?: unknown;

  constructor(message: string, status: number, responseBody?: unknown, documentationUrl?: string) {
    super(message);
    this.status = status;
    this.responseBody = responseBody;
    this.documentationUrl = documentationUrl;
  }
}

const API_ROOT = "https://api.github.com";
const OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";

type GithubRequestOptions = {
  token?: string | null;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

async function githubRequest<T>(path: string, options: GithubRequestOptions = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_ROOT}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": config.githubUserAgent,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(options.headers || {})
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let body: string | undefined;
  if (options.body !== undefined) {
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  const response = await fetch(url, {
    method: options.method || (body ? "POST" : "GET"),
    headers,
    body
  });

  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const message = payload?.message || `GitHub API request failed with status ${response.status}`;
    const documentationUrl = payload?.documentation_url;
    throw new GithubApiError(message, response.status, payload, documentationUrl);
  }

  return payload as T;
}

export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string;
  scope: string[];
  tokenType: string;
}> {
  const payload = await githubRequest<{ access_token: string; scope: string; token_type: string }>(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json"
    },
    body: {
      client_id: config.githubClientId,
      client_secret: config.githubClientSecret,
      code,
      redirect_uri: `${config.publicBaseUrl}/api/github/oauth/callback`
    }
  });
  if (!payload.access_token) {
    throw new GithubApiError("GitHub did not return an access token", 400, payload);
  }
  const scope = payload.scope ? payload.scope.split(",").map((item) => item.trim()).filter(Boolean) : [];
  return {
    accessToken: payload.access_token,
    scope,
    tokenType: payload.token_type
  };
}

export type GithubUser = {
  login: string;
  avatar_url?: string;
};

export async function fetchViewer(token: string): Promise<GithubUser> {
  return githubRequest<GithubUser>("/user", { token });
}

export type GithubRepository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  owner: {
    login: string;
    avatar_url?: string;
  };
};

export async function fetchRepositories(token: string, params?: { perPage?: number; page?: number }): Promise<{
  repositories: GithubRepository[];
  hasNextPage: boolean;
}> {
  const perPage = params?.perPage ?? 100;
  const page = params?.page ?? 1;
  const query = new URLSearchParams({
    per_page: String(perPage),
    page: String(page),
    sort: "updated",
    direction: "desc",
    affiliation: "owner,collaborator,organization_member"
  });
  const response = await fetch(`${API_ROOT}/user/repos?${query.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": config.githubUserAgent,
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`
    }
  });
  const text = await response.text();
  let payload: any;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload?.message || `GitHub API request failed with status ${response.status}`;
    const documentationUrl = payload?.documentation_url;
    throw new GithubApiError(message, response.status, payload, documentationUrl);
  }
  const link = response.headers.get("link");
  const hasNextPage = Boolean(link && link.includes('rel="next"'));
  return {
    repositories: (payload as GithubRepository[]) || [],
    hasNextPage
  };
}

export type GithubWebhook = {
  id: number;
  url: string;
  config: {
    url: string;
    content_type: string;
    insecure_ssl?: string;
  };
  events: string[];
  active: boolean;
  name?: string;
  created_at?: string;
  updated_at?: string;
};

export function parseRepoFullName(repo: string): { owner: string; name: string } {
  const trimmed = repo.trim();
  const parts = trimmed.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Repository name must be in owner/repo format");
  }
  return { owner: parts[0], name: parts[1] };
}

export async function createRepoWebhook(
  token: string,
  owner: string,
  repo: string,
  payload: { url: string; secret: string; events: string[] }
): Promise<GithubWebhook> {
  return githubRequest<GithubWebhook>(`/repos/${owner}/${repo}/hooks`, {
    token,
    method: "POST",
    body: {
      name: "web",
      active: true,
      events: payload.events,
      config: {
        url: payload.url,
        content_type: "json",
        secret: payload.secret,
        insecure_ssl: "0"
      }
    }
  });
}

export async function updateRepoWebhook(
  token: string,
  owner: string,
  repo: string,
  hookId: number,
  payload: { url: string; secret: string; events: string[] }
): Promise<GithubWebhook> {
  return githubRequest<GithubWebhook>(`/repos/${owner}/${repo}/hooks/${hookId}`, {
    token,
    method: "PATCH",
    body: {
      active: true,
      events: payload.events,
      config: {
        url: payload.url,
        content_type: "json",
        secret: payload.secret,
        insecure_ssl: "0"
      }
    }
  });
}

export async function deleteRepoWebhook(token: string, owner: string, repo: string, hookId: number): Promise<void> {
  await githubRequest(`/repos/${owner}/${repo}/hooks/${hookId}`, {
    token,
    method: "DELETE"
  });
}

export async function listRepoWebhooks(token: string, owner: string, repo: string): Promise<GithubWebhook[]> {
  return githubRequest<GithubWebhook[]>(`/repos/${owner}/${repo}/hooks`, { token });
}
