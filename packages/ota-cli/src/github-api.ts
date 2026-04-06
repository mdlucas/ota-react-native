interface GhContentResponse {
  sha?: string;
}

function encodeRepoPath(repoPath: string): string {
  return repoPath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export async function githubGetContentSha(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<string | undefined> {
  const q = new URLSearchParams({ ref: branch });
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeRepoPath(path)}?${q}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );
  if (res.status === 404) return undefined;
  if (!res.ok) {
    throw new Error(`GitHub GET ${path}: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GhContentResponse;
  return data.sha;
}

export async function githubPutContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  message: string,
  contentBase64: string,
  sha?: string
): Promise<void> {
  const body: Record<string, string> = {
    message,
    content: contentBase64,
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeRepoPath(path)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    throw new Error(`GitHub PUT ${path}: ${res.status} ${await res.text()}`);
  }
}
