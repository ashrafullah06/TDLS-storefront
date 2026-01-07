"use client";
import { useEffect, useState } from "react";
import Image from "next/image";

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

// Utility: returns { summary, loading, error }
function useLoyaltySummary(userId) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    fetchWithAuth(`/api/loyalty/user-summary${q}`)
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
  }, [userId]);
  return { summary, loading, error, setSummary };
}

function useWallet(userId) {
  const [balance, setBalance] = useState(null);
  useEffect(() => {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    fetchWithAuth(`/api/wallet/balance${q}`)
      .then((r) => r.json())
      .then((j) => setBalance(j.balance || 0))
      .catch(() => setBalance(0));
  }, [userId]);
  return balance;
}

function useRewardProducts(userId) {
  const [products, setProducts] = useState([]);
  useEffect(() => {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    fetchWithAuth(`/api/loyalty/reward-products${q}`)
      .then((r) => r.json())
      .then((j) => setProducts(j.products || []))
      .catch(() => setProducts([]));
  }, [userId]);
  return products;
}

export default function LoyaltyProgressBar({ userId }) {
  // Main hooks (now actually use userId so it's not "unused")
  const { summary, loading, error, setSummary } = useLoyaltySummary(userId);
  const walletBalance = useWallet(userId);
  const rewardProducts = useRewardProducts(userId);

  // Redeem points modal logic
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState(0);
  const [redeemResult, setRedeemResult] = useState("");

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

  // Progress math (now also surface total_redeemed and user)
  const {
    current_points,
    points_to_next_tier,
    tier,
    next_tier,
    point_history,
    total_redeemed,
    user,
  } = summary;

  const percent = points_to_next_tier
    ? Math.min(100, (current_points / (current_points + points_to_next_tier)) * 100)
    : 100;

  // Redeem points for wallet
  async function handleRedeem(e) {
    e.preventDefault();
    setRedeemResult("");
    if (redeemAmount < 1) {
      setRedeemResult("Enter an amount to redeem.");
      return;
    }
    const res = await fetchWithAuth("/api/loyalty/redeem", {
      method: "POST",
      body: JSON.stringify({ amount: redeemAmount, userId }),
    });
    if (!res.ok) {
      setRedeemResult("Redemption failed.");
      return;
    }
    const data = await res.json();
    setRedeemResult(`Redeemed ${redeemAmount} points for ৳${data.wallet_credit}!`);
    // Update summary instantly
    setSummary((s) => ({
      ...s,
      current_points: s.current_points - redeemAmount,
      total_redeemed: (s.total_redeemed || 0) + redeemAmount,
    }));
    setShowRedeem(false);
    setRedeemAmount(0);
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-6 bg-gradient-to-br from-white via-neutral-50 to-neutral-100 rounded-2xl shadow-lg border border-neutral-200 mb-8">
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex-1">
          <div className="font-bold text-lg md:text-2xl text-primary-700 mb-1">
            Loyalty Status{user?.name ? ` — ${user.name}` : ""}
          </div>
          <div className="text-base text-neutral-600 mb-1">
            Tier: <b className="text-primary-800">{tier}</b>
            {next_tier && (
              <> → <span className="text-primary-700">{next_tier}</span> ({points_to_next_tier} points to next)</>
            )}
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-neutral-700">Current Points:</span>
            <span className="font-semibold text-lg text-green-700">{current_points}</span>
          </div>
          <div className="text-xs text-neutral-600 mb-2">
            Total Redeemed: <b>{total_redeemed ?? 0}</b> pts
          </div>
          <div className="flex items-center gap-3">
            <button
              className="bg-primary-700 hover:bg-primary-900 text-white rounded-lg px-4 py-2 text-sm font-bold transition shadow"
              onClick={() => setShowRedeem(true)}
            >
              Redeem Points
            </button>
            <span className="text-neutral-600 text-sm">
              Wallet: <b className="text-blue-700">৳{walletBalance ?? 0}</b>
            </span>
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
                <Image
                  src={p.image}
                  alt={p.name}
                  width={80}
                  height={80}
                  className="h-20 w-auto mb-2 rounded"
                  unoptimized
                />
                <div className="text-sm font-bold mb-1">{p.name}</div>
                <div className="text-xs text-neutral-700 mb-2">{p.points_required} pts</div>
                <button
                  disabled={current_points < p.points_required}
                  className={`px-3 py-1 rounded text-xs font-bold ${
                    current_points < p.points_required
                      ? "bg-neutral-300 text-neutral-500 cursor-not-allowed"
                      : "bg-primary-700 hover:bg-primary-900 text-white"
                  }`}
                  onClick={async () => {
                    setRedeemResult("");
                    const res = await fetchWithAuth("/api/loyalty/redeem", {
                      method: "POST",
                      body: JSON.stringify({ product_id: p.id, userId }),
                    });
                    if (res.ok) {
                      setRedeemResult(`Successfully redeemed for "${p.name}"!`);
                      setSummary((s) => ({
                        ...s,
                        current_points: s.current_points - p.points_required,
                        total_redeemed: (s.total_redeemed || 0) + p.points_required,
                      }));
                    } else {
                      setRedeemResult("Redemption failed.");
                    }
                  }}
                >
                  Redeem
                </button>
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
              <button type="submit" className="bg-primary-700 hover:bg-primary-900 text-white rounded-lg px-5 py-2 font-bold">
                Redeem
              </button>
              <button
                type="button"
                className="bg-neutral-200 hover:bg-neutral-300 rounded-lg px-5 py-2"
                onClick={() => { setShowRedeem(false); setRedeemResult(""); setRedeemAmount(0); }}
              >
                Cancel
              </button>
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
                      {row.points > 0 ? "+" : ""}{row.points}
                    </td>
                    <td className="py-1 px-3 text-right">{row.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
