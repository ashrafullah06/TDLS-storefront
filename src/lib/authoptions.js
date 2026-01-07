// FILE: src/lib/auth-options.js
// Shim for legacy imports that expect "@/lib/auth-options".
// In v5, prefer using `auth()` from "@/lib/auth". This file exists
// only to satisfy older `getServerSession(authOptions)` call sites.
export const authOptions = {};
export default authOptions;
