import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest, downloadFile } from "../../../lib/api";
import { formatCurrency, GST_PERCENTAGE } from "../../../lib/format";
import OrderStatusTracker from "./OrderStatusTracker";
import { STATUS_STYLES, formatDate, canSubmitOrder, canCancelOrder } from "./orderShared";
import { useConfirm } from "../../../components/ConfirmProvider";


const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const Field = ({ label, children }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#5B7285" }}>{label}</p>
    {children}
  </div>
);

const statusBadge = (status) => (
  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold" style={STATUS_STYLES[status] || { background: "#E2EBF4", color: "#334155" }}>
    {status}
  </span>
);

// Same {lines, gst_amount, total_payable} shape as the User portal's
// PricingPreviewCard (see PartnerUserOrderDetails.jsx) — null just hides
// the card, for an order not far enough along yet for a real number.
const PricingPreviewCard = ({ pricing }) => {
  if (!pricing) return null;
  return (
    <section className="rounded-2xl p-6 mb-6" style={card}>
      <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Pricing</h2>
      <div className="space-y-2 text-sm">
        {pricing.lines.map((line, i) => (
          <div className="flex justify-between" key={`${line.description}-${i}`}>
            <span style={{ color: "#5B7285" }}>{line.description}</span>
            <span className="font-semibold" style={{ color: "#1e293b" }}>{formatCurrency(line.amount)}</span>
          </div>
        ))}
        {Number(pricing.gst_amount) > 0 && (
          <div className="flex justify-between">
            <span style={{ color: "#5B7285" }}>GST ({GST_PERCENTAGE}%)</span>
            <span className="font-semibold" style={{ color: "#1e293b" }}>{formatCurrency(pricing.gst_amount)}</span>
          </div>
        )}
        <div className="flex justify-between pt-2 border-t" style={{ borderColor: "#D8E6F0" }}>
          <span style={{ color: "#5B7285" }}>Total Payable</span>
          <span className="font-semibold" style={{ color: "#176B87" }}>{formatCurrency(pricing.total_payable)}</span>
        </div>
      </div>
    </section>
  );
};

const PartnerOrderDetails = () => {
  const { confirm, alert } = useConfirm();
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadOrder = () => {
    setLoading(true);
    apiRequest(`/api/partner/orders/${orderId}`)
      .then(setOrder)
      .catch(() => setOrder(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const handleDownload = async () => {
    try {
      await downloadFile(`/api/partner/orders/${order.id}/document`, order.document_filename);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleSubmit = async () => {
    setBusy(true);
    try {
      await apiRequest(`/api/partner/orders/${order.id}/submit`, { method: "POST" });
      showToast("Order submitted");
      loadOrder();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!await confirm(`Cancel order ${order.order_no}?`)) return;
    setBusy(true);
    try {
      await apiRequest(`/api/partner/orders/${order.id}/cancel`, { method: "POST" });
      showToast("Order cancelled");
      loadOrder();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm" style={{ color: "#5B7285" }}>Loading order...</p>;
  if (!order) return <p className="text-sm" style={{ color: "#5B7285" }}>Order not found.</p>;

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <Link to="/partner/orders/drafts" className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#16A34A" }}>
            ← Back to Orders
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>{order.order_no}</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>Order details</p>
        </div>
        <div className="flex items-center gap-2">
          {order.document_filename && (
            <button onClick={handleDownload} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Download</button>
          )}
          {canSubmitOrder(order) && (
            <button onClick={handleSubmit} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Submit Order</button>
          )}
          {canCancelOrder(order) && (
            <button onClick={handleCancel} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ background: "#FEE2E2", color: "#B91C1C" }}>Cancel Order</button>
          )}
        </div>
      </div>

      <section className="rounded-2xl p-6 mb-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Order Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Field label="Customer Name"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{order.customer_name}</p></Field>
          <Field label="Customer Email"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{order.customer_email}</p></Field>
          <Field label="Customer Mobile"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{order.customer_mobile}</p></Field>
          <Field label="Service"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{order.service_name}</p></Field>
          <Field label="Amount"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{formatCurrency(order.amount)}</p></Field>
          <Field label="Status">{statusBadge(order.status)}</Field>
          <Field label="Created Date"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{formatDate(order.created_at)}</p></Field>
          <Field label="Last Updated"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{formatDate(order.updated_at)}</p></Field>
          <Field label="Document"><p className="text-sm font-medium" style={{ color: "#1e293b" }}>{order.document_filename || "-"}</p></Field>
        </div>
      </section>

      <PricingPreviewCard pricing={order.pricing_preview} />

      <section className="rounded-2xl p-6" style={card}>
        <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>Track Status</h2>
        <OrderStatusTracker status={order.status} updatedAt={order.updated_at} />
      </section>
    </div>
  );
};

export default PartnerOrderDetails;

