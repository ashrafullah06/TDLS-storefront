import React, { useState, useEffect } from 'react';

export default function UserProfileEdit({ userId }) {
  const [profile, setProfile] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch('/api/user/me');
        if (!res.ok) throw new Error('Failed to load profile');
        const data = await res.json();
        setProfile(data);
      } catch (error) {
        setMessage('Error loading profile');
      }
    }
    fetchProfile();
  }, [userId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/user/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
      if (!res.ok) throw new Error('Update failed');
      setMessage('Profile updated successfully');
    } catch (error) {
      setMessage('Error updating profile');
    }
  };

  if (!profile) return <p>Loading...</p>;

  return (
    <form onSubmit={handleSubmit} className="user-profile-edit-form">
      <label>Username:
        <input name="username" value={profile.username || ''} onChange={handleChange} disabled />
      </label>
      <label>Email:
        <input name="email" value={profile.email || ''} onChange={handleChange} required />
      </label>
      <label>Phone:
        <input name="phone" value={profile.phone || ''} onChange={handleChange} required />
      </label>
      <button type="submit">Update Profile</button>
      {message && <p>{message}</p>}
    </form>
  );
}
