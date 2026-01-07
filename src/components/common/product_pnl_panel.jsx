// /components/common/product_pnl_panel.jsx
'use client';

import { useEffect, useMemo, useState } from 'react';

const groups = [
  { v: 'day', l: 'Daily' },
  { v: 'week', l: 'Weekly' },
  { v: 'month', l: 'Monthly' },
  { v: 'quarter', l: 'Quarterly' },
  { v: 'half', l: 'Half-Yearly' },
  { v: 'year', l: 'Yearly' },
  { v: 'all', l: 'Total' },
];

export default function ProductPnlPanel({ defaultStart, defaultEnd }) {
  const [sku, setSku] = useState('');
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [group, setGroup] = useState('month');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (sku) q.set('sku', sku);
    if (productId) q.set('productId', productId);
    if (variantId) q.set('variantId', variantId);
    q.set('group', group);
    q.set('start', start);
    q.set('end', end);
    return q.toString();
  }, [sku, productId, variantId, group, start, end]);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/reports/pnl/product?${query}`, { cache: 'no-store' });
      const js = await res.json();
      if (!js.ok) throw new Error(js.error || 'Load failed');
      setData(js.data);
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  function downloadPdf() {
    const url = `/api/reports/pnl/product/pdf?${query}`;
    window.open(url, '_blank', 'noopener');
  }

  useEffect(() => {
    // No auto-load to avoid empty queries; admin provides SKU/product/variant explicitly.
  }, []);

  return (
    <div className="max-w-[1200px] mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Product-wise P&L</h1>

      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
        <input value={sku} onChange={e => setSku(e.target.value)} placeholder="SKU (e.g., TDLC-TS-PRM-NAVY-S)" className="border rounded px-3 py-2 col-span-2" />
        <input value={productId} onChange={e => setProductId(e.target.value)} placeholder="Product ID" className="border rounded px-3 py-2" />
        <input value={variantId} onChange={e => setVariantId(e.target.value)} placeholder="Variant ID" className="border rounded px-3 py-2" />
        <input type="date" value={start} onChange={e => setStart(e.target.value)} className="border rounded px-3 py-2" />
        <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="border rounded px-3 py-2" />
        <select value={group} onChange={e => setGroup(e.target.value)} className="border rounded px-3 py-2">
          {groups.map(g => <option key={g.v} value={g.v}>{g.l}</option>)}
        </select>
      </div>

      <div className="flex gap-3 mb-4">
        <button onClick={load} disabled={loading} className="bg-black text-white px-4 py-2 rounded">{loading ? 'Loading…' : 'Load report'}</button>
        <button onClick={downloadPdf} disabled={!data} className="border px-4 py-2 rounded">Download PDF</button>
      </div>

      {err ? <div className="text-red-600 mb-3">{err}</div> : null}

      {data && (
        <div className="border rounded">
          <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-3 border-b bg-neutral-50">
            <Kpi label="Net Sales (ex-VAT)" value={data.totals.netSalesExVat} />
            <Kpi label="COGS" value={data.totals.cogs} />
            <Kpi label="Gross Profit" value={(data.totals.netSalesExVat || 0) - (data.totals.cogs || 0)} />
            <Kpi label="Net Profit" value={data.totals.netProfit} />
            <Kpi label="VAT Collected" value={data.totals.vatCollected} />
            <Kpi label="Shipping Subsidy" value={data.totals.shippingSubsidy} />
            <Kpi label="Reship Cost" value={data.totals.reshipCost} />
            <Kpi label="Payment Fees" value={data.totals.paymentFees} />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-100">
                <tr>
                  {['Period','Rev (incl VAT)','VAT','Net Sales','Units','COGS','Gross','Ship Subsidy','Reship','Fees','Overhead','Net'].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, idx) => (
                  <tr key={idx} className="border-t">
                    <Td>{r.label}</Td>
                    <Td money>{r.revenueInclVat}</Td>
                    <Td money>{r.vatCollected}</Td>
                    <Td money>{r.netSalesExVat}</Td>
                    <Td>{r.units}</Td>
                    <Td money>{r.cogs}</Td>
                    <Td money>{(r.netSalesExVat || 0) - (r.cogs || 0)}</Td>
                    <Td money>{r.shippingSubsidy}</Td>
                    <Td money>{r.reshipCost}</Td>
                    <Td money>{r.paymentFees}</Td>
                    <Td money>{r.overheadAllocated}</Td>
                    <Td money bold>{r.netProfit}</Td>
                  </tr>
                ))}
                <tr className="border-t bg-neutral-50">
                  <Td bold>Total</Td>
                  <Td money bold>{data.totals.revenueInclVat}</Td>
                  <Td money bold>{data.totals.vatCollected}</Td>
                  <Td money bold>{data.totals.netSalesExVat}</Td>
                  <Td bold>{data.totals.units}</Td>
                  <Td money bold>{data.totals.cogs}</Td>
                  <Td money bold>{(data.totals.netSalesExVat || 0) - (data.totals.cogs || 0)}</Td>
                  <Td money bold>{data.totals.shippingSubsidy}</Td>
                  <Td money bold>{data.totals.reshipCost}</Td>
                  <Td money bold>{data.totals.paymentFees}</Td>
                  <Td money bold>{data.totals.overheadAllocated}</Td>
                  <Td money bold>{data.totals.netProfit}</Td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="p-3">
            <h3 className="font-medium mb-2">Payment Fees by Gateway</h3>
            {Object.keys(data.totals.gateways || {}).length === 0 ? (
              <div className="text-sm text-neutral-600">No gateway fees recorded for this period.</div>
            ) : (
              <ul className="text-sm">
                {Object.entries(data.totals.gateways).map(([k,v]) => (
                  <li key={k}>{k}: <Money n={v} /></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="bg-white border rounded p-3">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-lg font-semibold"><Money n={value} /></div>
    </div>
  );
}

function Td({ children, money, bold }) {
  return (
    <td className={`px-3 py-2 ${bold ? 'font-semibold' : ''}`}>
      {money ? <Money n={children} /> : children}
    </td>
  );
}

function Money({ n }) {
  const v = Number(n || 0);
  return new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', currencyDisplay: 'code', maximumFractionDigits: 2 }).format(v);
}
