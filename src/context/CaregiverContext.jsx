import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "ella_auth_session";

const CaregiverContext = createContext({
  caregiverId: null,
  username: "",
  isAuthenticated: false,
  login: () => false,
  logout: () => {},
});

export function CaregiverProvider({ children }) {
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
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
      isAuthenticated: Boolean(session?.caregiverId),
      login: (account) => {
        if (!account?.caregiverId || !account?.username) return false;
        setSession({ caregiverId: account.caregiverId, username: account.username });
        return true;
      },
      logout: () => {
        setSession(null);
      },
    }),
    [session]
  );

  return <CaregiverContext.Provider value={value}>{children}</CaregiverContext.Provider>;
}

export function useCaregiver() {
  return useContext(CaregiverContext);
}
