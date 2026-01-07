// src/components/common/auth_popup.js
"use client";

import React from "react";

export default function AuthPopup({ onClose, onSignIn }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white max-w-sm w-full rounded-xl p-5 grid gap-3">
        <h3 className="text-lg font-semibold">Sign up or Log in to Continue</h3>
        {/* Hook this to your real OAuth flows (next-auth etc.) */}
        <button className="border rounded py-2" onClick={() => onSignIn?.("google")}>
          Sign in with Google
        </button>
        <button className="border rounded py-2" onClick={() => onSignIn?.("facebook")}>
          Sign in with Facebook
        </button>
        <button className="border rounded py-2" onClick={() => onSignIn?.("email")}>
          Sign up with Email
        </button>
        <button className="border rounded py-2" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
