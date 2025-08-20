// === keep your existing constants & types ===
const CLIENT_ID = import.meta.env.VITE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.VITE_CLIENT_SECRET;
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI;
const SCOPES = [
  "read:jira-user",
  "read:jira-work",
  "write:jira-work",   // ⬅️ required for transitions & comments
  "read:me",
  "offline_access"
];

type TokenData = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: "Bearer";
  expires_at?: number;
};

// === keep your existing helper functions as-is ===
function buildAuthUrl() {
  const base = "https://auth.atlassian.com/authorize";
  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    prompt: "consent",
    state: crypto.randomUUID(),
    scope: SCOPES.join(" ")
  });
  return `${base}?${params.toString()}`;
}

async function exchangeCodeForToken(code: string): Promise<TokenData> {
  const res = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI
    })
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = (await res.json()) as TokenData;
  data.expires_at = Date.now() + (data.expires_in - 30) * 1000;
  await chrome.storage.local.set({ jira_token: data });
  return data;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenData> {
  const res = await fetch("https://auth.atlassian.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken
    })
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
  const data = (await res.json()) as TokenData;
  data.expires_at = Date.now() + (data.expires_in - 30) * 1000;
  const existing = await chrome.storage.local.get("jira_token");
  if (!data.refresh_token && existing?.jira_token?.refresh_token) {
    data.refresh_token = existing.jira_token.refresh_token;
  }
  await chrome.storage.local.set({ jira_token: data });
  return data;
}

async function getValidAccessToken(): Promise<string | null> {
  const { jira_token } = await chrome.storage.local.get("jira_token");
  if (!jira_token) return null;
  const token: TokenData = jira_token;
  if (token.expires_at && Date.now() < token.expires_at) return token.access_token;
  if (token.refresh_token) {
    const refreshed = await refreshAccessToken(token.refresh_token);
    return refreshed.access_token;
  }
  return null;
}

// === profile helpers kept ===
async function fetchProfile(): Promise<any> {
  const access = await getValidAccessToken();
  if (!access) throw new Error("Not authenticated");
  const res = await fetch("https://api.atlassian.com/me", {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
  return res.json();
}

async function getCloudId(access: string): Promise<string> {
  const r1 = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }
  });
  if (!r1.ok) throw new Error(`Resources fetch failed: ${r1.status}`);
  const resources = await r1.json();
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error("No accessible Jira sites");
  }
  return resources[0].id;
}

async function fetchJiraMyself(): Promise<any> {
  const access = await getValidAccessToken();
  if (!access) throw new Error("Not authenticated");
  const cloudId = await getCloudId(access);
  const r2 = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }
  });
  if (!r2.ok) throw new Error(`Jira myself failed: ${r2.status}`);
  return r2.json();
}

async function fetchJiraProjects(): Promise<any> {
  const access = await getValidAccessToken();
  if (!access) throw new Error("Not authenticated");
  const cloudId = await getCloudId(access);
  const r2 = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project`, {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }
  });
  if (!r2.ok) throw new Error(`Projects fetch failed: ${r2.status}`);
  return r2.json();
}

// === detect & cache story points field key (varies per site/type) ===
async function getStoryPointsFieldKey(access: string, cloudId: string): Promise<string> {
  const cacheKey = `sp_field_key_${cloudId}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached?.[cacheKey]) return cached[cacheKey];

  // common default
  let key = "customfield_10016";

  try {
    const r = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/field`, {
      headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }
    });
    if (r.ok) {
      const fields = await r.json();
      const hit = fields.find((f: any) =>
        typeof f.name === "string" &&
        /story points?/i.test(f.name) &&
        f.schema?.type === "number"
      );
      if (hit?.id) key = hit.id;
    }
  } catch (_) {
    // ignore & fallback to default
  }

  await chrome.storage.local.set({ [cacheKey]: key });
  return key;
}

// === issues, comments, transitions ===
async function fetchJiraIssues(projectKey: string): Promise<any[]> {
  const access = await getValidAccessToken();
  if (!access) throw new Error("Not authenticated");
  const cloudId = await getCloudId(access);
  const spKey = await getStoryPointsFieldKey(access, cloudId);

  const params = new URLSearchParams({
    jql: `project = ${projectKey} ORDER BY updated DESC`,
    maxResults: "3",
    fields: `summary,issuetype,status,priority,comment,${spKey}`
  });

  const r = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search?${params}`, {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }
  });
  if (!r.ok) throw new Error(`Issues fetch failed: ${r.status}`);
  const data = await r.json();

  // normalize story points to consistent key for UI
  const issues = (data.issues || []).map((it: any) => ({
    ...it,
    fields: {
      ...it.fields,
      storyPoints: it.fields?.[spKey]
    }
  }));
  return issues;
}

