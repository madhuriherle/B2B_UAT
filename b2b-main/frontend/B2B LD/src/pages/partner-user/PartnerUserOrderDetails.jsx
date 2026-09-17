import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest, downloadFile, fetchBlobUrl } from "../../lib/api";
import { formatCurrency, formatWholeRupees, GST_PERCENTAGE } from "../../lib/format";
import { isValidEmail, isValidMobile, sanitizeMobileInput } from "../../lib/validation";
import { STATUS_STYLES, formatDate, formatDateTime } from "../partner/orders/orderShared";
import { theme, serif, card } from "../../lib/userPortalTheme";
import { renderableEkycFields } from "../../lib/ekycFields";

const CONFIRM_RESEND_MESSAGE =
  "Updating signer details will invalidate the existing signing request and generate a new signing link for all signers. Continue?";
const CONFIRM_CANCEL_MESSAGE = "Are you sure? All pending signing links will become invalid.";

const Field = ({ label, children }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: theme.slate }}>{label}</p>
    {children}
  </div>
);

const statusBadge = (status) => (
  <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold" style={STATUS_STYLES[status] || { background: theme.bg, color: theme.slate }}>
    {status}
  </span>
);

// Service Charge/GST/Total breakdown for the Order Detail Pricing card —
// null pricing (order not far enough along yet, e.g. eSign still in
// progress) simply hides the whole card rather than showing a
// half-populated one. Shared across every non-Bulk service (eSign, eStamp,
// eStamp On The Fly, eKYC, plain services) since they all get the same
// {lines, gst_amount, total_payable} shape from the backend's
// get_order_pricing_preview — eStamp Bulk has its own dedicated Pricing
// card (see PartnerUserEstampBulkOrderDetails.jsx) because it already
// carries a richer denomination-line breakdown of its own.
const PricingPreviewCard = ({ pricing }) => {
  if (!pricing) return null;
  return (
    <section className="rounded-lg p-6 space-y-2 text-sm" style={card}>
      <h2 className="text-base font-bold mb-3" style={{ color: theme.ink, fontFamily: serif }}>Pricing</h2>
      {pricing.lines.map((line, i) => (
        <div className="flex justify-between" key={`${line.description}-${i}`}>
          <span style={{ color: theme.slate }}>{line.description}</span>
          <span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(line.amount)}</span>
        </div>
      ))}
      {Number(pricing.gst_amount) > 0 && (
        <div className="flex justify-between">
          <span style={{ color: theme.slate }}>GST ({GST_PERCENTAGE}%)</span>
          <span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(pricing.gst_amount)}</span>
        </div>
      )}
      <div className="flex justify-between pt-2 border-t" style={{ borderColor: theme.border }}>
        <span style={{ color: theme.slate }}>Total Payable</span>
        <span className="font-semibold" style={{ color: theme.navy }}>{formatCurrency(pricing.total_payable)}</span>
      </div>
    </section>
  );
};

const SIGNER_STATUS_STYLES = {
  signed: { background: theme.successSoft, color: theme.success },
  pending: { background: theme.goldSoft, color: theme.navy },
  sent: { background: theme.goldSoft, color: theme.navy },
  rejected: { background: theme.dangerSoft, color: theme.danger },
  expired: { background: theme.bg, color: theme.slate },
  failed: { background: theme.dangerSoft, color: theme.danger },
  cancelled: { background: theme.bg, color: theme.slate },
};
const SIGNER_STATUS_LABELS = { signed: "Signed", pending: "Pending", sent: "Pending", rejected: "Rejected", expired: "Expired", failed: "Failed", cancelled: "Cancelled" };

