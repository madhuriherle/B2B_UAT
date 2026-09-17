import { createContext, useContext, useEffect, useState } from "react";
import {
  apiRequest, broadcastLogout, clearSession, getStoredToken, getStoredUser,
  onAuthLogoutBroadcast, redirectToLoginAfterLogout, storeSession,
} from "./api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(getStoredUser());
  const [loading, setLoading] = useState(true);

  // Mirrors a session going away in another tab into this one immediately —
  // either a 401 (the shared token expired/went invalid) or an explicit
  // Logout click there (see logout below), instead of only finding out the
  // next time this tab happens to call the API.
  useEffect(() => onAuthLogoutBroadcast(() => {
    clearSession();
    setUser(null);
  }), []);

  useEffect(() => {
    const restoreSession = async () => {
      const token = getStoredToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const me = await apiRequest("/api/auth/me");
        setUser(me);
        storeSession(getStoredToken(), me);
      } catch {
        // apiRequest itself already clears the session + redirects on a
        // genuine 401 (see api.js), so this catch only ever sees something
        // else: a network hiccup, a request an extension blocked, a
        // momentary backend blip — none of which mean the session is
        // actually invalid. Clearing it here too used to log the user out
        // of an otherwise-valid session on nothing more than a failed
        // request — most visible when duplicating a tab (a fresh page load
        // racing this same bootstrap call) landed on /login instead of the
        // duplicated screen. Leave `user` as whatever was optimistically set
        // from sessionStorage at mount; a token that's really invalid still
        // gets caught and cleared by the next API call that actually reaches
        // the server.
      } finally {
        setLoading(false);
      }
    };
    restoreSession();
  }, []);

  // Returns either the logged-in user (2FA disabled — session established
  // immediately) or an { otp_required: true, otp_token, email, expires_in }
  // object the caller (Login.jsx) uses to show the OTP screen. No session is
  // stored in the latter case — that only happens once verifyOtp succeeds.
  const login = async (email, password) => {
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (result.otp_required) return result;
    storeSession(result.access_token, result.user);
    setUser(result.user);
    return result.user;
  };

  const verifyOtp = async (otpToken, otp) => {
    const result = await apiRequest("/api/auth/verify-otp", {
      method: "POST",
      body: JSON.stringify({ otp_token: otpToken, otp }),
    });
    storeSession(result.access_token, result.user);
    setUser(result.user);
    return result.user;
  };

  const resendOtp = (otpToken) =>
    apiRequest("/api/auth/resend-otp", {
      method: "POST",
      body: JSON.stringify({ otp_token: otpToken }),
    });

  // Broadcast so a duplicated tab (browser's "duplicate tab", which copies
  // sessionStorage and so shares this exact same token) logs out too instead
  // of silently staying signed in after the user explicitly logged out
  // somewhere else. Safe unlike the session-adoption mechanism removed from
  // api.js: this only ever tells tabs to clear a session they already have,
  // never hands a session to a tab that doesn't.
  //
  // Server revoke MUST run before clearSession — otherwise the Bearer token
  // is discarded client-side but remains valid until exp, and a captured
  // request (Burp Repeater) can still create orders after "logout".
  const logout = async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } catch {
      // Still clear locally if the revoke call fails (network blip, already
      // revoked token, etc.) — never leave the UI looking signed in.
    }
    clearSession();
    broadcastLogout();
    setUser(null);
    redirectToLoginAfterLogout();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyOtp, resendOtp, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
