// src/components/ui/modal-provider.jsx
"use client";

import React, { createContext, useContext, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

const ModalRootContext = createContext(null);

export function useModalRoot() {
  return useContext(ModalRootContext);
}

/**
 * Provides a DOM node for portals: <div id="__modal-root" />
 * Not wired unless you use it. Safe to include.
 */
export default function ModalProvider({ children }) {
  const value = useMemo(() => {
    if (typeof document === "undefined") return null;
    let el = document.getElementById("__modal-root");
    if (!el) {
      el = document.createElement("div");
      el.id = "__modal-root";
      document.body.appendChild(el);
    }
    return el;
  }, []);

  useEffect(() => {
    return () => {
      // no cleanup: we keep modal root persistent
    };
  }, []);

  return (
    <ModalRootContext.Provider value={value}>
      {children}
      {/* ensure there is always a modal root present */}
      <div id="__modal-root" />
    </ModalRootContext.Provider>
  );
}

/**
 * Example usage:
 * const root = useModalRoot();
 * return root ? createPortal(<YourModal/>, root) : null;
 */
export function ModalPortal({ children }) {
  const root = useModalRoot();
  if (!root) return null;
  return createPortal(children, root);
}
