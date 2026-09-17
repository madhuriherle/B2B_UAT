import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiRequest, apiUpload, downloadFile } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../lib/AuthContext";
import { portalBase } from "../lib/roleHome";
import { STATUS_STYLES, formatDateTime } from "./partner/orders/orderShared";
import InvoiceViewModal from "../components/InvoiceViewModal";
import CancelOrderModal from "../components/CancelOrderModal";

const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const Field = ({ label, children }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#5B7285" }}>{label}</p>
    {children}
  </div>
);

const statusBadge = (status) => (
  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold" style={STATUS_STYLES[status] || { background: "#E2EBF4", color: "#5B7285" }}>
    {status}
  </span>
);

const SectionTitle = ({ children }) => (
  <h2 className="text-base font-bold mb-4" style={{ color: "#0f172a" }}>{children}</h2>
);

// ============================================================
// SERVICE SECTIONS — one per satellite table an order can carry.
// Each renders only when the order actually has that satellite row (see
// reports.get_order_report_detail, which returns null/None for whichever
// services this particular order never touched) — an order can show more
// than one of these at once (e.g. eStamp + eSign attached afterwards).
// ============================================================

const rateLabel = (item) => {
  if (!item.charge_type) return "-";
  return item.charge_type === "percentage" ? `${item.rate}%` : formatCurrency(item.rate);
};

const emptyDenomRow = { stamp_denomination_id: "", customValue: "", quantity: "1" };

// Same "preset ₹100/₹200 plus master list plus custom amount" selector as
// the Partner's own Bulk Stamp Requirements form (see
// PartnerUserCreateEstampBulk.jsx PRESET_DENOMINATIONS) — reused here so
// Admin's Add Denomination flow (used for eStamp-type orders once KASCoSA
// determines the actual denomination) looks and behaves the same way.
const PRESET_DENOMINATIONS = [100, 200];

// Pending -> Processed -> Completed. Mirrors partner.py's
// BULK_ESTAMP_STATUS_FLOW. Advancing to Completed is what actually deducts
// the stamp face value from the wallet and — since eStamp Bulk never
// currently coexists with another service on the same order — also
// completes the order as a whole (see update_bulk_estamp_order_status).
const BULK_NEXT_STATUS = {
  Pending: { next: "Processed", label: "Mark Processed" },
  Processed: { next: "Completed", label: "Mark eStamp Bulk Completed" },
};

