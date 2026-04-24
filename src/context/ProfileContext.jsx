import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useCaregiver } from "./CaregiverContext.jsx";
import { deriveProfileStatus, getProfileByCaregiver } from "../lib/profileApi.js";

const ProfileContext = createContext({
  profile: null,
  profileStatus: null,
  loadingProfile: true,
  profileError: "",
  refreshProfile: async () => {},
});

export function ProfileProvider({ children }) {
  const { caregiverId, isAuthenticated } = useCaregiver();
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [profileError, setProfileError] = useState("");

  async function refreshProfile() {
    if (!isAuthenticated || !caregiverId) {
      setProfile(null);
      setProfileError("");
      setLoadingProfile(false);
      return;
    }

    setLoadingProfile(true);
    try {
      const data = await getProfileByCaregiver(caregiverId);
      setProfile(data);
      setProfileError("");
    } catch (error) {
      setProfile(null);
      if (error?.status === 404) {
        setProfileError("");
      } else {
        setProfileError(error.message || "Failed to load profile.");
      }
    } finally {
      setLoadingProfile(false);
    }
  }

  useEffect(() => {
    refreshProfile();
  }, [caregiverId, isAuthenticated]);

  const profileStatus = useMemo(() => deriveProfileStatus(profile), [profile]);

  const value = useMemo(
    () => ({
      profile,
      profileStatus,
      loadingProfile,
      profileError,
      refreshProfile,
    }),
    [profile, profileStatus, loadingProfile, profileError]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  return useContext(ProfileContext);
}
