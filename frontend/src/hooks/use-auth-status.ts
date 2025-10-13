import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, type ApiUser } from "../lib/api";

type AuthState = "loading" | "authenticated" | "unauthenticated" | "error";

type AuthStatus = {
  status: AuthState;
  user: ApiUser | null;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useAuthStatus(): AuthStatus {
  const [status, setStatus] = useState<AuthState>("loading");
  const [user, setUser] = useState<ApiUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const initialFetchDone = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyState = useCallback(
    (nextStatus: AuthState, nextUser: ApiUser | null = null, message: string | null = null) => {
      if (!mounted.current) {
        return;
      }
      setStatus(nextStatus);
      setUser(nextUser);
      setError(message);
    },
    []
  );

  const fetchSession = useCallback(async () => {
    applyState("loading", user, null);
    try {
      const response = await api.me();
      applyState("authenticated", response.user, null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        applyState("unauthenticated", null, null);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to verify session";
      applyState("error", null, message);
    }
  }, [applyState, user]);

  useEffect(() => {
    if (initialFetchDone.current) {
      return;
    }
    initialFetchDone.current = true;
    void fetchSession();
  }, [fetchSession]);

  const refresh = useCallback(async () => {
    await fetchSession();
  }, [fetchSession]);

  return {
    status,
    user,
    error,
    refresh
  };
}