const EstampBulkSection = ({ order, bulk, onUpdated, showToast }) => {
  const [updating, setUpdating] = useState(false);
  const [addingDenomination, setAddingDenomination] = useState(false);
  const [denominationRows, setDenominationRows] = useState([{ ...emptyDenomRow }]);
  const [savingDenomination, setSavingDenomination] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [denominations, setDenominations] = useState([]);
  // Completing an eStamp Bulk order requires the physical stamp paper's
  // certificate number (see update_bulk_estamp_order_status's server-side
  // requirement) — collected via this popup rather than a plain button
  // click, since it's the one piece of data only Admin has at that moment.
  const [stampNumberModalOpen, setStampNumberModalOpen] = useState(false);
  const [stampNumberInput, setStampNumberInput] = useState("");

  const isEstampOrder = bulk?.stamp_paper_type === "eStamp";
  const denominationAdded = bulk?.items?.length > 0;
  const nextAction = BULK_NEXT_STATUS[order.status];
  // Matches partner.cancel_bulk_estamp_order's own allowed-status check —
  // once Processed moves to Completed the wallet's already been debited for
  // real, so there's nothing left to release.
  const canCancel = order.status === "Pending" || order.status === "Processed";

  // Same master data the Partner's own create-order form uses for this
  // state (see PartnerUserCreateEstampBulk.jsx) — /api/stamps returns every
  // state's rows so this filters to just the one this order is for.
  useEffect(() => {
    if (!bulk?.stamp_state_id) return;
    apiRequest("/api/stamps")
      .then((all) => setDenominations(all.filter((d) => d.state_id === bulk.stamp_state_id && d.is_active)))
      .catch(() => setDenominations([]));
  }, [bulk?.stamp_state_id]);

  const denominationById = (id) => denominations.find((d) => String(d.id) === String(id));
  const rowDenominationValue = (row) => {
    if (row.stamp_denomination_id === "custom") return Number(row.customValue) || 0;
    if (row.stamp_denomination_id?.startsWith("preset-")) return Number(row.stamp_denomination_id.slice(7)) || 0;
    return Number(denominationById(row.stamp_denomination_id)?.stamp_value) || 0;
  };
  const rowFaceValue = (row) => {
    const qty = parseInt(row.quantity, 10);
    const value = rowDenominationValue(row);
    return value > 0 && qty > 0 ? value * qty : 0;
  };
  // Reverse-maps an already-saved item's raw amount back to a selector
  // value when Admin reopens the form to correct it (see "Correct
  // Denomination" below) — prefers the real master row for that value, then
  // falls back to the preset shortcuts, then to "type your own amount".
  const resolveDenominationRow = (item) => {
    const master = denominations.find((d) => Number(d.stamp_value) === Number(item.denomination));
    if (master) return { stamp_denomination_id: String(master.id), customValue: "", quantity: String(item.quantity) };
    if (PRESET_DENOMINATIONS.includes(Number(item.denomination))) {
      return { stamp_denomination_id: `preset-${item.denomination}`, customValue: "", quantity: String(item.quantity) };
    }
    return { stamp_denomination_id: "custom", customValue: String(item.denomination), quantity: String(item.quantity) };
  };

  const advanceStatus = async (nextStatus, stampNumber) => {
    setUpdating(true);
    try {
      await apiRequest(`/api/estamp-bulk/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify(stampNumber !== undefined ? { status: nextStatus, stamp_number: stampNumber } : { status: nextStatus }),
      });
      showToast(`eStamp Bulk marked ${nextStatus}.`);
      onUpdated();
      return true;
    } catch (err) {
      showToast(err.message);
      return false;
    } finally {
      setUpdating(false);
    }
  };

  const handleAdvanceClick = () => {
    if (nextAction.next === "Completed") {
      setStampNumberInput("");
      setStampNumberModalOpen(true);
      return;
    }
    advanceStatus(nextAction.next);
  };

  const handleConfirmCompleteWithStampNumber = async () => {
    if (!stampNumberInput.trim()) {
      showToast("Enter the stamp number");
      return;
    }
    const ok = await advanceStatus("Completed", stampNumberInput.trim());
    if (ok) setStampNumberModalOpen(false);
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await apiRequest(`/api/estamp-bulk/orders/${order.id}/cancel`, { method: "POST" });
      showToast("Order cancelled — any blocked wallet amount has been released.");
      setConfirmingCancel(false);
      onUpdated();
    } catch (err) {
      showToast(err.message);
    } finally {
      setCancelling(false);
    }
  };

  const startAddingDenomination = () => {
    setDenominationRows(bulk.items?.length ? bulk.items.map(resolveDenominationRow) : [{ ...emptyDenomRow }]);
    setAddingDenomination(true);
  };

  const addDenomRow = () => setDenominationRows((prev) => [...prev, { ...emptyDenomRow }]);
  const removeDenomRow = (index) => setDenominationRows((prev) => prev.filter((_, i) => i !== index));
  const updateDenomRow = (index, field, value) =>
    setDenominationRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));

  const handleSaveDenomination = async () => {
    const items = [];
    for (const row of denominationRows) {
      const denomination = rowDenominationValue(row);
      const quantity = Number(row.quantity);
      if (!row.stamp_denomination_id || !denomination || denomination <= 0) {
        showToast("Select a valid denomination for every line");
        return;
      }
      if (!quantity || quantity < 1) {
        showToast("Enter a valid quantity (at least 1) for every line");
        return;
      }
      items.push({ denomination, quantity });
    }
    setSavingDenomination(true);
    try {
      await apiRequest(`/api/estamp-bulk/orders/${order.id}/denomination`, {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      setAddingDenomination(false);
      setDenominationRows([{ ...emptyDenomRow }]);
      showToast("Denomination saved — pricing recalculated.");
      onUpdated();
    } catch (err) {
      showToast(err.message);
    } finally {
      setSavingDenomination(false);
    }
  };

  return (
    <section className="rounded-2xl p-6 space-y-4" style={card}>
      <div className="flex items-center justify-between">
        <SectionTitle>eStamp Bulk</SectionTitle>
        {statusBadge(order.status)}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Stamp State"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{bulk.stamp_state_label}</p></Field>
        <Field label="Total Quantity"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{bulk.total_quantity}</p></Field>
        {bulk.stamp_number && (
          <Field label="Stamp Number"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{bulk.stamp_number}</p></Field>
        )}
        {isEstampOrder && (
          <>
            <Field label="Consideration Amount"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{formatCurrency(bulk.consideration_amount)}</p></Field>
            <Field label="Article Code"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{bulk.article_code || "-"}{bulk.article_code_description ? ` — ${bulk.article_code_description}` : ""}</p></Field>
          </>
        )}
      </div>

      {bulk.first_party_name && (
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>First Party</p>
            <p className="text-sm font-semibold" style={{ color: "#0f172a" }}>{bulk.first_party_name}</p>
            <p className="text-sm mt-1" style={{ color: "#5B7285" }}>{bulk.first_party_address}</p>
          </div>
          <div className="rounded-lg p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>Second Party</p>
            <p className="text-sm font-semibold" style={{ color: "#0f172a" }}>{bulk.second_party_name}</p>
            <p className="text-sm mt-1" style={{ color: "#5B7285" }}>{bulk.second_party_address}</p>
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#5B7285" }}>{isEstampOrder ? "Denomination" : "Bulk Stamp Requirements"}</p>

        {isEstampOrder && !denominationAdded && !addingDenomination ? (
          <div className="rounded-lg p-4" style={{ background: "#FFF7ED", border: "1px solid #FDBA74" }}>
            <p className="text-sm font-semibold mb-1" style={{ color: "#0f172a" }}>Denomination: Not Added</p>
            <p className="text-xs mb-3" style={{ color: "#92400E" }}>
              Check KASCoSA using the Article Code and Consideration Amount above to determine the applicable stamp denomination(s), then enter them here.
            </p>
            <button onClick={startAddingDenomination} className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: "#1E6091" }}>
              Add Denomination
            </button>
          </div>
        ) : addingDenomination ? (
          <div className="rounded-lg p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
            <div className="rounded-lg overflow-hidden mb-3" style={{ border: "1px solid #D8E6F0" }}>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#fff" }}>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Denomination</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Quantity</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Face Value</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {denominationRows.map((row, index) => (
                    <tr key={index} className="border-t" style={{ borderColor: "#E2EBF4", background: "#fff" }}>
                      <td className="px-3 py-2">
                        <select
                          value={row.stamp_denomination_id}
                          onChange={(e) => updateDenomRow(index, "stamp_denomination_id", e.target.value)}
                          className="px-3 py-2 text-sm rounded-lg outline-none w-full"
                          style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#1e293b" }}
                        >
                          <option value="">Select</option>
                          {PRESET_DENOMINATIONS.filter((v) => !denominations.some((d) => Number(d.stamp_value) === v)).map((v) => (
                            <option key={`preset-${v}`} value={`preset-${v}`}>₹{v}</option>
                          ))}
                          {denominations.map((d) => (<option key={d.id} value={d.id}>₹{d.stamp_value}</option>))}
                          <option value="custom">Other (type amount)</option>
                        </select>
                        {row.stamp_denomination_id === "custom" && (
                          <input
                            type="number" min="1" step="1" autoFocus={index === 0}
                            value={row.customValue}
                            onChange={(e) => updateDenomRow(index, "customValue", e.target.value)}
                            placeholder="Enter denomination amount"
                            className="px-3 py-2 text-sm rounded-lg outline-none w-full mt-2"
                            style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#1e293b" }}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number" min="1" step="1"
                          value={row.quantity}
                          onChange={(e) => updateDenomRow(index, "quantity", e.target.value)}
                          placeholder="Qty"
                          className="px-3 py-2 text-sm rounded-lg outline-none w-24"
                          style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#1e293b" }}
                        />
                      </td>
                      <td className="px-3 py-2 font-semibold" style={{ color: "#0f172a" }}>
                        {formatCurrency(rowFaceValue(row))}
                      </td>
                      <td className="px-3 py-2">
                        {denominationRows.length > 1 && (
                          <button onClick={() => removeDenomRow(index)} className="text-xs font-semibold px-2" style={{ color: "#DC2626" }}>Remove</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <button onClick={addDenomRow} className="text-xs font-semibold" style={{ color: "#1E6091" }}>+ Add another line</button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setAddingDenomination(false); setDenominationRows([{ ...emptyDenomRow }]); }}
                  className="px-3 py-2 rounded-lg text-sm font-semibold"
                  style={{ background: "#E2EBF4", color: "#334155" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDenomination}
                  disabled={savingDenomination}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "#1E6091" }}
                >
                  {savingDenomination ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-lg overflow-hidden mb-3" style={{ border: "1px solid #D8E6F0" }}>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#F3F8FB" }}>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Denomination</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Quantity</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Face Value</th>
                    {isEstampOrder && (
                      <>
                        <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Rate</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold uppercase" style={{ color: "#5B7285" }}>Service Charge</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {bulk.items.map((item) => (
                    <tr key={item.id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                      <td className="px-3 py-2" style={{ color: "#0f172a" }}>₹{item.denomination}</td>
                      <td className="px-3 py-2" style={{ color: "#0f172a" }}>{item.quantity}</td>
                      <td className="px-3 py-2 font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(item.face_value)}</td>
                      {isEstampOrder && (
                        <>
                          <td className="px-3 py-2" style={{ color: "#0f172a" }}>{rateLabel(item)}</td>
                          <td className="px-3 py-2 font-semibold" style={{ color: "#0f172a" }}>{item.service_charge != null ? formatCurrency(item.service_charge) : "-"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                  {bulk.items.length === 0 && (
                    <tr><td colSpan={isEstampOrder ? 5 : 3} className="px-3 py-3 text-sm text-center" style={{ color: "#5B7285" }}>No denomination added yet.</td></tr>
                  )}
                </tbody>
              </table>
              </div>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t" style={{ borderColor: "#E2EBF4" }}>
              <span style={{ color: "#5B7285" }}>Total Face Value</span>
              <span className="font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(bulk.total_face_value)}</span>
            </div>
            {isEstampOrder && order.status !== "Completed" && bulk.items.length > 0 && (
              <div className="mt-3 pt-3 border-t" style={{ borderColor: "#E2EBF4" }}>
                <button onClick={startAddingDenomination} className="text-xs font-semibold" style={{ color: "#1E6091" }}>Correct Denomination</button>
              </div>
            )}
          </>
        )}
      </div>

      {bulk.delivery_full_name && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#5B7285" }}>Delivery Details</p>
          <div className="grid grid-cols-2 gap-4 rounded-lg p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
            <Field label="Full Name"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{bulk.delivery_full_name}</p></Field>
            <Field label="Mobile"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{bulk.delivery_mobile}</p></Field>
            <div className="col-span-2">
              <Field label="Address">
                <p className="text-sm font-medium" style={{ color: "#0f172a" }}>
                  {bulk.delivery_address_line1}{bulk.delivery_address_line2 ? `, ${bulk.delivery_address_line2}` : ""}, {bulk.delivery_city}, {bulk.delivery_state} {bulk.delivery_pincode}
                </p>
              </Field>
            </div>
          </div>
        </div>
      )}

      {order.status !== "Completed" && (
        <div className="pt-2 border-t space-y-3" style={{ borderColor: "#E2EBF4" }}>
          {nextAction && (
            <>
              <button
                onClick={handleAdvanceClick}
                disabled={updating || (nextAction.next === "Completed" && isEstampOrder && !denominationAdded)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
              >
                {updating ? "Updating..." : nextAction.label}
              </button>
              {nextAction.next === "Completed" && (
                <p className="text-xs" style={{ color: "#5B7285" }}>
                  {isEstampOrder && !denominationAdded
                    ? "Add the denomination above before completing this service."
                    : "eStamp Bulk is the only service on this order, so this also completes the order and generates its invoice(s)."}
                </p>
              )}
            </>
          )}

          {canCancel && (
            !confirmingCancel ? (
              <button
                onClick={() => setConfirmingCancel(true)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FCA5A5" }}
              >
                Cancel Order
              </button>
            ) : (
              <div className="space-y-3 rounded-xl p-4" style={{ background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
                <p className="text-sm font-semibold" style={{ color: "#0f172a" }}>
                  Cancel this order? {bulk.total_face_value > 0 ? `The ₹${Number(bulk.total_face_value).toLocaleString("en-IN")} blocked for its stamp value will be released back to the wallet.` : ""}
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setConfirmingCancel(false)}
                    className="px-3 py-2 rounded-lg text-sm font-semibold"
                    style={{ background: "#fff", color: "#334155", border: "1px solid #D8E6F0" }}
                  >
                    Keep Order
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: "#DC2626" }}
                  >
                    {cancelling ? "Cancelling..." : "Yes, Cancel Order"}
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {stampNumberModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl" style={{ background: "#fff" }}>
            <div className="p-6">
              <h2 className="text-lg font-bold mb-1" style={{ color: "#0f172a" }}>Enter Stamp Number</h2>
              <p className="text-sm mb-4" style={{ color: "#5B7285" }}>
                Enter the certificate/stamp number of the physical stamp paper procured for this order before marking it Completed.
              </p>
              <input
                type="text"
                autoFocus
                value={stampNumberInput}
                onChange={(e) => setStampNumberInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmCompleteWithStampNumber(); }}
                placeholder="Stamp number"
                className="w-full px-4 py-2.5 text-sm rounded-xl outline-none"
                style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}
              />
            </div>
            <div className="px-6 py-4 border-t flex items-center justify-end gap-2" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
              <button
                onClick={() => setStampNumberModalOpen(false)}
                disabled={updating}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ background: "#fff", color: "#334155", border: "1px solid #D8E6F0" }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCompleteWithStampNumber}
                disabled={updating || !stampNumberInput.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
              >
                {updating ? "Completing..." : "Mark Completed"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const MANUAL_NEXT_LABEL = {
  Submitted: "Start Processing",
};

const ManualEstampSection = ({ order, manual, esign, onUpdated, showToast }) => {
  const [stampedFile, setStampedFile] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [downloadingOriginal, setDownloadingOriginal] = useState(false);

  // The document the partner/user uploaded at order creation — same file
  // the Partner/User Portals' own /orders/{id}/document endpoints serve,
  // just via the admin-scoped equivalent (Super Admin isn't a member of
  // the order's own organization, so it needs its own org-scoped route —
  // see organizations.download_organization_order_document). This existed
  // on the backend already; the "Submitted" step below used to just say
  // "Download the original document..." with nothing to actually click.
  const handleDownloadOriginal = async () => {
    setDownloadingOriginal(true);
    try {
      await downloadFile(`/api/organizations/${order.organization_id}/orders/${order.id}/document`, `${order.order_no}-original.pdf`);
    } catch (err) {
      showToast(err.message);
    } finally {
      setDownloadingOriginal(false);
    }
  };

  const runAction = async (action, successMsg) => {
    setUpdating(true);
    try {
      await action();
      setStampedFile(null);
      showToast(successMsg);
      onUpdated();
    } catch (err) {
      showToast(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const patchStatus = (status, successMsg) =>
    runAction(() => apiRequest(`/api/manual-estamp/orders/${order.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }), successMsg);

  const handleStartProcessing = () => patchStatus("Stamp Processing", "Order moved to Stamp Processing.");
  const handleUploadStamped = () => {
    if (!stampedFile) return;
    const formData = new FormData();
    formData.append("file", stampedFile);
    runAction(() => apiUpload(`/api/manual-estamp/orders/${order.id}/stamped-document`, formData), "Stamped document uploaded. Marked Stamp Completed.");
  };
  const handleSendForEsign = () => runAction(() => apiRequest(`/api/manual-estamp/orders/${order.id}/send-for-esign`, { method: "POST" }), "Sent for eSign.");
  const handleMarkOrderCompleted = () => patchStatus("Completed", "Order marked Completed. The stamp value has been deducted from the wallet.");

  return (
    <section className="rounded-2xl p-6 space-y-4" style={card}>
      <div className="flex items-center justify-between">
        <SectionTitle>Manual eStamp</SectionTitle>
        {statusBadge(order.status)}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Field label="State"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{manual.stamp_state_label}</p></Field>
        <Field label="Stamp Amount"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{formatCurrency(manual.stamp_amount)}</p></Field>
        <Field label="Service Fee"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{formatCurrency(manual.service_fee)}</p></Field>
      </div>

      {manual.delivery_full_name && (
        <div className="grid grid-cols-2 gap-4 rounded-lg p-4" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
          <Field label="Full Name"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{manual.delivery_full_name}</p></Field>
          <Field label="Mobile"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{manual.delivery_mobile}</p></Field>
          <div className="col-span-2">
            <Field label="Address">
              <p className="text-sm font-medium" style={{ color: "#0f172a" }}>
                {manual.delivery_address_line1}{manual.delivery_address_line2 ? `, ${manual.delivery_address_line2}` : ""}, {manual.delivery_city}, {manual.delivery_state} {manual.delivery_pincode}
              </p>
            </Field>
          </div>
        </div>
      )}

      {order.status === "Submitted" && (
        <div className="pt-2 border-t space-y-2" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Download the original document, complete the physical/manual stamping outside the system, then start processing.</p>
          <div className="flex items-center gap-2">
            <button onClick={handleDownloadOriginal} disabled={downloadingOriginal} className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ background: "#E8F3FB", color: "#1E6091" }}>
              {downloadingOriginal ? "Downloading..." : "Download Document"}
            </button>
            <button onClick={handleStartProcessing} disabled={updating} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              {updating ? "Updating..." : MANUAL_NEXT_LABEL.Submitted}
            </button>
          </div>
        </div>
      )}

      {order.status === "Stamp Processing" && (
        <div className="pt-2 border-t space-y-2" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>Once the physical stamping is complete, upload the stamped document below.</p>
          <button onClick={handleDownloadOriginal} disabled={downloadingOriginal} className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ background: "#E8F3FB", color: "#1E6091" }}>
            {downloadingOriginal ? "Downloading..." : "Download Original Document"}
          </button>
          {!stampedFile ? (
            <input type="file" accept="application/pdf" onChange={(e) => setStampedFile(e.target.files?.[0] || null)} className="w-full px-4 py-2.5 text-sm rounded-xl outline-none" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }} />
          ) : (
            <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
              <p className="text-sm font-semibold truncate" style={{ color: "#0f172a" }}>{stampedFile.name}</p>
              <button onClick={() => setStampedFile(null)} className="text-xs font-semibold shrink-0 ml-3" style={{ color: "#176B87" }}>Remove</button>
            </div>
          )}
          <button onClick={handleUploadStamped} disabled={!stampedFile || updating} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            {updating ? "Uploading..." : "Mark Stamp Completed"}
          </button>
        </div>
      )}

      {order.status === "Stamp Completed" && !manual.esign_required && (
        <div className="pt-2 border-t space-y-2" style={{ borderColor: "#E2EBF4" }}>
          <p className="text-sm" style={{ color: "#5B7285" }}>No eSign was requested. The stamped document is final — this completes the order.</p>
          <button onClick={handleMarkOrderCompleted} disabled={updating} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            {updating ? "Updating..." : "Mark Order Completed"}
          </button>
        </div>
      )}

      {manual.esign_required && ["Stamp Completed", "eSign Pending", "eSign Completed"].includes(order.status) && (
        <div className="pt-2 border-t space-y-3" style={{ borderColor: "#E2EBF4" }}>
          <div className="flex justify-between text-sm">
            <span style={{ color: "#5B7285" }}>Signers</span>
            <span className="font-semibold" style={{ color: "#0f172a" }}>{(manual.esign_signers || []).length}</span>
          </div>
          <div className="space-y-2">
            {(manual.esign_signers || []).map((s, i) => (
              <div key={i} className="p-2.5 rounded-lg text-xs" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                <div className="flex items-center justify-between">
                  <p className="font-semibold" style={{ color: "#0f172a" }}>Signer {i + 1} · {s.name}</p>
                  {esign?.signers?.[i] && <span className="capitalize font-semibold" style={{ color: "#5B7285" }}>{esign.signers[i].status}</span>}
                </div>
                <p style={{ color: "#5B7285" }}>{s.email} · {s.mobile}</p>
              </div>
            ))}
          </div>
          {order.status === "Stamp Completed" && (
            <button onClick={handleSendForEsign} disabled={updating} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              {updating ? "Sending..." : "Send for eSign"}
            </button>
          )}
          {order.status === "eSign Pending" && <p className="text-xs" style={{ color: "#5B7285" }}>Awaiting signatures.</p>}
          {order.status === "eSign Completed" && (
            <button onClick={handleMarkOrderCompleted} disabled={updating} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
              {updating ? "Updating..." : "Mark Order Completed"}
            </button>
          )}
        </div>
      )}

      {order.status === "Completed" && (
        <p className="text-sm font-medium px-4 py-3 rounded-xl" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
          Completed. The stamp value has been deducted from the wallet and the final document is available to the user.
        </p>
      )}

    </section>
  );
};

