import React, { useEffect, useState } from 'react';

export default function notificationpanel({ userId }) {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    async function fetchNotifications() {
      try {
        const res = await fetch(`/api/notification/${userId}`);
        if (!res.ok) throw new Error('Failed to fetch notifications');
        const data = await res.json();
        setNotifications(data);
      } catch (error) {
        console.error(error);
      }
    }
    fetchNotifications();
  }, [userId]);

  return (
    <div className="notification-panel">
      <h3>Notifications</h3>
      <ul>
        {notifications.map((notif) => (
          <li key={notif._id}>
            <strong>{notif.subject || 'Notification'}:</strong> {notif.content}
          </li>
        ))}
      </ul>
    </div>
  );
}
