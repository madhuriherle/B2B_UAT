import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";

const inputClass = "w-full px-4 py-2.5 text-sm rounded-xl outline-none";
const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const QuoteAccess = () => {
  const { quoteId } = useParams();
  const [errorMsg, setErrorMsg] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFoundMessage, setNotFoundMessage] = useState("");

  useEffect(() => {
    apiRequest(`/api/quotations/token/${quoteId}`)
      .then((data) => setQuote(data))
      .catch((err) => setNotFoundMessage(err.message || "Quotation not found"))
      .finally(() => setLoading(false));
  }, [quoteId]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const result = await apiRequest(`/api/quotations/${quote.id}/accept`, { method: "POST" });
      setQuote({ ...quote, ...result.quotation });
      setErrorMsg("");
    } catch (err) {
      setErrorMsg(err.message || "Could not accept quotation");
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#F3F8FB" }}>
        <p className="text-sm" style={{ color: "#5B7285" }}>Loading…</p>
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#F3F8FB" }}>
        <div className="max-w-md w-full rounded-2xl p-6 text-center" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
          <h1 className="text-xl font-bold" style={{ color: "#0f172a" }}>Quotation not found</h1>
          <p className="text-sm mt-2 mb-5" style={{ color: "#5B7285" }}>{notFoundMessage}</p>
        </div>
      </div>
    );
  }

  const amount = Number(quote.amount || 0);
  const gstPercentage = Number(quote.gst_percentage || 0);
  const totalAmount = Number(quote.total_amount ?? amount + (amount * gstPercentage) / 100);
  const isAccepted = quote.quotation_status === "accepted";

  return (
    <div className="min-h-screen" style={{ background: "#F3F8FB" }}>
      <header className="px-6 py-4 border-b" style={{ background: "#fff", borderColor: "#D8E6F0" }}>
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold" style={{ color: "#0f172a" }}>LegalDesk Service Portal</h1>
            <p className="text-xs" style={{ color: "#5B7285" }}>{quote.organization_name}</p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 items-start">
          <section className="rounded-2xl p-6" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
            <p className="text-xs font-semibold uppercase mb-2" style={{ color: "#1E6091" }}>
              {isAccepted ? "Quotation accepted" : "Quotation generated"}
            </p>
            <h2 className="text-2xl font-bold" style={{ color: "#0f172a" }}>{quote.organization_name}</h2>
            <p className="text-sm mt-2" style={{ color: "#5B7285" }}>
              {isAccepted ? "These services are now active on your account." : "Review the services enabled by admin and accept to activate them."}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
              {(quote.services || []).map((service) => (
                <div key={service.service_name} className="rounded-xl p-4" style={{ background: "#E8F3FB", border: "1px solid #D8E6F0" }}>
                  <p className="font-semibold text-sm" style={{ color: "#1E6091" }}>{service.service_name}</p>
                  <p className="text-xs mt-2" style={{ color: "#334155" }}>{formatCurrency(service.service_price)}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
              <div className="flex justify-between text-sm py-1" style={{ color: "#334155" }}><span>Amount</span><span>{formatCurrency(amount)}</span></div>
              <div className="flex justify-between text-sm py-1" style={{ color: "#334155" }}><span>GST {gstPercentage.toFixed(2)}%</span><span>{formatCurrency(totalAmount - amount)}</span></div>
              <div className="flex justify-between font-bold pt-3 mt-2 border-t" style={{ color: "#0f172a", borderColor: "#D8E6F0" }}><span>Total</span><span>{formatCurrency(totalAmount)}</span></div>
            </div>

            {errorMsg && (
              <p className="text-sm font-semibold mt-4" style={{ color: "#176B87" }}>{errorMsg}</p>
            )}
          </section>

          <section className="rounded-2xl p-6" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
            {isAccepted ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#E6F5EA" }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold mb-2" style={{ color: "#0f172a" }}>Quotation accepted</h2>
                <p className="text-sm" style={{ color: "#5B7285" }}>Your services are now active. Our team will reach out with next steps.</p>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-bold mb-2" style={{ color: "#0f172a" }}>Ready to proceed?</h2>
                <p className="text-sm mb-5" style={{ color: "#5B7285" }}>Accepting this quotation activates the listed services for {quote.organization_name}.</p>
                <input className={inputClass} style={{ ...inputStyle, marginBottom: "1rem" }} disabled value={quote.customer_email || ""} />
                <button onClick={handleAccept} disabled={accepting} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#0f172a" }}>
                  {accepting ? "Accepting…" : "Accept Quotation"}
                </button>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default QuoteAccess;