// b2b_stamp_transaction.status is lowercase (processing/completed/failed —
// see stamp_service.py) unlike orders.status/STATUS_STYLES' Title Case keys.
const STAMP_STATUS_LABEL = { processing: "Processing", completed: "Completed", failed: "Failed" };

// Single/API eStamp (SignDesk DSS-integrated) — driven by the partner-user
// flow (stamp_service.initiate_stamp), nothing for Super Admin to advance
// here; this is a read-only status view of what SignDesk already returned.
const EstampSection = ({ stamp }) => (
  <section className="rounded-2xl p-6 space-y-3" style={card}>
    <div className="flex items-center justify-between">
      <SectionTitle>eStamp</SectionTitle>
      {statusBadge(STAMP_STATUS_LABEL[stamp.status] || stamp.status)}
    </div>
    <div className="grid grid-cols-2 gap-4">
      {stamp.stamp_paper_number && <Field label="Stamp Paper Number"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{stamp.stamp_paper_number}</p></Field>}
      {stamp.stamp_duty_amount != null && <Field label="Stamp Duty Amount"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{formatCurrency(stamp.stamp_duty_amount)}</p></Field>}
    </div>
    {stamp.error_message && <p className="text-xs" style={{ color: "#B91C1C" }}>{stamp.error_message}</p>}
  </section>
);

