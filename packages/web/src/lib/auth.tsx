import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { RegisterInput, SessionUser } from "@curvelo/shared";
import { api } from "./api";

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  /** True while the site admin is in a "View as" impersonated session. */
  impersonating: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (input: RegisterInput) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Switch to an impersonated session of the target user (admin only). */
  startImpersonation: (userId: string) => Promise<SessionUser>;
  /** Exit impersonation and restore the admin's own session. */
  exitImpersonation: () => Promise<SessionUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  // Server-driven: /auth/me reports whether the current session is a
  // "View as" impersonated session, so the banner survives reloads and can
  // never get stuck on after a fresh login.
  const [impersonating, setImpersonating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { user: me, impersonated } = await api.me();
      setUser(me);
      setImpersonating(impersonated === true);
    } catch {
      setUser(null);
      setImpersonating(false);
    }
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const { user: loggedIn } = await api.login({ email, password });
    setUser(loggedIn);
    setImpersonating(false);
    return loggedIn;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const { user: created } = await api.register(input);
    setUser(created);
    setImpersonating(false);
    return created;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setImpersonating(false);
      setUser(null);
    }
  }, []);

  const startImpersonation = useCallback(async (userId: string) => {
    const { user: target, impersonated } = await api.adminImpersonate(userId);
    setImpersonating(impersonated === true);
    setUser(target);
    return target;
  }, []);

  const exitImpersonation = useCallback(async () => {
    const { user: admin, impersonated } = await api.adminExitImpersonation();
    setImpersonating(impersonated === true);
    setUser(admin);
    return admin;
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      impersonating,
      login,
      register,
      logout,
      refresh,
      startImpersonation,
      exitImpersonation,
    }),
    [
      user,
      loading,
      impersonating,
      login,
      register,
      logout,
      refresh,
      startImpersonation,
      exitImpersonation,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
