"use client";
import { useEffect, useState, useCallback } from "react";

// --- Universal fetch with auth
function fetchWithAuth(url, options = {}) {
  return fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.headers || {}),
      "Content-Type": "application/json",
      ...(typeof window !== "undefined" && window.localStorage?.getItem("jwt")
        ? { Authorization: `Bearer ${window.localStorage.getItem("jwt")}` }
        : {}),
    },
  });
}

// --- Loyalty user summary
function useLoyaltySummary(liveReload = false) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    setLoading(true);
    fetchWithAuth("/api/loyalty/user-summary")
      .then((res) => res.json())
      .then((json) => {
        setSummary(json);
        setError("");
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to fetch loyalty info.");
        setLoading(false);
      });
  }, []);
  useEffect(() => { reload(); }, [liveReload, reload]);
  return { summary, loading, error, setSummary, reload };
}

// --- Wallet balance
function useWallet(liveReload = false) {
  const [balance, setBalance] = useState(null);
  const reload = useCallback(() => {
    fetchWithAuth("/api/wallet/balance")
      .then((r) => r.json())
      .then((j) => setBalance(j.balance || 0));
  }, []);
  useEffect(() => { reload(); }, [liveReload, reload]);
  return { balance, reload };
}

// --- Reward products
function useRewardProducts(liveReload = false) {
  const [products, setProducts] = useState([]);
  const reload = useCallback(() => {
    fetchWithAuth("/api/loyalty/reward-products")
      .then((r) => r.json())
      .then((j) => setProducts(j.products || []));
  }, []);
  useEffect(() => { reload(); }, [liveReload, reload]);
  return { products, reload };
}

