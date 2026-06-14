import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "ella_auth_session";
const SESSION_VERSION = 2;

const CaregiverContext = createContext({
  caregiverId: null,
  username: "",
  profile: null,
  isAuthenticated: false,
  login: () => false,
  logout: () => {},
  updateProfileSnapshot: () => {},
});

export function CaregiverProvider({ children }) {
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.version !== SESSION_VERSION) return null;
      if (!parsed?.caregiverId || !parsed?.username) return null;
      return parsed;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [session]);

  const value = useMemo(
    () => ({
      caregiverId: session?.caregiverId ?? null,
      username: session?.username ?? "",
      profile: session?.profile ?? null,
      isAuthenticated: Boolean(session?.caregiverId),
      login: (profile) => {
        if (!profile?.caregiverId || !profile?.username) return false;
        setSession({
          version: SESSION_VERSION,
          caregiverId: profile.caregiverId,
          username: profile.username,
          profile,
        });
        return true;
      },
      logout: () => {
        setSession(null);
      },
      updateProfileSnapshot: (profile) => {
        if (!profile?.caregiverId || !profile?.username) return;
        setSession((current) => {
          if (!current) return current;
          return {
            ...current,
            caregiverId: profile.caregiverId,
            username: profile.username,
            profile,
          };
        });
      },
    }),
    [session]
  );

  return <CaregiverContext.Provider value={value}>{children}</CaregiverContext.Provider>;
}

export function useCaregiver() {
  return useContext(CaregiverContext);
}
