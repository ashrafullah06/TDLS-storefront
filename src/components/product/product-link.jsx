// FILE: src/components/product/product-link.jsx
"use client";

import Link from "next/link";
import React from "react";

/**
 * Simple wrapper over Next Link.
 * We don't intercept clicks here to avoid accidentally blocking navigation.
 */
export default function ProductLink({ href, children, ...rest }) {
  if (!href) return <>{children}</>;
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}
