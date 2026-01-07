// app/health/page.jsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const STATUS_COLORS = {
  ok: { bg: '#e8f5e9', text: '#1b5e20', border: '#c8e6c9', icon: '✅' },
  degraded: { bg: '#fff8e1', text: '#784300', border: '#ffe0b2', icon: '⚠️' },
  error: { bg: '#ffebee', text: '#b71c1c', border: '#ffcdd2', icon: '⛔' },
};

function Badge({ ok }) {
  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: ok ? '#e8f5e9' : '#ffebee',
    color: ok ? '#1b5e20' : '#b71c1c',
    border: `1px solid ${ok ? '#c8e6c9' : '#ffcdd2'}`,
    lineHeight: 1.4,
  };
  return <span style={style}>{ok ? '✅ PASS' : '❌ FAIL'}</span>;
}

function latencyColor(ms) {
  if (typeof ms !== 'number') return '#555';
  if (ms < 300) return '#1b5e20';
  if (ms < 1000) return '#7a4e00';
  return '#b71c1c';
}

export default function HealthPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);

  const fetchHealth = async () => {
    try {
      setRefreshing(true);
      const res = await fetch('/api/health', { cache: 'no-store' });
      const json = await res.json();
      if (mountedRef.current) setData(json);
    } catch (e) {
      if (mountedRef.current) {
        setData({
          status: 'error',
          suggestions: ['Failed to fetch /api/health'],
          error: String(e),
        });
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchHealth();
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { mountedRef.current = false; clearInterval(id); };
  }, []);

  const updatedAgo = useMemo(() => {
    if (!data?.timestamp) return '';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(data.timestamp).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s ago`;
  }, [data?.timestamp, tick]);

  if (loading) {
    return <div style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>Running health checks…</div>;
  }
  if (!data) {
    return <div style={{ padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>No data.</div>;
  }

  const rows = Object.entries(data.checks || {}).map(([key, v]) => ({
    key,
    desc: v?.desc || key,
    ok: !!v?.ok,
    status: v?.status,
    ms: v?.ms,
    error: v?.error,
  }));

  const statusKey = data.status === 'ok' ? 'ok' : data.status === 'degraded' ? 'degraded' : 'error';
  const theme = STATUS_COLORS[statusKey];

  const shell = {
    // 2.5in top, 3in bottom (print-accurate)
    paddingTop: '1.5in',
    paddingBottom: '3in',
    paddingLeft: 32,
    paddingRight: 32,
    maxWidth: 960,
    margin: '0 auto',
    fontFamily: 'ui-sans-serif, system-ui',
    background: '#fff',
  };

  const card = {
    border: '1px solid #eee',
    borderRadius: 12,
    background: '#fff',
  };

  return (
    <div id="health-root" style={shell}>
      <style>{`
        /* PRINT FIX: visibility trick prevents blank PDFs and overlays */
        @media print {
          html, body { height: auto !important; overflow: visible !important; }
          body * { visibility: hidden !important; }
          #health-root, #health-root * { visibility: visible !important; }
          #health-root { position: absolute; left: 0; top: 0; width: 100%; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-break { page-break-inside: avoid; break-inside: avoid; }
          table, thead, tbody, tr, td, th { page-break-inside: avoid; break-inside: avoid; }
        }

        .checks-table { display: table; width: 100%; border-collapse: collapse; }
        .checks-cards { display: none; }
        @media (max-width: 700px) {
          .checks-table { display: none; }
          .checks-cards { display: grid; grid-template-columns: 1fr; gap: 12px; }
        }

        .btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 10px 14px; border-radius: 10px; border: 1px solid #e5e7eb;
          background: #f9fafb; color: #111827; font-weight: 600; cursor: pointer;
          transition: transform .08s ease, background .2s ease, border-color .2s ease;
        }
        .btn:hover { background: #f3f4f6; }
        .btn:active { transform: translateY(1px); }
        .btn:disabled { opacity: .6; cursor: not-allowed; }

        .muted { color: #6b7280; }
        .table-th {
          text-align: left; padding: 12px; font-weight: 700; font-size: 13px;
          background: #f6f6f6; border-bottom: 1px solid #eee;
        }
        .table-td { padding: 12px; font-size: 14px; vertical-align: top; }
        .row { border-top: 1px solid #eee; }
      `}</style>

      <h1 className="no-break" style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>System Health</h1>

      <div
        className="no-break"
        style={{
          marginBottom: 24,
          padding: 16,
          borderRadius: 12,
          border: `1px solid ${theme.border}`,
          background: theme.bg,
          color: theme.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700 }}>
          <span>{theme.icon}</span>
          <span>
            {statusKey === 'ok' && 'All systems operational'}
            {statusKey === 'degraded' && 'Partial outage / degraded'}
            {statusKey === 'error' && 'System unavailable'}
          </span>
        </div>

        <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn" onClick={() => fetchHealth()} disabled={refreshing || loading} title="Re-run health checks">
            🔄 {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="btn" onClick={() => window.print()} disabled={!data} title="Save as PDF or print">
            ⬇️ Save as PDF
          </button>
        </div>
      </div>

      <div className="no-break" style={{ marginBottom: 12 }}>
        <span className="muted">as of {new Date(data.timestamp).toLocaleString()} ({updatedAgo})</span>
      </div>

      {data.version && (
        <section className="no-break" style={{ marginBottom: 16 }}>
          <div style={{ ...card, padding: 12, display: 'grid', gridTemplateColumns: '220px 1fr', gap: 8, background: '#fcfcfc' }}>
            <div>App Version</div><div><code>{data.version?.app || '—'}</code></div>
            <div>Git SHA</div><div><code>{data.version?.commit || '—'}</code></div>
            <div>Build ID</div><div><code>{data.version?.build || '—'}</code></div>
            <div>Region</div><div><code>{data.version?.region || '—'}</code></div>
          </div>
        </section>
      )}

      <section className="no-break" style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Environment</h2>
        <div
          style={{
            ...card,
            display: 'grid',
            gridTemplateColumns: '220px 1fr',
            gap: 8,
            padding: 16,
            background: '#fafafa',
          }}
        >
          <div>NODE_ENV</div><div><code>{data.env?.node_env}</code></div>
          <div>Public Site URL</div><div><code>{data.env?.next_public_site_url}</code></div>
          <div>Strapi URL</div><div><code>{data.env?.strapi_url || '—'}</code></div>
          <div>Strapi Token Set</div><div><code>{String(data.env?.strapi_token_set)}</code></div>
          <div>Strapi Token Preview</div><div><code>{data.env?.strapi_token_preview || '—'}</code></div>
          <div>Node Version</div><div><code>{data.env?.node_version}</code></div>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Checks</h2>

        <div style={{ ...card, overflow: 'hidden' }}>
          <table className="checks-table">
            <thead>
              <tr>
                <th className="table-th">Check</th>
                <th className="table-th">Status</th>
                <th className="table-th" style={{ textAlign: 'right' }}>HTTP</th>
                <th className="table-th" style={{ textAlign: 'right' }}>Latency (ms)</th>
                <th className="table-th">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="row no-break">
                  <td className="table-td" style={{ fontWeight: 600 }}>{r.desc}</td>
                  <td className="table-td"><Badge ok={r.ok} /></td>
                  <td className="table-td" style={{ textAlign: 'right' }}>{r.status || '—'}</td>
                  <td className="table-td" style={{ textAlign: 'right', color: latencyColor(r.ms) }}>
                    {typeof r.ms === 'number' ? r.ms : '—'}
                  </td>
                  <td className="table-td" style={{ color: '#b30000' }}>{r.error || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="checks-cards" style={{ padding: 12 }}>
            {rows.map((r) => (
              <div key={r.key} className="no-break" style={{ border: '1px solid #eee', borderRadius: 10, padding: 12, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>{r.desc}</div>
                  <Badge ok={r.ok} />
                </div>
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 6, columnGap: 10, fontSize: 14 }}>
                  <div className="muted">HTTP</div><div style={{ textAlign: 'right' }}>{r.status || '—'}</div>
                  <div className="muted">Latency</div><div style={{ textAlign: 'right', color: latencyColor(r.ms) }}>{typeof r.ms === 'number' ? `${r.ms} ms` : '—'}</div>
                  {r.error ? (<><div className="muted">Error</div><div style={{ color: '#b30000' }}>{r.error}</div></>) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {Array.isArray(data.suggestions) && data.suggestions.length > 0 && (
        <section className="no-break">
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Suggestions</h2>
          <div style={{ ...card, padding: 16 }}>
            <ol style={{ paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
              {data.suggestions.map((s, i) => (<li key={i}>{s}</li>))}
            </ol>
          </div>
        </section>
      )}
    </div>
  );
}
