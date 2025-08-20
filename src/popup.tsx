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

  // NEW: issues + helpers
  const [issues, setIssues] = useState<any[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [transitionsByIssue, setTransitionsByIssue] = useState<Record<string, any[]>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    chrome.storage.local.get(["jira_token", "selected_project"], (data) => {
      if (data?.jira_token) {
        setLoggedIn(true);
        setToken(data.jira_token);
        fetchAll();
      }
      if (data?.selected_project) {
        setSelectedProject(data.selected_project);
        // fetch issues for persisted project
        fetchIssues(data.selected_project.key);
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

  // NEW: issues fetcher (+ transitions prefetch)
  const fetchIssues = (projectKey: string) => {
    setLoadingIssues(true);
    chrome.runtime.sendMessage({ type: "GET_JIRA_ISSUES", projectKey }, (res) => {
      setLoadingIssues(false);
      if (res?.success) {
        const top = (res.issues || []).slice(0, 3);
        setIssues(top);
        // prefetch transitions for those issues
        top.forEach((it: any) => {
          chrome.runtime.sendMessage(
            { type: "GET_JIRA_TRANSITIONS", issueKey: it.key },
            (r) => {
              if (r?.success) {
                setTransitionsByIssue((prev) => ({ ...prev, [it.key]: r.transitions }));
              }
            }
          );
        });
      } else {
        setIssues([]);
      }
    });
  };

  // NEW: move status (transition)
  const handleTransition = (issueKey: string, transitionId: string) => {
    if (!transitionId) return;
    chrome.runtime.sendMessage(
      { type: "TRANSITION_JIRA_ISSUE", issueKey, transitionId },
      (res) => {
        if (res?.success && selectedProject?.key) {
          fetchIssues(selectedProject.key); // refresh list after transition
        }
      }
    );
  };

  // NEW: add comment
  const addComment = (issueKey: string) => {
    const text = (commentInputs[issueKey] || "").trim();
    if (!text) return;
    chrome.runtime.sendMessage({ type: "ADD_JIRA_COMMENT", issueKey, text }, (res) => {
      if (res?.success && selectedProject?.key) {
        setCommentInputs((p) => ({ ...p, [issueKey]: "" }));
        fetchIssues(selectedProject.key);
      }
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
      setIssues([]);
      setTransitionsByIssue({});
      setCommentInputs({});
      chrome.storage.local.remove("selected_project");
    });
  };

  const handleSelectProject = (p: any) => {
    setSelectedProject(p);
    chrome.storage.local.set({ selected_project: p });
    setShowDropdown(false);
    fetchIssues(p.key); // load issues on selection
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

          {/* NEW: Issues block (kept below your Projects UI) */}
          {selectedProject && (
            <div style={{ marginTop: 14 }}>
              <h4 style={{ margin: "8px 0" }}>Top 3 Tickets</h4>
              {loadingIssues ? (
                <div style={{ fontSize: 13, color: "#666" }}>Loading tickets…</div>
              ) : issues.length === 0 ? (
                <div style={{ fontSize: 13, color: "#666" }}>No issues found</div>
              ) : (
                issues.map((issue) => {
                  const transitions = transitionsByIssue[issue.key] || [];
                  return (
                    <div
                      key={issue.id}
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: 6,
                        padding: 8,
                        marginBottom: 10,
                        background: "#fafafa"
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {issue.key}: {issue.fields.summary}
                      </div>
                      <div style={{ fontSize: 12, display: "grid", gap: 2 }}>
                        <div><b>Type:</b> {issue.fields.issuetype?.name ?? "—"}</div>
                        <div><b>Priority:</b> {issue.fields.priority?.name ?? "—"}</div>
                        <div><b>Status:</b> {issue.fields.status?.name ?? "—"}</div>
                        <div><b>Story Points:</b> {issue.fields.storyPoints ?? issue.fields.customfield_10016 ?? "—"}</div>
                      </div>

                      {transitions.length > 0 && (
                        <select
                          style={{ marginTop: 6, width: "100%", padding: 6, borderRadius: 6 }}
                          onChange={(e) => handleTransition(issue.key, e.target.value)}
                          defaultValue=""
                        >
                          <option value="">Change status…</option>
                          {transitions.map((tr: any) => (
                            <option key={tr.id} value={tr.id}>{tr.name}</option>
                          ))}
                        </select>
                      )}

                      {/* Comments (top 3) + add comment */}
                      <IssueComments issueKey={issue.key} />

                      <div style={{ display: "flex", marginTop: 6 }}>
                        <input
                          type="text"
                          placeholder="Add a comment…"
                          value={commentInputs[issue.key] || ""}
                          onChange={(e) =>
                            setCommentInputs((prev) => ({ ...prev, [issue.key]: e.target.value }))
                          }
                          style={{
                            flex: 1,
                            padding: 6,
                            border: "1px solid #ccc",
                            borderRadius: 6,
                            fontSize: 12
                          }}
                        />
                        <button
                          onClick={() => addComment(issue.key)}
                          style={{
                            marginLeft: 6,
                            padding: "6px 10px",
                            fontSize: 12,
                            borderRadius: 6,
                            background: "#0052CC",
                            color: "#fff",
                            border: "none",
                            cursor: "pointer"
                          }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Small child for comments (isolated; pulls top 3 each render of a card)
function IssueComments({ issueKey }: { issueKey: string }) {
  const [comments, setComments] = useState<any[] | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_JIRA_COMMENTS", issueKey, maxResults: 3 }, (res) => {
      if (res?.success) setComments(res.comments || []);
      else setComments([]);
    });
  }, [issueKey]);

  return (
    <div style={{ marginTop: 8 }}>
      <b style={{ fontSize: 12 }}>Comments:</b>
      {comments === null ? (
        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>Loading comments…</div>
      ) : comments.length === 0 ? (
        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>No comments</div>
      ) : (
        <ul style={{ marginTop: 4, paddingLeft: 16, fontSize: 12 }}>
          {comments.slice(0, 3).map((c: any) => (
            <li key={c.id}>
              <b>{c.author?.displayName || "User"}:</b>{" "}
              {typeof c.body === "string"
                ? c.body
                : c.body?.content?.[0]?.content?.[0]?.text || "(comment)"} 
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
