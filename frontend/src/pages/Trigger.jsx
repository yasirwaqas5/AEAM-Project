import { useState } from "react";

const INITIAL = { event_type: "", metric: "", value: "", severity: "" };

const SEVERITY_OPTIONS = ["low", "medium", "high", "critical"];

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <label style={{
        fontSize: "0.7rem",
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--muted)",
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: "7px",
  padding: "0.65rem 0.9rem",
  fontSize: "0.85rem",
  fontFamily: "var(--font-mono)",
  color: "var(--text)",
  outline: "none",
  transition: "border-color 0.15s ease",
  width: "100%",
};

export default function Trigger() {
  const [form,       setForm]       = useState(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [result,     setResult]     = useState(null); // { ok: bool, message: string }

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
    setResult(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/v1/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          value: form.value === "" ? undefined : Number(form.value),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setResult({ ok: true, message: data.message ?? "Event triggered successfully." });
        setForm(INITIAL);
      } else {
        setResult({ ok: false, message: data.detail ?? data.message ?? `Error ${res.status}` });
      }
    } catch (err) {
      setResult({ ok: false, message: err.message ?? "Network error." });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = form.event_type.trim() && form.metric.trim() && form.value !== "" && form.severity;

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
          Trigger Event
        </h1>
        <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}>
          Manually inject an anomaly into the system
        </p>
      </div>

      {/* Form card */}
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "2rem",
        maxWidth: "520px",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

          {/* event_type */}
          <Field label="Event Type">
            <input
              name="event_type"
              value={form.event_type}
              onChange={handleChange}
              placeholder="e.g. cpu_spike"
              style={inputStyle}
              onFocus={e  => e.target.style.borderColor = "var(--accent)"}
              onBlur={e   => e.target.style.borderColor = "var(--border)"}
            />
          </Field>

          {/* metric */}
          <Field label="Metric">
            <input
              name="metric"
              value={form.metric}
              onChange={handleChange}
              placeholder="e.g. cpu_usage"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e  => e.target.style.borderColor = "var(--border)"}
            />
          </Field>

          {/* value */}
          <Field label="Value">
            <input
              name="value"
              type="number"
              value={form.value}
              onChange={handleChange}
              placeholder="e.g. 95.4"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = "var(--accent)"}
              onBlur={e  => e.target.style.borderColor = "var(--border)"}
            />
          </Field>

          {/* severity — segmented control */}
          <Field label="Severity">
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {SEVERITY_OPTIONS.map(opt => {
                const active = form.severity === opt;
                const colors = {
                  low:      "#00ffa3",
                  medium:   "#ffb800",
                  high:     "#ff8c42",
                  critical: "#ff4d6a",
                };
                const c = colors[opt];
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => { setForm(f => ({ ...f, severity: opt })); setResult(null); }}
                    style={{
                      flex: 1,
                      padding: "0.55rem 0",
                      borderRadius: "6px",
                      border: `1px solid ${active ? c : "var(--border)"}`,
                      background: active ? `${c}18` : "transparent",
                      color: active ? c : "var(--muted)",
                      fontSize: "0.7rem",
                      fontFamily: "var(--font-mono)",
                      fontWeight: active ? 700 : 400,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            style={{
              marginTop: "0.5rem",
              padding: "0.75rem",
              borderRadius: "7px",
              border: "1px solid var(--accent)",
              background: canSubmit && !submitting ? "var(--accent-dim)" : "transparent",
              color: canSubmit && !submitting ? "var(--accent)" : "var(--muted)",
              fontSize: "0.8rem",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
              transition: "all 0.15s ease",
              borderColor: canSubmit && !submitting ? "var(--accent)" : "var(--border)",
            }}
          >
            {submitting ? "Injecting…" : "⟡ Trigger Event"}
          </button>

          {/* Feedback */}
          {result && (
            <div style={{
              padding: "0.85rem 1rem",
              borderRadius: "7px",
              background: result.ok ? "rgba(0,255,163,0.08)" : "rgba(255,77,106,0.08)",
              border: `1px solid ${result.ok ? "#00ffa344" : "#ff4d6a44"}`,
              color: result.ok ? "#00ffa3" : "#ff4d6a",
              fontSize: "0.8rem",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
              animation: "fadeSlideIn 0.2s ease forwards",
            }}>
              {result.ok ? "✓ " : "✕ "}{result.message}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}