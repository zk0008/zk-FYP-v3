import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

type User = {
  id: number;
  username: string;
  role: string;
};

type AuthContextValue = {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Pull exp out of a JWT without a library — just base64-decode the middle part
function jwtIsExpired(token: string): boolean {
  try {
    const segment = token.split(".")[1];
    // base64url uses - and _ instead of + and /
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));
    // exp is seconds since epoch
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true; // unparseable = treat as expired
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On launch, restore auth state from storage if the token is still valid
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync("jwt_token");
        if (stored && !jwtIsExpired(stored)) {
          const storedUser = await SecureStore.getItemAsync("user");
          setToken(stored);
          setUser(storedUser ? JSON.parse(storedUser) : null);
        } else if (stored) {
          // token exists but is expired — clean up
          await SecureStore.deleteItemAsync("jwt_token");
          await SecureStore.deleteItemAsync("user");
        }
      } catch {
        // storage read failed — start unauthenticated
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = async (username: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail ?? "Invalid username or password");
    }

    const { access_token } = await res.json();

    // Fetch the user object with the fresh token
    const meRes = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) throw new Error("Failed to load user info");
    const userData: User = await meRes.json();

    await SecureStore.setItemAsync("jwt_token", access_token);
    await SecureStore.setItemAsync("user", JSON.stringify(userData));

    setToken(access_token);
    setUser(userData);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync("jwt_token");
    await SecureStore.deleteItemAsync("user");
    setToken(null);
    setUser(null);
  };

  return React.createElement(
    AuthContext.Provider,
    { value: { token, user, isAuthenticated: token !== null, isLoading, login, logout } },
    children
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
