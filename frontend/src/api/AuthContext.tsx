import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, ApiError } from "./client";

interface AuthState {
  username: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ username: string }>("/auth/me")
      .then((u) => setUsername(u.username))
      .catch(() => setUsername(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(u: string, p: string) {
    const res = await api.post<{ username: string }>("/auth/login", { username: u, password: p });
    setUsername(res.username);
  }

  async function logout() {
    await api.post("/auth/logout");
    setUsername(null);
  }

  return (
    <AuthContext.Provider value={{ username, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export { ApiError };
