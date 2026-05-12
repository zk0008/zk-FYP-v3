import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./useAuth";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8001";

export type Group = {
  id: string;        // string_id used in URLs, e.g. "group-a"
  numericId: number; // integer PK, kept for endpoints that need it
  name: string;
  unread_messages: number;
  unread_tags: number;
};

export function useGroups() {
  const { token, logout } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/my-groups`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        // Token expired or secret changed — clear stored credentials
        await logout();
        throw new Error("__401__");
      }
      if (!res.ok) throw new Error("Failed to load groups");
      const data: any[] = await res.json();

      // Pull unread counts for every group at once
      const enriched = await Promise.all(
        data.map(async (g) => {
          // backend /my-groups returns { id: string_id, name } — the "id" field IS the string_id
          const stringId: string = g.id;
          try {
            const unreadRes = await fetch(
              `${API_BASE}/groups/${stringId}/unread`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            const unread = unreadRes.ok
              ? await unreadRes.json()
              : { unread_messages: 0, unread_tags: 0 };
            return {
              id: stringId,
              numericId: 0, // not returned by /my-groups; unused in current code
              name: g.name,
              unread_messages: unread.unread_messages ?? 0,
              unread_tags: unread.unread_tags ?? 0,
            };
          } catch {
            // if unread fetch fails, show the group without a badge
            return {
              id: stringId,
              numericId: 0,
              name: g.name,
              unread_messages: 0,
              unread_tags: 0,
            };
          }
        })
      );
      setGroups(enriched);
    } catch (err: any) {
      setError(err.message ?? "Failed to load groups");
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  return { groups, isLoading, error, refresh: fetchGroups };
}