// eSign — shared by every order type that can carry it (plain eSign order,
// Manual eStamp's eSign leg is shown inline in its own section instead, and
// an eStamp order with eSign attached afterwards). Lets Super Admin manually
// flip a stuck signer to Signed after confirming completion out-of-band
// (e.g. the signed-copy email SignDesk sends directly to the signer) — a
// safety net for when SignDesk's completion webhook never arrives, see
// app/esign_service.py's admin_mark_signer_signed.
const EsignSection = ({ order, onUpdated, showToast, allowManualOverride }) => {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noteBySigner, setNoteBySigner] = useState({});
  const [submittingSignerId, setSubmittingSignerId] = useState(null);

  const load = () => {
    setLoading(true);
    apiRequest(`/api/esign-admin/orders/${order.id}`)
      .then(setOverview)
      .catch(() => setOverview(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [order.id]);

  const handleMarkSigned = async (signerId) => {
    const note = (noteBySigner[signerId] || "").trim();
    if (!note) {
      showToast("Enter a note explaining how signing was confirmed");
      return;
    }
    setSubmittingSignerId(signerId);
    try {
      await apiRequest(`/api/esign-admin/orders/${order.id}/signers/${signerId}/mark-signed`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      load();
      onUpdated();
    } catch (err) {
      showToast(err.message);
    } finally {
      setSubmittingSignerId(null);
    }
  };

  return (
    <section className="rounded-2xl p-6 space-y-3" style={card}>
      <div className="flex items-center justify-between">
        <SectionTitle>eSign</SectionTitle>
        {overview && statusBadge(overview.status)}
      </div>
      {loading ? (
        <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>
      ) : !overview ? (
        <p className="text-sm" style={{ color: "#5B7285" }}>eSign details unavailable.</p>
      ) : (
        <div className="space-y-2">
          {overview.error && <p className="text-xs" style={{ color: "#B91C1C" }}>{overview.error}</p>}
          {overview.signers.map((s) => (
            <div key={s.id} className="rounded-xl p-3" style={{ background: s.status === "signed" ? "#E6F5EA" : "#F3F8FB", border: `1px solid ${s.status === "signed" ? "#16A34A" : "#D8E6F0"}` }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold" style={{ color: "#1e293b" }}>{s.signer_name}</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: s.status === "signed" ? "#16A34A" : "#E2EBF4", color: s.status === "signed" ? "#fff" : "#5B7285" }}>{s.status}</span>
              </div>
              <p className="text-xs mb-2" style={{ color: "#5B7285" }}>{s.signer_email}</p>
              {s.status === "signed" ? (
                <p className="text-xs" style={{ color: "#5B7285" }}>Signed {s.signed_at ? new Date(s.signed_at).toLocaleString("en-IN") : ""}</p>
              ) : allowManualOverride ? (
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="text"
                    value={noteBySigner[s.id] || ""}
                    onChange={(e) => setNoteBySigner((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    placeholder="How was signing confirmed? (required)"
                    className="flex-1 px-3 py-2 text-xs rounded-lg outline-none"
                    style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#1e293b" }}
                  />
                  <button
                    onClick={() => handleMarkSigned(s.id)}
                    disabled={submittingSignerId === s.id}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-60 flex-shrink-0"
                    style={{ background: "#16A34A" }}
                  >
                    {submittingSignerId === s.id ? "Saving..." : "Mark as Signed"}
                  </button>
                </div>
              ) : (
                <p className="text-xs" style={{ color: "#94A3B8" }}>Awaiting signature — completes automatically once SignDesk confirms signing.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

// ============================================================
// FINANCIAL SUMMARY — the order's own pre-tax component breakdown (charges +
// stamp face value), which always sums to order.amount exactly since it's
// read straight from the same rows the order was priced from at creation/
// completion time — never a value re-derived or recomputed in the frontend.
// ============================================================

const FinancialSummary = ({ order, charges }) => {
  const bulk = order.bulk_estamp;
  const manual = order.manual_estamp;
  const rows = [];
  // Everything except the stamp face value — that's the only part of an
  // eStamp Bulk order the Service Invoice actually taxes (see
  // invoice_service._resolve_order_invoice's bulk branch: face value goes
  // on the separate, always-0%-GST Reimbursement invoice instead).
  let bulkServiceChargeTotal = 0;

  if (bulk) {
    if (Number(bulk.total_face_value) > 0) rows.push(["Stamp Face Value / Reimbursement", bulk.total_face_value]);
    if (Number(bulk.service_fee) > 0) {
      rows.push(["Service Fee", bulk.service_fee]);
      bulkServiceChargeTotal += Number(bulk.service_fee);
    }
    if (bulk.charges?.length) {
      for (const c of bulk.charges) {
        if (Number(c.price) > 0) {
          // Display-only relabel — stored/invoiced as "Bulk eStamp Pricing"
          // (kept distinct from org-level Additional Charges so the two can
          // never collide into two identically-named rows), shown as
          // "Service Charge" here and on the invoice (see accounts.py's
          // _with_totals for the matching PDF/view-modal relabel).
          const label = c.charge_name === "Bulk eStamp Pricing" ? "Service Charge" : c.charge_name;
          rows.push([label, c.price]);
          bulkServiceChargeTotal += Number(c.price);
        }
      }
    } else if (Number(bulk.delivery_charge) > 0) {
      rows.push(["Delivery Charge", bulk.delivery_charge]);
      bulkServiceChargeTotal += Number(bulk.delivery_charge);
    }
  } else if (manual) {
    if (Number(manual.stamp_amount) > 0) rows.push(["Stamp Amount", manual.stamp_amount]);
    if (Number(manual.service_fee) > 0) rows.push(["Service Fee", manual.service_fee]);
    for (const c of manual.charges || []) if (Number(c.price) > 0) rows.push([c.charge_name, c.price]);
    if (manual.esign_required) {
      const signerCount = (manual.esign_signers || []).length;
      const esignTotal = Number(order.esign_price_per_signer || 0) * signerCount;
      if (esignTotal > 0) rows.push(["eSign Fee", esignTotal]);
    }
  } else {
    for (const c of charges) if (Number(c.price) > 0) rows.push([c.charge_name, c.price]);
    if (rows.length === 0 && Number(order.amount) > 0) rows.push(["Service Charge", order.amount]);
  }

  // GST rate/split is never guessed here — it's the exact figure
  // invoice_service would apply to this order's bill-to state (see
  // reports.get_order_report_detail's service_charge_gst), so this preview
  // can never disagree with what the Service Invoice actually charges.
  const gstRate = bulk && order.service_charge_gst ? Number(order.service_charge_gst.rate) : null;
  const gstAmount = gstRate != null && bulkServiceChargeTotal > 0 ? (bulkServiceChargeTotal * gstRate) / 100 : 0;

  return (
    <section className="rounded-2xl p-6" style={card}>
      <SectionTitle>Financial Summary</SectionTitle>
      <div className="space-y-2">
        {rows.map(([label, amount]) => (
          <div key={label} className="flex justify-between text-sm">
            <span style={{ color: "#5B7285" }}>{label}</span>
            <span style={{ color: "#1e293b" }}>{formatCurrency(amount)}</span>
          </div>
        ))}
        {gstRate != null && gstAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span style={{ color: "#5B7285" }}>GST on Service Charge ({gstRate}%)</span>
            <span style={{ color: "#1e293b" }}>{formatCurrency(gstAmount)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm pt-2 border-t" style={{ borderColor: "#D8E6F0" }}>
          <span className="font-semibold" style={{ color: "#0f172a" }}>Order Total</span>
          <span className="font-bold" style={{ color: "#0f172a" }}>{formatCurrency(order.amount)}</span>
        </div>
        {gstRate != null && gstAmount > 0 && (
          <div className="flex justify-between text-sm">
            <span className="font-semibold" style={{ color: "#0f172a" }}>Total (incl. GST)</span>
            <span className="font-bold" style={{ color: "#0f172a" }}>{formatCurrency(Number(order.amount) + gstAmount)}</span>
          </div>
        )}
      </div>
      {bulk ? (
        <p className="text-xs mt-3" style={{ color: "#94a3b8" }}>
          Stamp Face Value is never taxed. Order Total is what's debited from the wallet (pre-GST) — the Service Invoice below carries the GST shown here.
        </p>
      ) : (
        <p className="text-xs mt-3" style={{ color: "#94a3b8" }}>GST is applied on the invoice(s) below, not here — see Invoices.</p>
      )}
    </section>
  );
};

// Wallet credit(s)/debit(s) raised specifically to cover THIS order (see
// reports.get_order_report_detail's financial_transactions — order_id
// linkage only, never inferred from amount/date/partner). Renders nothing
// when the order has none, rather than a fake/empty section.
const WalletReimbursement = ({ order, financialTransactions }) => {
  if (!financialTransactions.length) return null;
  return (
    <section className="rounded-2xl p-6" style={card}>
      <SectionTitle>Wallet / Reimbursement</SectionTitle>
      <div className="space-y-2">
        {financialTransactions.map((t) => (
          <div key={t.id} className="rounded-xl p-3 flex items-center justify-between" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#0f172a" }}>{t.type === "credit" ? "Wallet Reimbursement" : "Wallet Debit"}: {formatCurrency(t.amount)}</p>
              {t.description && <p className="text-xs" style={{ color: "#5B7285" }}>{t.description}</p>}
              <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>Order ID: {order.order_no}</p>
            </div>
            <div className="text-right">
              {t.type === "credit" ? (
                <>
                  <p className="text-xs font-semibold" style={{ color: t.invoice_number ? "#3D7A1F" : "#92400E" }}>{t.invoice_number ? "Invoiced" : "Pending"}</p>
                  {t.invoice_number && <p className="text-xs" style={{ color: "#5B7285" }}>{t.invoice_number}</p>}
                </>
              ) : (
                // A debit is just the ledger deduction for a charge already
                // covered by the order's own invoice(s) below — it never
                // gets an invoice of its own, so there's no Pending/Invoiced
                // state to show for it (unlike a credit, which funds a
                // Reimbursement invoice — see get_or_create_reimbursement_
                // invoice_for_wallet_credit, called for credits only).
                <p className="text-xs" style={{ color: "#5B7285" }}>Deducted</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

// Invoice rows already generated (Service and/or Reimbursement — an order
// can have both, see invoice_service._resolve_order_invoice) plus a manual
// "Generate Invoice" action for whichever type(s) are still Pending, for ANY
// service (not only eStamp Bulk — a plain eSign/Manual eStamp/single eStamp
// order can just as easily be sitting Completed with an invoice that never
// auto-generated). One button covers both types at once: the backend
// (reports.generate_order_invoice -> invoice_service.get_or_create_invoice_
// for_order) resolves exactly which invoice(s) this order actually needs and
// is idempotent, so it never duplicates an invoice that already exists and
// never fabricates one for a type this order doesn't produce.
const InvoicesSection = ({ order, invoices, onGenerated, showToast }) => {
  const [generating, setGenerating] = useState(false);
  const [viewingInvoiceId, setViewingInvoiceId] = useState(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await apiRequest(`/api/reports/orders/${order.id}/generate-invoice`, { method: "POST" });
      const newCount = result.length - invoices.length;
      showToast(
        newCount > 0
          ? `${newCount} ${order.service_name} invoice${newCount > 1 ? "s" : ""} generated for order ${order.order_no}.`
          : `No new invoice to generate for this ${order.service_name} order — already up to date.`
      );
      onGenerated();
    } catch (err) {
      showToast(err.message);
    } finally {
      setGenerating(false);
    }
  };

  // What each invoice_type actually represents, in plain language, tied to
  // THIS order's own service — the generic "Reimbursement Invoice"/"Service
  // Invoice" labels alone don't say what they're for, which gets genuinely
  // confusing on an eStamp Bulk order (the one case with two invoices to
  // track at once — see invoice_service._resolve_order_invoice).
  const invoiceSubtitle = (invoiceType) =>
    invoiceType === "Reimbursement"
      ? `${order.service_name} stamp/denomination value — no GST`
      : `${order.service_name} service charge (incl. GST)`;

  // Generating would just 400 from the backend until the order reaches
  // whatever "financially final" state invoice_service._resolve_order_
  // invoice requires for its service — Draft is never final for any
  // service, and eStamp Bulk/Manual eStamp specifically aren't final until
  // Completed (see their own status gates there). Showing the button
  // regardless of status let Admin click it prematurely and just get an
  // error instead of the button simply not being there yet.
  const requiresCompleted = ["eStamp Bulk", "Manual eStamp"].includes(order.service_name);
  const canGenerateInvoice =
    !order.invoices_complete &&
    !["eKYC", "eSign"].includes(order.service_name) &&
    order.status !== "Draft" &&
    (!requiresCompleted || order.status === "Completed");

  return (
    <section className="rounded-2xl p-6 space-y-3" style={card}>
      <div className="flex items-center justify-between">
        <SectionTitle>Invoices</SectionTitle>
      </div>
      <p className="text-xs -mt-2" style={{ color: "#94a3b8" }}>For this {order.service_name} order ({order.order_no})</p>
      {invoices.length === 0 ? (
        <p className="text-sm" style={{ color: "#5B7285" }}>
          No {order.service_name} invoices generated yet — they generate automatically{" "}
          {order.service_name === "eKYC" ? "once verification succeeds." : "once this order is fully Completed."}
        </p>
      ) : (
        <div className="space-y-2">
          {invoices.map((inv) => (
            <button
              key={inv.invoice_number}
              type="button"
              onClick={() => setViewingInvoiceId(inv.invoice_id)}
              className="w-full flex items-center justify-between rounded-xl p-3 text-left transition-colors hover:opacity-90"
              style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: "#0f172a" }}>{inv.invoice_type === "Reimbursement" ? "Reimbursement Invoice" : "Service Invoice"}</p>
                <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>{invoiceSubtitle(inv.invoice_type)}</p>
                <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>{inv.invoice_number}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold" style={{ color: "#3D7A1F" }}>Generated</p>
                <p className="text-sm font-semibold" style={{ color: "#0f172a" }}>{formatCurrency(inv.amount)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      {/* eKYC and eSign now auto-invoice/auto-charge the moment their own
          real completion signal fires (DigiLocker/PAN verification;
          every signer finishing, including the real SignDesk webhook —
          see ekyc_service._auto_invoice_ekyc_on_verification and
          esign_service.record_callback's charge_wallet=True) — Super Admin
          never needs to click anything for these two, so the button is
          never shown at all, not even as a manual fallback. Every other
          service (eStamp Bulk, Manual eStamp, Document Service, eNotary,
          eSBTR) still needs it, either as their only invoicing trigger or
          as the fallback when their own Completed-triggered auto-hook
          silently fails. */}
      {canGenerateInvoice && (
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
        >
          {generating ? "Generating..." : `Generate ${order.service_name} Invoice`}
        </button>
      )}
      {viewingInvoiceId && (
        <InvoiceViewModal
          fetchUrl={`/api/accounts/invoices/${viewingInvoiceId}`}
          downloadUrl={`/api/accounts/invoices/${viewingInvoiceId}/pdf`}
          onClose={() => setViewingInvoiceId(null)}
        />
      )}
    </section>
  );
};

// ============================================================
// PAGE
// ============================================================

const OrderDetail = () => {
  const { orderId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const base = portalBase(user);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [showCancel, setShowCancel] = useState(false);

  const load = () => {
    apiRequest(`/api/reports/orders/${orderId}`)
      .then(setOrder)
      .catch((err) => setError(err.message));
  };

  useEffect(load, [orderId]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  if (error) {
    return (
      <div>
        <p className="text-sm" style={{ color: "#5B7285" }}>{error}</p>
        <Link to={`${base}/reports/orders`} className="text-xs font-semibold" style={{ color: "#1E6091" }}>← Back to Orders</Link>
      </div>
    );
  }
  if (!order) {
    return <p className="text-sm" style={{ color: "#5B7285" }}>Loading order...</p>;
  }

  const hasBulk = !!order.bulk_estamp;
  const hasManual = !!order.manual_estamp;
  const hasStamp = !!order.stamp;
  const hasEsign = !!order.esign;
  const noServiceSection = !hasBulk && !hasManual && !hasStamp && !hasEsign;

  // eKYC never actually reaches a status literally called "Completed" —
  // 'Verified' (DigiLocker/PAN confirmed) and 'Document Extracted'
  // (terminal state for doc types with no verification path, e.g. Passport)
  // are its two real finished states (see ekyc_service._sync_ekyc_order_
  // status). Both mean the order is genuinely done, so the Overall Status
  // badge shows "Completed" here for clarity — this is a display label
  // only; order.status itself is untouched everywhere else (still exactly
  // what _auto_invoice_ekyc_on_verification/InvoicesSection etc. check).
  const overallStatusLabel =
    order.service_name === "eKYC" && ["Verified", "Document Extracted"].includes(order.status)
      ? "Completed"
      : order.status;

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white max-w-xl" style={{ background: "#16A34A" }}>
          {toast}
        </div>
      )}

      <div className="flex justify-between items-start mb-6">
        <div>
          <Link to={`${base}/reports/orders`} className="text-xs font-semibold inline-flex items-center gap-1 mb-2" style={{ color: "#1E6091" }}>
            ← Back to Orders
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "#0f172a" }}>Order Details</h1>
        </div>
      </div>

      <section className="rounded-2xl p-6 mb-6" style={card}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>{order.order_no}</h2>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#5B7285" }}>Overall Status</p>
            {statusBadge(overallStatusLabel)}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Partner"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.partner_name || "-"}</p></Field>
          <Field label="User"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.user_name || "-"}</p></Field>
          <Field label="Customer"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{order.customer_name || "-"}</p></Field>
          <Field label="Created Date"><p className="text-sm font-medium" style={{ color: "#0f172a" }}>{formatDateTime(order.created_at)}</p></Field>
        </div>
        {order.cancellation_reason && (
          <div className="mt-4 rounded-xl p-3" style={{ background: "#FDECEC", border: "1px solid #F5C6C0" }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#C0392B" }}>Cancellation Reason</p>
            <p className="text-sm" style={{ color: "#7A241C" }}>{order.cancellation_reason}</p>
          </div>
        )}
        {order.status !== "Cancelled" && (
          <div className="mt-4 pt-4 border-t" style={{ borderColor: "#E2EBF4" }}>
            <button
              onClick={() => setShowCancel(true)}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FCA5A5" }}
            >
              Cancel Order
            </button>
          </div>
        )}
      </section>

      <div className="space-y-6">
        {hasBulk && <EstampBulkSection order={order} bulk={order.bulk_estamp} onUpdated={load} showToast={showToast} />}
        {hasManual && <ManualEstampSection order={order} manual={order.manual_estamp} esign={order.esign} onUpdated={load} showToast={showToast} />}
        {hasStamp && <EstampSection stamp={order.stamp} />}
        {hasEsign && (
          <EsignSection
            order={order}
            onUpdated={load}
            showToast={showToast}
            // The manual "Mark as Signed" override is a safety net for when
            // eSign is a follow-on step attached to a stamp order (plain
            // eStamp, Manual eStamp, eStamp Bulk) — for a plain "eSign" (or
            // "eKYC", which never actually reaches this branch) order, Admin
            // should never manually override signing status; it's read-only
            // here and only ever completes via the real SignDesk callback.
            allowManualOverride={!["eSign", "eKYC"].includes(order.service_name)}
          />
        )}

        {noServiceSection && (
          <section className="rounded-2xl p-6" style={card}>
            <SectionTitle>Service</SectionTitle>
            <p className="text-sm" style={{ color: "#0f172a" }}>{order.service_name || "-"}</p>
          </section>
        )}

        <FinancialSummary order={order} charges={order.charges} />
        <WalletReimbursement order={order} financialTransactions={order.financial_transactions} />
        <InvoicesSection order={order} invoices={order.invoices} onGenerated={load} showToast={showToast} />
      </div>

      <button
        onClick={() => navigate(`${base}/reports/orders`)}
        className="w-full mt-6 px-4 py-2.5 rounded-xl text-sm font-semibold"
        style={{ background: "#fff", color: "#334155", border: "1px solid #D8E6F0" }}
      >
        Back to Orders
      </button>

      {showCancel && (
        <CancelOrderModal
          order={order}
          onClose={() => setShowCancel(false)}
          onCancelled={() => {
            setShowCancel(false);
            load();
          }}
        />
      )}
    </div>
  );
};

export default OrderDetail;
