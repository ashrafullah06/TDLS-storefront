// src/components/ui/drawer-provider.jsx
"use client";

import React, { createContext, useContext } from "react";

// Placeholder drawer bus. Not wired now; safe to keep for later.
const DrawerContext = createContext({
  open: () => {},
  close: () => {},
});

export function useDrawer() {
  return useContext(DrawerContext);
}

export default function DrawerProvider({ children }) {
  const api = {
    open: () => {},
    close: () => {},
  };
  return <DrawerContext.Provider value={api}>{children}</DrawerContext.Provider>;
}
