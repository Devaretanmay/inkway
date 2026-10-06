import { toast } from "sonner";
import type { DaemonTranslator } from "../components/daemon-i18n";

/**
 * Re-establish the local daemon's loopback capability after its local credential
 * probe fails. There is no account session or remote credential exchange.
 */
export async function reauthenticateDaemon(
  t: DaemonTranslator,
): Promise<void> {
  const token = localStorage.getItem("inkway_token");
  if (!token) {
    toast.error(t(($) => $.desktop.daemon.reconnect_failed));
    return;
  }

  try {
    const result = await window.daemonAPI.reauthenticate(token);
    if (result.ok) return; // daemon restarting; status flips via onStatusChange
    toast.error(t(($) => $.desktop.daemon.reconnect_failed), {
      description:
        result.message || t(($) => $.desktop.daemon.try_again_moment),
    });
  } catch (err) {
    // An unexpected IPC error is not an auth failure — never log out on it.
    toast.error(t(($) => $.desktop.daemon.reconnect_failed), {
      description:
        err instanceof Error
          ? err.message
          : t(($) => $.desktop.daemon.try_again),
    });
  }
}