// Mirrors ekyc_service._sync_ekyc_order_status's logic so this page's
// "Document Extraction" / "Government Verification" breakdown can never
// contradict the order.status badge shown next to it. `ekyc`, `digilocker`
// and `pan` are the raw rows from order.ekyc / order.digilocker / order.pan.
const computeKycVerification = (ekyc, digilocker, pan) => {
  if (!ekyc) return { extraction: null, verification: null, method: null, verifiedAt: null };

  const extraction = ekyc.status === "success" ? "Successful" : "Failed";

  if (extraction === "Failed") {
    return { extraction, verification: "Not Performed", method: null, verifiedAt: null };
  }
  if (ekyc.verified) {
    return { extraction, verification: "Verified", method: "Document Verification", verifiedAt: ekyc.updated_at };
  }
  if (digilocker?.status === "verified") {
    return { extraction, verification: "Verified", method: "DigiLocker", verifiedAt: digilocker.aadhaar_verified_at };
  }
  if (pan?.status === "verified" && pan.valid_pan) {
    return { extraction, verification: "Verified", method: "PAN Verification", verifiedAt: pan.updated_at };
  }
  if (digilocker?.status === "link_generated") {
    return { extraction, verification: "Pending", method: "DigiLocker (awaiting completion)", verifiedAt: null };
  }
  return { extraction, verification: "Not Verified", method: null, verifiedAt: null };
};

const GOV_VERIFICATION_STYLES = {
  Verified: { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` },
  "Not Verified": { background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` },
  Pending: { background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` },
  "Not Performed": { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` },
};

const signerStatusBadge = (status) => (
  <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold capitalize" style={SIGNER_STATUS_STYLES[status] || { background: theme.bg, color: theme.slate }}>
    {SIGNER_STATUS_LABELS[status] || status}
  </span>
);

