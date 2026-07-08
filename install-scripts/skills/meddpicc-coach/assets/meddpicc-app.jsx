import React, { useState, useEffect, useRef } from "react";
import { Plus, Trash2, MessageSquare, Target, Users, ArrowLeft, Send, Loader2, AlertCircle, CheckCircle2, Circle, Upload, FileText, X } from "lucide-react";

const ELEMENTS = [
  { key: "metrics", label: "Metrics", short: "M", desc: "Quantified business impact" },
  { key: "economicBuyer", label: "Economic Buyer", short: "E", desc: "Who signs and why they care" },
  { key: "decisionCriteria", label: "Decision Criteria", short: "D", desc: "How they'll evaluate" },
  { key: "decisionProcess", label: "Decision Process", short: "D", desc: "Steps, timing, approvals" },
  { key: "paperProcess", label: "Paper Process", short: "P", desc: "Legal, procurement, security" },
  { key: "identifyPain", label: "Identify Pain", short: "I", desc: "The compelling event" },
  { key: "champion", label: "Champion", short: "C", desc: "Internal seller with power and motive" },
  { key: "competition", label: "Competition", short: "C", desc: "Alternatives, including do-nothing" },
];

const emptyDeal = () => ({
  id: `deal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: "",
  notes: "",
  scores: {},
  createdAt: new Date().toISOString(),
});

async function callClaude(systemPrompt, messages) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await response.json();
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// CSV parser — handles quoted fields, escaped quotes, embedded commas/newlines
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      }
      else { field += c; }
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? "").trim(); });
      return obj;
    });
  return { headers, records };
}

// Suggest mapping from CSV headers to deal fields
const FIELD_TARGETS = [
  { key: "name", label: "Deal name", required: true, hints: ["deal", "opportunity", "account", "name", "company"] },
  { key: "notes", label: "Notes / description", required: true, hints: ["notes", "description", "summary", "context", "details", "comments"] },
];
function suggestMapping(headers) {
  const mapping = {};
  FIELD_TARGETS.forEach((target) => {
    const lowered = headers.map((h) => h.toLowerCase());
    const match = target.hints.find((hint) => lowered.some((h) => h.includes(hint)));
    if (match) mapping[target.key] = headers[lowered.findIndex((h) => h.includes(match))];
    else mapping[target.key] = "";
  });
  return mapping;
}

export default function MeddpiccCoach() {
  const [deals, setDeals] = useState([]);
  const [activeDealId, setActiveDealId] = useState(null);
  const [view, setView] = useState("list"); // list | deal | manager
  const [mode, setMode] = useState("score"); // score | drill | roleplay
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState("rep"); // rep | manager

  useEffect(() => {
    (async () => {
      try {
        const result = await window.storage.list("deal:");
        if (result && result.keys?.length) {
          const loaded = await Promise.all(
            result.keys.map(async (k) => {
              try {
                const r = await window.storage.get(k);
                return r ? JSON.parse(r.value) : null;
              } catch {
                return null;
              }
            })
          );
          setDeals(loaded.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        }
      } catch (e) {
        console.error("Load error:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveDeal = async (deal) => {
    try {
      await window.storage.set(`deal:${deal.id}`, JSON.stringify(deal));
      setDeals((prev) => {
        const others = prev.filter((d) => d.id !== deal.id);
        return [deal, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
    } catch (e) {
      console.error("Save error:", e);
    }
  };

  const deleteDeal = async (id) => {
    try {
      await window.storage.delete(`deal:${id}`);
      setDeals((prev) => prev.filter((d) => d.id !== id));
    } catch (e) {
      console.error("Delete error:", e);
    }
  };

  // Bulk import — saves many deals at once, returns count
  const bulkSaveDeals = async (newDeals) => {
    const saved = [];
    for (const d of newDeals) {
      try {
        await window.storage.set(`deal:${d.id}`, JSON.stringify(d));
        saved.push(d);
      } catch (e) {
        console.error("Bulk save error:", e);
      }
    }
    setDeals((prev) => {
      const ids = new Set(saved.map((d) => d.id));
      const others = prev.filter((d) => !ids.has(d.id));
      return [...saved, ...others].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    return saved.length;
  };

  const createDeal = async () => {
    const d = emptyDeal();
    d.name = `Untitled deal — ${new Date().toLocaleDateString()}`;
    await saveDeal(d);
    setActiveDealId(d.id);
    setView("deal");
    setMode("score");
  };

  const activeDeal = deals.find((d) => d.id === activeDealId);

  return (
    <div style={styles.shell}>
      <style>{globalCss}</style>
      <header style={styles.header}>
        <div style={styles.logo}>
          <div style={styles.logoMark}>M</div>
          <div>
            <div style={styles.logoTitle}>MEDDPICC Coach</div>
            <div style={styles.logoSub}>Prototype · {role === "manager" ? "manager view" : "deal qualifier"}</div>
          </div>
        </div>
        <div style={styles.headerActions}>
          {view === "deal" && (
            <button style={styles.ghostBtn} onClick={() => setView("list")}>
              <ArrowLeft size={14} /> All deals
            </button>
          )}
          <div style={styles.roleToggle}>
            <button
              style={{ ...styles.roleBtn, ...(role === "rep" ? styles.roleBtnActive : {}) }}
              onClick={() => { setRole("rep"); setView("list"); }}
            >
              Rep
            </button>
            <button
              style={{ ...styles.roleBtn, ...(role === "manager" ? styles.roleBtnActive : {}) }}
              onClick={() => { setRole("manager"); setView("manager"); }}
            >
              Manager
            </button>
          </div>
        </div>
      </header>

      {loading ? (
        <div style={styles.loadingShell}>
          <Loader2 size={20} className="spin" /> Loading deals…
        </div>
      ) : view === "manager" ? (
        <ManagerView deals={deals} onOpenDeal={(id) => { setActiveDealId(id); setView("deal"); setMode("score"); setRole("rep"); }} />
      ) : view === "list" ? (
        <DealList deals={deals} onOpen={(id) => { setActiveDealId(id); setView("deal"); setMode("score"); }} onCreate={createDeal} onDelete={deleteDeal} onBulkImport={bulkSaveDeals} />
      ) : activeDeal ? (
        <DealView
          deal={activeDeal}
          mode={mode}
          setMode={setMode}
          saveDeal={saveDeal}
          role={role}
        />
      ) : null}
    </div>
  );
}

function DealList({ deals, onOpen, onCreate, onDelete, onBulkImport }) {
  const [showUpload, setShowUpload] = useState(false);

  return (
    <div style={styles.listShell}>
      <div style={styles.listHeader}>
        <h2 style={styles.h2}>Your deals</h2>
        <div style={styles.headerBtnGroup}>
          <button style={styles.ghostBtn} onClick={() => setShowUpload(true)}>
            <Upload size={14} /> Bulk upload CSV
          </button>
          <button style={styles.primaryBtn} onClick={onCreate}>
            <Plus size={14} /> New deal
          </button>
        </div>
      </div>
      {deals.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>No deals yet.</div>
          <div style={styles.emptySub}>Create one to score it, drill into a weak element, or role-play a buyer. Or bulk-upload a CSV from your CRM.</div>
        </div>
      ) : (
        <div style={styles.dealGrid}>
          {deals.map((d) => {
            const scored = Object.keys(d.scores || {}).length;
            const avg = scored ? (Object.values(d.scores).reduce((a, b) => a + (b.score || 0), 0) / scored).toFixed(1) : null;
            return (
              <div key={d.id} style={styles.dealCard} onClick={() => onOpen(d.id)}>
                <div style={styles.dealCardTop}>
                  <div style={styles.dealName}>{d.name}</div>
                  <button
                    style={styles.iconBtn}
                    onClick={(e) => { e.stopPropagation(); if (confirm("Delete this deal?")) onDelete(d.id); }}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div style={styles.dealMeta}>
                  {avg !== null ? <><span style={styles.scoreBadge}>Avg {avg}/10</span> · {scored}/8 scored</> : <span style={styles.dim}>Not scored yet</span>}
                </div>
                <div style={styles.dealDate}>{new Date(d.createdAt).toLocaleDateString()}</div>
              </div>
            );
          })}
        </div>
      )}

      {showUpload && (
        <BulkUploadModal
          onClose={() => setShowUpload(false)}
          onImport={onBulkImport}
        />
      )}
    </div>
  );
}

function BulkUploadModal({ onClose, onImport }) {
  const [stage, setStage] = useState("drop"); // drop | map | importing | done
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null); // { headers, records }
  const [mapping, setMapping] = useState({});
  const [autoScore, setAutoScore] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0, currentName: "" });
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setError(null);
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setError("Please upload a .csv file.");
      return;
    }
    try {
      const text = await file.text();
      const result = parseCSV(text);
      if (result.records.length === 0) {
        setError("CSV has no data rows.");
        return;
      }
      setFileName(file.name);
      setParsed(result);
      setMapping(suggestMapping(result.headers));
      setStage("map");
    } catch (e) {
      setError("Couldn't read the file.");
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const runImport = async () => {
    if (!parsed) return;
    if (!mapping.name || !mapping.notes) {
      setError("Map both Deal name and Notes before importing.");
      return;
    }
    setError(null);
    setStage("importing");

    const newDeals = parsed.records.map((row, i) => ({
      id: `deal_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      name: row[mapping.name] || `Imported deal ${i + 1}`,
      notes: row[mapping.notes] || "",
      scores: {},
      createdAt: new Date(Date.now() - i).toISOString(), // preserve CSV order
      source: "csv_import",
    }));

    if (autoScore) {
      setProgress({ done: 0, total: newDeals.length, currentName: "" });
      const sys = `You are a rigorous MEDDPICC sales coach. You evaluate deals across all 8 elements: metrics, economicBuyer, decisionCriteria, decisionProcess, paperProcess, identifyPain, champion, competition.

For each element, score 0-10 based on what the rep DEMONSTRABLY knows. Be skeptical: 8+ means specific names, numbers, dates, quotes. 4-6 means partial info. 0-3 means missing or hand-wavy.

Return STRICT JSON, no preamble, no markdown fences:
{
  "metrics": {"score": 0, "rationale": "...", "gap": "..."},
  "economicBuyer": {"score": 0, "rationale": "...", "gap": "..."},
  "decisionCriteria": {"score": 0, "rationale": "...", "gap": "..."},
  "decisionProcess": {"score": 0, "rationale": "...", "gap": "..."},
  "paperProcess": {"score": 0, "rationale": "...", "gap": "..."},
  "identifyPain": {"score": 0, "rationale": "...", "gap": "..."},
  "champion": {"score": 0, "rationale": "...", "gap": "..."},
  "competition": {"score": 0, "rationale": "...", "gap": "..."},
  "nextActions": ["action 1", "action 2", "action 3"]
}
Rationale: 1 sentence. Gap: 1 sentence. NextActions: 2-3 concrete moves.`;

      for (let i = 0; i < newDeals.length; i++) {
        const d = newDeals[i];
        setProgress({ done: i, total: newDeals.length, currentName: d.name });
        if (!d.notes.trim()) continue;
        try {
          const raw = await callClaude(sys, [{ role: "user", content: `Deal name: ${d.name}\n\nNotes:\n${d.notes}` }]);
          const cleaned = raw.replace(/```json|```/g, "").trim();
          const parsedScores = JSON.parse(cleaned);
          const scores = {};
          ["metrics", "economicBuyer", "decisionCriteria", "decisionProcess", "paperProcess", "identifyPain", "champion", "competition"].forEach((k) => {
            if (parsedScores[k]) scores[k] = parsedScores[k];
          });
          d.scores = scores;
          d.nextActions = parsedScores.nextActions || [];
        } catch (e) {
          console.error(`Score failed for ${d.name}:`, e);
        }
      }
      setProgress({ done: newDeals.length, total: newDeals.length, currentName: "" });
    }

    const count = await onImport(newDeals);
    setImportedCount(count);
    setStage("done");
  };

  return (
    <div style={styles.modalBackdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <div style={styles.modalTitle}>Bulk upload deals</div>
          <button style={styles.iconBtn} onClick={onClose} title="Close"><X size={18} /></button>
        </div>

        {error && <div style={styles.modalError}><AlertCircle size={14} /> {error}</div>}

        {stage === "drop" && (
          <div
            style={styles.dropzone}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={32} style={{ color: "var(--ink-soft)", marginBottom: 12 }} />
            <div style={styles.dropTitle}>Drop a CSV here, or click to select</div>
            <div style={styles.dropSub}>One row per deal. We'll map columns next.</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <div style={styles.dropHint}>
              <strong>Expected columns:</strong> at minimum a deal/account name and a notes/description column. Anything else can be ignored.
            </div>
          </div>
        )}

        {stage === "map" && parsed && (
          <div>
            <div style={styles.mapFileRow}>
              <FileText size={14} /> <strong>{fileName}</strong>
              <span style={styles.dim}>· {parsed.records.length} {parsed.records.length === 1 ? "row" : "rows"}, {parsed.headers.length} columns</span>
            </div>

            <div style={styles.mapSection}>
              <div style={styles.mapSectionTitle}>Map columns</div>
              {FIELD_TARGETS.map((target) => (
                <div key={target.key} style={styles.mapRow}>
                  <div style={styles.mapLabel}>
                    {target.label} {target.required && <span style={styles.required}>*</span>}
                  </div>
                  <select
                    style={styles.mapSelect}
                    value={mapping[target.key] || ""}
                    onChange={(e) => setMapping({ ...mapping, [target.key]: e.target.value })}
                  >
                    <option value="">— Select column —</option>
                    {parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {mapping.name && mapping.notes && (
              <div style={styles.previewSection}>
                <div style={styles.mapSectionTitle}>Preview · first 3 rows</div>
                <div style={styles.previewTable}>
                  {parsed.records.slice(0, 3).map((r, i) => (
                    <div key={i} style={styles.previewRow}>
                      <div style={styles.previewName}>{r[mapping.name] || <span style={styles.dim}>(empty)</span>}</div>
                      <div style={styles.previewNotes}>{(r[mapping.notes] || "").slice(0, 140)}{(r[mapping.notes] || "").length > 140 ? "…" : ""}</div>
                    </div>
                  ))}
                  {parsed.records.length > 3 && <div style={styles.previewMore}>… and {parsed.records.length - 3} more</div>}
                </div>
              </div>
            )}

            <label style={styles.autoScoreToggle}>
              <input type="checkbox" checked={autoScore} onChange={(e) => setAutoScore(e.target.checked)} />
              <span>Auto-score every deal after import <span style={styles.dim}>(slower — about 3-5 seconds per deal)</span></span>
            </label>

            <div style={styles.modalFooter}>
              <button style={styles.ghostBtn} onClick={() => { setStage("drop"); setParsed(null); setError(null); }}>Back</button>
              <button style={styles.primaryBtn} onClick={runImport} disabled={!mapping.name || !mapping.notes}>
                Import {parsed.records.length} {parsed.records.length === 1 ? "deal" : "deals"}
              </button>
            </div>
          </div>
        )}

        {stage === "importing" && (
          <div style={styles.importingShell}>
            <Loader2 size={28} className="spin" style={{ color: "var(--accent)" }} />
            <div style={styles.importingTitle}>
              {autoScore ? "Importing and scoring deals…" : "Importing deals…"}
            </div>
            {autoScore && progress.total > 0 && (
              <>
                <div style={styles.progressTrack}>
                  <div style={{ ...styles.progressFill, width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                <div style={styles.progressText}>
                  {progress.done} of {progress.total} scored
                  {progress.currentName && <div style={styles.progressCurrent}>Now: {progress.currentName}</div>}
                </div>
              </>
            )}
          </div>
        )}

        {stage === "done" && (
          <div style={styles.doneShell}>
            <CheckCircle2 size={36} style={{ color: "var(--ok)" }} />
            <div style={styles.doneTitle}>Imported {importedCount} {importedCount === 1 ? "deal" : "deals"}</div>
            <div style={styles.doneSub}>
              {autoScore
                ? "All deals are scored and ready in your pipeline."
                : "Open any deal and hit Score to analyze it."}
            </div>
            <button style={styles.primaryBtn} onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ManagerView({ deals, onOpenDeal }) {
  const [coachingNote, setCoachingNote] = useState(null);
  const [loading, setLoading] = useState(false);

  // Build the rep-pattern matrix: average score per element across deals
  const scoredDeals = deals.filter((d) => d.scores && Object.keys(d.scores).length > 0);

  const elementAverages = {};
  ELEMENTS.forEach((el) => {
    const vals = scoredDeals
      .map((d) => {
        const override = d.managerOverrides?.[el.key]?.score;
        return override ?? d.scores?.[el.key]?.score;
      })
      .filter((v) => typeof v === "number");
    elementAverages[el.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });

  // Sort elements weakest to strongest
  const ranked = ELEMENTS
    .map((el) => ({ ...el, avg: elementAverages[el.key] }))
    .filter((x) => x.avg !== null)
    .sort((a, b) => a.avg - b.avg);

  const weakestElement = ranked[0];

  // Calibration gap: where AI and manager disagree
  const calibrationGaps = [];
  scoredDeals.forEach((d) => {
    Object.entries(d.managerOverrides || {}).forEach(([key, override]) => {
      const aiScore = d.scores?.[key]?.score;
      if (typeof aiScore === "number") {
        const delta = override.score - aiScore;
        if (Math.abs(delta) >= 2) {
          calibrationGaps.push({ dealName: d.name, dealId: d.id, element: key, aiScore, mgrScore: override.score, delta, note: override.note });
        }
      }
    });
  });

  const generateCoachingPlan = async () => {
    setLoading(true);
    setCoachingNote(null);
    try {
      const summary = {
        dealCount: scoredDeals.length,
        elementAverages: Object.fromEntries(
          Object.entries(elementAverages).map(([k, v]) => [k, v !== null ? v.toFixed(1) : null])
        ),
        deals: scoredDeals.map((d) => ({
          name: d.name,
          scores: Object.fromEntries(
            Object.entries(d.scores || {}).map(([k, s]) => [k, {
              ai: s.score,
              mgr: d.managerOverrides?.[k]?.score ?? null,
              gap: s.gap,
            }])
          ),
          mgrNotes: Object.fromEntries(
            Object.entries(d.managerOverrides || {})
              .filter(([_, v]) => v.note)
              .map(([k, v]) => [k, v.note])
          ),
        })),
      };

      const sys = `You are an experienced VP of Sales coaching a manager who coaches a rep. Look across the rep's pipeline and identify SYSTEMATIC patterns — not deal-specific tactics.

Your output is a SHORT coaching plan (max 200 words, prose, no bullet lists unless one is genuinely useful) covering:

1) The ONE chronic weakness across the rep's deals (which MEDDPICC element, evidenced by which deals)
2) Whether it's a SKILL gap (rep doesn't know how) or a DOCUMENTATION gap (rep knows but doesn't write it down) — be specific about how to tell
3) ONE concrete coaching action the manager should take this week to address the pattern
4) If manager overrides exist and consistently differ from AI scores, comment on what the calibration gap reveals about the rep's self-assessment

Be direct. No cheerleading. Talk TO the manager, not about them.`;

      const reply = await callClaude(sys, [{ role: "user", content: `Rep pipeline data:\n\n${JSON.stringify(summary, null, 2)}` }]);
      setCoachingNote(reply);
    } catch (e) {
      setCoachingNote("Coach unavailable. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (scoredDeals.length === 0) {
    return (
      <div style={styles.listShell}>
        <h2 style={styles.h2}>Manager view</h2>
        <div style={styles.empty}>
          <div style={styles.emptyTitle}>No scored deals yet.</div>
          <div style={styles.emptySub}>Once the rep scores a few deals, you'll see patterns here — chronic weak elements, calibration gaps between AI and manager scores, and a coaching plan.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.listShell}>
      <div style={styles.listHeader}>
        <div>
          <h2 style={styles.h2}>Manager view</h2>
          <div style={styles.subtle}>{scoredDeals.length} scored {scoredDeals.length === 1 ? "deal" : "deals"} · patterns across the rep's pipeline</div>
        </div>
        <button style={styles.primaryBtn} onClick={generateCoachingPlan} disabled={loading}>
          {loading ? <><Loader2 size={14} className="spin" /> Thinking…</> : "Generate coaching plan"}
        </button>
      </div>

      {weakestElement && (
        <div style={styles.weakestBanner}>
          <div style={styles.bannerLabel}>Chronic weakness</div>
          <div style={styles.bannerBody}>
            <span style={styles.elShort}>{weakestElement.short}</span>
            <strong>{weakestElement.label}</strong>
            <span style={styles.bannerAvg}>avg {weakestElement.avg.toFixed(1)}/10 across {scoredDeals.length} deals</span>
          </div>
          <div style={styles.bannerHint}>Anchor this week's 1:1 here. Don't ask "walk me through your pipeline" — open with "your weakest element is {weakestElement.label}. Talk me through it on each deal."</div>
        </div>
      )}

      {coachingNote && (
        <div style={styles.coachingPlanBox}>
          <div style={styles.coachingPlanTitle}>Coaching plan</div>
          <div style={styles.coachingPlanBody}>{coachingNote}</div>
        </div>
      )}

      <h3 style={styles.h3}>Element averages — weakest first</h3>
      <div style={styles.elementAvgList}>
        {ranked.map((el) => {
          const color = el.avg >= 7 ? "var(--ok)" : el.avg >= 4 ? "var(--warn)" : "var(--bad)";
          const pct = (el.avg / 10) * 100;
          return (
            <div key={el.key} style={styles.elementAvgRow}>
              <div style={styles.elementAvgLabel}>
                <span style={styles.elShort}>{el.short}</span>
                <span>{el.label}</span>
              </div>
              <div style={styles.barTrack}>
                <div style={{ ...styles.barFill, width: `${pct}%`, background: color }} />
              </div>
              <div style={{ ...styles.avgScorePill, color }}>{el.avg.toFixed(1)}</div>
            </div>
          );
        })}
      </div>

      <h3 style={styles.h3}>Deal matrix</h3>
      <div style={styles.matrixWrap}>
        <table style={styles.matrix}>
          <thead>
            <tr>
              <th style={styles.matrixHeadDeal}>Deal</th>
              {ELEMENTS.map((el) => (
                <th key={el.key} style={styles.matrixHead} title={el.label}>{el.short}<span style={styles.matrixSub}>{el.label.split(" ")[0]}</span></th>
              ))}
              <th style={styles.matrixHead}>Avg</th>
            </tr>
          </thead>
          <tbody>
            {scoredDeals.map((d) => {
              const scoreVals = ELEMENTS.map((el) => {
                const ai = d.scores?.[el.key]?.score;
                const mgr = d.managerOverrides?.[el.key]?.score;
                return { ai, mgr, final: mgr ?? ai };
              });
              const validScores = scoreVals.filter((s) => typeof s.final === "number").map((s) => s.final);
              const avg = validScores.length ? validScores.reduce((a, b) => a + b, 0) / validScores.length : 0;
              return (
                <tr key={d.id} style={styles.matrixRow} onClick={() => onOpenDeal(d.id)}>
                  <td style={styles.matrixDealCell}>{d.name}</td>
                  {scoreVals.map((s, i) => {
                    if (typeof s.final !== "number") return <td key={i} style={styles.matrixCell}>—</td>;
                    const color = s.final >= 7 ? "var(--ok)" : s.final >= 4 ? "var(--warn)" : "var(--bad)";
                    return (
                      <td key={i} style={{ ...styles.matrixCell, background: color, color: "#fff", fontWeight: 600 }} title={s.mgr != null ? `AI: ${s.ai}, Manager: ${s.mgr}` : `AI: ${s.ai}`}>
                        {s.final}
                        {s.mgr != null && s.mgr !== s.ai && <span style={styles.matrixDot}>•</span>}
                      </td>
                    );
                  })}
                  <td style={styles.matrixAvg}>{avg.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={styles.matrixLegend}>Click any row to open the deal. Dot (•) marks a manager override that differs from AI score.</div>
      </div>

      {calibrationGaps.length > 0 && (
        <>
          <h3 style={styles.h3}>Calibration gaps — where you disagreed with the AI</h3>
          <div style={styles.calibList}>
            {calibrationGaps.map((g, i) => {
              const elLabel = ELEMENTS.find((e) => e.key === g.element)?.label || g.element;
              return (
                <div key={i} style={styles.calibCard} onClick={() => onOpenDeal(g.dealId)}>
                  <div style={styles.calibHead}>
                    <strong>{g.dealName}</strong> · {elLabel}
                  </div>
                  <div style={styles.calibBody}>
                    AI scored <strong>{g.aiScore}</strong>, you scored <strong>{g.mgrScore}</strong>
                    <span style={{ color: g.delta > 0 ? "var(--ok)" : "var(--bad)", marginLeft: 8 }}>
                      {g.delta > 0 ? "▲" : "▼"} {Math.abs(g.delta)} points
                    </span>
                  </div>
                  {g.note && <div style={styles.calibNote}>"{g.note}"</div>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function DealView({ deal, mode, setMode, saveDeal, role }) {
  const [name, setName] = useState(deal.name);
  const [notes, setNotes] = useState(deal.notes);

  useEffect(() => { setName(deal.name); setNotes(deal.notes); }, [deal.id]);

  const persist = (patch) => saveDeal({ ...deal, ...patch });

  return (
    <div style={styles.dealShell}>
      <div style={styles.dealHeader}>
        <input
          style={styles.nameInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => persist({ name })}
          placeholder="Deal name"
        />
        <textarea
          style={styles.notesInput}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => persist({ notes })}
          placeholder="Paste call notes, CRM export, or anything you know about this deal. The coach uses this as context."
          rows={4}
        />
      </div>

      <div style={styles.tabs}>
        <Tab active={mode === "score"} onClick={() => setMode("score")} icon={<Target size={14} />} label="Score & gaps" />
        <Tab active={mode === "drill"} onClick={() => setMode("drill")} icon={<MessageSquare size={14} />} label="Socratic drill" />
        <Tab active={mode === "roleplay"} onClick={() => setMode("roleplay")} icon={<Users size={14} />} label="Role-play" />
      </div>

      {mode === "score" && <ScoreMode deal={deal} saveDeal={saveDeal} role={role} />}
      {mode === "drill" && <DrillMode deal={deal} saveDeal={saveDeal} />}
      {mode === "roleplay" && <RoleplayMode deal={deal} />}
    </div>
  );
}

function Tab({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }}>
      {icon} {label}
    </button>
  );
}

function ScoreMode({ deal, saveDeal, role }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [overridingKey, setOverridingKey] = useState(null);
  const [overrideScore, setOverrideScore] = useState("");
  const [overrideNote, setOverrideNote] = useState("");

  const analyze = async () => {
    if (!deal.notes?.trim()) {
      setError("Add some deal notes first — the coach needs context.");
      return;
    }
    setError(null);
    setAnalyzing(true);
    try {
      const sys = `You are a rigorous MEDDPICC sales coach. You evaluate deals across all 8 elements: metrics, economicBuyer, decisionCriteria, decisionProcess, paperProcess, identifyPain, champion, competition.

For each element, score 0-10 based on what the rep DEMONSTRABLY knows (not what they assume). Be skeptical of vague claims. Score harshly: 8+ means specific names, numbers, dates, quotes. 4-6 means partial info. 0-3 means missing or hand-wavy.

Return STRICT JSON, no preamble, no markdown fences, this exact shape:
{
  "metrics": {"score": 0, "rationale": "...", "gap": "..."},
  "economicBuyer": {"score": 0, "rationale": "...", "gap": "..."},
  "decisionCriteria": {"score": 0, "rationale": "...", "gap": "..."},
  "decisionProcess": {"score": 0, "rationale": "...", "gap": "..."},
  "paperProcess": {"score": 0, "rationale": "...", "gap": "..."},
  "identifyPain": {"score": 0, "rationale": "...", "gap": "..."},
  "champion": {"score": 0, "rationale": "...", "gap": "..."},
  "competition": {"score": 0, "rationale": "...", "gap": "..."},
  "nextActions": ["action 1", "action 2", "action 3"]
}

Rationale: 1 sentence on what the rep knows. Gap: 1 sentence on what's missing or unverified. NextActions: 2-3 concrete moves that close the biggest gaps.`;

      const userMsg = `Deal name: ${deal.name}\n\nNotes:\n${deal.notes}`;
      const raw = await callClaude(sys, [{ role: "user", content: userMsg }]);
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const scores = {};
      ELEMENTS.forEach((el) => {
        if (parsed[el.key]) scores[el.key] = parsed[el.key];
      });
      saveDeal({ ...deal, scores, nextActions: parsed.nextActions || [] });
    } catch (e) {
      console.error(e);
      setError("Couldn't parse the coach's response. Try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  const scores = deal.scores || {};
  const hasScores = Object.keys(scores).length > 0;

  return (
    <div style={styles.modePanel}>
      <div style={styles.actionRow}>
        <button style={styles.primaryBtn} onClick={analyze} disabled={analyzing}>
          {analyzing ? <><Loader2 size={14} className="spin" /> Analyzing…</> : <>{hasScores ? "Re-score deal" : "Score this deal"}</>}
        </button>
        {error && <span style={styles.error}><AlertCircle size={14} /> {error}</span>}
      </div>

      {hasScores && (
        <>
          <div style={styles.scoreGrid}>
            {ELEMENTS.map((el) => {
              const s = scores[el.key];
              if (!s) return null;
              const aiColor = s.score >= 7 ? "var(--ok)" : s.score >= 4 ? "var(--warn)" : "var(--bad)";
              const override = deal.managerOverrides?.[el.key];
              const isOverriding = overridingKey === el.key;
              const finalScore = override?.score ?? s.score;
              const finalColor = finalScore >= 7 ? "var(--ok)" : finalScore >= 4 ? "var(--warn)" : "var(--bad)";
              const delta = override ? override.score - s.score : null;

              const saveOverride = () => {
                const n = parseInt(overrideScore, 10);
                if (isNaN(n) || n < 0 || n > 10) return;
                const newOverrides = { ...(deal.managerOverrides || {}), [el.key]: { score: n, note: overrideNote, at: new Date().toISOString() } };
                saveDeal({ ...deal, managerOverrides: newOverrides });
                setOverridingKey(null);
                setOverrideScore("");
                setOverrideNote("");
              };
              const clearOverride = () => {
                const newOverrides = { ...(deal.managerOverrides || {}) };
                delete newOverrides[el.key];
                saveDeal({ ...deal, managerOverrides: newOverrides });
              };

              return (
                <div key={el.key} style={styles.scoreCard}>
                  <div style={styles.scoreCardHead}>
                    <div style={styles.scoreLabel}>
                      <span style={styles.elShort}>{el.short}</span>
                      <span>{el.label}</span>
                    </div>
                    <div style={styles.scorePillStack}>
                      <div style={{ ...styles.scorePill, background: aiColor, opacity: override ? 0.4 : 1 }} title="AI score from notes">
                        AI {s.score}
                      </div>
                      {override && (
                        <div style={{ ...styles.scorePill, background: finalColor, border: "2px solid var(--ink)" }} title="Manager override">
                          MGR {override.score}
                          {delta !== 0 && <span style={styles.deltaArrow}>{delta > 0 ? ` ▲${delta}` : ` ▼${Math.abs(delta)}`}</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={styles.scoreText}><strong>What rep knows:</strong> {s.rationale}</div>
                  <div style={styles.gapText}><strong>Gap:</strong> {s.gap}</div>
                  {override?.note && (
                    <div style={styles.mgrNote}><strong>Manager:</strong> {override.note}</div>
                  )}

                  {role === "manager" && (
                    <div style={styles.overrideArea}>
                      {isOverriding ? (
                        <div style={styles.overrideForm}>
                          <input
                            type="number"
                            min="0"
                            max="10"
                            value={overrideScore}
                            onChange={(e) => setOverrideScore(e.target.value)}
                            placeholder="Score 0-10"
                            style={styles.smallInput}
                          />
                          <input
                            type="text"
                            value={overrideNote}
                            onChange={(e) => setOverrideNote(e.target.value)}
                            placeholder="Coaching note (optional)"
                            style={styles.smallInputWide}
                          />
                          <button style={styles.tinyBtn} onClick={saveOverride}>Save</button>
                          <button style={styles.tinyBtnGhost} onClick={() => setOverridingKey(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div style={styles.overrideActions}>
                          <button
                            style={styles.tinyBtnGhost}
                            onClick={() => {
                              setOverridingKey(el.key);
                              setOverrideScore(String(override?.score ?? s.score));
                              setOverrideNote(override?.note ?? "");
                            }}
                          >
                            {override ? "Edit override" : "Override score"}
                          </button>
                          {override && <button style={styles.tinyBtnGhost} onClick={clearOverride}>Clear</button>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {deal.nextActions?.length > 0 && (
            <div style={styles.actionsBox}>
              <div style={styles.actionsTitle}>Next best actions</div>
              <ul style={styles.actionsList}>
                {deal.nextActions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DrillMode({ deal, saveDeal }) {
  const [element, setElement] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages, sending]);

  const startDrill = async (el) => {
    setElement(el);
    setMessages([]);
    setSending(true);
    try {
      const sys = drillSystemPrompt(el);
      const userMsg = `Deal notes:\n${deal.notes || "(none provided)"}\n\nStart drilling me on ${el.label}. Ask your sharpest opening question.`;
      const reply = await callClaude(sys, [{ role: "user", content: userMsg }]);
      setMessages([{ role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([{ role: "assistant", content: "Coach unavailable. Try again." }]);
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg = { role: "user", content: input };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const reply = await callClaude(drillSystemPrompt(element), [
        { role: "user", content: `Deal notes:\n${deal.notes || "(none provided)"}` },
        ...next,
      ]);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: "Coach unavailable. Try again." }]);
    } finally {
      setSending(false);
    }
  };

  if (!element) {
    return (
      <div style={styles.modePanel}>
        <div style={styles.modeIntro}>Pick an element to drill on. The coach will Socratically probe what you actually know.</div>
        <div style={styles.elementGrid}>
          {ELEMENTS.map((el) => {
            const score = deal.scores?.[el.key]?.score;
            return (
              <button key={el.key} style={styles.elementBtn} onClick={() => startDrill(el)}>
                <div style={styles.elementBtnHead}>
                  <span style={styles.elShort}>{el.short}</span>
                  {score != null && <span style={styles.miniScore}>{score}/10</span>}
                </div>
                <div style={styles.elementBtnLabel}>{el.label}</div>
                <div style={styles.elementBtnDesc}>{el.desc}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.modePanel}>
      <div style={styles.drillHeader}>
        <button style={styles.ghostBtn} onClick={() => { setElement(null); setMessages([]); }}>
          <ArrowLeft size={14} /> Change element
        </button>
        <div style={styles.drillTitle}>Drilling: <strong>{element.label}</strong></div>
      </div>
      <div style={styles.chat} ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} style={{ ...styles.bubble, ...(m.role === "user" ? styles.bubbleUser : styles.bubbleCoach) }}>
            {m.content}
          </div>
        ))}
        {sending && <div style={{ ...styles.bubble, ...styles.bubbleCoach }}><Loader2 size={14} className="spin" /> thinking…</div>}
      </div>
      <div style={styles.inputRow}>
        <textarea
          style={styles.chatInput}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Your answer… (Enter to send, Shift+Enter for newline)"
          rows={2}
        />
        <button style={styles.primaryBtn} onClick={send} disabled={sending || !input.trim()}>
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

function drillSystemPrompt(el) {
  return `You are a senior sales coach drilling a rep on the MEDDPICC element "${el.label}" (${el.desc}).

Style:
- Socratic, not preachy. Ask ONE sharp question at a time.
- Skeptical. If the rep gives a vague answer ("they really want this", "Q2-ish"), push back: by whom, when exactly, how do you know?
- Brief. 2-4 sentences per turn. No bullet lists unless summarizing.
- Direct, no cheerleading.

After roughly 4-6 exchanges, end with a short verdict: where they're solid, where they're exposed, and ONE concrete next step. Mark the verdict with "VERDICT:" so the rep can spot it.`;
}

function RoleplayMode({ deal }) {
  const [persona, setPersona] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages, sending]);

  const PERSONAS = [
    { key: "eb", label: "Skeptical Economic Buyer", desc: "CFO-type. Cares about ROI, risk, and why now. Limited time." },
    { key: "champion", label: "Wavering Champion", desc: "Was excited, now distracted. You need to re-energize them." },
    { key: "procurement", label: "Procurement Lead", desc: "Late-stage gauntlet. Pricing, terms, security, references." },
    { key: "user", label: "End User / Influencer", desc: "Hands-on. Cares about workflow fit, not strategy." },
  ];

  const start = async (p) => {
    setPersona(p);
    setMessages([]);
    setSending(true);
    try {
      const sys = roleplaySystemPrompt(p);
      const userMsg = `Background on the deal:\n${deal.notes || "(none)"}\n\nOpen the conversation in character. Keep it natural — one or two sentences.`;
      const reply = await callClaude(sys, [{ role: "user", content: userMsg }]);
      setMessages([{ role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([{ role: "assistant", content: "Buyer unavailable. Try again." }]);
    } finally {
      setSending(false);
    }
  };

  const send = async () => {
    if (!input.trim() || sending) return;
    const userMsg = { role: "user", content: input };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const reply = await callClaude(roleplaySystemPrompt(persona), [
        { role: "user", content: `Deal background:\n${deal.notes || "(none)"}` },
        ...next,
      ]);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: "Buyer unavailable. Try again." }]);
    } finally {
      setSending(false);
    }
  };

  const endCall = async () => {
    if (sending) return;
    setSending(true);
    try {
      const sys = `You are a sales coach who just watched a role-play between a rep and a "${persona.label}". Give a brutally honest, brief debrief:
1) What the rep did well (1-2 things)
2) What they missed or fumbled (1-2 things, specific)
3) What MEDDPICC elements they advanced, and which they neglected
4) One concrete thing to do differently next time

Be direct. No fluff. Max 180 words.`;
      const transcript = messages.map((m) => `${m.role === "user" ? "Rep" : persona.label}: ${m.content}`).join("\n\n");
      const reply = await callClaude(sys, [{ role: "user", content: `Transcript:\n\n${transcript}` }]);
      setMessages([...messages, { role: "assistant", content: `📋 DEBRIEF\n\n${reply}`, isDebrief: true }]);
    } catch (e) {
      // ignore
    } finally {
      setSending(false);
    }
  };

  if (!persona) {
    return (
      <div style={styles.modePanel}>
        <div style={styles.modeIntro}>Pick a buyer persona to practice against. The buyer reacts to what you say — not a script.</div>
        <div style={styles.personaGrid}>
          {PERSONAS.map((p) => (
            <button key={p.key} style={styles.personaBtn} onClick={() => start(p)}>
              <div style={styles.personaLabel}>{p.label}</div>
              <div style={styles.personaDesc}>{p.desc}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.modePanel}>
      <div style={styles.drillHeader}>
        <button style={styles.ghostBtn} onClick={() => { setPersona(null); setMessages([]); }}>
          <ArrowLeft size={14} /> Change persona
        </button>
        <div style={styles.drillTitle}>Role-play: <strong>{persona.label}</strong></div>
        <button style={styles.ghostBtn} onClick={endCall} disabled={messages.length < 2 || sending}>End & debrief</button>
      </div>
      <div style={styles.chat} ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} style={{ ...styles.bubble, ...(m.role === "user" ? styles.bubbleUser : (m.isDebrief ? styles.bubbleDebrief : styles.bubbleBuyer)) }}>
            {m.content}
          </div>
        ))}
        {sending && <div style={{ ...styles.bubble, ...styles.bubbleBuyer }}><Loader2 size={14} className="spin" /> …</div>}
      </div>
      <div style={styles.inputRow}>
        <textarea
          style={styles.chatInput}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="What do you say?"
          rows={2}
        />
        <button style={styles.primaryBtn} onClick={send} disabled={sending || !input.trim()}>
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

function roleplaySystemPrompt(p) {
  return `You are role-playing a "${p.label}" in a B2B software sales conversation. ${p.desc}

Rules:
- Stay in character. You are NOT a coach. You are the buyer/stakeholder.
- React naturally to what the rep says. Short responses (1-3 sentences usually).
- Be realistic: push back, ask hard questions, get distracted, change topic, give partial info.
- Don't volunteer everything. Make the rep earn information.
- If the rep asks great discovery questions, give them useful color. If they pitch features, get bored or skeptical.
- Never break character to give advice. The debrief happens later.`;
}

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600;700&family=JetBrains+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
  :root {
    --bg: #faf8f3;
    --paper: #ffffff;
    --ink: #1a1410;
    --ink-soft: #5c544c;
    --rule: #e8e2d6;
    --accent: #c8401a;
    --accent-soft: #f5e6df;
    --ok: #2d6a4f;
    --warn: #b8860b;
    --bad: #a02a1a;
    --dim: #8b8378;
  }
  * { box-sizing: border-box; }
  body { margin: 0; }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  button:not(:disabled) { cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  textarea, input { font-family: inherit; }
`;

const styles = {
  shell: {
    fontFamily: "'Inter', system-ui, sans-serif",
    background: "var(--bg)",
    color: "var(--ink)",
    minHeight: "100vh",
    padding: "24px",
    maxWidth: "1100px",
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: "20px",
    borderBottom: "1px solid var(--rule)",
    marginBottom: "24px",
  },
  logo: { display: "flex", alignItems: "center", gap: "12px" },
  logoMark: {
    width: "38px",
    height: "38px",
    background: "var(--accent)",
    color: "#fff",
    fontFamily: "'Fraunces', serif",
    fontWeight: 700,
    fontSize: "22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "2px",
  },
  logoTitle: { fontFamily: "'Fraunces', serif", fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em" },
  logoSub: { fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.1em" },
  loadingShell: { display: "flex", alignItems: "center", gap: "8px", padding: "40px", color: "var(--ink-soft)" },
  listShell: {},
  listHeader: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "20px" },
  h2: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: "28px", margin: 0, letterSpacing: "-0.02em" },
  empty: { textAlign: "center", padding: "60px 20px", background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: "4px" },
  emptyTitle: { fontFamily: "'Fraunces', serif", fontSize: "20px", marginBottom: "8px" },
  emptySub: { color: "var(--ink-soft)", fontSize: "14px" },
  dealGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "14px" },
  dealCard: {
    background: "var(--paper)",
    border: "1px solid var(--rule)",
    borderRadius: "4px",
    padding: "16px",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  dealCardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" },
  dealName: { fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 600, lineHeight: "1.3" },
  dealMeta: { fontSize: "13px", color: "var(--ink-soft)", marginBottom: "6px" },
  dealDate: { fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", color: "var(--dim)", textTransform: "uppercase", letterSpacing: "0.08em" },
  scoreBadge: { background: "var(--accent-soft)", color: "var(--accent)", padding: "2px 6px", borderRadius: "2px", fontWeight: 600, fontSize: "12px" },
  dim: { color: "var(--dim)", fontStyle: "italic" },
  iconBtn: { background: "transparent", border: "none", color: "var(--ink-soft)", padding: "4px" },
  primaryBtn: {
    background: "var(--ink)",
    color: "#fff",
    border: "none",
    padding: "8px 16px",
    borderRadius: "2px",
    fontSize: "13px",
    fontWeight: 500,
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },
  ghostBtn: {
    background: "transparent",
    border: "1px solid var(--rule)",
    color: "var(--ink)",
    padding: "6px 12px",
    borderRadius: "2px",
    fontSize: "13px",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },
  dealShell: {},
  dealHeader: { marginBottom: "20px" },
  nameInput: {
    fontFamily: "'Fraunces', serif",
    fontSize: "26px",
    fontWeight: 600,
    width: "100%",
    border: "none",
    background: "transparent",
    padding: "4px 0",
    marginBottom: "8px",
    color: "var(--ink)",
    letterSpacing: "-0.02em",
  },
  notesInput: {
    width: "100%",
    border: "1px solid var(--rule)",
    background: "var(--paper)",
    padding: "12px",
    borderRadius: "2px",
    fontSize: "14px",
    color: "var(--ink)",
    fontFamily: "'Inter', sans-serif",
    resize: "vertical",
    lineHeight: "1.5",
  },
  tabs: { display: "flex", gap: "2px", marginBottom: "20px", borderBottom: "1px solid var(--rule)" },
  tab: {
    background: "transparent",
    border: "none",
    padding: "10px 16px",
    fontSize: "13px",
    color: "var(--ink-soft)",
    borderBottom: "2px solid transparent",
    marginBottom: "-1px",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },
  tabActive: { color: "var(--accent)", borderBottom: "2px solid var(--accent)", fontWeight: 600 },
  modePanel: {},
  modeIntro: { fontSize: "14px", color: "var(--ink-soft)", marginBottom: "16px", lineHeight: "1.5" },
  actionRow: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px", flexWrap: "wrap" },
  error: { color: "var(--bad)", fontSize: "13px", display: "inline-flex", alignItems: "center", gap: "4px" },
  scoreGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" },
  scoreCard: { background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: "4px", padding: "14px" },
  scoreCardHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" },
  scoreLabel: { display: "flex", alignItems: "center", gap: "8px", fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 600 },
  elShort: {
    width: "22px",
    height: "22px",
    background: "var(--ink)",
    color: "#fff",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "11px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "2px",
    fontWeight: 600,
  },
  scorePill: { color: "#fff", padding: "3px 10px", borderRadius: "2px", fontSize: "12px", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" },
  scoreText: { fontSize: "13px", lineHeight: "1.5", marginBottom: "6px", color: "var(--ink)" },
  gapText: { fontSize: "13px", lineHeight: "1.5", color: "var(--ink-soft)", fontStyle: "italic" },
  actionsBox: {
    marginTop: "20px",
    background: "var(--accent-soft)",
    border: "1px solid var(--accent)",
    borderRadius: "4px",
    padding: "16px 20px",
  },
  actionsTitle: { fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 600, marginBottom: "8px", color: "var(--accent)" },
  actionsList: { margin: 0, paddingLeft: "20px", fontSize: "14px", lineHeight: "1.6" },
  elementGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "10px" },
  elementBtn: {
    background: "var(--paper)",
    border: "1px solid var(--rule)",
    borderRadius: "4px",
    padding: "14px",
    textAlign: "left",
    transition: "all 0.15s",
  },
  elementBtnHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" },
  elementBtnLabel: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: "15px", marginBottom: "4px" },
  elementBtnDesc: { fontSize: "12px", color: "var(--ink-soft)", lineHeight: "1.4" },
  miniScore: { fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "var(--ink-soft)", background: "var(--bg)", padding: "2px 6px", borderRadius: "2px" },
  drillHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", gap: "12px", flexWrap: "wrap" },
  drillTitle: { fontFamily: "'Fraunces', serif", fontSize: "16px" },
  chat: {
    background: "var(--paper)",
    border: "1px solid var(--rule)",
    borderRadius: "4px",
    padding: "16px",
    minHeight: "300px",
    maxHeight: "500px",
    overflowY: "auto",
    marginBottom: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  bubble: { padding: "10px 14px", borderRadius: "4px", fontSize: "14px", lineHeight: "1.5", maxWidth: "85%", whiteSpace: "pre-wrap" },
  bubbleUser: { background: "var(--ink)", color: "#fff", alignSelf: "flex-end" },
  bubbleCoach: { background: "var(--accent-soft)", color: "var(--ink)", alignSelf: "flex-start", borderLeft: "3px solid var(--accent)" },
  bubbleBuyer: { background: "var(--bg)", color: "var(--ink)", alignSelf: "flex-start", border: "1px solid var(--rule)" },
  bubbleDebrief: { background: "#fef9e7", color: "var(--ink)", alignSelf: "stretch", maxWidth: "100%", border: "1px solid var(--warn)" },
  inputRow: { display: "flex", gap: "8px", alignItems: "flex-end" },
  chatInput: {
    flex: 1,
    border: "1px solid var(--rule)",
    borderRadius: "2px",
    padding: "10px",
    fontSize: "14px",
    background: "var(--paper)",
    color: "var(--ink)",
    resize: "none",
    fontFamily: "'Inter', sans-serif",
  },
  personaGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" },
  personaBtn: {
    background: "var(--paper)",
    border: "1px solid var(--rule)",
    borderRadius: "4px",
    padding: "16px",
    textAlign: "left",
  },
  personaLabel: { fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: "16px", marginBottom: "6px" },
  personaDesc: { fontSize: "13px", color: "var(--ink-soft)", lineHeight: "1.4" },

  // Header / role toggle
  headerActions: { display: "flex", gap: "10px", alignItems: "center" },
  roleToggle: { display: "flex", background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: "2px", padding: "2px" },
  roleBtn: { background: "transparent", border: "none", padding: "6px 12px", fontSize: "12px", color: "var(--ink-soft)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", borderRadius: "2px" },
  roleBtnActive: { background: "var(--ink)", color: "#fff" },

  // Score override
  scorePillStack: { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" },
  deltaArrow: { fontSize: "10px", marginLeft: "4px", opacity: 0.85 },
  mgrNote: { fontSize: "13px", lineHeight: "1.5", marginTop: "8px", padding: "8px 10px", background: "var(--bg)", borderLeft: "3px solid var(--ink)", color: "var(--ink)" },
  overrideArea: { marginTop: "10px", paddingTop: "10px", borderTop: "1px dashed var(--rule)" },
  overrideForm: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" },
  overrideActions: { display: "flex", gap: "6px" },
  smallInput: { width: "70px", border: "1px solid var(--rule)", padding: "4px 6px", fontSize: "12px", borderRadius: "2px" },
  smallInputWide: { flex: 1, minWidth: "120px", border: "1px solid var(--rule)", padding: "4px 6px", fontSize: "12px", borderRadius: "2px" },
  tinyBtn: { background: "var(--ink)", color: "#fff", border: "none", padding: "4px 10px", fontSize: "11px", borderRadius: "2px", fontWeight: 500 },
  tinyBtnGhost: { background: "transparent", border: "1px solid var(--rule)", padding: "4px 10px", fontSize: "11px", borderRadius: "2px", color: "var(--ink-soft)" },

  // Manager view
  subtle: { fontSize: "13px", color: "var(--ink-soft)", marginTop: "4px" },
  h3: { fontFamily: "'Fraunces', serif", fontSize: "18px", fontWeight: 600, marginTop: "32px", marginBottom: "12px", letterSpacing: "-0.01em" },
  weakestBanner: { background: "var(--paper)", border: "1px solid var(--rule)", borderLeft: "4px solid var(--bad)", padding: "16px 20px", borderRadius: "4px", marginBottom: "20px" },
  bannerLabel: { fontFamily: "'JetBrains Mono', monospace", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--bad)", marginBottom: "6px" },
  bannerBody: { display: "flex", alignItems: "center", gap: "10px", fontFamily: "'Fraunces', serif", fontSize: "20px", marginBottom: "8px", flexWrap: "wrap" },
  bannerAvg: { fontFamily: "'JetBrains Mono', monospace", fontSize: "12px", color: "var(--ink-soft)", fontWeight: "normal" },
  bannerHint: { fontSize: "13px", color: "var(--ink-soft)", lineHeight: "1.5", fontStyle: "italic" },
  coachingPlanBox: { background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: "4px", padding: "18px 22px", marginBottom: "20px" },
  coachingPlanTitle: { fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 600, color: "var(--accent)", marginBottom: "10px" },
  coachingPlanBody: { fontSize: "14px", lineHeight: "1.6", whiteSpace: "pre-wrap", color: "var(--ink)" },
  elementAvgList: { display: "flex", flexDirection: "column", gap: "8px", background: "var(--paper)", border: "1px solid var(--rule)", padding: "16px", borderRadius: "4px" },
  elementAvgRow: { display: "grid", gridTemplateColumns: "180px 1fr 50px", alignItems: "center", gap: "12px" },
  elementAvgLabel: { display: "flex", alignItems: "center", gap: "8px", fontSize: "14px" },
  barTrack: { height: "8px", background: "var(--bg)", borderRadius: "2px", overflow: "hidden" },
  barFill: { height: "100%", borderRadius: "2px", transition: "width 0.3s" },
  avgScorePill: { fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", fontWeight: 600, textAlign: "right" },
  matrixWrap: { overflowX: "auto", background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: "4px", padding: "12px" },
  matrix: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  matrixHead: { padding: "8px 4px", textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--rule)", verticalAlign: "bottom" },
  matrixHeadDeal: { padding: "8px", textAlign: "left", fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "var(--ink-soft)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--rule)" },
  matrixSub: { display: "block", fontSize: "9px", marginTop: "2px", opacity: 0.7 },
  matrixRow: { cursor: "pointer", transition: "background 0.15s" },
  matrixDealCell: { padding: "10px 8px", fontWeight: 500, borderBottom: "1px solid var(--rule)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  matrixCell: { padding: "10px 4px", textAlign: "center", borderBottom: "1px solid var(--rule)", borderRadius: 0, position: "relative" },
  matrixDot: { position: "absolute", top: "2px", right: "4px", fontSize: "12px", lineHeight: 1 },
  matrixAvg: { padding: "10px 8px", textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, borderBottom: "1px solid var(--rule)" },
  matrixLegend: { fontSize: "11px", color: "var(--ink-soft)", marginTop: "10px", fontStyle: "italic" },
  calibList: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "10px" },
  calibCard: { background: "var(--paper)", border: "1px solid var(--rule)", borderLeft: "3px solid var(--warn)", padding: "12px 14px", borderRadius: "4px", cursor: "pointer" },
  calibHead: { fontSize: "13px", marginBottom: "6px" },
  calibBody: { fontSize: "13px", color: "var(--ink-soft)" },
  calibNote: { fontSize: "12px", color: "var(--ink)", marginTop: "6px", fontStyle: "italic", paddingTop: "6px", borderTop: "1px dashed var(--rule)" },

  // Bulk upload modal
  headerBtnGroup: { display: "flex", gap: "8px" },
  modalBackdrop: {
    position: "fixed", inset: 0, background: "rgba(26, 20, 16, 0.55)", display: "flex",
    alignItems: "center", justifyContent: "center", zIndex: 100, padding: "20px",
  },
  modal: {
    background: "var(--bg)", borderRadius: "4px", maxWidth: "640px", width: "100%",
    maxHeight: "85vh", overflowY: "auto", padding: "24px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
    border: "1px solid var(--rule)",
  },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" },
  modalTitle: { fontFamily: "'Fraunces', serif", fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em" },
  modalError: {
    background: "#fde8e4", border: "1px solid var(--bad)", color: "var(--bad)",
    padding: "10px 14px", borderRadius: "2px", fontSize: "13px", marginBottom: "16px",
    display: "flex", alignItems: "center", gap: "6px",
  },
  dropzone: {
    border: "2px dashed var(--rule)", borderRadius: "4px", padding: "40px 20px",
    textAlign: "center", cursor: "pointer", background: "var(--paper)",
    display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
    transition: "all 0.15s",
  },
  dropTitle: { fontFamily: "'Fraunces', serif", fontSize: "16px", fontWeight: 600 },
  dropSub: { fontSize: "13px", color: "var(--ink-soft)", marginBottom: "12px" },
  dropHint: {
    fontSize: "12px", color: "var(--ink-soft)", marginTop: "16px", padding: "10px 14px",
    background: "var(--bg)", borderRadius: "2px", maxWidth: "440px", lineHeight: "1.5", textAlign: "left",
  },
  mapFileRow: { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", marginBottom: "20px", color: "var(--ink-soft)" },
  mapSection: { marginBottom: "20px" },
  mapSectionTitle: {
    fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", textTransform: "uppercase",
    letterSpacing: "0.1em", color: "var(--ink-soft)", marginBottom: "10px",
  },
  mapRow: { display: "grid", gridTemplateColumns: "180px 1fr", alignItems: "center", gap: "12px", marginBottom: "10px" },
  mapLabel: { fontSize: "14px" },
  required: { color: "var(--accent)" },
  mapSelect: {
    width: "100%", border: "1px solid var(--rule)", padding: "8px 10px", fontSize: "13px",
    borderRadius: "2px", background: "var(--paper)", color: "var(--ink)", fontFamily: "'Inter', sans-serif",
  },
  previewSection: { marginBottom: "20px" },
  previewTable: { background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: "2px" },
  previewRow: { padding: "10px 12px", borderBottom: "1px solid var(--rule)", fontSize: "13px" },
  previewName: { fontFamily: "'Fraunces', serif", fontWeight: 600, marginBottom: "4px" },
  previewNotes: { color: "var(--ink-soft)", fontSize: "12px", lineHeight: "1.5" },
  previewMore: { padding: "10px 12px", color: "var(--ink-soft)", fontStyle: "italic", fontSize: "12px" },
  autoScoreToggle: {
    display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px",
    background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: "2px",
    fontSize: "13px", cursor: "pointer", marginBottom: "20px",
  },
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--rule)" },
  importingShell: { display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "40px 20px" },
  importingTitle: { fontFamily: "'Fraunces', serif", fontSize: "18px" },
  progressTrack: { width: "100%", maxWidth: "400px", height: "8px", background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: "2px", overflow: "hidden" },
  progressFill: { height: "100%", background: "var(--accent)", transition: "width 0.3s" },
  progressText: { fontSize: "13px", color: "var(--ink-soft)", textAlign: "center" },
  progressCurrent: { fontSize: "12px", marginTop: "4px", fontStyle: "italic" },
  doneShell: { display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "30px 20px", textAlign: "center" },
  doneTitle: { fontFamily: "'Fraunces', serif", fontSize: "22px", fontWeight: 600 },
  doneSub: { fontSize: "14px", color: "var(--ink-soft)", marginBottom: "12px", maxWidth: "400px", lineHeight: "1.5" },
};
