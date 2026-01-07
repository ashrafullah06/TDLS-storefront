import React, { useEffect, useState } from 'react';

export default function rewarddashboard({ userId }) {
  const [points, setPoints] = useState(0);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    async function fetchRewards() {
      try {
        const res = await fetch(`/api/rewards?userId=${userId}`);
        if (!res.ok) throw new Error('Failed to fetch rewards');
        const data = await res.json();
        setPoints(data.reduce((sum, r) => sum + (r.redeemed ? 0 : r.points), 0));
        setHistory(data);
      } catch (error) {
        console.error(error);
      }
    }
    fetchRewards();
  }, [userId]);

  return (
    <div className="reward-dashboard">
      <h3>Your Reward Points: {points}</h3>
      <ul>
        {history.map((r) => (
          <li key={r._id}>
            {r.points} points for {r.earnedReason} - {r.redeemed ? 'Redeemed' : 'Available'}
          </li>
        ))}
      </ul>
    </div>
  );
}
