import React, { useState } from 'react';

export default function RewardRedemption({ userId }) {
  const [rewardId, setRewardId] = useState('');
  const [message, setMessage] = useState('');

  const handleChange = (e) => {
    setRewardId(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/rewards/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId })
      });
      if (!res.ok) throw new Error('Redemption failed');
      setMessage('Reward redeemed successfully.');
      setRewardId('');
    } catch (error) {
      setMessage('Error redeeming reward.');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="reward-redemption-form">
      <label>Reward ID:
        <input type="text" value={rewardId} onChange={handleChange} required />
      </label>
      <button type="submit">Redeem Reward</button>
      {message && <p>{message}</p>}
    </form>
  );
}
