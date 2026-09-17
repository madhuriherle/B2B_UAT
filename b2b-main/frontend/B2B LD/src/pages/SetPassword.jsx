import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { passwordStrengthError, PASSWORD_HINT } from "../lib/validation";
import logo from "../assets/logo.png";

const SetPassword = () => {
  const { token } = useParams();
  const [succeeded, setSucceeded] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [userInfo, setUserInfo] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest(`/api/auth/reset-token/${token}`)
      .then(setUserInfo)
      .catch((err) => setLoadError(err.message || "Invalid or expired link"))
      .finally(() => setLoading(false));
  }, [token]);

  const status = succeeded ? "success" : loading ? "loading" : userInfo ? "ready" : "error";

  const handleSubmit = async () => {
    const passwordError = passwordStrengthError(password);
    if (passwordError) {
      setErrorMsg(passwordError);
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords do not match");
      return;
    }
    setErrorMsg("");
    setSubmitting(true);
    try {
      await apiRequest("/api/auth/set-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setSucceeded(true);
    } catch (err) {
      setErrorMsg(err.message || "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #E8F3FB 0%, #F3F8FB 100%)" }}>
      <div className="w-full max-w-md rounded-2xl p-8" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>

        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <img src={logo} alt="LegalDesk" className="h-14 w-auto" />
        </div>

        {status === "loading" && (
          <div className="text-center py-4">
            <p className="text-sm" style={{ color: "#5B7285" }}>Loading…</p>
          </div>
        )}

        {/* Invalid / expired */}
        {status === "error" && (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#E8F3FB" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#176B87" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 className="text-lg font-bold mb-2" style={{ color: "#0f172a" }}>Link Invalid or Expired</h2>
            <p className="text-sm" style={{ color: "#5B7285" }}>{loadError}</p>
            <p className="text-xs mt-3" style={{ color: "#5B7285" }}>Please contact your administrator to get a new link.</p>
          </div>
        )}

        {/* Set password form */}
        {status === "ready" && (
          <>
            <h2 className="text-xl font-bold mb-1" style={{ color: "#0f172a" }}>Set Your Password</h2>
            <p className="text-sm mb-6" style={{ color: "#5B7285" }}>
              Welcome, <span className="font-semibold" style={{ color: "#1E6091" }}>{userInfo?.full_name || userInfo?.email}</span>. Create a password to access your account.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>New Password *</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={PASSWORD_HINT}
                  className="w-full px-4 py-2.5 text-sm rounded-xl outline-none"
                  style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Confirm Password *</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  className="w-full px-4 py-2.5 text-sm rounded-xl outline-none"
                  style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}
                />
              </div>

              {errorMsg && (
                <p className="text-xs font-medium px-3 py-2 rounded-lg" style={{ background: "#E8F3FB", color: "#1E6091" }}>{errorMsg}</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
              >
                {submitting ? "Setting password…" : "Set Password"}
              </button>
            </div>
          </>
        )}

        {/* Success */}
        {status === "success" && (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#E6F5EA" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="text-lg font-bold mb-2" style={{ color: "#0f172a" }}>Password Set!</h2>
            <p className="text-sm" style={{ color: "#5B7285" }}>Your password has been saved. You can now log in with your credentials.</p>
          </div>
        )}

      </div>
    </div>
  );
};

export default SetPassword;

