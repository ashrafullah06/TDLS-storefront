// /components/common/bottomfloatingbar.client.jsx
"use client";

/**
 * Client entry remains a thin wrapper.
 * The “catcher” payload is fetched/cached in bottomfloatingbar.shell.jsx (server),
 * then injected here via props (`initialData`) into BottomFloatingBar.
 */
import BottomFloatingBar from "./bottomfloatingbar";

export default function BottomFloatingBarClient(props) {
  return <BottomFloatingBar {...props} />;
}
