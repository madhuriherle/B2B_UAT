import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiRequest } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { useAuth } from "../../lib/AuthContext";
import { portalBase } from "../../lib/roleHome";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const PAYMENT_BADGE = {
  success: { bg: "#E6F5EA", color: "#3D7A1F", label: "Paid" },
  pending: { bg: "#FEF3C7", color: "#92400E", label: "Awaiting Payment" },
  failed: { bg: "#FDECEC", color: "#C0392B", label: "Failed" },
};

// Mirrors AdminOrdersTab's own map — kept as a separate local copy rather
// than a shared import since each file's badge set is small and self
// contained, same pattern OrderDetail.jsx (B2B) already uses for its own
// statusBadge helper.
const DOC_STATUS_BADGE = {
  processing: { bg: "#E8F3FB", color: "#1E6091", label: "Processing" },
  completed: { bg: "#E6F5EA", color: "#3D7A1F", label: "Completed" },
  delivered: { bg: "#EFE8FB", color: "#6B21A8", label: "Delivered" },
  draft: { bg: "#E2EBF4", color: "#5B7285", label: "Draft" },
};

const Badge = ({ map, value }) => {
  const s = map[value] || { bg: "#E2EBF4", color: "#5B7285", label: value || "-" };
  return <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
};

const Field = ({ label, children }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#5B7285" }}>{label}</p>
    {children}
  </div>
);

const SectionTitle = ({ children }) => (
  <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>{children}</h2>
);

const AdminOrderDetail = () => {
  const { userDocId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const base = portalBase(user);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest(`/api/admin/orders/${userDocId}`)
      .then(setOrder)
      .catch((err) => setError(err.message));
  }, [userDocId]);

  if (error) {
    return (
      <div>
        <p className="text-sm" style={{ color: "#5B7285" }}>{error}</p>
        <Link to={`${base}/b2c-admin/orders`} className="text-xs font-semibold" style={{ color: "#1E6091" }}>← Back to Orders</Link>
      </div>
    );
  }
  if (!order) {
    return <p className="text-sm" style={{ color: "#5B7285" }}>Loading order...</p>;
  }

  const payment = order.payment || {};

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <Link to={`${base}/b2c-admin/orders`} className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#1E6091" }}>
            ← Back to Orders
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Order Details</h1>
        </div>
      </div>

      <section className="rounded-2xl p-6 mb-6" style={card}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-lg font-bold font-mono" style={{ color: "#6B21A8" }}>#{order.user_doc_id}</h2>
          <div className="flex items-center gap-2">
            <Badge map={PAYMENT_BADGE} value={order.payment_status} />
            <Badge map={DOC_STATUS_BADGE} value={order.doc_status} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Customer"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.user_name}</p></Field>
          <Field label="Email"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.user_email}</p></Field>
          <Field label="Document Type"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.doc_type}</p></Field>
          <Field label="State"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.state}</p></Field>
          <Field label="Created"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.created_at}</p></Field>
          <Field label="Last Modified"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.modified_at}</p></Field>
          {order.paid_date && <Field label="Paid Date"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.paid_date}</p></Field>}
          {order.invoice_number && <Field label="Invoice Number"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.invoice_number}</p></Field>}
        </div>
      </section>

      {order.fields?.length > 0 && (
        <section className="rounded-2xl p-6 mb-6" style={card}>
          <SectionTitle>Document Fields</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {order.fields.map((f) => (
              <Field key={f.label} label={f.label}><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{f.value ?? "-"}</p></Field>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl p-6" style={card}>
        <SectionTitle>Payment</SectionTitle>
        <div className="space-y-2">
          {[
            ["Document Price", payment.doc_price],
            ["Stamp", payment.stamp],
            ["Convenience Fee", payment.convenience_fee],
            ["Delivery Fee", payment.delivery_fee],
            ["Coupon Discount", payment.coupon_discount],
            ["GST", payment.gst],
          ].filter(([, v]) => Number(v) > 0).map(([label, amount]) => (
            <div key={label} className="flex justify-between text-sm">
              <span style={{ color: "#5B7285" }}>{label}</span>
              <span style={{ color: "#1e293b" }}>{formatCurrency(amount)}</span>
            </div>
          ))}
          <div className="flex justify-between text-sm pt-2 border-t" style={{ borderColor: "#D8E6F0" }}>
            <span className="font-semibold" style={{ color: "#0f172a" }}>Total</span>
            <span className="font-bold" style={{ color: "#0f172a" }}>{formatCurrency(payment.total)}</span>
          </div>
        </div>
        {payment.transaction_id && (
          <p className="text-xs mt-3" style={{ color: "#94a3b8" }}>Transaction #{payment.transaction_id} · {payment.created_at}</p>
        )}
      </section>

      <button
        onClick={() => navigate(`${base}/b2c-admin/orders`)}
        className="w-full mt-6 px-4 py-2.5 rounded-xl text-sm font-semibold"
        style={{ background: "#fff", color: "#334155", border: "1px solid #D8E6F0" }}
      >
        Back to Orders
      </button>
    </div>
  );
};

export default AdminOrderDetail;
