import { useState, useEffect } from "react";
import AgentLogCard from "../components/AgentLogCard";

const STATUS_CONFIG = {
  success:  { color: "#00ffa3", label: "SUCCESS",  glow: "rgba(0,255,163,0.25)" },
  running:  { color: "#00b4ff", label: "RUNNING",  glow: "rgba(0,180,255,0.25)" },
  failed:   { color: "#ff4d6a", label: "FAILED",   glow: "rgba(255,77,106,0.25)" },
  pending:  { color: "#ffb800", label: "PENDING",  glow: "rgba(255,184,0,0.25)"  },
};

function getStatus(s = "") {
  const key = s.toLowerCase();
  return STATUS_CONFIG[key] ?? { color: "#5a5f72", label: s.toUpperCase(), glow: "transparent" };
}

// ── Summary bar ───────────────────────────────────────────────────────────────
function SummaryBar({ logs }) {
  const total   = logs.length;
  const success = logs.filter(l => l.status?.toLowerCase() === "success").length;
  const failed  = logs.filter(l => l.status?.toLowerCase() === "failed").length;
  const running = logs.filter(l => l.status?.toLowerCase() === "running").length;

  const stats = [
    { label: "Total",   value: total,   color: "var(--text)"  },
    { label: "Success", value: success, color: "#00ffa3"       },
    { label: "Failed",  value: failed,  color: "#ff4d6a"       },
    { label: "Running", value: running, color: "#00b4ff"       },
  ];

  return (
    <div style={{
      display: "flex",
      gap: "2rem",
      padding: "1rem 1.5rem",
      background: "var(--surface)",
      borderRadius: "10px",
      border: "1px solid var(--border)",
      marginBottom: "1.5rem",
    }}>
      {stats.map(({ label, value, color }) => (
        <div key={label}>
          <div style={{
            fontSize: "1.35rem",
            fontWeight: 700,
            fontFamily: "var(--font-mono)",
            color,
            lineHeight: 1,
          }}>{value}</div>
          <div style={{
            fontSize: "0.65rem",
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginTop: "0.2rem",
          }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Agents() {
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [filter,  setFilter]  = useState("all");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch("/api/v1/logs/agents")
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => setLogs(Array.isArray(data) ? data : data.logs ?? []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const statuses  = ["all", ...new Set(logs.map(l => l.status?.toLowerCase()).filter(Boolean))];
  const displayed = filter === "all" ? logs : logs.filter(l => l.status?.toLowerCase() === filter);

  return (
    <div style={{ animation: "fadeSlideIn 0.3s ease forwards" }}>
      {/* Header */}
      <div style={{ marginBottom: "2.5rem" }}>
        <h1 style={{
          fontSize: "1.75rem",
          fontWeight: 700,
          fontFamily: "var(--font-display)",
          color: "var(--text)",
          margin: 0,
          lineHeight: 1.2,
        }}>
          Agent Logs
        </h1>
        <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
          Execution history per agent
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ color: "var(--muted)", fontSize: "0.85rem", padding: "2rem 0" }}>
          Fetching agent logs…
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: "1rem 1.5rem",
          borderRadius: "10px",
          background: "#ff4d6a14",
          border: "1px solid #ff4d6a44",
          color: "#ff4d6a",
          fontSize: "0.82rem",
          fontFamily: "var(--font-mono)",
        }}>
          Failed to load logs: {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <SummaryBar logs={logs} />

          {/* Filter pills */}
          {statuses.length > 1 && (
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
              {statuses.map(s => {
                const active = filter === s;
                const cfg    = s === "all" ? { color: "var(--accent)" } : getStatus(s);
                return (
                  <button
                    key={s}
                    onClick={() => setFilter(s)}
                    style={{
                      padding: "0.3rem 0.85rem",
                      borderRadius: "5px",
                      border: `1px solid ${active ? cfg.color : "var(--border)"}`,
                      background: active ? `${cfg.color}14` : "transparent",
                      color: active ? cfg.color : "var(--muted)",
                      fontSize: "0.72rem",
                      fontFamily: "var(--font-mono)",
                      fontWeight: active ? 700 : 400,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          )}

          {/* Log list */}
          {displayed.length === 0 ? (
            <div style={{
              border: "1px dashed var(--border)",
              borderRadius: "12px",
              padding: "3rem",
              textAlign: "center",
              color: "var(--muted)",
              fontSize: "0.85rem",
              letterSpacing: "0.06em",
            }}>
              No agent logs found
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {displayed.map((log, index) => (
                <AgentLogCard key={index} log={log} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}