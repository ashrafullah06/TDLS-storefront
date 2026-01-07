"use client";
import { useEffect, useMemo, useState } from "react";

export default function WalletAdminPage() {
  const [userId, setUserId] = useState("");
  const [data, setData] = useState(null);
  const [adj, setAdj] = useState({ amount: "", reason: "ADJUST", reference: "manual" });
  const [xfer, setXfer] = useState({ toUserId: "", amount: "", reason: "TRANSFER", reference: "admin" });
  const [err, setErr] = useState("");

  const disabled = useMemo(()=>!userId, [userId]);

  async function load() {
    setErr(""); setData(null);
    try {
      const r = await fetch(`/api/wallet/transactions?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "load failed");
      setData(j);
    } catch(e) { setErr(String(e.message || e)); }
  }

  async function doAdjust(e) {
    e.preventDefault(); setErr("");
    const r = await fetch(`/api/wallet/transactions`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ userId, amount: Number(adj.amount||0), reason: adj.reason, reference: adj.reference }) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error||"adjust failed"); return; }
    await load();
    setAdj({ amount: "", reason: "ADJUST", reference: "manual" });
  }

  async function doTransfer(e) {
    e.preventDefault(); setErr("");
    const r = await fetch(`/api/wallet/transfer`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ fromUserId: userId, toUserId: xfer.toUserId, amount: Number(xfer.amount||0), reason: xfer.reason, reference: xfer.reference }) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error||"transfer failed"); return; }
    await load();
    setXfer({ toUserId: "", amount: "", reason: "TRANSFER", reference: "admin" });
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Wallet Management</h1>

      <div className="flex gap-3 mb-4">
        <input className="border rounded p-2 w-80" placeholder="User ID"
          value={userId} onChange={e=>setUserId(e.target.value)} />
        <button onClick={load} className="bg-black text-white px-4 py-2 rounded" disabled={!userId}>Load</button>
      </div>

      {err && <div className="text-red-600 mb-3">{err}</div>}

      {data && (
        <>
          <div className="border rounded p-4 mb-6">
            <div>Balance: <b>৳{Number(data.balance||0).toFixed(2)}</b></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <form onSubmit={doAdjust} className="border rounded p-4">
              <h2 className="font-medium mb-3">Manual adjustment</h2>
              <input className="border rounded p-2 w-full mb-2" type="number" placeholder="Amount (+/-)" value={adj.amount} onChange={e=>setAdj(s=>({...s,amount:e.target.value}))}/>
              <input className="border rounded p-2 w-full mb-2" placeholder="Reason" value={adj.reason} onChange={e=>setAdj(s=>({...s,reason:e.target.value}))}/>
              <input className="border rounded p-2 w-full mb-3" placeholder="Reference" value={adj.reference} onChange={e=>setAdj(s=>({...s,reference:e.target.value}))}/>
              <button disabled={disabled} className="bg-gray-900 text-white px-4 py-2 rounded">Apply</button>
            </form>

            <form onSubmit={doTransfer} className="border rounded p-4">
              <h2 className="font-medium mb-3">Transfer to user</h2>
              <input className="border rounded p-2 w-full mb-2" placeholder="To User ID" value={xfer.toUserId} onChange={e=>setXfer(s=>({...s,toUserId:e.target.value}))}/>
              <input className="border rounded p-2 w-full mb-2" type="number" placeholder="Amount" value={xfer.amount} onChange={e=>setXfer(s=>({...s,amount:e.target.value}))}/>
              <input className="border rounded p-2 w-full mb-2" placeholder="Reason" value={xfer.reason} onChange={e=>setXfer(s=>({...s,reason:e.target.value}))}/>
              <input className="border rounded p-2 w-full mb-3" placeholder="Reference" value={xfer.reference} onChange={e=>setXfer(s=>({...s,reference:e.target.value}))}/>
              <button disabled={disabled} className="bg-gray-900 text-white px-4 py-2 rounded">Transfer</button>
            </form>
          </div>

          <div className="mt-8">
            <h2 className="font-medium mb-2">Transactions</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr className="border-b"><th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Δ Amount</th><th className="py-2 pr-4">Reason</th><th className="py-2 pr-4">Reference</th></tr></thead>
                <tbody>
                  {(data.txns||[]).map(t=>(
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">{new Date(t.createdAt).toLocaleString()}</td>
                      <td className="py-2 pr-4">{Number(t.delta).toFixed(2)}</td>
                      <td className="py-2 pr-4">{t.reason}</td>
                      <td className="py-2 pr-4">{t.reference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
