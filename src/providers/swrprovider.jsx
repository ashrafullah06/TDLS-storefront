// src/providers/swrprovider.jsx
"use client";

import { SWRConfig } from "swr";
import { safeSWRFetcher } from "@/lib/swrfetcher";

export default function SwrProvider({ children }) {
  return (
    <SWRConfig
      value={{
        fetcher: safeSWRFetcher,
        shouldRetryOnError: false,
        revalidateOnFocus: false,
        revalidateIfStale: true,
        dedupingInterval: 10_000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
