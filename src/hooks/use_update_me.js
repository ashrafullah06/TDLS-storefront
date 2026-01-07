// src/hooks/use_update_me.js
import { useState, useCallback } from 'react';

export function useUpdateMe() {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [data, setData]       = useState(null);

  const updateMe = useCallback(async (fields) => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch('/api/account/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.message || json?.error || 'update_failed');
        setLoading(false);
        return null;
      }
      setData(json);
      setLoading(false);
      return json;
    } catch {
      setError('network_error');
      setLoading(false);
      return null;
    }
  }, []);

  return { updateMe, loading, error, data };
}
