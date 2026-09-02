import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, ApiError, Role } from "./client";

interface AuthState {
  username: string | null;
  role: Role | null;
  mustChangePassword: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<{ mfaRequired: boolean }>;
  viewerLogin: (username: string, password: string) => Promise<void>;
  verifyMfa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  completeFirstLogin: (username: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ username: string; role: Role; mustChangePassword: boolean }>("/auth/me")
      .then((u) => {
        setUsername(u.username);
        setRole(u.role);
        setMustChangePassword(u.mustChangePassword);
      })
      .catch(() => setUsername(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(u: string, p: string) {
    const res = await api.post<{ mfaRequired?: boolean; username?: string; mustChangePassword?: boolean }>(
      "/auth/login",
      { username: u, password: p }
    );
    if (res.mfaRequired) return { mfaRequired: true };
    setUsername(res.username!);
    setRole("admin");
    setMustChangePassword(res.mustChangePassword!);
    return { mfaRequired: false };
  }

  async function viewerLogin(u: string, p: string) {
    const res = await api.post<{ username: string }>("/auth/viewer-login", { username: u, password: p });
    setUsername(res.username);
    setRole("viewer");
    setMustChangePassword(false);
  }

  async function verifyMfa(code: string) {
    const res = await api.post<{ username: string; mustChangePassword: boolean }>("/auth/mfa/login", { code });
    setUsername(res.username);
    setRole("admin");
    setMustChangePassword(res.mustChangePassword);
  }

  async function logout() {
    await api.post("/auth/logout");
    setUsername(null);
    setRole(null);
    setMustChangePassword(false);
  }

  function completeFirstLogin(newUsername: string) {
    setUsername(newUsername);
    setRole("admin");
    setMustChangePassword(false);
  }

  return (
    <AuthContext.Provider
      value={{ username, role, mustChangePassword, loading, login, viewerLogin, verifyMfa, logout, completeFirstLogin }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
