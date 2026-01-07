"use client";
import { useEffect, useState } from "react";

export default function LoyaltyAdminPage() {
  const [userId, setUserId] = useState("");
  const [points, setPoints] = useState("");
  const [delta, setDelta] = useState(0);
  const [res, setRes] = useState(null);

  async function call(path, body) {
    const r = await fetch(path, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
    const j = await r.json();
    setRes({ ok: r.ok, j });
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Loyalty</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <input className="border rounded p-2" placeholder="User ID" value={userId} onChange={e=>setUserId(e.target.value)} />
        <input className="border rounded p-2" type="number" placeholder="Points (earn +ve / redeem -ve)" value={points} onChange={e=>setPoints(e.target.value)} />
      </div>
      <div className="flex gap-3">
        <button onClick={()=>call("/api/loyalty/earn",{ userId, points: parseInt(points||"0",10) })} className="bg-black text-white px-4 py-2 rounded">Earn</button>
        <button onClick={()=>call("/api/loyalty/redeem",{ userId, points: -Math.abs(parseInt(points||"0",10)) })} className="border px-4 py-2 rounded">Redeem</button>
      </div>
      {res && <pre className={`mt-5 p-3 rounded text-xs ${res.ok?"bg-green-50":"bg-red-50"}`}>{JSON.stringify(res.j,null,2)}</pre>}
    </div>
  );
}