// --- Referral history
function useReferralHistory(liveReload = false) {
  const [history, setHistory] = useState([]);
  const reload = useCallback(() => {
    fetchWithAuth("/api/loyalty/referral-history", { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setHistory(j.history || []));
  }, []);
  useEffect(() => { reload(); }, [liveReload, reload]);
  return { history, reload };
}

export default function LoyaltyProgressBar({ userId }) {
  // Live update version: increment this to trigger reload of all
  const [reloadIndex, setReloadIndex] = useState(0);

  // All main hooks, using reloadIndex for live updates
  const { summary, loading, error, setSummary, reload: reloadSummary } = useLoyaltySummary(reloadIndex);
  const { balance: walletBalance, reload: reloadWallet } = useWallet(reloadIndex);
  const { products: rewardProducts, reload: reloadRewards } = useRewardProducts(reloadIndex);
  const { history: referralHistory, reload: reloadReferrals } = useReferralHistory(reloadIndex);

  // Modal logic
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState(0);
  const [redeemResult, setRedeemResult] = useState("");

  // Real-time update trigger
  function triggerReloadAll() {
    setReloadIndex((n) => n + 1);
    // Ensures all hooks reload
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center w-full py-8 animate-pulse">
        <div className="h-6 w-2/3 rounded bg-neutral-200 mb-4" />
        <div className="h-3 w-5/6 rounded bg-neutral-100" />
      </div>
    );
  }
  if (error || !summary) {
    return (
      <div className="flex flex-col items-center w-full py-8 text-red-600">
        <div className="font-semibold text-lg">{error || "Error loading loyalty info"}</div>
      </div>
    );
  }

  // Progress math
  const { current_points, points_to_next_tier, tier, next_tier, point_history, total_redeemed, user } = summary;
  const percent = points_to_next_tier
    ? Math.min(100, (current_points / (current_points + points_to_next_tier)) * 100)
    : 100;

  // Wallet redemption
  async function handleRedeem(e) {
    e.preventDefault();
    setRedeemResult("");
    if (redeemAmount < 1) {
      setRedeemResult("Enter an amount to redeem.");
      return;
    }
    const res = await fetchWithAuth("/api/loyalty/redeem", {
      method: "POST",
      body: JSON.stringify({ amount: redeemAmount }),
    });
    if (!res.ok) {
      setRedeemResult("Redemption failed.");
      return;
    }
    const data = await res.json();
    setRedeemResult(`Redeemed ${redeemAmount} points for ৳${data.wallet_credit}!`);
    setShowRedeem(false);
    setRedeemAmount(0);
    triggerReloadAll(); // Real-time update
  }

  // Reward product redemption
  async function handleProductRedeem(p) {
    setRedeemResult("");
    const res = await fetchWithAuth("/api/loyalty/redeem", {
      method: "POST",
      body: JSON.stringify({ product_id: p.id }),
    });
    if (res.ok) {
      setRedeemResult(`Successfully redeemed for "${p.name}"!`);
      triggerReloadAll();
    } else {
      setRedeemResult("Redemption failed.");
    }
  }

  // Copy invite link
  const inviteLink = typeof window !== "undefined"
    ? `${window.location.origin}/register?ref=${userId || (user && user.id)}`
    : "";

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-6 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 rounded-2xl shadow-lg border border-neutral-200 mb-8">
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex-1">
          <div className="font-bold text-lg md:text-2xl text-primary-700 mb-1">Loyalty Status</div>
          <div className="text-base text-neutral-600 mb-1">Tier: <b className="text-primary-800">{tier}</b>
            {next_tier && (
              <> → <span className="text-primary-700">{next_tier}</span> ({points_to_next_tier} points to next)</>
            )}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-neutral-700">Current Points:</span>
            <span className="font-semibold text-lg text-green-700">{current_points}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="bg-primary-700 hover:bg-primary-900 text-white rounded-lg px-4 py-2 text-sm font-bold transition shadow"
              onClick={() => setShowRedeem(true)}
            >Redeem Points</button>
            <span className="text-neutral-600 text-sm">Wallet: <b className="text-blue-700">৳{walletBalance ?? 0}</b></span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 min-w-[128px]">
          <div className="w-24 h-24 rounded-full border-4 border-green-500 flex items-center justify-center relative bg-white">
            <span className="text-2xl font-bold text-green-700">{Math.round(percent)}%</span>
            <svg className="absolute left-0 top-0 w-24 h-24" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="48" cy="48" r="44" stroke="#e5e7eb" strokeWidth="8" fill="none" />
              <circle
                cx="48" cy="48" r="44"
                stroke="#22c55e"
                strokeWidth="8"
                fill="none"
                strokeDasharray={2 * Math.PI * 44}
                strokeDashoffset={2 * Math.PI * 44 * (1 - percent / 100)}
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="text-xs text-neutral-500">to next tier</div>
        </div>
      </div>

      {/* Reward products */}
      {rewardProducts.length > 0 && (
        <div className="mt-6">
          <div className="font-semibold text-base text-primary-700 mb-2">Redeem for Rewards:</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {rewardProducts.map((p) => (
              <div key={p.id} className="bg-white rounded-xl border p-3 flex flex-col items-center shadow">
                <img src={p.image} alt={p.name} className="h-20 w-auto mb-2 rounded" />
                <div className="text-sm font-bold mb-1">{p.name}</div>
                <div className="text-xs text-neutral-700 mb-2">{p.points_required} pts</div>
                <button
                  disabled={current_points < p.points_required}
                  className={`px-3 py-1 rounded text-xs font-bold ${
                    current_points < p.points_required
                      ? "bg-neutral-300 text-neutral-500 cursor-not-allowed"
                      : "bg-primary-700 hover:bg-primary-900 text-white"
                  }`}
                  onClick={() => handleProductRedeem(p)}
                >Redeem</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Redeem modal for wallet */}
      {showRedeem && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
          <form
            className="bg-white rounded-2xl px-8 py-6 shadow-2xl border border-primary-600 min-w-[320px]"
            onSubmit={handleRedeem}
          >
            <div className="font-semibold mb-2 text-lg text-primary-800">Redeem Points for Wallet Credit</div>
            <input
              type="number"
              min={1}
              max={current_points}
              className="w-full border rounded px-3 py-2 mb-3 text-lg"
              placeholder="Enter points to redeem"
              value={redeemAmount}
              onChange={(e) => setRedeemAmount(Number(e.target.value))}
              required
            />
            <div className="flex items-center gap-2 mb-4">
              <span className="text-neutral-500 text-sm">Wallet: <b>৳{walletBalance ?? 0}</b></span>
              <span className="text-neutral-500 text-sm">Points: <b>{current_points}</b></span>
            </div>
            <div className="flex gap-4">
              <button
                type="submit"
                className="bg-primary-700 hover:bg-primary-900 text-white rounded-lg px-5 py-2 font-bold"
              >Redeem</button>
              <button
                type="button"
                className="bg-neutral-200 hover:bg-neutral-300 rounded-lg px-5 py-2"
                onClick={() => { setShowRedeem(false); setRedeemResult(""); setRedeemAmount(0); }}
              >Cancel</button>
            </div>
            {redeemResult && <div className="text-green-700 font-semibold mt-3">{redeemResult}</div>}
          </form>
        </div>
      )}

      {/* Result message */}
      {redeemResult && !showRedeem && (
        <div className="mt-4 text-center text-green-700 font-semibold">{redeemResult}</div>
      )}

      {/* Points history */}
      {Array.isArray(point_history) && point_history.length > 0 && (
        <div className="mt-8">
          <div className="font-semibold text-base text-primary-700 mb-1">Points Activity:</div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-neutral-100">
                  <th className="py-2 px-3 text-left">Date</th>
                  <th className="py-2 px-3 text-left">Activity</th>
                  <th className="py-2 px-3 text-right">Points</th>
                  <th className="py-2 px-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {point_history.map((row, idx) => (
                  <tr key={row.id || idx} className="border-b last:border-0">
                    <td className="py-1 px-3">{new Date(row.date).toLocaleDateString()}</td>
                    <td className="py-1 px-3">{row.activity}</td>
                    <td className={`py-1 px-3 text-right ${row.points > 0 ? "text-green-700" : "text-red-600"}`}>
                      {row.points > 0 ? "+" : ""}
                      {row.points}
                    </td>
                    <td className="py-1 px-3 text-right">{row.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Referral history table */}
      <div className="mt-8">
        <div className="font-semibold text-base text-primary-700 mb-2">Referral Status:</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-neutral-100">
                <th className="py-2 px-3 text-left">Friend</th>
                <th className="py-2 px-3 text-left">Status</th>
                <th className="py-2 px-3 text-right">Points</th>
                <th className="py-2 px-3 text-right">Date</th>
              </tr>
            </thead>
            <tbody>
              {referralHistory.map((row, idx) => (
                <tr key={row.id || idx} className="border-b last:border-0">
                  <td className="py-1 px-3">{row.friend_name || row.friend_email || row.friend_phone || "—"}</td>
                  <td className="py-1 px-3">
                    {row.isRedeemed
                      ? "Purchased"
                      : row.createdAt
                      ? "Registered"
                      : "Pending"}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {row.isRedeemed ? "500" : "0"}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {row.activatedAt
                      ? new Date(row.activatedAt).toLocaleDateString()
                      : row.createdAt
                      ? new Date(row.createdAt).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite friends link */}
      <div className="mt-6">
        <div className="text-base text-primary-800">Invite friends & earn 500 points each!</div>
        <input
          type="text"
          value={inviteLink}
          readOnly
          className="w-full border rounded px-2 py-1 mt-2 text-sm"
          onClick={(e) => e.target.select()}
        />
        <button
          className="mt-2 bg-primary-700 text-white px-3 py-1 rounded"
          onClick={() => { navigator.clipboard.writeText(inviteLink); alert("Copied!"); }}
        >Copy Link</button>
      </div>
    </div>
  );
}
