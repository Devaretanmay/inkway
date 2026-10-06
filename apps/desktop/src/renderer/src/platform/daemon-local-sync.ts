/** Start the CLI daemon with this installation's local backend capability. */
export interface DaemonLocalSyncAPI {
  setTargetApiUrl: (url: string) => Promise<void>;
  syncToken: (token: string) => Promise<void>;
  autoStart: () => Promise<unknown>;
}

export async function syncDaemonForLocalApp(
  api: DaemonLocalSyncAPI,
  apiUrl: string,
  token: string,
): Promise<void> {
  // Profile resolution must precede token persistence; otherwise the capability
  // could be written into the user's unrelated default CLI profile.
  await api.setTargetApiUrl(apiUrl);
  await api.syncToken(token);
  await api.autoStart();
}
