import { redirect } from "next/navigation";

/** Keep bookmarks and older shared links working after the FastPaths rename. */
export default async function LegacyFastPathsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(`/${workspaceSlug}/inks`);
}
