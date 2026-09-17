import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, downloadFile } from "../../../lib/api";
import { formatCurrency } from "../../../lib/format";
import Modal from "../../../components/Modal";
import OrderStatusTracker from "./OrderStatusTracker";
import { STATUS_STYLES, formatDate, canSubmitOrder, canCancelOrder } from "./orderShared";
import { useConfirm } from "../../../components/ConfirmProvider";


const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const statusBadge = (status) => (
  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold" style={STATUS_STYLES[status] || { background: "#E2EBF4", color: "#334155" }}>
    {status}
  </span>
);

const TrackStatusModal = ({ order, onClose }) => (
  <Modal title="Track Status" subtitle={`${order.order_no} · ${order.customer_name}`} onClose={onClose}>
    <OrderStatusTracker status={order.status} updatedAt={order.updated_at} />
  </Modal>
);

const OrderListView = ({ title, subtitle, statuses, emptyText }) => {
  const { confirm, alert } = useConfirm();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadOrders = () => {
    setLoading(true);
    apiRequest(`/api/partner/orders?status=${encodeURIComponent(statuses.join(","))}`)
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses.join(",")]);

  const handleDownload = async (order) => {
    try {
      await downloadFile(`/api/partner/orders/${order.id}/document`, order.document_filename);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleSubmit = async (order) => {
    setBusyId(order.id);
    try {
      await apiRequest(`/api/partner/orders/${order.id}/submit`, { method: "POST" });
      showToast(`${order.order_no} submitted`);
      loadOrders();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleCancel = async (order) => {
    if (!await confirm(`Cancel order ${order.order_no}?`)) return;
    setBusyId(order.id);
    try {
      await apiRequest(`/api/partner/orders/${order.id}/cancel`, { method: "POST" });
      showToast(`${order.order_no} cancelled`);
      loadOrders();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>{title}</h1>
          <p className="text-sm mt-1" style={{ color: "#5B7285" }}>{subtitle}</p>
        </div>
        <button onClick={() => navigate("/partner/orders/create")} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
          + Create Order
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["Order ID", "Customer", "Service", "Created Date", "Amount", "Status", "Actions"].map((h) => (
                  <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-4"><p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{order.order_no}</p></td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium" style={{ color: "#1e293b" }}>{order.customer_name}</p>
                    <p className="text-xs" style={{ color: "#5B7285" }}>{order.customer_email}</p>
                  </td>
                  <td className="px-5 py-4 text-sm" style={{ color: "#1e293b" }}>{order.service_name}</td>
                  <td className="px-5 py-4 text-sm whitespace-nowrap" style={{ color: "#5B7285" }}>{formatDate(order.created_at)}</td>
                  <td className="px-5 py-4 text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(order.amount)}</td>
                  <td className="px-5 py-4">{statusBadge(order.status)}</td>
                  <td className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button onClick={() => navigate(`/partner/orders/${order.id}`)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E8F3FB", color: "#1E6091" }}>View</button>
                      {order.document_filename && (
                        <button onClick={() => handleDownload(order)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#E2EBF4", color: "#334155" }}>Download</button>
                      )}
                      <button onClick={() => setModal({ order })} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors" style={{ background: "#D8E6F0", color: "#334155" }}>Track</button>
                      {canSubmitOrder(order) && (
                        <button onClick={() => handleSubmit(order)} disabled={busyId === order.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>Submit</button>
                      )}
                      {canCancelOrder(order) && (
                        <button onClick={() => handleCancel(order)} disabled={busyId === order.id} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60" style={{ background: "#FEE2E2", color: "#B91C1C" }}>Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && orders.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "#E2EBF4" }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                      </div>
                      <p className="font-semibold" style={{ color: "#5B7285" }}>{emptyText}</p>
                    </div>
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="7" className="text-center py-16 text-sm" style={{ color: "#5B7285" }}>Loading orders...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Showing <span className="font-semibold" style={{ color: "#1e293b" }}>{orders.length}</span> orders</p>
        </div>
      </div>

      {modal && <TrackStatusModal order={modal.order} onClose={() => setModal(null)} />}
    </div>
  );
};

export default OrderListView;

