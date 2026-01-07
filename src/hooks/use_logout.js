// src/hooks/use_logout.js
'use client';

import { useRouter } from 'next/navigation';

export default function useLogout(redirectTo = '/') {
  const router = useRouter();
  return async function logout() {
    try {
      await fetch('/api/auth/signout', { method: 'POST', cache: 'no-store' });
      try {
        localStorage.removeItem('tdlc_token');
        localStorage.removeItem('tdlc_refresh');
        localStorage.removeItem('strapi_jwt');
        sessionStorage.removeItem('tdlc_token');
        localStorage.removeItem('me');
      } catch {}
      router.replace(redirectTo);
    } catch {
      // optionally toast error
    }
  };
}
