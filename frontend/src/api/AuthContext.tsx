import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, ApiError } from "./client";

interface AuthState {
  username: string | null;
  mustChangePassword: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeFirstLogin: (username: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ username: string; mustChangePassword: boolean }>("/auth/me")
      .then((u) => {
        setUsername(u.username);
        setMustChangePassword(u.mustChangePassword);
      })
      .catch(() => setUsername(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(u: string, p: string) {
    const res = await api.post<{ username: string; mustChangePassword: boolean }>("/auth/login", {
      username: u,
      password: p,
    });
    setUsername(res.username);
    setMustChangePassword(res.mustChangePassword);
  }

  async function logout() {
    await api.post("/auth/logout");
    setUsername(null);
    setMustChangePassword(false);
  }

  function completeFirstLogin(newUsername: string) {
    setUsername(newUsername);
    setMustChangePassword(false);
  }

  return (
    <AuthContext.Provider value={{ username, mustChangePassword, loading, login, logout, completeFirstLogin }}>
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
