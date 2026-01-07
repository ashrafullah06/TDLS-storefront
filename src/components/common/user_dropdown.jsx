// FILE: src/components/common/user_dropdown.jsx
"use client";
import AccountMenu from "./account_menu";

/** Mobile wrapper around AccountMenu (same real DB data + robust signout). */
export default function UserDropdown() {
  return (
    <div className="md:hidden">
      <AccountMenu />
    </div>
  );
}
