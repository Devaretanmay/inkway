import { create } from "zustand";
import type { User, StorageAdapter } from "../types";
import { resetAnalytics } from "../analytics";
import type { ApiClient } from "../api/client";
import { setCurrentWorkspace } from "../platform/workspace-storage";

export interface AuthStoreOptions {
  api: ApiClient;
  storage: StorageAdapter;
  onLogout?: () => void;
  /**
   * Cleanup for a session the server ended, as opposed to one the user did.
   * Defaults to `onLogout` — a shell only needs its own handler when some of
   * its logout teardown is too destructive for an expiry it did not ask for.
   */
  onSessionExpired?: () => void;
  /** When true, rely on HttpOnly cookies instead of localStorage for auth tokens. */
  cookieAuth?: boolean;
}

export type AuthStatus =
  | "authenticating"
  | "authenticated"
  | "unauthenticated"
  | "recovering";

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  status: AuthStatus;
  retryGeneration: number;
  /**
   * The last transition to `unauthenticated` was the server rejecting our
   * credential, not the user asking to leave. Purely presentational — the
   * login page uses it to say why the session ended. Cleared by any
   * successful login and by an explicit logout.
   */
  expired: boolean;

  retryAuthentication: () => void;
  logout: () => void;
  sessionExpired: () => void;
  setUser: (user: User) => void;
  refreshMe: () => Promise<void>;
}

export function createAuthStore(options: AuthStoreOptions) {
  const { api, storage, onLogout, onSessionExpired, cookieAuth } =
    options;

  return create<AuthState>((set, get) => ({
    user: null,
    isLoading: true,
    status: "authenticating",
    retryGeneration: 0,
    expired: false,

    retryAuthentication: () => {
      set((state) => ({
        isLoading: true,
        status: "authenticating",
        retryGeneration: state.retryGeneration + 1,
      }));
    },

    logout: () => {
      storage.removeItem("inkway_token");
      api.setToken(null);
      setCurrentWorkspace(null, null);
      resetAnalytics();
      onLogout?.();
      set({
        user: null,
        isLoading: false,
        status: "unauthenticated",
        expired: false,
      });
    },

    /**
     * The server rejected our credential (401). Tears the session down to
     * exactly the state a cold boot with a dead token lands in, so the shell
     * unmounts and the app shows the login page instead of staying up while
     * every request fails with an auth error the user cannot act on
     * (MUL-7028).
     *
     * No server round-trip: the credential is already dead, and `/auth/logout`
     * would be one more request to answer a 401 with. Idempotent, because a
     * session dies once but a screen full of in-flight requests all learn
     * about it separately.
     */
    sessionExpired: () => {
      // "Expired" is a claim about the user's own history, so only make it
      // when this client really did present a credential the server then
      // rejected: a live session, or a stored token left by an earlier one.
      // A first visit to /login 401s on the identity probe too, and telling
      // that person their session expired would be a lie. Read before the
      // teardown below removes the evidence.
      const hadCredential =
        get().status === "authenticated" ||
        storage.getItem("inkway_token") !== null;

      // Dropping the rejected credential happens before the idempotence
      // guard, and unconditionally. A login attempt that 401s never leaves
      // `unauthenticated` — Desktop's deep link writes the token, calls
      // getMe, and gets rejected — so a guard placed first would return with
      // that invalid token still sitting in storage, to be replayed at the
      // next launch. Nothing below this point is safe to repeat; this is.
      storage.removeItem("inkway_token");
      api.setToken(null);

      // Past here we are ending a session, which happens once no matter how
      // many in-flight requests learn the credential is dead — and does not
      // happen at all when there was no session to end.
      if (get().status === "unauthenticated") return;

      // Cookie mode leaves the workspace singleton alone: there the URL owns
      // workspace identity and the login route overwrites it on the next
      // entry. Mirrors AuthInitializer's boot-time rejection.
      if (!cookieAuth) setCurrentWorkspace(null, null);
      resetAnalytics();
      (onSessionExpired ?? onLogout)?.();
      set({
        user: null,
        isLoading: false,
        status: "unauthenticated",
        expired: hadCredential,
      });
    },

    setUser: (user: User) => {
      set({ user, isLoading: false, status: "authenticated", expired: false });
    },

    refreshMe: async () => {
      const user = await api.getMe();
      set({ user, isLoading: false, status: "authenticated", expired: false });
    },
  }));
}
