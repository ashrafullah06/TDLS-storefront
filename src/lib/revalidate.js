import { revalidatePath, revalidateTag } from "next/cache";
export async function doRevalidate({ path, tag }) {
  if (tag) revalidateTag(tag);
  if (path) revalidatePath(path);
  return { ok: true };
}
