// FILE: src/components/admin/settings/rbac-panel.jsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

const NAVY = "#0F2147";
const BORDER = "#E5E7EB";

function toLabel(key = "") {
  // "view_analytics" → "View Analytics"
  return String(key)
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function RbacPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  // Editable matrix state
  const [matrix, setMatrix] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        setError("");
        setSaveMessage("");
        const res = await fetch("/api/admin/settings/rbac", {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(text || `Request failed with ${res.status}`);
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setMatrix(json.matrix || {});
          setDirty(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("RBAC settings load error", err);
          setError(err?.message || "Failed to load RBAC settings");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const roles = data?.roles || [];
  const permissions = data?.permissions || [];
  const isSuperadmin = Boolean(data?.isSuperadmin);
  // If API doesn’t send canEdit, fall back to superadmin
  const canEdit = data?.canEdit ?? isSuperadmin;

  const filteredPermissions = useMemo(() => {
    if (!permissions.length) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return permissions;
    return permissions.filter((p) => {
      const key = String(p.key || "").toLowerCase();
      const label = String(p.label || toLabel(p.key)).toLowerCase();
      return key.includes(q) || label.includes(q);
    });
  }, [permissions, filter]);

  function togglePerm(roleName, permKey) {
    if (!canEdit) return;
    if (!roleName || !permKey) return;

    // Superadmin is always "all permissions" in code; keep UI non-editable
    if (roleName.toLowerCase() === "superadmin") return;

    setMatrix((prev) => {
      const current = Array.isArray(prev[roleName]) ? prev[roleName] : [];
      const has = current.includes(permKey);
      const next = has
        ? current.filter((p) => p !== permKey)
        : [...current, permKey];
      return { ...prev, [roleName]: next };
    });
    setDirty(true);
    setSaveMessage("");
  }

  async function handleSave() {
    if (!canEdit || !dirty) return;

    setSaving(true);
    setError("");
    setSaveMessage("");

    try {
      const res = await fetch("/api/admin/settings/rbac", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matrix }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Save failed with ${res.status}`);
      }

      const json = await res.json();
      setData((prev) => ({
        ...(prev || {}),
        matrix: json.matrix || {},
        meta: json.meta || prev?.meta,
      }));
      setMatrix(json.matrix || {});
      setDirty(false);
      setSaveMessage("Changes saved. Permission checks now use this matrix.");
    } catch (err) {
      console.error("RBAC save error", err);
      setError(err?.message || "Failed to save RBAC changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!canEdit) return;

    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(
            "Reset all roles back to code defaults from lib/rbac.js?\nThis will override any custom changes."
          )
        : true;

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setSaveMessage("");

    try {
      const res = await fetch("/api/admin/settings/rbac", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToDefaults: true }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Reset failed with ${res.status}`);
      }

      const json = await res.json();
      setData((prev) => ({
        ...(prev || {}),
        matrix: json.matrix || {},
        meta: json.meta || prev?.meta,
      }));
      setMatrix(json.matrix || {});
      setDirty(false);
      setSaveMessage("Reset to code defaults from lib/rbac.js.");
    } catch (err) {
      console.error("RBAC reset error", err);
      setError(err?.message || "Failed to reset RBAC matrix");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400" />
        Loading RBAC matrix…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Error loading RBAC configuration: {error}
        </div>
        <p className="text-xs text-gray-500">
          Make sure the API route <code>/api/admin/settings/rbac</code> is
          reachable and the database is migrated with the{" "}
          <code>AppSetting</code> and <code>Role</code> tables.
        </p>
      </div>
    );
  }

  if (!roles.length || !permissions.length) {
    return (
      <div className="text-sm text-gray-500">
        No RBAC data found. Make sure roles are seeded (superadmin, admin,
        manager, finance, analyst, staff) and <code>lib/rbac.js</code> is
        present.
      </div>
    );
  }

  const totalPerms = permissions.length;
  const totalRoles = roles.length;

  return (
    <div className="space-y-6">
      {/* Top status bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1.5">
          {isSuperadmin ? (
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              You are signed in as{" "}
              <span className="font-semibold">superadmin</span>. Superadmin
              effectively has <span className="font-semibold">all permissions</span>{" "}
              regardless of the matrix; toggles here control other roles.
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs text-sky-800">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              You are viewing the RBAC matrix. Only admins with RBAC/Settings
              permissions can edit it.
            </div>
          )}

          <div className="text-xs text-gray-500">
            <span className="font-medium">Source:</span>{" "}
            {data?.meta?.source === "db"
              ? "Database override (AppSetting: rbac_matrix)"
              : "Code defaults (lib/rbac.js)"}
            {data?.meta?.updatedAt && (
              <>
                {" · "}
                <span className="font-medium">Last updated:</span>{" "}
                {new Date(data.meta.updatedAt).toLocaleString()}
              </>
            )}
            {data?.meta?.updatedBy && (
              <>
                {" · "}
                <span className="font-medium">Updated by:</span>{" "}
                {data.meta.updatedBy}
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden text-xs text-gray-500 sm:inline-flex sm:items-center sm:gap-2">
            <span className="inline-flex h-6 items-center rounded-full border border-gray-200 bg-gray-50 px-2">
              <span className="text-[11px]">
                {totalRoles} roles · {totalPerms} permissions
              </span>
            </span>
            {dirty && (
              <span className="inline-flex h-6 items-center rounded-full border border-amber-200 bg-amber-50 px-2 text-[11px] text-amber-700">
                Unsaved changes
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter permissions…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-8 w-40 rounded-full border border-gray-200 bg-gray-50 px-3 text-xs text-gray-700 placeholder:text-gray-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={handleReset}
              disabled={!canEdit || saving}
              className="inline-flex h-8 items-center rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canEdit || saving || !dirty}
              className="inline-flex h-8 items-center rounded-full border border-transparent bg-indigo-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>

      {/* Save / error messages */}
      {(saveMessage || error) && (
        <div className="space-y-2">
          {saveMessage && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {saveMessage}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Matrix table */}
      <div className="overflow-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-gray-50 px-4 py-2 text-left text-xs font-semibold text-gray-700"
              >
                Permission
              </th>
              {roles.map((role) => {
                const isSuper = String(role.name || "").toLowerCase() === "superadmin";
                return (
                  <th
                    key={role.id}
                    scope="col"
                    className="px-4 py-2 text-center text-xs font-semibold text-gray-700 capitalize"
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span>{role.name}</span>
                      {isSuper && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                          Always all
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-white">
            {filteredPermissions.map((perm) => (
              <tr key={perm.key} className="border-t border-gray-100">
                <td className="sticky left-0 z-0 bg-white px-4 py-2 align-top">
                  <div className="font-medium text-gray-900">
                    {perm.label || toLabel(perm.key)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    {perm.key}
                  </div>
                </td>
                {roles.map((role) => {
                  const roleName = role.name;
                  const isSuperRole =
                    String(roleName || "").toLowerCase() === "superadmin";
                  const granted = Array.isArray(matrix?.[roleName])
                    ? matrix[roleName].includes(perm.key)
                    : false;

                  const interactive = canEdit && !isSuperRole;
                  const baseClasses =
                    "inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold transition";

                  let cellClasses;
                  let symbol;
                  if (granted) {
                    cellClasses = `${baseClasses} border-emerald-200 bg-emerald-50 text-emerald-700 ${
                      interactive ? "hover:bg-emerald-100 cursor-pointer" : ""
                    }`;
                    symbol = "✓";
                  } else {
                    cellClasses = `${baseClasses} border-gray-200 bg-gray-50 text-gray-300 ${
                      interactive ? "hover:bg-gray-100 cursor-pointer" : ""
                    }`;
                    symbol = "—";
                  }

                  return (
                    <td
                      key={role.id}
                      className="px-4 py-2 text-center align-middle"
                    >
                      <button
                        type="button"
                        disabled={!interactive}
                        onClick={() => togglePerm(roleName, perm.key)}
                        className={
                          interactive
                            ? cellClasses
                            : `${cellClasses} cursor-not-allowed opacity-70`
                        }
                      >
                        {symbol}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500">
        Changes saved here are stored in the{" "}
        <code>AppSetting(&quot;rbac_matrix&quot;)</code> record and used by the admin
        permission checks (e.g. <code>requireAdmin()</code>).{" "}
        <span className="font-semibold">
          Superadmin always retains full access
        </span>{" "}
        even if the matrix is edited.
      </p>
    </div>
  );
}
