// FILE: app/(admin)/admin/users/page.jsx
"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/* ───────────────────────── helpers ───────────────────────── */

function formatDateTime(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-BD", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function normalizeRoleName(name) {
  return String(name || "").trim().toLowerCase();
}

/**
 * Extract role names from a user record.
 * Accepts:
 *  - user.roles as array of strings
 *  - user.roles as array of { name }
 *  - user.roles as array of { role: { name } }
 */
function extractRoleNames(user) {
  const roles = user?.roles;
  if (!Array.isArray(roles)) return [];

  const out = [];
  for (const r of roles) {
    if (typeof r === "string") {
      out.push(normalizeRoleName(r));
      continue;
    }
    if (r?.role?.name) {
      out.push(normalizeRoleName(r.role.name));
      continue;
    }
    if (r?.name) {
      out.push(normalizeRoleName(r.name));
      continue;
    }
  }
  return Array.from(new Set(out));
}

function cn(...parts) {
  return parts.filter(Boolean).join(" ");
}

/* ───────────────────────── constants ───────────────────────── */

const DEFAULT_PAGE_SIZE = 20;

// These should correspond to entries in your Role table and src/lib/rbac.js
const KNOWN_ROLES = [
  "superadmin",
  "admin",
  "manager",
  "finance",
  "analyst",
  "staff",
  "support",
  "operations",
  "warehouse",
  "inventory_manager",
  "marketing",
  "content_manager",
  "dispatcher",
  "auditor",
  "readonly",
];

const ROLE_LABELS = {
  superadmin: "Superadmin",
  admin: "Admin",
  manager: "Manager",
  finance: "Finance",
  analyst: "Analyst",
  staff: "Staff",
  support: "Support",
  operations: "Operations",
  warehouse: "Warehouse",
  inventory_manager: "Inventory Manager",
  marketing: "Marketing",
  content_manager: "Content Manager",
  dispatcher: "Dispatcher",
  auditor: "Auditor",
  readonly: "Read-only",
};

const LOGIN_PREF_OPTIONS = [
  { value: "OTP", label: "OTP only" },
  { value: "PASSWORD", label: "Password only" },
  { value: "TWO_FA", label: "Password + OTP (2FA)" },
];

const LOGIN_PREF_LABELS = LOGIN_PREF_OPTIONS.reduce((acc, opt) => {
  acc[opt.value] = opt.label;
  return acc;
}, {});

/* ───────────────────────── main component ───────────────────────── */

