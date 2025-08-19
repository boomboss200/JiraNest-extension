const CLIENT_ID = "4Zmd9fm3iZkJgpzlnHoM1QA13cdDxDWh";
const CLIENT_SECRET = "ATOAsgvr03L9ozubQfE2N-EHyNKPO359XpiiOq81N-SByH2vrNfksQAG81yEuktsuy9p9D04054B";
const REDIRECT_URI = "https://hdalgmemjnepejjjnickmakccablekmc.chromiumapp.org/provider_cb";
const SCOPES = [
  "read:jira-user",
  "read:jira-work",
  "read:me",
  "offline_access"
];

type TokenData = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: "Bearer";
  expires_at?: number; // epoch ms
};

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
  if (token.expires_at && Date.now() < token.expires_at) {
    return token.access_token;
  }
  if (token.refresh_token) {
    const refreshed = await refreshAccessToken(token.refresh_token);
    return refreshed.access_token;
  }
  return null;
}

async function fetchProfile(): Promise<any> {
  const access = await getValidAccessToken();
  if (!access) throw new Error("Not authenticated");
  const res = await fetch("https://api.atlassian.com/me", {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }
  });
  if (!res.ok) throw new Error(`Profile fetch failed: ${res.status}`);
  return res.json();
}

async function fetchJiraMyself(): Promise<any> {
  const access = await getValidAccessToken();
  if (!access) throw new Error("Not authenticated");

  // Step 1: get accessible resources (cloud IDs)
  const r1 = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }
  });
  if (!r1.ok) throw new Error(`Resources fetch failed: ${r1.status}`);
  const resources = await r1.json();
  if (!Array.isArray(resources) || resources.length === 0) {
    throw new Error("No accessible Jira sites");
  }
  const cloudId = resources[0].id;

  // Step 2: call Jira REST /myself
  const r2 = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" }
  });
  if (!r2.ok) throw new Error(`Jira myself failed: ${r2.status}`);
  return r2.json();
}

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

      if (message.type === "LOGOUT") {
        await chrome.storage.local.remove("jira_token");
        sendResponse({ success: true });
        return;
      }

      sendResponse({ success: false, error: "Unknown message" });
    } catch (e: any) {
      console.error(e);
      sendResponse({ success: false, error: e?.message || String(e) });
    }
  })();

  return true; // async
});
