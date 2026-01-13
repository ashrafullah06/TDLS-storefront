// FILE: src/components/common/bottomfloatingbar.client.jsx
"use client";

/**
 * TDLS Bottom Floating Bar (client entry).
 * Data “catcher” happens in BottomFloatingBarShell via /api/bfbar + localStorage,
 * then is injected here via props (`initialData`).
 */

import BottomFloatingBar from "./bottomfloatingbar";

export default function BottomFloatingBarClient(props) {
  return <BottomFloatingBar {...props} />;
}