async function fetchIssueTransitions(issueKey: string): Promise<any[]> {
  const access = await getValidAccessToken();
  if (!access) throw new Error("Not authenticated");
  const cloudId = await getCloudId(access);
  const r = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}/transitions`,
    { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } }
  );
  if (!r.ok) throw new Error(`Transitions fetch failed: ${r.status}`);
  const data = await r.json();
  return data.transitions || [];
}

async function transitionIssue(issueKey: string, transitionId: string): Promise<void> {
  const access = await getValidAccessToken();
  if (!access) throw new Error("Not authenticated");
  const cloudId = await getCloudId(access);
  const r = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}/transitions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ transition: { id: transitionId } })
    }
  );
  if (!r.ok) throw new Error(`Transition failed: ${r.status}`);
}

async function fetchIssueComments(issueKey: string, maxResults = 3): Promise<any[]> {
  const access = await getValidAccessToken();
  if (!access) throw new Error("Not authenticated");
  const cloudId = await getCloudId(access);
  const params = new URLSearchParams({ maxResults: String(maxResults), orderBy: "-created" });
  const r = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}/comment?${params}`,
    { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } }
  );
  if (!r.ok) throw new Error(`Comments fetch failed: ${r.status}`);
  const data = await r.json();
  return data.comments || [];
}

async function addIssueComment(issueKey: string, text: string): Promise<void> {
  const access = await getValidAccessToken();
  if (!access) throw new Error("Not authenticated");
  const cloudId = await getCloudId(access);
  const r = await fetch(
    `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${issueKey}/comment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ body: text })
    }
  );
  if (!r.ok) throw new Error(`Add comment failed: ${r.status}`);
}

// === single onMessage listener with all cases (keeps your previous cases) ===
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "LOGIN_TO_JIRA") {
        const authUrl = buildAuthUrl();
        chrome.identity.launchWebAuthFlow(
          { url: authUrl, interactive: true },
          async (redirectUrl) => {
            try {
              if (chrome.runtime.lastError || !redirectUrl) {
                throw new Error(chrome.runtime.lastError?.message || "No redirect");
              }
              const url = new URL(redirectUrl);
              const code = url.searchParams.get("code");
              if (!code) throw new Error("No code in redirect");
              const token = await exchangeCodeForToken(code);
              sendResponse({ success: true, token });
            } catch (e: any) {
              console.error(e);
              sendResponse({ success: false, error: e?.message || String(e) });
            }
          }
        );
        return;
      }

      if (message.type === "GET_PROFILE") {
        const profile = await fetchProfile();
        sendResponse({ success: true, profile });
        return;
      }

      if (message.type === "GET_JIRA_PROFILE") {
        const jiraProfile = await fetchJiraMyself();
        sendResponse({ success: true, jiraProfile });
        return;
      }

      if (message.type === "GET_JIRA_PROJECTS") {
        const projects = await fetchJiraProjects();
        sendResponse({ success: true, projects });
        return;
      }

      // NEW handlers used by Popup.tsx
      if (message.type === "GET_JIRA_ISSUES") {
        const issues = await fetchJiraIssues(message.projectKey);
        sendResponse({ success: true, issues });
        return;
      }

      if (message.type === "GET_JIRA_TRANSITIONS") {
        const transitions = await fetchIssueTransitions(message.issueKey);
        sendResponse({ success: true, transitions });
        return;
      }

      if (message.type === "TRANSITION_JIRA_ISSUE") {
        await transitionIssue(message.issueKey, message.transitionId);
        sendResponse({ success: true });
        return;
      }

      if (message.type === "GET_JIRA_COMMENTS") {
        const comments = await fetchIssueComments(message.issueKey, message.maxResults || 3);
        sendResponse({ success: true, comments });
        return;
      }

      if (message.type === "ADD_JIRA_COMMENT") {
        await addIssueComment(message.issueKey, message.text);
        sendResponse({ success: true });
        return;
      }

      if (message.type === "LOGOUT") {
        await chrome.storage.local.remove(["jira_token"]);
        sendResponse({ success: true });
        return;
      }

      sendResponse({ success: false, error: "Unknown message" });
    } catch (e: any) {
      console.error(e);
      sendResponse({ success: false, error: e?.message || String(e) });
    }
  })();

  return true; // keep the message channel open for async
});
