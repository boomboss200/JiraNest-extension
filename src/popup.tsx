import { useEffect, useState } from "react";

type TokenData = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: "Bearer";
  expires_at?: number;
};

export default function Popup() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [token, setToken] = useState<TokenData | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [jiraProfile, setJiraProfile] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(["jira_token", "selected_project"], (data) => {
      if (data?.jira_token) {
        setLoggedIn(true);
        setToken(data.jira_token);
        fetchAll();
      }
      if (data?.selected_project) {
        setSelectedProject(data.selected_project);
      }
    });
  }, []);

  const login = () => {
    setErr(null);
    setLoading(true);
    chrome.runtime.sendMessage({ type: "LOGIN_TO_JIRA" }, (res) => {
      setLoading(false);
      if (res?.success) {
        setLoggedIn(true);
        setToken(res.token);
        fetchAll();
      } else {
        setErr(res?.error || "Login failed");
      }
    });
  };

  const fetchAll = () => {
    chrome.runtime.sendMessage({ type: "GET_PROFILE" }, (res) => {
      if (res?.success) setProfile(res.profile);
    });

    chrome.runtime.sendMessage({ type: "GET_JIRA_PROFILE" }, (res) => {
      if (res?.success) setJiraProfile(res.jiraProfile);
    });

    chrome.runtime.sendMessage({ type: "GET_JIRA_PROJECTS" }, (res) => {
      if (res?.success) setProjects(res.projects);
    });
  };

  const logout = () => {
    chrome.runtime.sendMessage({ type: "LOGOUT" }, () => {
      setLoggedIn(false);
      setToken(null);
      setProfile(null);
      setJiraProfile(null);
      setProjects([]);
      setSelectedProject(null);
      chrome.storage.local.remove("selected_project");
    });
  };

  const handleSelectProject = (p: any) => {
    setSelectedProject(p);
    chrome.storage.local.set({ selected_project: p });
    setShowDropdown(false);
  };

  return (
    <div style={{ padding: 16, width: 320, fontFamily: "system-ui, sans-serif" }}>
      {!loggedIn ? (
        <button
          onClick={login}
          disabled={loading}
          style={{
            background: "#0052CC",
            color: "white",
            padding: "10px 14px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            width: "100%"
          }}
        >
          {loading ? "Opening Jira…" : "Login with Jira"}
        </button>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ color: "#22aa55" }}>✅ Logged in</div>
            <button
              onClick={logout}
              style={{ border: "1px solid #ccc", borderRadius: 6, padding: "4px 8px" }}
            >
              Logout
            </button>
          </div>

          {err && <div style={{ color: "crimson", marginBottom: 8 }}>{err}</div>}

          {token && (
            <details style={{ marginTop: 6 }}>
              <summary>Show token</summary>
              <pre
                style={{
                  background: "#f6f6f8",
                  padding: 8,
                  maxHeight: 140,
                  overflow: "auto",
                  fontSize: 12
                }}
              >
                {JSON.stringify(token, null, 2)}
              </pre>
            </details>
          )}

          <div style={{ marginTop: 10 }}>
            <h4 style={{ margin: "8px 0" }}>Atlassian /me</h4>
            {profile ? (
              <div style={{ fontSize: 13 }}>
                <div><b>Account ID:</b> {profile.account_id ?? "—"}</div>
                <div><b>Name:</b> {profile.name ?? "—"}</div>
                <div><b>Email:</b> {profile.email ?? "hidden"}</div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#666" }}>Loading…</div>
            )}
          </div>

          <div style={{ marginTop: 10 }}>
            <h4 style={{ margin: "8px 0" }}>Jira /myself (Cloud)</h4>
            {jiraProfile ? (
              <div style={{ fontSize: 13 }}>
                <div><b>Display name:</b> {jiraProfile.displayName ?? "—"}</div>
                <div><b>Time zone:</b> {jiraProfile.timeZone ?? "—"}</div>
                <div><b>Account type:</b> {jiraProfile.accountType ?? "—"}</div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#666" }}>Loading…</div>
            )}
          </div>

          <div style={{ marginTop: 12, position: "relative" }}>
            <h4 style={{ margin: "8px 0" }}>Projects</h4>
            {projects.length > 0 ? (
              <>
                <div
                  style={{
                    position: "relative",
                    border: "1px solid #ccc",
                    borderRadius: 6,
                    padding: 6,
                    cursor: "pointer",
                    background: "#fff"
                  }}
                  onClick={() => setShowDropdown(!showDropdown)}
                >
                  {selectedProject ? (
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <img
                        src={selectedProject.avatarUrls?.["16x16"]}
                        alt=""
                        style={{ width: 16, height: 16, marginRight: 6 }}
                      />
                      {selectedProject.name}
                    </div>
                  ) : (
                    "Select a project"
                  )}
                </div>

                {showDropdown && (
                  <div
                    style={{
                      position: "absolute",
                      marginTop: 2,
                      border: "1px solid #ccc",
                      borderRadius: 6,
                      background: "#fff",
                      width: "100%",
                      zIndex: 10,
                      maxHeight: 200,
                      overflowY: "auto"
                    }}
                  >
                    {projects.map((p) => (
                      <div
                        key={p.id}
                        onClick={() => handleSelectProject(p)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "6px 8px",
                          cursor: "pointer",
                          borderBottom: "1px solid #eee"
                        }}
                      >
                        <img
                          src={p.avatarUrls?.["16x16"]}
                          alt=""
                          style={{ width: 16, height: 16, marginRight: 6 }}
                        />
                        {p.name}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: "#666" }}>Loading…</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