const PartnerUserOrderDetails = () => {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editSigners, setEditSigners] = useState([]);
  const [editError, setEditError] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [resending, setResending] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [resendingSignerId, setResendingSignerId] = useState(null);
  const [digilockerLoading, setDigilockerLoading] = useState(false);
  const [digilockerError, setDigilockerError] = useState("");
  const [fetchingAadhaar, setFetchingAadhaar] = useState(false);
  const [panLoading, setPanLoading] = useState(false);
  const [panError, setPanError] = useState("");
  const [ekycRetrying, setEkycRetrying] = useState(false);
  const [ekycRetryError, setEkycRetryError] = useState("");

  const showToast = (msg, type = "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadOrder = () => {
    setLoading(true);
    setNotFound(false);
    return apiRequest(`/api/partner-user/orders/${orderId}`)
      .then(setOrder)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    if (!order || order.service_name === "eKYC") return;
    let url;
    let cancelled = false;
    fetchBlobUrl(`/api/partner-user/orders/${orderId}/document/signed-preview`)
      .catch(() => fetchBlobUrl(`/api/partner-user/orders/${orderId}/document/preview`))
      .then((u) => {
        if (cancelled) {
          window.URL.revokeObjectURL(u);
          return;
        }
        url = u;
        setPdfUrl(u);
      })
      .catch(() => setPdfUrl(null));
    return () => {
      cancelled = true;
      if (url) window.URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, orderId]);

  const handleDownloadOriginal = async () => {
    try {
      await downloadFile(`/api/partner-user/orders/${orderId}/document`, order.document_filename);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleDownloadSigned = async () => {
    try {
      await downloadFile(`/api/partner-user/orders/${orderId}/esign/download`, `${order.order_no}-signed.pdf`);
    } catch (err) {
      showToast(err.message);
    }
  };

  const handleDownloadInvoice = async () => {
    try {
      await downloadFile(`/api/partner-user/orders/${orderId}/invoice/pdf`, `${order.order_no}-invoice.pdf`);
    } catch (err) {
      showToast(err.message);
    }
  };

  const startEdit = () => {
    setEditSigners((order.esign?.signers || []).map((s) => ({ name: s.signer_name, email: s.signer_email, mobile: s.signer_mobile })));
    setEditError("");
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditError("");
  };

  const updateEditSigner = (index, field, value) => {
    setEditSigners((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: field === "mobile" ? sanitizeMobileInput(value) : value } : s))
    );
  };

  const handleGenerateClick = () => {
    for (const s of editSigners) {
      if (!s.name || !s.email || !s.mobile) {
        setEditError("Every signer needs a name, email and mobile number");
        return;
      }
      if (!isValidEmail(s.email)) {
        setEditError(`"${s.email}" is not a valid email address`);
        return;
      }
      if (!isValidMobile(s.mobile)) {
        setEditError("Signer mobile numbers must be exactly 10 digits");
        return;
      }
    }
    setEditError("");
    setShowConfirm(true);
  };

  const confirmResend = async () => {
    setShowConfirm(false);
    setResending(true);
    try {
      await apiRequest(`/api/partner-user/orders/${orderId}/esign/initiate`, {
        method: "POST",
        body: JSON.stringify({ signers: editSigners }),
      });
      setEditing(false);
      await loadOrder();
      showToast("New signing request sent to all signers.", "success");
    } catch (err) {
      showToast(err.message);
    } finally {
      setResending(false);
    }
  };

  const confirmCancelWorkflow = async () => {
    setShowCancelConfirm(false);
    setCancelling(true);
    try {
      await apiRequest(`/api/partner-user/orders/${orderId}/esign/cancel`, { method: "POST" });
      await loadOrder();
      showToast("Workflow cancelled. Pending signing links are no longer valid.", "success");
    } catch (err) {
      showToast(err.message);
    } finally {
      setCancelling(false);
    }
  };

  // Re-runs the same General Document Verification call the order's initial
  // eKYC submission made — initiate_ekyc (see ekyc_service.py) explicitly
  // allows re-submitting once the stored status is 'failed', so this is a
  // real, backend-supported retry.
  const handleEkycRetry = async () => {
    setEkycRetrying(true);
    setEkycRetryError("");
    try {
      await apiRequest(`/api/partner-user/orders/${orderId}/ekyc/verify`, {
        method: "POST",
        body: JSON.stringify({ verification: true }),
      });
      await loadOrder();
    } catch (err) {
      setEkycRetryError(err.message);
    } finally {
      setEkycRetrying(false);
    }
  };

  const handleDigilockerVerify = async () => {
    setDigilockerLoading(true);
    setDigilockerError("");
    try {
      const digilocker = await apiRequest(`/api/partner-user/orders/${orderId}/digilocker/verify`, { method: "POST" });
      await loadOrder();
      if (digilocker.status === "link_generated" && digilocker.link) {
        window.open(digilocker.link, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setDigilockerError(err.message);
    } finally {
      setDigilockerLoading(false);
    }
  };

  const handleFetchAadhaarDetails = async () => {
    setFetchingAadhaar(true);
    setDigilockerError("");
    try {
      await apiRequest(`/api/partner-user/orders/${orderId}/digilocker/fetch-aadhaar`, { method: "POST" });
      await loadOrder();
    } catch (err) {
      setDigilockerError(err.message);
    } finally {
      setFetchingAadhaar(false);
    }
  };

  const handlePanVerify = async () => {
    setPanLoading(true);
    setPanError("");
    try {
      await apiRequest(`/api/partner-user/orders/${orderId}/pan/verify`, { method: "POST" });
      await loadOrder();
    } catch (err) {
      setPanError(err.message);
    } finally {
      setPanLoading(false);
    }
  };

  const handleResendEmail = async (signerId) => {
    setResendingSignerId(signerId);
    try {
      const result = await apiRequest(`/api/partner-user/orders/${orderId}/esign/signers/${signerId}/resend`, { method: "POST" });
      showToast(
        result.provider_notified ? "Reminder email sent." : "Resend requested — SignDesk reminder isn't configured yet, but the request was logged.",
        "success"
      );
      await loadOrder();
    } catch (err) {
      showToast(err.message);
    } finally {
      setResendingSignerId(null);
    }
  };

  if (loading) return <p className="text-sm" style={{ color: theme.slate }}>Loading order...</p>;
  if (notFound || !order) return <p className="text-sm" style={{ color: theme.slate }}>Order not found.</p>;

  const isEsign = order.service_name === "eSign";
  const esign = order.esign;
  // An eStamp order optionally has eSign attached afterwards ("send for
  // eSign after stamp") — order.esign is only ever populated when that
  // actually happened (see partner.get_partner_order_with_esign), so its
  // mere presence here is enough to show the same signer sections a plain
  // eSign order gets, without a separate flag to track.
  const hasEsign = isEsign || (order.service_name === "eStamp" && !!esign);
  const canEditSigners = isEsign && esign?.status_label === "Sent for Signature";
  const canCancelWorkflow = isEsign && (esign?.status_label === "Sent for Signature" || esign?.status_label === "Partially Signed");
  const isEStamp = order.service_name === "eStamp";
  const stamp = order.stamp;
  const isEkyc = order.service_name === "eKYC";
  const ekyc = order.ekyc;
  const digilocker = order.digilocker;
  const pan = order.pan;
  const ekycDocType = order.document_type || ekyc?.doc_type;
  const isAadhaarEkyc = isEkyc && ekycDocType === "aadhaar_card";
  const isPanEkyc = isEkyc && ekycDocType === "pan_card";
  const showDigilockerSection = isAadhaarEkyc || isPanEkyc;
  const kycVerification = isEkyc ? computeKycVerification(ekyc, digilocker, pan) : null;

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white max-w-xl" style={{ background: toast.type === "success" ? theme.success : theme.danger }}>
          {toast.msg}
        </div>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(15,23,42,0.5)" }}>
          <div className="rounded-lg p-6 max-w-md w-full" style={{ background: "#fff" }}>
            <p className="text-sm mb-6" style={{ color: theme.ink }}>{CONFIRM_RESEND_MESSAGE}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: theme.bg, color: theme.ink, border: `1px solid ${theme.border}` }}>
                Cancel
              </button>
              <button onClick={confirmResend} className="px-4 py-2 rounded text-sm font-semibold text-white" style={{ background: theme.navy }}>
                Generate New Signing Request
              </button>
            </div>
          </div>
        </div>
      )}

      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(15,23,42,0.5)" }}>
          <div className="rounded-lg p-6 max-w-md w-full" style={{ background: "#fff" }}>
            <p className="text-sm mb-6" style={{ color: theme.ink }}>{CONFIRM_CANCEL_MESSAGE}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCancelConfirm(false)} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: theme.bg, color: theme.ink, border: `1px solid ${theme.border}` }}>
                Cancel
              </button>
              <button onClick={confirmCancelWorkflow} className="px-4 py-2 rounded text-sm font-semibold text-white" style={{ background: theme.danger }}>
                Cancel Workflow
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-start mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <div>
          <Link to="/user/orders" className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: theme.navy }}>
            ← Back to Orders
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>{order.order_no}</h1>
          <p className="text-sm mt-1" style={{ color: theme.slate }}>Order details</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleDownloadOriginal} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: theme.bg, color: theme.ink, border: `1px solid ${theme.border}` }}>
            Download Original
          </button>
          {isEsign && (
            <button onClick={handleDownloadSigned} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: theme.goldSoft, color: theme.navy }}>
              Download Signed Copy
            </button>
          )}
          {order.status !== "Draft" && (
            <button onClick={handleDownloadInvoice} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: theme.navy, color: "#fff" }}>
              Download Invoice
            </button>
          )}
        </div>
      </div>

      <div className={isEkyc ? "grid grid-cols-1 gap-6" : "grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6"}>
        {!isEkyc && (
          <section className="rounded-lg overflow-hidden" style={card}>
            {pdfUrl ? (
              <iframe title="Document preview" src={pdfUrl} className="w-full" style={{ minHeight: "80vh", border: "none" }} />
            ) : (
              <div className="flex items-center justify-center text-sm" style={{ minHeight: "60vh", color: theme.slate }}>
                Preview not available
              </div>
            )}
          </section>
        )}

        <div className="space-y-6">
          <section className="rounded-lg p-6" style={card}>
            <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>Document Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Order ID"><p className="text-sm font-medium" style={{ color: theme.ink }}>{order.order_no}</p></Field>
              <Field label="Document Name"><p className="text-sm font-medium" style={{ color: theme.ink }}>{order.document_filename || "-"}</p></Field>
              <Field label="Created By"><p className="text-sm font-medium" style={{ color: theme.ink }}>{order.created_by || "-"}</p></Field>
              <Field label="Created Date"><p className="text-sm font-medium" style={{ color: theme.ink }}>{formatDate(order.created_at)}</p></Field>
              {isEsign ? (
                <>
                  <Field label="Total Signers"><p className="text-sm font-medium" style={{ color: theme.ink }}>{esign?.summary?.total ?? order.quantity}</p></Field>
                  <Field label="Overall Status">{statusBadge(esign?.status_label || order.status)}</Field>
                  <Field label="Amount">
                    <p className="text-sm font-medium whitespace-nowrap" style={{ color: theme.ink }}>
                      {formatWholeRupees(esign?.charged_amount)} / {formatWholeRupees(order.amount)}
                    </p>
                  </Field>
                </>
              ) : isEkyc ? (
                <>
                  <Field label="Customer/Partner"><p className="text-sm font-medium" style={{ color: theme.ink }}>{order.customer_name || "-"}</p></Field>
                  <Field label="Service"><p className="text-sm font-medium" style={{ color: theme.ink }}>eKYC</p></Field>
                  <Field label="Document Type"><p className="text-sm font-medium capitalize" style={{ color: theme.ink }}>{(ekycDocType || "-").replace(/_/g, " ")}</p></Field>
                  <Field label="Amount"><p className="text-sm font-medium" style={{ color: theme.ink }}>{formatCurrency(order.amount)}</p></Field>
                  <Field label="Order Status">{statusBadge(order.status)}</Field>
                </>
              ) : (
                <>
                  <Field label="Amount"><p className="text-sm font-medium" style={{ color: theme.ink }}>{formatCurrency(order.amount)}</p></Field>
                  <Field label="Status">{statusBadge(order.status)}</Field>
                </>
              )}
            </div>
          </section>

          <PricingPreviewCard pricing={order.pricing_preview} />

          {isEkyc && ekyc && kycVerification && (
            <section className="rounded-lg p-6" style={card}>
              <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>KYC Verification</h2>

              <div className="flex flex-wrap gap-3 mb-4">
                <span
                  className="inline-flex items-center px-3 py-1.5 rounded text-xs font-semibold"
                  style={kycVerification.extraction === "Successful"
                    ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                    : { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}
                >
                  Document Extraction: {kycVerification.extraction}
                </span>
                <span
                  className="inline-flex items-center px-3 py-1.5 rounded text-xs font-semibold"
                  style={GOV_VERIFICATION_STYLES[kycVerification.verification]}
                >
                  Government Verification: {kycVerification.verification}
                </span>
              </div>

              {kycVerification.extraction === "Failed" ? (
                <div className="space-y-3">
                  <p className="text-sm px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                    {ekyc.error || "Document verification failed."}
                  </p>
                  {ekycRetryError && (
                    <p className="text-sm px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                      {ekycRetryError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleEkycRetry}
                    disabled={ekycRetrying}
                    className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: theme.navy }}
                  >
                    {ekycRetrying ? "Retrying..." : "Try Again"}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {kycVerification.verification === "Verified" && (
                    <div className="grid grid-cols-2 gap-3 text-sm px-4 py-3 rounded" style={{ background: theme.successSoft, border: `1px solid ${theme.success}33` }}>
                      <Field label="Verification Method"><p style={{ color: theme.ink }}>{kycVerification.method}</p></Field>
                      <Field label="Verified At"><p style={{ color: theme.ink }}>{formatDateTime(kycVerification.verifiedAt)}</p></Field>
                    </div>
                  )}
                  {kycVerification.verification === "Not Verified" && (
                    <p className="text-sm px-4 py-3 rounded" style={{ background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` }}>
                      Document extracted, but was not verified against government records.
                    </p>
                  )}
                  {renderableEkycFields(ekyc.extracted_data).length > 0 && (
                    <div className="rounded p-4" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                      <p className="text-xs font-semibold uppercase mb-3" style={{ color: theme.slate }}>Verified Details</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        {renderableEkycFields(ekyc.extracted_data).map(({ key, label, value }) => (
                          <div key={key} className="min-w-0">
                            <p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>{label}</p>
                            <p style={{ color: theme.ink, wordBreak: "break-all" }}>{value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {showDigilockerSection && (
            <section className="rounded-lg p-6" style={card}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-bold" style={{ color: theme.ink, fontFamily: serif }}>DigiLocker Verification</h2>
                {digilocker && (
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold capitalize"
                    style={digilocker.status === "verified"
                      ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                      : digilocker.status === "failed"
                        ? { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }
                        : { background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` }}
                  >
                    {digilocker.status.replace(/_/g, " ")}
                  </span>
                )}
              </div>

              {digilockerError && (
                <p className="text-sm px-4 py-3 rounded mb-3" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                  {digilockerError}
                </p>
              )}

              {!digilocker ? (
                <>
                  <p className="text-xs mb-3" style={{ color: theme.slate }}>
                    Alternatively, verify the customer's Aadhaar directly through DigiLocker — no document upload needed.
                  </p>
                  <button
                    type="button"
                    onClick={handleDigilockerVerify}
                    disabled={digilockerLoading}
                    className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: theme.navy }}
                  >
                    {digilockerLoading ? "Generating link..." : "Verify with DigiLocker"}
                  </button>
                </>
              ) : digilocker.status === "link_generated" ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium px-4 py-3 rounded" style={{ background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }}>
                    DigiLocker login link generated. Ask the customer to complete authentication there, then fetch their details.
                  </p>
                  <div className="flex items-center gap-3">
                    <a href={digilocker.link} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold" style={{ color: theme.navy }}>
                      Reopen DigiLocker Login
                    </a>
                    <button
                      type="button"
                      onClick={handleFetchAadhaarDetails}
                      disabled={fetchingAadhaar}
                      className="px-4 py-2 rounded text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                      style={{ background: theme.navy }}
                    >
                      {fetchingAadhaar ? "Fetching..." : "Fetch Aadhaar Details"}
                    </button>
                  </div>
                </div>
              ) : digilocker.status === "verified" ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium px-4 py-3 rounded" style={{ background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }}>
                    Aadhaar details fetched via DigiLocker.
                  </p>
                  {renderableEkycFields(digilocker.aadhaar_data).length > 0 && (
                    <div className="rounded p-4" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        {renderableEkycFields(digilocker.aadhaar_data).map(({ key, label, value }) => (
                          <div key={key} className="min-w-0">
                            <p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>{label}</p>
                            <p style={{ color: theme.ink, wordBreak: "break-all" }}>{value}</p>
                          </div>
                        ))}
                      </div>
                      {digilocker.aadhaar_last4 && (
                        <p className="text-xs mt-2" style={{ color: theme.slate }}>Aadhaar ending in {digilocker.aadhaar_last4}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                    {digilocker.error || "DigiLocker verification failed."}
                  </p>
                  <button
                    type="button"
                    onClick={handleDigilockerVerify}
                    disabled={digilockerLoading}
                    className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: theme.navy }}
                  >
                    {digilockerLoading ? "Retrying..." : "Try Again"}
                  </button>
                </div>
              )}
            </section>
          )}

          {isPanEkyc && (
            <section className="rounded-lg p-6" style={card}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-bold" style={{ color: theme.ink, fontFamily: serif }}>PAN Verification</h2>
                {pan && (
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold capitalize"
                    style={pan.status === "verified" && pan.valid_pan
                      ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                      : { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}
                  >
                    {pan.status === "verified" && !pan.valid_pan ? "Invalid PAN" : pan.status}
                  </span>
                )}
              </div>

              {panError && (
                <p className="text-sm px-4 py-3 rounded mb-3" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                  {panError}
                </p>
              )}

              {!pan ? (
                <>
                  <p className="text-xs mb-3" style={{ color: theme.slate }}>
                    Cross-check this PAN card against government records, on top of the document extraction above.
                  </p>
                  <button
                    type="button"
                    onClick={handlePanVerify}
                    disabled={panLoading}
                    className="px-5 py-2.5 rounded text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    style={{ background: theme.navy }}
                  >
                    {panLoading ? "Verifying..." : "Verify PAN"}
                  </button>
                </>
              ) : pan.status === "verified" ? (
                <div className="space-y-3">
                  <p className="text-sm font-medium px-4 py-3 rounded" style={pan.valid_pan
                    ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                    : { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                    {pan.valid_pan ? "PAN verified against government records." : "This PAN number could not be validated against government records."}
                  </p>
                  {renderableEkycFields(pan.validated_data).length > 0 && (
                    <div className="rounded p-4" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                      <p className="text-xs font-semibold uppercase mb-3" style={{ color: theme.slate }}>Validated Details</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        {renderableEkycFields(pan.validated_data).map(({ key, label, value }) => (
                          <div key={key} className="min-w-0">
                            <p className="text-xs font-semibold uppercase" style={{ color: theme.slate }}>{label}</p>
                            <p style={{ color: theme.ink, wordBreak: "break-all" }}>{value}</p>
                          </div>
                        ))}
                      </div>
                      {pan.data_match_aggregate && (
                        <p className="text-xs mt-2" style={{ color: theme.slate }}>Data match: {pan.data_match_aggregate}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                  {pan.error || "PAN verification failed."}
                </p>
              )}
            </section>
          )}

          {isEStamp && (
            <section className="rounded-lg p-6" style={card}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold" style={{ color: theme.ink, fontFamily: serif }}>eStamp Request</h2>
                {stamp && (
                  <span
                    className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold capitalize"
                    style={stamp.status === "completed"
                      ? { background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }
                      : stamp.status === "failed"
                        ? { background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }
                        : { background: theme.goldSoft, color: theme.navy, border: `1px solid ${theme.gold}66` }}
                  >
                    {stamp.status}
                  </span>
                )}
              </div>
              {!stamp ? (
                <p className="text-sm" style={{ color: theme.slate }}>Not requested yet.</p>
              ) : stamp.status === "completed" ? (
                <p className="text-sm px-4 py-3 rounded" style={{ background: theme.successSoft, color: theme.success, border: `1px solid ${theme.success}33` }}>
                  Stamp paper attached{stamp.stamp_paper_number ? ` — number ${stamp.stamp_paper_number}` : ""}.
                </p>
              ) : stamp.status === "failed" ? (
                <p className="text-sm px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                  {stamp.error_message || "The eStamp request failed."}
                </p>
              ) : (
                <p className="text-sm px-4 py-3 rounded" style={{ background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` }}>
                  SignDesk is procuring the stamp paper — this can take up to 5–6 hours.
                </p>
              )}
            </section>
          )}

          {hasEsign && (
            <section className="rounded-lg p-6" style={card}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-bold" style={{ color: theme.ink, fontFamily: serif }}>Signer Timeline</h2>
                {!editing && (
                  <div className="flex items-center gap-3">
                    {canEditSigners && (
                      <button onClick={startEdit} className="text-xs font-semibold" style={{ color: theme.navy }}>
                        Edit Signers
                      </button>
                    )}
                    {canCancelWorkflow && (
                      <button onClick={() => setShowCancelConfirm(true)} disabled={cancelling} className="text-xs font-semibold disabled:opacity-60" style={{ color: theme.danger }}>
                        {cancelling ? "Cancelling..." : "Cancel Workflow"}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {editing ? (
                <>
                  {editError && (
                    <p className="text-sm mb-4 px-4 py-3 rounded" style={{ background: theme.dangerSoft, color: theme.danger, border: `1px solid ${theme.danger}33` }}>
                      {editError}
                    </p>
                  )}
                  <div className="space-y-3 mb-4">
                    {editSigners.map((signer, index) => (
                      <div key={index} className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                        <Field label={`Signer ${index + 1} Name`}>
                          <input type="text" value={signer.name} onChange={(e) => updateEditSigner(index, "name", e.target.value)} className="w-full px-3 py-2 text-sm rounded outline-none" style={{ background: "#fff", border: `1px solid ${theme.border}`, color: "#1e293b" }} />
                        </Field>
                        <Field label="Email">
                          <input type="email" value={signer.email} onChange={(e) => updateEditSigner(index, "email", e.target.value)} className="w-full px-3 py-2 text-sm rounded outline-none" style={{ background: "#fff", border: `1px solid ${theme.border}`, color: "#1e293b" }} />
                        </Field>
                        <Field label="Mobile">
                          <input type="text" inputMode="numeric" maxLength={10} value={signer.mobile} onChange={(e) => updateEditSigner(index, "mobile", e.target.value)} className="w-full px-3 py-2 text-sm rounded outline-none" style={{ background: "#fff", border: `1px solid ${theme.border}`, color: "#1e293b" }} />
                        </Field>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={cancelEdit} disabled={resending} className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-60" style={{ background: "#fff", color: theme.ink, border: `1px solid ${theme.border}` }}>
                      Cancel
                    </button>
                    <button onClick={handleGenerateClick} disabled={resending} className="px-4 py-2 rounded text-sm font-semibold text-white disabled:opacity-60" style={{ background: theme.navy }}>
                      {resending ? "Sending..." : "Generate New Signing Request"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  {(esign?.signers || []).map((s, i) => (
                    <div key={s.id || i} className="p-4 rounded" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <p className="text-sm font-semibold" style={{ color: theme.ink }}>Signer {s.sequence ?? i + 1} · {s.signer_name}</p>
                          <p className="text-xs" style={{ color: theme.slate }}>{s.signer_email} · {s.signer_mobile}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {canCancelWorkflow && (s.status === "pending" || s.status === "sent") && (
                            <button
                              onClick={() => handleResendEmail(s.id)}
                              disabled={resendingSignerId === s.id}
                              className="text-xs font-semibold disabled:opacity-60"
                              style={{ color: theme.navy }}
                            >
                              {resendingSignerId === s.id ? "Sending..." : "Resend Email"}
                            </button>
                          )}
                          {signerStatusBadge(s.status)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Sent"><p className="text-xs" style={{ color: theme.ink }}>{formatDateTime(s.sent_at)}</p></Field>
                        <Field label="Signed"><p className="text-xs" style={{ color: theme.ink }}>{formatDateTime(s.signed_at)}</p></Field>
                      </div>
                    </div>
                  ))}
                  {(!esign?.signers || esign.signers.length === 0) && (
                    <p className="text-sm" style={{ color: theme.slate }}>Not sent for signature yet.</p>
                  )}
                </div>
              )}
            </section>
          )}

          {hasEsign && esign?.summary && (
            <section className="rounded-lg p-6" style={card}>
              <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>Workflow Summary</h2>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  ["Total", esign.summary.total],
                  ["Signed", esign.summary.signed],
                  ["Pending", esign.summary.pending],
                  ["Rejected", esign.summary.rejected],
                  ["Expired", esign.summary.expired],
                  ["Failed", esign.summary.failed],
                  ["Cancelled", esign.summary.cancelled],
                ].map(([label, value]) => (
                  <div key={label} className="p-3 rounded text-center" style={{ background: theme.bg }}>
                    <p className="text-lg font-bold" style={{ color: theme.ink }}>{value}</p>
                    <p className="text-xs" style={{ color: theme.slate }}>{label}</p>
                  </div>
                ))}
              </div>
              <div className="mb-4">
                <div className="flex justify-between text-xs mb-1" style={{ color: theme.slate }}>
                  <span>Completion</span>
                  <span>{esign.summary.completion_pct}%</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: theme.bg }}>
                  <div className="h-full rounded-full" style={{ width: `${esign.summary.completion_pct}%`, background: theme.success }} />
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default PartnerUserOrderDetails;
