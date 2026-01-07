"use client";
import { useEffect, useMemo, useState } from "react";

export default function ActivityPage() {
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  async function load() {
    setErr(""); setData(null);
    try {
      const q = new URLSearchParams();
      if (userId) q.set("userId", userId);
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const r = await fetch(`/api/reports/activity?`+q.toString(), { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load failed");
      setData(j);
    } catch(e) { setErr(String(e.message || e)); }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Customer Activity</h1>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <input className="border rounded p-2" placeholder="User ID" value={userId} onChange={e=>setUserId(e.target.value)}/>
        <input className="border rounded p-2" type="date" value={from} onChange={e=>setFrom(e.target.value)}/>
        <input className="border rounded p-2" type="date" value={to} onChange={e=>setTo(e.target.value)}/>
        <button onClick={load} className="bg-black text-white rounded px-4">Load</button>
      </div>
      {err && <div className="text-red-600 mb-3">{err}</div>}
      {data && (
        <>
          <div className="border rounded p-4 mb-4">
            <div>User: <b>{data.userId}</b></div>
            <div>Orders: <b>{data.summary.orders}</b></div>
            <div>Wallet: <b>৳{Number(data.summary.walletBalance||0).toFixed(2)}</b></div>
            <div>Loyalty: <b>{data.summary.points}</b> pts ({data.summary.loyaltyTier})</div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e,i)=>(
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-4">{new Date(e.at).toLocaleString()}</td>
                    <td className="py-2 pr-4">{e.type}</td>
                    <td className="py-2 pr-4">
                      {e.type==="ORDER" && <>Order #{e.ref} — ৳{Number(e.total||0).toFixed(2)} — {e.status}</>}
                      {e.type==="WALLET" && <>Δ ৳{Number(e.delta||0).toFixed(2)} — {e.reason} {e.reference?`(${e.reference})`:""}</>}
                      {e.type==="LOYALTY" && <>{e.points>0?"+":""}{e.points} pts — {e.reason} {e.reference?`(${e.reference})`:""} {e.taka?`→ ৳${Number(e.taka).toFixed(2)}`:""}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
