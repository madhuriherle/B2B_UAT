import { useSearchParams } from "react-router-dom";
import logo from "../assets/logo.png";

// Public, unauthenticated landing page — this is where SignDesk's
// return_url sends the signer's own browser once they finish (or abandon/
// fail) signing (see backend/app/routes/esign.py's esign_callback, which
// 303-redirects here after recording the real status exactly as before).
// The actual document/signer status is already persisted server-side by
// the time this page ever loads — it exists purely to replace the raw
// JSON the browser used to land on with something a human signer can
// read, never to re-derive or re-record anything itself.
const EsignComplete = () => {
  const [searchParams] = useSearchParams();
  const success = searchParams.get("status") === "success";

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #E8F3FB 0%, #F3F8FB 100%)" }}>
      <div className="w-full max-w-sm rounded-2xl p-8 text-center" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
        <img src={logo} alt="LegalDesk" className="h-14 w-auto mx-auto mb-6" />

        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ background: success ? "#E6F5EA" : "#FEE2E2" }}
        >
          {success ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          )}
        </div>

        <h1 className="text-lg font-bold mb-2" style={{ color: "#0f172a" }}>
          {success ? "Document signed successfully." : "Signing wasn't completed"}
        </h1>
        <p className="text-sm" style={{ color: "#5B7285" }}>
          {success
            ? "Thank you — your signature has been recorded. You can close this window now."
            : "The signing process was cancelled, declined, or didn't go through. Please contact the sender for a new signing link, or try again."}
        </p>
      </div>
    </div>
  );
};

export default EsignComplete;
