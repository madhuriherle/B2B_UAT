import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";

const inputClass = "w-full px-3 py-2 text-sm rounded-lg outline-none";
const inputStyle = { background: "#fff", border: "1px solid #D8E6F0", color: "#1e293b" };

const emptyForm = { denomination_type: "customize", denomination_from: "", denomination_to: "", quantity_from: "", quantity_to: "", charge_type: "fixed_amount", charge: "", is_active: true };

// 'fixed_amount': line service charge = charge (rate) x quantity. 'percentage':
// line service charge = that line's own denomination x charge% x quantity —
// see partner.calculate_bulk_estamp_line_charge, the one place this formula
// actually lives server-side; this is only a label helper for display here.
const formatRate = (rule) => (rule.charge_type === "percentage" ? `${rule.charge}%` : formatCurrency(rule.charge));

// 'any' rules are open-ended from an admin-entered starting denomination
// (denomination_to is null/Infinity server-side) — NOT a catch-all from ₹0,
// so the display always shows the real From value plus "Unlimited" instead
// of collapsing to a bare "Any" label, per product requirement.
const formatDenomination = (rule) => (rule.denomination_type === "any" ? `₹${rule.denomination_from} – Unlimited` : `₹${rule.denomination_from}–₹${rule.denomination_to}`);

