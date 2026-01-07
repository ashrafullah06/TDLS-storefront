// /components/common/bottomfloatingbar.shell.jsx
"use client";
import dynamic from "next/dynamic";

const BottomFloatingBar = dynamic(() => import("./bottomfloatingbar.client"), {
  ssr: false,
});

export default function BottomFloatingBarShell(props) {
  return <BottomFloatingBar {...props} />;
}
