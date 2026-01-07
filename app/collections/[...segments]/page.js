// FILE: app/collections/[...segments]/page.jsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import Navbar from "@/components/common/navbar";
import CollectionsSegmentClient from "./collections-segment-client";

/**
 * Segment route for collections browsing.
 *
 * Examples:
 *  /collections/men
 *  /collections/men/panjabi
 *  /collections/kids/boys/6-10/panjabi
 *
 * Tier MUST remain a query param:
 *  /collections/men/panjabi?tier=limited-edition
 */

export default function CollectionsSegmentPage() {
  return (
    <>
      <Navbar />
      <CollectionsSegmentClient />
    </>
  );
}
