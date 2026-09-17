import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { homeFor } from "../lib/roleHome";
import logo from "../assets/logo.png";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none transition-all";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const formatCountdown = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

// Shown in place of the credentials form once /login responds with
// otp_required — the user's password has already been verified at that
// point, this step only confirms the emailed code before a real session is
// established (see AuthContext.verifyOtp/resendOtp).
const OtpStep = ({ pending, onVerified, onBack }) => {
  const { verifyOtp, resendOtp } = useAuth();
  const [otp, setOtp] = useState("");
  const [otpToken, setOtpToken] = useState(pending.otp_token);
  const [secondsLeft, setSecondsLeft] = useState(pending.expires_in);
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const expired = secondsLeft <= 0;

  const handleVerify = async (e) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }
    if (expired) {
      setError("This OTP has expired. Please resend a new code.");
      return;
    }
    setVerifying(true);
    setError("");
    try {
      const loggedInUser = await verifyOtp(otpToken, otp);
      onVerified(loggedInUser);
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError("");
    setOtp("");
    try {
      const result = await resendOtp(otpToken);
      setOtpToken(result.otp_token);
      setSecondsLeft(result.expires_in);
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      <p className="text-sm" style={{ color: "#5B7285" }}>
        Enter the 6-digit code sent to <span className="font-semibold" style={{ color: "#1e293b" }}>{pending.email}</span>.
      </p>
      {error && <p className="text-xs font-medium px-3 py-2 rounded-lg" style={{ background: "#FDECEC", color: "#C0392B" }}>{error}</p>}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>One-Time Password</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className={`${inputClass} text-center tracking-[0.5em] font-semibold`}
          style={inputStyle}
          placeholder="------"
        />
      </div>
      <div className="flex items-center justify-between text-xs" style={{ color: "#5B7285" }}>
        <span>{expired ? "Code expired" : `Expires in ${formatCountdown(secondsLeft)}`}</span>
        <button type="button" onClick={handleResend} disabled={resending} className="font-semibold disabled:opacity-60" style={{ color: "#1E6091" }}>
          {resending ? "Sending..." : "Resend OTP"}
        </button>
      </div>
      <button type="submit" disabled={verifying || expired} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
        {verifying ? "Verifying..." : "Verify OTP"}
      </button>
      <button type="button" onClick={onBack} className="w-full text-xs font-semibold text-center" style={{ color: "#5B7285" }}>
        ← Back to sign in
      </button>
    </form>
  );
};

const Login = () => {
  const { login, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingOtp, setPendingOtp] = useState(null);

  if (isAuthenticated) {
    const redirectTo = location.state?.from || homeFor(user);
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Enter your email and password");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await login(email, password);
      if (result?.otp_required) {
        setPendingOtp(result);
      } else {
        navigate(location.state?.from || homeFor(result), { replace: true });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{
        backgroundImage:
          "radial-gradient(rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(155deg, #1E6091 0%, #1E6091 45%, #16A34A 100%)",
        backgroundSize: "22px 22px, 100% 100%",
      }}
    >
      <div className="absolute rounded-full" style={{ width: 460, height: 460, background: "rgba(255,255,255,0.07)", top: -160, left: -160 }} />
      <div className="absolute rounded-full" style={{ width: 380, height: 380, background: "rgba(255,255,255,0.06)", bottom: -160, right: -160 }} />

      <div className="relative w-full max-w-sm rounded-2xl p-8" style={{ background: "#fff", boxShadow: "0 30px 70px -20px rgba(0,0,0,0.35)" }}>
        <div className="flex items-center justify-center mb-8">
          <img src={logo} alt="LegalDesk" className="h-14 w-auto shrink-0" />
        </div>

        <h2 className="text-xl font-bold mb-6" style={{ color: "#0f172a" }}>{pendingOtp ? "Verify your identity" : "Sign in"}</h2>

        {pendingOtp ? (
          <OtpStep
            pending={pendingOtp}
            onBack={() => {
              setPendingOtp(null);
              setPassword("");
              setError("");
            }}
            onVerified={(loggedInUser) => navigate(location.state?.from || homeFor(loggedInUser), { replace: true })}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-xs font-medium px-3 py-2 rounded-lg" style={{ background: "#FDECEC", color: "#C0392B" }}>{error}</p>}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} style={inputStyle} autoFocus />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} style={inputStyle} />
            </div>
            <button type="submit" disabled={loading} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default Login;

