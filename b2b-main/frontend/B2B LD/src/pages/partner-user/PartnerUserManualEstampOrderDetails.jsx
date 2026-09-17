import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest, downloadFile } from "../../lib/api";
import { formatCurrency, GST_PERCENTAGE } from "../../lib/format";
import { theme, serif, card } from "../../lib/userPortalTheme";
import { STATUS_STYLES, formatDate } from "../partner/orders/orderShared";

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

// Service Charge/GST/Total breakdown from the backend's
// get_order_pricing_preview — see PartnerUserOrderDetails.jsx's own copy of
// this component for the full rationale. Only populated once the order
// reaches Completed (stamp amount + eSign charge, if any, are only final
// then), so this renders nothing before that.
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

const DocumentRow = ({ label, onDownload }) => (
  <div className="flex items-center justify-between p-3 rounded" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
    <p className="text-sm font-medium" style={{ color: theme.ink }}>{label}</p>
    <button onClick={onDownload} className="px-3 py-1.5 rounded text-xs font-semibold shrink-0 ml-3" style={{ background: theme.goldSoft, color: theme.navy }}>
      Download
    </button>
  </div>
);

const PartnerUserManualEstampOrderDetails = () => {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    apiRequest(`/api/partner-user/orders/${orderId}`)
      .then(setOrder)
      .catch((err) => setError(err.message));
  }, [orderId]);

  if (error) return <p className="text-sm" style={{ color: theme.danger }}>{error}</p>;
  if (!order) return <p className="text-sm" style={{ color: theme.slate }}>Loading order...</p>;

  const manual = order.manual_estamp;
  const esign = order.esign;
  const hasDelivery = !!manual?.delivery_full_name;

  const download = async (path, filename) => {
    setDownloadError("");
    try {
      await downloadFile(path, filename);
    } catch (err) {
      setDownloadError(err.message);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-start mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <div>
          <Link to="/user/orders" className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: theme.navy }}>
            ← Back to Orders
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>{order.order_no}</h1>
          <p className="text-sm mt-1" style={{ color: theme.slate }}>Manual eStamp order details</p>
        </div>
        <div className="flex items-center gap-3">
          {order.status === "Completed" && manual?.invoice_number && (
            <button
              onClick={() => download(`/api/partner-user/orders/${orderId}/invoice/pdf`, `${order.order_no}-invoice.pdf`)}
              className="px-4 py-2 rounded text-sm font-semibold"
              style={{ background: theme.navy, color: "#fff" }}
            >
              Download Invoice
            </button>
          )}
          {statusBadge(order.status)}
        </div>
      </div>

      {downloadError && <p className="text-xs mb-4" style={{ color: theme.danger }}>{downloadError}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        <div className="space-y-6">
          <section className="rounded-lg p-6" style={card}>
            <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>Order Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Order ID"><p className="text-sm font-medium" style={{ color: theme.ink }}>{order.order_no}</p></Field>
              <Field label="Service"><p className="text-sm font-medium" style={{ color: theme.ink }}>{order.service_name}</p></Field>
              <Field label="Created Date"><p className="text-sm font-medium" style={{ color: theme.ink }}>{formatDate(order.created_at)}</p></Field>
              <Field label="Status">{statusBadge(order.status)}</Field>
              <Field label="Customer"><p className="text-sm font-medium" style={{ color: theme.ink }}>{order.customer_name}</p></Field>
              <Field label="Customer Contact"><p className="text-sm font-medium" style={{ color: theme.ink }}>{order.customer_email} · {order.customer_mobile}</p></Field>
            </div>
          </section>

          {manual && (
            <section className="rounded-lg p-6" style={card}>
              <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>Stamp Details</h2>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Stamp State"><p className="text-sm font-medium" style={{ color: theme.ink }}>{manual.stamp_state_label}</p></Field>
                <Field label="Stamp Amount"><p className="text-sm font-medium" style={{ color: theme.ink }}>{formatCurrency(manual.stamp_amount)}</p></Field>
                <Field label="eSign Requested"><p className="text-sm font-medium" style={{ color: theme.ink }}>{manual.esign_required ? `Yes (${(manual.esign_signers || []).length} signer${(manual.esign_signers || []).length === 1 ? "" : "s"})` : "No"}</p></Field>
                <Field label="Physical Delivery"><p className="text-sm font-medium" style={{ color: theme.ink }}>{hasDelivery ? "Yes" : "No"}</p></Field>
              </div>
            </section>
          )}

          {manual?.charges?.length > 0 && (
            <section className="rounded-lg p-6" style={card}>
              <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>Charges</h2>
              <div className="space-y-2">
                {manual.charges.map((c) => (
                  <div key={c.charge_name} className="flex justify-between text-sm p-2.5 rounded" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                    <span style={{ color: theme.ink }}>{c.charge_name}</span>
                    <span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(c.price)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <PricingPreviewCard pricing={order.pricing_preview} />

          {manual?.esign_required && (
            <section className="rounded-lg p-6" style={card}>
              <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>Signers</h2>
              <div className="space-y-2">
                {(manual.esign_signers || []).map((s, i) => (
                  <div key={i} className="p-3 rounded text-sm" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                    <div className="flex items-center justify-between">
                      <p className="font-semibold" style={{ color: theme.ink }}>Signer {i + 1} · {s.name}</p>
                      {esign?.signers?.[i] && (
                        <span className="text-xs font-semibold capitalize" style={{ color: theme.slate }}>{esign.signers[i].status}</span>
                      )}
                    </div>
                    <p className="text-xs" style={{ color: theme.slate }}>{s.email} · {s.mobile}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {hasDelivery && (
            <section className="rounded-lg p-6" style={card}>
              <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>Delivery Address</h2>
              <div className="p-3 rounded text-sm" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                <p className="font-semibold" style={{ color: theme.ink }}>{manual.delivery_full_name} · {manual.delivery_mobile}</p>
                <p style={{ color: theme.ink }}>{manual.delivery_address_line1}{manual.delivery_address_line2 ? `, ${manual.delivery_address_line2}` : ""}</p>
                <p style={{ color: theme.ink }}>{manual.delivery_city}, {manual.delivery_state} - {manual.delivery_pincode}</p>
              </div>
            </section>
          )}
        </div>

        <div className="space-y-4">
          <section className="rounded-lg p-6 space-y-3" style={card}>
            <h2 className="text-base font-bold mb-1" style={{ color: theme.ink, fontFamily: serif }}>Documents</h2>

            {order.document_path && (
              <DocumentRow label="Original Document" onDownload={() => download(`/api/partner-user/orders/${orderId}/document`, `${order.order_no}-original.pdf`)} />
            )}

            {manual?.stamped_document_path ? (
              <DocumentRow label="Stamped Document" onDownload={() => download(`/api/partner-user/orders/${orderId}/document/manual-stamped-preview`, `${order.order_no}-stamped.pdf`)} />
            ) : (
              <div className="p-3 rounded text-xs" style={{ background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` }}>
                Stamped Document — pending manual processing.
              </div>
            )}

            {manual?.esign_required && (
              esign?.signed_file_path ? (
                <DocumentRow label="Final Signed Document" onDownload={() => download(`/api/partner-user/orders/${orderId}/document/signed-preview`, `${order.order_no}-signed.pdf`)} />
              ) : (
                <div className="p-3 rounded text-xs" style={{ background: theme.bg, color: theme.slate, border: `1px solid ${theme.border}` }}>
                  Final Signed Document — pending eSign.
                </div>
              )
            )}

            {!manual?.esign_required && order.status === "Completed" && (
              <p className="text-xs" style={{ color: theme.slate }}>No eSign was requested — the stamped document above is the final document.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default PartnerUserManualEstampOrderDetails;