export default function AdminUsersPage() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const [users, setUsers] = useState([]);
  const [allRoles, setAllRoles] = useState(KNOWN_ROLES);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState(null);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createSuccess, setCreateSuccess] = useState(null);

  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);
  const [editSuccess, setEditSuccess] = useState(null);

  const [forceReloadToken, setForceReloadToken] = useState(0);

  /* ───────── session / permissions ───────── */

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      setLoadingSession(true);
      try {
        const res = await fetch("/api/admin/session", {
          method: "GET",
          credentials: "include",
        });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        setSession(data || null);
      } catch {
        if (cancelled) return;
        setSession(null);
      } finally {
        if (!cancelled) setLoadingSession(false);
      }
    }
    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  // Align with RBAC convention (permissions are uppercase, e.g. "MANAGE_USERS")
  const permissions = useMemo(() => {
    const raw = Array.isArray(session?.permissions)
      ? session.permissions
      : [];
    return new Set(raw.map((p) => String(p).toUpperCase()));
  }, [session]);

  const canManageUsers = permissions.has("MANAGE_USERS");

  /* ───────── debounce search query ───────── */

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  /* ───────── load users ───────── */

  const loadUsers = useCallback(
    async () => {
      if (!canManageUsers) return;
      setLoadingUsers(true);
      setUsersError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        if (debouncedQuery) params.set("q", debouncedQuery);

        const res = await fetch(`/api/admin/users?${params.toString()}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        if (res.status === 403) {
          setUsers([]);
          setTotal(0);
          setPageCount(1);
          setUsersError("FORBIDDEN");
          return;
        }

        const body = await res.json().catch(() => null);

        if (!body) {
          setUsersError("Unexpected empty response from server.");
          return;
        }

        // Flexible handling: either { ok, data: { users, pagination } } or plain array
        if (Array.isArray(body)) {
          setUsers(body);
          setTotal(body.length);
          setPageCount(1);
        } else if (body.ok === false) {
          setUsersError(body.error || "Failed to load users.");
          const usersArr =
            body.data?.users || body.users || body.items || body.results || [];
          setUsers(usersArr);
          const p = body.data?.pagination || body.pagination || {};
          setTotal(p.total || usersArr.length || 0);
          setPageCount(p.pageCount || 1);
        } else {
          const usersArr =
            body.data?.users || body.users || body.items || body.results || [];
          setUsers(usersArr);

          const pagination = body.data?.pagination || body.pagination || {};
          const totalFromApi =
            typeof pagination.total === "number"
              ? pagination.total
              : typeof body.total === "number"
              ? body.total
              : usersArr.length || 0;
          const pageCountFromApi =
            typeof pagination.pageCount === "number"
              ? pagination.pageCount
              : Math.max(
                  1,
                  Math.ceil((totalFromApi || usersArr.length || 0) / pageSize)
                );

          setTotal(totalFromApi);
          setPageCount(pageCountFromApi);

          // Infer all roles from current users if backend didn't send a list
          const observedRoles = new Set(
            Array.isArray(allRoles) ? allRoles.map(normalizeRoleName) : []
          );
          const sourceUsers =
            (Array.isArray(usersArr) && usersArr.length ? usersArr : []) || [];
          for (const u of sourceUsers) {
            for (const r of extractRoleNames(u)) observedRoles.add(r);
          }

          // If backend sent a canonical role list, merge it in
          const backendRoles = body.data?.roles || body.roles;
          if (Array.isArray(backendRoles)) {
            for (const r of backendRoles) {
              if (typeof r === "string") {
                observedRoles.add(normalizeRoleName(r));
              } else if (r?.name) {
                observedRoles.add(normalizeRoleName(r.name));
              }
            }
          }

          const nextRoles = Array.from(observedRoles);
          // Only update if actually changed → avoid infinite re-fetch loops
          setAllRoles((prev) => {
            if (
              Array.isArray(prev) &&
              prev.length === nextRoles.length &&
              prev.every((r) => nextRoles.includes(r))
            ) {
              return prev;
            }
            return nextRoles;
          });
        }
      } catch (err) {
        setUsersError(
          err?.message || "Failed to load users due to a network error."
        );
      } finally {
        setLoadingUsers(false);
      }
    },
    [
      canManageUsers,
      page,
      pageSize,
      debouncedQuery,
      forceReloadToken,
      allRoles,
    ]
  ); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!canManageUsers) return;
    loadUsers();
  }, [canManageUsers, loadUsers]);

  const refreshUsers = useCallback(() => {
    setForceReloadToken((x) => x + 1);
  }, []);

  /* ───────── create user ───────── */

  const [createForm, setCreateForm] = useState({
    name: "",
    email: "",
    phone: "",
    roles: ["staff"],
    isActive: true,
    // default new staff/admin accounts to 2FA (Password + OTP)
    loginPreference: "TWO_FA",
    tempPassword: "",
  });

  function handleCreateChange(field, value) {
    setCreateForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleCreateRoleToggle(roleName) {
    const r = normalizeRoleName(roleName);
    setCreateForm((prev) => {
      const exists = prev.roles.includes(r);
      if (exists) {
        return { ...prev, roles: prev.roles.filter((x) => x !== r) };
      }
      return { ...prev, roles: [...prev.roles, r] };
    });
  }

  async function handleCreateSubmit(e) {
    e.preventDefault();
    if (!canManageUsers) return;

    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);
    try {
      const lp = LOGIN_PREF_OPTIONS.some(
        (opt) => opt.value === createForm.loginPreference
      )
        ? createForm.loginPreference
        : "OTP";

      const payload = {
        name: createForm.name?.trim() || null,
        email: createForm.email?.trim() || null,
        phone: createForm.phone?.trim() || null,
        roles: createForm.roles.map(normalizeRoleName),
        isActive: !!createForm.isActive,
        loginPreference: lp,
        tempPassword: createForm.tempPassword?.trim() || undefined,
      };

      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok || body?.ok === false) {
        setCreateError(
          body?.error ||
            body?.message ||
            `Failed to create user (HTTP ${res.status}).`
        );
        return;
      }

      setCreateSuccess("User created successfully.");
      // Reset form (except maybe default role)
      setCreateForm({
        name: "",
        email: "",
        phone: "",
        roles: ["staff"],
        isActive: true,
        loginPreference: "TWO_FA",
        tempPassword: "",
      });
      refreshUsers();
    } catch (err) {
      setCreateError(
        err?.message || "Failed to create user due to a network error."
      );
    } finally {
      setCreating(false);
    }
  }

  /* ───────── edit user ───────── */

  function openEdit(user) {
    if (!user) return;
    setEditingId(user.id);
    setEditError(null);
    setEditSuccess(null);

    const roleNames = extractRoleNames(user);

    const rawLoginPref = (
      user.loginPreference ||
      user.login_preference ||
      "OTP"
    )
      .toString()
      .toUpperCase();

    const loginPreference = LOGIN_PREF_OPTIONS.some(
      (opt) => opt.value === rawLoginPref
    )
      ? rawLoginPref
      : "OTP";

    setEditDraft({
      id: user.id,
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
      roles: roleNames.length ? roleNames : ["staff"],
      isActive: user.isActive !== false,
      // stored login preference
      loginPreference,
      requireRbacReauth: false,
    });
  }

  function closeEdit() {
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
    setEditSuccess(null);
  }

  function handleEditChange(field, value) {
    setEditDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  }

  function handleEditRoleToggle(roleName) {
    const r = normalizeRoleName(roleName);
    setEditDraft((prev) => {
      if (!prev) return prev;
      const exists = prev.roles.includes(r);
      if (exists) {
        return { ...prev, roles: prev.roles.filter((x) => x !== r) };
      }
      return { ...prev, roles: [...prev.roles, r] };
    });
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!canManageUsers || !editDraft?.id) return;

    setSavingEdit(true);
    setEditError(null);
    setEditSuccess(null);
    try {
      const lp = LOGIN_PREF_OPTIONS.some(
        (opt) => opt.value === editDraft.loginPreference
      )
        ? editDraft.loginPreference
        : "OTP";

      const payload = {
        id: editDraft.id,
        name: editDraft.name?.trim() || null,
        email: editDraft.email?.trim() || null,
        phone: editDraft.phone?.trim() || null,
        roles: editDraft.roles.map(normalizeRoleName),
        isActive: !!editDraft.isActive,
        loginPreference: lp,
        requireRbacReauth: !!editDraft.requireRbacReauth,
      };

      // IMPORTANT: matches backend PATCH /api/admin/users (body.id)
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok || body?.ok === false) {
        setEditError(
          body?.error ||
            body?.message ||
            `Failed to update user (HTTP ${res.status}).`
        );
        return;
      }

      setEditSuccess("User updated successfully.");
      refreshUsers();
    } catch (err) {
      setEditError(
        err?.message || "Failed to update user due to a network error."
      );
    } finally {
      setSavingEdit(false);
    }
  }

  /* ───────── derived ───────── */

  const isLoadingInitial = loadingSession || (canManageUsers && loadingUsers);

  const currentPageLabel = useMemo(() => {
    if (!total) return `Page ${page} of ${pageCount}`;
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    return `${from}–${to} of ${total}`;
  }, [page, pageSize, total, pageCount]);

  /* ───────────────────────── render ───────────────────────── */

  if (loadingSession) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">Loading admin session…</div>
      </div>
    );
  }

  if (!session || !canManageUsers) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold mb-2">User Management</h1>
        <p className="text-sm text-red-600">
          You do not have permission to manage users (MANAGE_USERS).
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            User Management
          </h1>
          <p className="text-sm text-gray-600">
            View and manage staff / admin accounts for the TDLC backoffice.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowCreate((v) => !v);
            setCreateError(null);
            setCreateSuccess(null);
          }}
          className="inline-flex items-center rounded-md border border-transparent bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
        >
          {showCreate ? "Close" : "Create User"}
        </button>
      </div>

      {/* Search + pagination */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex-1 max-w-md">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Search
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or phone…"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="flex items-center justify-between gap-3 md:justify-end">
          <div className="text-xs text-gray-500">{currentPageLabel}</div>
          <div className="inline-flex rounded-md border border-gray-300 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoadingInitial}
              className={cn(
                "px-2 py-1 text-xs border-r border-gray-200",
                page <= 1 || isLoadingInitial
                  ? "text-gray-300 cursor-not-allowed"
                  : "text-gray-700 hover:bg-gray-50"
              )}
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((p) => (p >= pageCount ? p : p + 1))
              }
              disabled={page >= pageCount || isLoadingInitial}
              className={cn(
                "px-2 py-1 text-xs",
                page >= pageCount || isLoadingInitial
                  ? "text-gray-300 cursor-not-allowed"
                  : "text-gray-700 hover:bg-gray-50"
              )}
            >
              Next
            </button>
          </div>
          <button
            type="button"
            onClick={refreshUsers}
            disabled={isLoadingInitial}
            className={cn(
              "px-2 py-1 text-xs rounded-md border border-gray-300 bg-white shadow-sm hover:bg-gray-50",
              isLoadingInitial && "opacity-60 cursor-not-allowed"
            )}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Create user panel */}
      {showCreate && (
        <form
          onSubmit={handleCreateSubmit}
          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              Create New User
            </h2>
            {creating && (
              <span className="text-xs text-gray-500">Saving…</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Name
              </label>
              <input
                type="text"
                value={createForm.name}
                onChange={(e) => handleCreateChange("name", e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Email
              </label>
              <input
                type="email"
                value={createForm.email}
                onChange={(e) => handleCreateChange("email", e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={createForm.phone}
                onChange={(e) => handleCreateChange("phone", e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <span className="block text-xs font-medium text-gray-500 mb-1">
                Roles
              </span>
              <div className="flex flex-wrap gap-2">
                {allRoles.map((r) => {
                  const label = ROLE_LABELS[r] || r;
                  const selected = createForm.roles.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleCreateRoleToggle(r)}
                      className={cn(
                        "px-2 py-1 rounded-full text-xs border",
                        selected
                          ? "bg-indigo-50 border-indigo-500 text-indigo-700"
                          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Login Preference
                </label>
                <select
                  value={createForm.loginPreference}
                  onChange={(e) =>
                    handleCreateChange("loginPreference", e.target.value)
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {LOGIN_PREF_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={createForm.isActive}
                  onChange={(e) =>
                    handleCreateChange("isActive", e.target.checked)
                  }
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Active
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Temporary Password (optional)
              </label>
              <input
                type="text"
                value={createForm.tempPassword}
                onChange={(e) =>
                  handleCreateChange("tempPassword", e.target.value)
                }
                placeholder="Leave blank for OTP-only onboarding"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {(createError || createSuccess) && (
            <div
              className={cn(
                "text-xs rounded-md px-3 py-2",
                createError
                  ? "bg-red-50 text-red-700"
                  : "bg-emerald-50 text-emerald-700"
              )}
            >
              {createError || createSuccess}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setCreateError(null);
                setCreateSuccess(null);
              }}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className={cn(
                "inline-flex items-center rounded-md border border-transparent bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1",
                creating && "opacity-70 cursor-not-allowed"
              )}
            >
              {creating ? "Creating…" : "Create User"}
            </button>
          </div>
        </form>
      )}

      {/* Errors for user list */}
      {usersError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {usersError}
        </div>
      )}

      {/* Users table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Name</th>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Phone</th>
              <th className="px-3 py-2 text-left font-medium">Roles</th>
              <th className="px-3 py-2 text-left font-medium">
                Login Pref
              </th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">
                Last Login
              </th>
              <th className="px-3 py-2 text-left font-medium">
                Last Admin 2FA
              </th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoadingInitial && users.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-6 text-center text-xs text-gray-500"
                >
                  Loading users…
                </td>
              </tr>
            )}

            {!isLoadingInitial && users.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-6 text-center text-xs text-gray-500"
                >
                  No users found.
                </td>
              </tr>
            )}

            {users.map((user) => {
              const roleNames = extractRoleNames(user);
              const status =
                user.status ||
                (user.isActive === false ? "Disabled" : "Active");

              const lastLogin =
                user.lastLoginAt ||
                user.last_login_at ||
                user.lastLogin ||
                null;

              const lastAdmin2FA =
                user.lastRbacLoginAt ||
                user.last_rbac_login_at ||
                user.lastAdmin2FA ||
                null;

              const rawLoginPref = (
                user.loginPreference ||
                user.login_preference ||
                "OTP"
              )
                .toString()
                .toUpperCase();

              const loginPrefLabel =
                LOGIN_PREF_LABELS[rawLoginPref] || rawLoginPref || "—";

              const isEditing = editingId === user.id;

              return (
                <tr key={user.id}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-gray-900">
                      {user.name || "—"}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      ID: {user.id}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-gray-800">
                    {user.email || "—"}
                  </td>
                  <td className="px-3 py-2 align-top text-gray-800">
                    {user.phone || "—"}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1">
                      {roleNames.length === 0 && (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                          (none)
                        </span>
                      )}
                      {roleNames.map((r) => (
                        <span
                          key={r}
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px]",
                            r === "superadmin"
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : r === "admin"
                              ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                              : "bg-gray-100 text-gray-700 border border-gray-200"
                          )}
                        >
                          {ROLE_LABELS[r] || r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-700">
                    {loginPrefLabel}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px]",
                        status === "Active"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : status === "Disabled"
                          ? "bg-gray-100 text-gray-600 border border-gray-200"
                          : "bg-yellow-50 text-yellow-800 border border-yellow-200"
                      )}
                    >
                      {status}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-700">
                    {formatDateTime(lastLogin)}
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-gray-700">
                    {formatDateTime(lastAdmin2FA)}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (isEditing) {
                          closeEdit();
                        } else {
                          openEdit(user);
                        }
                      }}
                      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                    >
                      {isEditing ? "Close" : "Edit"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit drawer (simple inline card) */}
      {editingId && editDraft && (
        <form
          onSubmit={handleEditSubmit}
          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Edit User
              </h2>
              <p className="text-xs text-gray-500">
                Update roles, status, and security preferences.
              </p>
            </div>
            {savingEdit && (
              <span className="text-xs text-gray-500">Saving…</span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Name
              </label>
              <input
                type="text"
                value={editDraft.name}
                onChange={(e) =>
                  handleEditChange("name", e.target.value)
                }
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Email
              </label>
              <input
                type="email"
                value={editDraft.email}
                onChange={(e) =>
                  handleEditChange("email", e.target.value)
                }
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={editDraft.phone}
                onChange={(e) =>
                  handleEditChange("phone", e.target.value)
                }
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <span className="block text-xs font-medium text-gray-500 mb-1">
                Roles
              </span>
              <div className="flex flex-wrap gap-2">
                {allRoles.map((r) => {
                  const label = ROLE_LABELS[r] || r;
                  const selected = editDraft.roles.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleEditRoleToggle(r)}
                      className={cn(
                        "px-2 py-1 rounded-full text-xs border",
                        selected
                          ? "bg-indigo-50 border-indigo-500 text-indigo-700"
                          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Login Preference
                </label>
                <select
                  value={editDraft.loginPreference}
                  onChange={(e) =>
                    handleEditChange("loginPreference", e.target.value)
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {LOGIN_PREF_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={editDraft.isActive}
                  onChange={(e) =>
                    handleEditChange("isActive", e.target.checked)
                  }
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Active
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={editDraft.requireRbacReauth}
                  onChange={(e) =>
                    handleEditChange(
                      "requireRbacReauth",
                      e.target.checked
                    )
                  }
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Require admin OTP on next /admin login
              </label>
              <p className="mt-1 text-[11px] text-gray-500">
                Backend can map this to{" "}
                <code className="font-mono">rbac_login</code> /
                <code className="font-mono">rbac_sensitive_action</code>{" "}
                in your OTP system.
              </p>
            </div>
          </div>

          {(editError || editSuccess) && (
            <div
              className={cn(
                "text-xs rounded-md px-3 py-2",
                editError
                  ? "bg-red-50 text-red-700"
                  : "bg-emerald-50 text-emerald-700"
              )}
            >
              {editError || editSuccess}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeEdit}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingEdit}
              className={cn(
                "inline-flex items-center rounded-md border border-transparent bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1",
                savingEdit && "opacity-70 cursor-not-allowed"
              )}
            >
              {savingEdit ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
