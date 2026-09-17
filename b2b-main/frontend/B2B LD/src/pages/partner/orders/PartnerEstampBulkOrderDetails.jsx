import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiRequest, downloadFile } from "../../../lib/api";
import { formatCurrency } from "../../../lib/format";
import { theme, serif, card } from "../../../lib/userPortalTheme";
import { STATUS_STYLES, formatDate, formatDateTime } from "./orderShared";

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

const PartnerEstampBulkOrderDetails = () => {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [invoiceError, setInvoiceError] = useState("");

  useEffect(() => {
    apiRequest(`/api/partner/orders/${orderId}`)
      .then(setOrder)
      .catch((err) => setError(err.message));
  }, [orderId]);

  if (error) return <p className="text-sm" style={{ color: theme.danger }}>{error}</p>;
  if (!order) return <p className="text-sm" style={{ color: theme.slate }}>Loading order...</p>;

  const bulk = order.bulk_estamp;
  const isEstampOrder = bulk?.stamp_paper_type === "eStamp";
  const denominationAdded = bulk?.items?.length > 0;

  const handleDownloadInvoice = async () => {
    setInvoiceError("");
    try {
      await downloadFile(`/api/partner/orders/${orderId}/invoice/pdf`, `${order.order_no}-invoice.pdf`);
    } catch (err) {
      setInvoiceError(err.message);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-start mb-6 pb-4 border-b" style={{ borderColor: theme.border }}>
        <div>
          <Link to="/partner/orders" className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: theme.navy }}>
            ← Back to Orders
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>{order.order_no}</h1>
          <p className="text-sm mt-1" style={{ color: theme.slate }}>eStamp Bulk order details</p>
        </div>
        <div className="text-right">
          {order.status === "Completed" && bulk?.invoice_number && (
            <button onClick={handleDownloadInvoice} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: theme.navy, color: "#fff" }}>
              Download Invoice
            </button>
          )}
          {invoiceError && <p className="text-xs mt-2 max-w-xs" style={{ color: theme.danger }}>{invoiceError}</p>}
        </div>
      </div>

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
              {bulk?.delivered_at && (
                <Field label="Delivered At"><p className="text-sm font-medium" style={{ color: theme.ink }}>{formatDateTime(bulk.delivered_at)}</p></Field>
              )}
            </div>
          </section>

          {bulk && (
            <section className="rounded-lg p-6" style={card}>
              <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>
                {isEstampOrder ? "eStamp Details" : "Bulk Stamp Requirements"}
              </h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Field label="Stamp State"><p className="text-sm font-medium" style={{ color: theme.ink }}>{bulk.stamp_state_label}</p></Field>
                <Field label="Total Stamp Papers"><p className="text-sm font-medium" style={{ color: theme.ink }}>{bulk.total_quantity}</p></Field>
                {isEstampOrder && (
                  <>
                    <Field label="Consideration Amount"><p className="text-sm font-medium" style={{ color: theme.ink }}>{formatCurrency(bulk.consideration_amount)}</p></Field>
                    <Field label="Article Code">
                      <p className="text-sm font-medium" style={{ color: theme.ink }}>
                        {bulk.article_code || "-"}{bulk.article_code_description ? ` — ${bulk.article_code_description}` : ""}
                      </p>
                    </Field>
                  </>
                )}
              </div>

              {isEstampOrder && !denominationAdded ? (
                <div className="rounded p-3 text-sm" style={{ background: theme.bg, border: `1px solid ${theme.border}`, color: theme.slate }}>
                  Denomination: To be determined by Admin
                </div>
              ) : (
                <>
                  <div className="rounded overflow-hidden mb-3" style={{ border: `1px solid ${theme.border}` }}>
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: theme.bg }}>
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: theme.slate }}>Denomination</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: theme.slate }}>Quantity</th>
                          <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: theme.slate }}>Face Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulk.items.map((item) => (
                          <tr key={item.id} className="border-t" style={{ borderColor: theme.border }}>
                            <td className="px-3 py-2" style={{ color: theme.ink }}>₹{item.denomination}</td>
                            <td className="px-3 py-2" style={{ color: theme.ink }}>{item.quantity}</td>
                            <td className="px-3 py-2 font-semibold" style={{ color: theme.ink }}>{formatCurrency(item.face_value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    </div>
                  </div>
                  <div className="flex justify-between text-sm pt-2 border-t" style={{ borderColor: theme.border }}>
                    <span style={{ color: theme.slate }}>Total Stamp Face Value</span>
                    <span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(bulk.total_face_value)}</span>
                  </div>
                </>
              )}
            </section>
          )}

          {bulk && (
            <section className="rounded-lg p-6" style={card}>
              <h2 className="text-base font-bold mb-4" style={{ color: theme.ink, fontFamily: serif }}>Delivery Address</h2>
              <div className="p-3 rounded text-sm mb-4" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
                <p className="font-semibold" style={{ color: theme.ink }}>{bulk.delivery_full_name} · {bulk.delivery_mobile}</p>
                <p style={{ color: theme.ink }}>{bulk.delivery_address_line1}{bulk.delivery_address_line2 ? `, ${bulk.delivery_address_line2}` : ""}</p>
                <p style={{ color: theme.ink }}>{bulk.delivery_city}, {bulk.delivery_state} - {bulk.delivery_pincode}</p>
              </div>
              {Number(bulk.delivery_charge) > 0 && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: theme.slate }}>Delivery Charge</span>
                  <span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(bulk.delivery_charge)}</span>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="space-y-4">
          <section className="rounded-lg p-6 space-y-2 text-sm" style={card}>
            <h2 className="text-base font-bold mb-3" style={{ color: theme.ink, fontFamily: serif }}>Pricing</h2>
            {bulk && (
              <>
                {(!isEstampOrder || denominationAdded) && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>Stamp Face Value</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(bulk.total_face_value)}</span></div>
                )}
                {Number(bulk.service_fee) > 0 && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>Service Fee</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(bulk.service_fee)}</span></div>
                )}
                {bulk.charges && bulk.charges.length > 0 ? (
                  bulk.charges
                    .filter((c) => Number(c.price) > 0)
                    .map((c) => (
                      <div className="flex justify-between" key={c.charge_name}>
                        <span style={{ color: theme.slate }}>{c.charge_name}</span>
                        <span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(c.price)}</span>
                      </div>
                    ))
                ) : (
                  Number(bulk.delivery_charge) > 0 && (
                    <div className="flex justify-between"><span style={{ color: theme.slate }}>Delivery Charge</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(bulk.delivery_charge)}</span></div>
                  )
                )}
                {Number(bulk.cgst_amount) > 0 && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>CGST (9%)</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(bulk.cgst_amount)}</span></div>
                )}
                {Number(bulk.sgst_amount) > 0 && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>SGST (9%)</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(bulk.sgst_amount)}</span></div>
                )}
                {Number(bulk.igst_amount) > 0 && (
                  <div className="flex justify-between"><span style={{ color: theme.slate }}>IGST (18%)</span><span className="font-semibold" style={{ color: theme.ink }}>{formatCurrency(bulk.igst_amount)}</span></div>
                )}
              </>
            )}
            <div className="flex justify-between pt-2 border-t" style={{ borderColor: theme.border }}>
              <span style={{ color: theme.slate }}>Total Payable</span>
              <span className="font-semibold" style={{ color: theme.navy }}>{formatCurrency(bulk?.total_payable ?? order.amount)}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PartnerEstampBulkOrderDetails;