// Super Admin's per-partner tiered pricing for eStamp Bulk — an additional
// charge on top of whatever "Service Charge"/other charges are already
// assigned above (see Quotation.jsx's Additional Charges block), applied by
// matching a denomination + quantity to a rule's range at order-creation
// time (see partner._match_bulk_estamp_pricing_rule). Every range/charge
// value here is admin-entered; nothing is a fixed business constant —
// mirrors organizations.py's BulkEstampPricingRuleIn validation exactly so
// a rejected save always has an explanation the admin can act on.
const BulkEstampPricingPanel = ({ organizationId }) => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null); // null = not editing, "new" = adding, else the rule's id
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    apiRequest(`/api/organizations/${organizationId}/estamp-bulk-pricing-rules`)
      .then(setRules)
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [organizationId]);

  const startAdd = () => {
    setForm(emptyForm);
    setEditingId("new");
    setError("");
  };
  const startEdit = (rule) => {
    setForm({
      denomination_type: rule.denomination_type,
      denomination_from: rule.denomination_from,
      denomination_to: rule.denomination_type === "any" ? "" : rule.denomination_to,
      quantity_from: rule.quantity_from, quantity_to: rule.quantity_to ?? "",
      charge_type: rule.charge_type, charge: rule.charge, is_active: rule.is_active,
    });
    setEditingId(rule.id);
    setError("");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setError("");
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const isAny = form.denomination_type === "any";
      const payload = {
        denomination_type: form.denomination_type,
        denomination_from: Number(form.denomination_from),
        denomination_to: isAny ? null : Number(form.denomination_to),
        quantity_from: Number(form.quantity_from),
        quantity_to: form.quantity_to === "" ? null : Number(form.quantity_to),
        charge_type: form.charge_type,
        charge: Number(form.charge),
        is_active: form.is_active,
      };
      if (editingId === "new") {
        await apiRequest(`/api/organizations/${organizationId}/estamp-bulk-pricing-rules`, {
          method: "POST", body: JSON.stringify(payload),
        });
      } else {
        await apiRequest(`/api/organizations/${organizationId}/estamp-bulk-pricing-rules/${editingId}`, {
          method: "PATCH", body: JSON.stringify(payload),
        });
      }
      setEditingId(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rule) => {
    setError("");
    try {
      await apiRequest(`/api/organizations/${organizationId}/estamp-bulk-pricing-rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          denomination_type: rule.denomination_type,
          denomination_from: rule.denomination_from, denomination_to: rule.denomination_to,
          quantity_from: rule.quantity_from, quantity_to: rule.quantity_to,
          charge_type: rule.charge_type, charge: rule.charge, is_active: !rule.is_active,
        }),
      });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const requestDelete = (rule) => {
    setDeleteTarget(rule);
    setError("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setError("");
    setDeleting(true);
    try {
      await apiRequest(`/api/organizations/${organizationId}/estamp-bulk-pricing-rules/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mt-3 pt-3" style={{ borderTop: "1px dashed #C9DCE8" }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#94A3B8" }}>Bulk eStamp Pricing (Denomination x Quantity tiers)</p>
        {editingId === null && (
          <button type="button" onClick={startAdd} className="text-xs font-semibold" style={{ color: "#1E6091" }}>+ Add Rule</button>
        )}
      </div>
      {error && <p className="text-xs mb-2 px-2 py-1.5 rounded" style={{ background: "#FEE2E2", color: "#B91C1C" }}>{error}</p>}

      {loading ? (
        <p className="text-xs" style={{ color: "#94A3B8" }}>Loading...</p>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid #E2EBF4" }}>
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                <th className="text-left px-2 py-1.5 font-semibold uppercase" style={{ color: "#94A3B8" }}>Denomination</th>
                <th className="text-left px-2 py-1.5 font-semibold uppercase" style={{ color: "#94A3B8" }}>Quantity</th>
                <th className="text-left px-2 py-1.5 font-semibold uppercase" style={{ color: "#94A3B8" }}>Charge Type</th>
                <th className="text-left px-2 py-1.5 font-semibold uppercase" style={{ color: "#94A3B8" }}>Rate</th>
                <th className="text-left px-2 py-1.5 font-semibold uppercase" style={{ color: "#94A3B8" }}>Status</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-2 py-1.5" style={{ color: "#1e293b" }}>
                    {r.denomination_type === "any" && (
                      <span className="mr-1.5 px-1.5 py-0.5 rounded font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>Any</span>
                    )}
                    {formatDenomination(r)}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: "#1e293b" }}>{r.quantity_from}–{r.quantity_to ?? "Unlimited"}</td>
                  <td className="px-2 py-1.5" style={{ color: "#1e293b" }}>{r.charge_type === "percentage" ? "Percentage" : "Fixed Amount"}</td>
                  <td className="px-2 py-1.5 font-semibold" style={{ color: "#1e293b" }}>{formatRate(r)}</td>
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => toggleActive(r)}
                      className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={r.is_active ? { background: "#E6F5EA", color: "#3D7A1F" } : { background: "#E2EBF4", color: "#5B7285" }}
                    >
                      {r.is_active ? "Active" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <button type="button" onClick={() => startEdit(r)} className="mr-2 font-semibold" style={{ color: "#1E6091" }}>Edit</button>
                    <button type="button" onClick={() => requestDelete(r)} className="font-semibold" style={{ color: "#DC2626" }}>Delete</button>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && editingId === null && (
                <tr><td colSpan={6} className="px-2 py-3 text-center" style={{ color: "#94A3B8" }}>No pricing rules configured yet.</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {editingId !== null && (
        <div className="mt-2 rounded-lg p-3" style={{ background: "#F8FAFC", border: "1px solid #E2EBF4" }}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-medium mb-1 min-h-[28px] leading-tight" style={{ color: "#94A3B8" }}>Denomination *</label>
              <select value={form.denomination_type} onChange={(e) => setForm({ ...form, denomination_type: e.target.value })} className={inputClass} style={inputStyle}>
                <option value="any">Any</option>
                <option value="customize">Customize</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-1 min-h-[28px] leading-tight" style={{ color: "#94A3B8" }}>Denomination From *</label>
              <input type="number" min="0" value={form.denomination_from} onChange={(e) => setForm({ ...form, denomination_from: e.target.value })} className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-1 min-h-[28px] leading-tight" style={{ color: "#94A3B8" }}>
                Denomination To {form.denomination_type === "customize" ? "*" : ""}
              </label>
              {form.denomination_type === "any" ? (
                <input type="text" value="Unlimited / ∞" disabled className={inputClass} style={{ ...inputStyle, background: "#F1F5F9", color: "#94A3B8", cursor: "not-allowed" }} />
              ) : (
                <input type="number" min="0" value={form.denomination_to} onChange={(e) => setForm({ ...form, denomination_to: e.target.value })} className={inputClass} style={inputStyle} />
              )}
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-1 min-h-[28px] leading-tight" style={{ color: "#94A3B8" }}>Quantity From *</label>
              <input type="number" min="1" value={form.quantity_from} onChange={(e) => setForm({ ...form, quantity_from: e.target.value })} className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-1 min-h-[28px] leading-tight" style={{ color: "#94A3B8" }}>Quantity To</label>
              <input type="number" min="1" value={form.quantity_to} onChange={(e) => setForm({ ...form, quantity_to: e.target.value })} placeholder="Unlimited" className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-1 min-h-[28px] leading-tight" style={{ color: "#94A3B8" }}>Charge Type *</label>
              <select value={form.charge_type} onChange={(e) => setForm({ ...form, charge_type: e.target.value })} className={inputClass} style={inputStyle}>
                <option value="fixed_amount">Fixed Amount</option>
                <option value="percentage">Percentage</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium mb-1 min-h-[28px] leading-tight" style={{ color: "#94A3B8" }}>
                {form.charge_type === "percentage" ? "Rate (%) *" : "Rate / Amount (₹) *"}
              </label>
              <input type="number" min="0" max={form.charge_type === "percentage" ? 100 : undefined} value={form.charge} onChange={(e) => setForm({ ...form, charge: e.target.value })} className={inputClass} style={inputStyle} />
            </div>
          </div>
          <p className="text-[10px] mt-1.5" style={{ color: "#94A3B8" }}>
            {form.charge_type === "percentage"
              ? "Service charge per matching line = denomination x rate% x quantity."
              : "Service charge per matching line = rate x quantity."}
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={cancelEdit} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E2EBF4", color: "#334155" }}>Cancel</button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60" style={{ background: "#1E6091" }}>
              {saving ? "Saving..." : "Save Rule"}
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.45)" }}>
          <div className="w-full max-w-sm rounded-2xl shadow-2xl" style={{ background: "#fff", border: "1px solid #D8E6F0" }}>
            <div className="px-5 py-4 border-b" style={{ borderColor: "#E2EBF4" }}>
              <h3 className="text-base font-bold" style={{ color: "#0f172a" }}>Delete Pricing Rule</h3>
              <p className="text-xs mt-1" style={{ color: "#5B7285" }}>This rule will be removed from this partner's Bulk eStamp pricing.</p>
            </div>
            <div className="px-5 py-4">
              <div className="rounded-xl p-3 text-sm" style={{ background: "#F8FAFC", border: "1px solid #E2EBF4", color: "#1e293b" }}>
                <div className="flex justify-between gap-4">
                  <span style={{ color: "#5B7285" }}>Denomination</span>
                  <span className="font-semibold text-right">{formatDenomination(deleteTarget)}</span>
                </div>
                <div className="flex justify-between gap-4 mt-2">
                  <span style={{ color: "#5B7285" }}>Quantity</span>
                  <span className="font-semibold text-right">{deleteTarget.quantity_from}–{deleteTarget.quantity_to ?? "Unlimited"}</span>
                </div>
                <div className="flex justify-between gap-4 mt-2">
                  <span style={{ color: "#5B7285" }}>Rate</span>
                  <span className="font-semibold text-right">{formatRate(deleteTarget)}</span>
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t flex justify-end gap-2" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ background: "#E2EBF4", color: "#334155" }}>
                Keep Rule
              </button>
              <button type="button" onClick={confirmDelete} disabled={deleting} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#DC2626" }}>
                {deleting ? "Deleting..." : "Delete Rule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BulkEstampPricingPanel;
