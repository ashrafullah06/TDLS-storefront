"use client";
import React, { createContext, useContext, useEffect, useState } from "react";

// Adjust this to your API base
const API_BASE = process.env.NEXT_PUBLIC_STRAPI_API_URL?.replace(/\/$/, "") || "http://localhost:1337";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [jwt, setJwt] = useState(null);
  const [loading, setLoading] = useState(true);

  // Try load user from token on mount
  useEffect(() => {
    const storedJwt = typeof window !== "undefined" ? localStorage.getItem("jwt") : null;
    if (storedJwt) {
      setJwt(storedJwt);
      fetchUser(storedJwt);
    } else {
      setLoading(false);
    }
  }, []);

  async function fetchUser(token) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch user");
      const data = await res.json();
      setUser(data);
    } catch (e) {
      console.error("Auth fetchUser error:", e);
      setUser(null);
      setJwt(null);
      if (typeof window !== "undefined") localStorage.removeItem("jwt");
    }
    setLoading(false);
  }

  // Login with Strapi's /api/auth/local
  async function login(identifier, password) {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/local`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json();
      if (data.jwt) {
        setJwt(data.jwt);
        if (typeof window !== "undefined") localStorage.setItem("jwt", data.jwt);
        await fetchUser(data.jwt);
        setLoading(false);
        return { success: true };
      } else {
        setLoading(false);
        return { error: data.error?.message || "Login failed" };
      }
    } catch (e) {
      console.error("Auth login error:", e);
      setLoading(false);
      return { error: "Network error" };
    }
  }

  // Logout (clear everything)
  function logout() {
    setUser(null);
    setJwt(null);
    if (typeof window !== "undefined") localStorage.removeItem("jwt");
  }

  // Refresh user on demand
  async function refresh() {
    if (jwt) await fetchUser(jwt);
  }

  return (
    <AuthContext.Provider value={{ user, jwt, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook to use everywhere
export function useUser() {
  return useContext(AuthContext);
}
