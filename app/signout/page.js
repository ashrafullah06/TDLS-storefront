// FILE: app/signout/page.js
'use client';

import SignoutButton from '@/components/auth/signout_button';

export default function SignoutPage() {
  return (
    <main className="min-h-[70vh] flex items-center justify-center px-6 pt-12">
      <div className="w-full max-w-md rounded-3xl border border-neutral-200 p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 text-center">
          Sign out of TDLC
        </h1>
        <p className="mt-3 text-center text-neutral-600">
          You’re being signed out securely. If nothing happens, use the button below.
        </p>
        <div className="mt-6 flex justify-center">
          <SignoutButton label="Sign out now" redirectTo="/" auto />
        </div>
        <p className="mt-6 text-xs text-neutral-500 text-center">
          This clears your NextAuth session cookie and any local cached profile tokens (including Strapi JWT).
        </p>
      </div>
    </main>
  );
}
