import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

const StampDenomination = () => {
  const [indianStates, setIndianStates] = useState([]);
  const [toast, setToast] = useState(null);
  // Per-state Stamp Paper Type (Traditional Stamp Paper / eStamp) — controls
  // whether the Partner's Create eStamp Bulk Order form shows denomination
  // selection or Consideration Amount + Article Code for that state (see
  // PartnerUserCreateEstampBulk.jsx / partner.create_bulk_estamp_order).
  // GET /api/catalog/states returns stamp_paper_type for every state
  // (defaulted server-side to Traditional Stamp Paper) plus is_configured
  // (true only once Super Admin has explicitly saved a type for that state
  // — see catalog.list_states) so this list only ever shows states someone
  // actually added here, not all ~30 states defaulting silently.
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [typeEditingStateId, setTypeEditingStateId] = useState(null);
  const [typeForm, setTypeForm] = useState({ state_id: "", stamp_paper_type: "Traditional Stamp Paper" });
  const [typeErrors, setTypeErrors] = useState({});
  const [savingType, setSavingType] = useState(false);
  // The two built-in types (always present, always first) plus whatever
  // custom names Admin has added via "+ Add New Type" — see
  // catalog.list_stamp_paper_types. A custom type has no real
  // order-creation flow yet (PartnerUserCreateEstampBulk.jsx shows "coming
  // soon" for it) — this screen only lets Admin name and assign it.
  const [stampPaperTypes, setStampPaperTypes] = useState(["Traditional Stamp Paper", "eStamp"]);
  const [addingNewType, setAddingNewType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeError, setNewTypeError] = useState("");
  const [savingNewType, setSavingNewType] = useState(false);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const loadStates = () => {
    apiRequest("/api/catalog/states")
      .then(setIndianStates)
      .catch(() => setIndianStates([]));
  };

  const loadStampPaperTypes = () => {
    apiRequest("/api/catalog/stamp-paper-types")
      .then(setStampPaperTypes)
      .catch(() => {});
  };

  useEffect(() => {
    loadStates();
    loadStampPaperTypes();
  }, []);

  const openAddTypeModal = () => {
    setTypeEditingStateId(null);
    setTypeForm({ state_id: "", stamp_paper_type: "Traditional Stamp Paper" });
    setTypeErrors({});
    setAddingNewType(false);
    setNewTypeName("");
    setNewTypeError("");
    setShowTypeModal(true);
  };

  const openEditTypeModal = (state) => {
    setTypeEditingStateId(state.id);
    setTypeForm({ state_id: state.id, stamp_paper_type: state.stamp_paper_type });
    setTypeErrors({});
    setAddingNewType(false);
    setNewTypeName("");
    setNewTypeError("");
    setShowTypeModal(true);
  };

  const closeTypeModal = () => {
    setShowTypeModal(false);
    setTypeEditingStateId(null);
    setTypeForm({ state_id: "", stamp_paper_type: "Traditional Stamp Paper" });
    setTypeErrors({});
    setAddingNewType(false);
    setNewTypeName("");
    setNewTypeError("");
  };

  // Saves the new type name itself (a label Admin invents, e.g. "ABC") —
  // separate from handleSaveType below, which assigns a type (built-in or
  // custom) to a specific state. Auto-selects the new type on success so
  // "add a type, then assign it to a state" is one continuous flow, exactly
  // the sequence it's meant for.
  const handleSaveNewType = async () => {
    const name = newTypeName.trim();
    if (!name) {
      setNewTypeError("Enter a name for the new type");
      return;
    }
    setSavingNewType(true);
    try {
      await apiRequest("/api/catalog/stamp-paper-types", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      loadStampPaperTypes();
      setTypeForm((prev) => ({ ...prev, stamp_paper_type: name }));
      setAddingNewType(false);
      setNewTypeName("");
      setNewTypeError("");
    } catch (err) {
      setNewTypeError(err.message);
    } finally {
      setSavingNewType(false);
    }
  };

  const handleSaveType = async () => {
    if (!typeForm.state_id) {
      setTypeErrors({ state_id: "State is required" });
      return;
    }
    setSavingType(true);
    try {
      await apiRequest(`/api/catalog/states/${typeForm.state_id}/stamp-paper-type`, {
        method: "PUT",
        body: JSON.stringify({ stamp_paper_type: typeForm.stamp_paper_type }),
      });
      setIndianStates((prev) =>
        prev.map((s) =>
          s.id === typeForm.state_id ? { ...s, stamp_paper_type: typeForm.stamp_paper_type, is_configured: true } : s
        )
      );
      closeTypeModal();
      showToast("Stamp paper type saved.");
    } catch (err) {
      setTypeErrors({ general: err.message });
    } finally {
      setSavingType(false);
    }
  };

  const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b", width: "100%", padding: "10px 14px", borderRadius: "10px", fontSize: "14px", outline: "none" };
  const errorStyle = { ...inputStyle, border: "1px solid #176B87", background: "#F3F8FB" };

  return (
    <div>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg text-white transition-all max-w-xl" style={{ background: toast.type === "error" ? "#176B87" : "#16A34A" }}>
          {toast.msg}
        </div>
      )}

      {/* min-height keeps this card filling the page even when only a few
          states are configured — without it the card shrink-wraps to its
          table (however tall that is) and leaves a stark gap of bare page
          background below, which read as "this box is too small" even
          though the table itself wasn't clipped. */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", minHeight: "calc(100vh - 140px)" }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "#D8E6F0" }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: "#0f172a" }}>Stamp Paper Type by State</h2>
            <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>
              Traditional Stamp Paper states use denomination selection as usual; eStamp states collect Consideration Amount + Article Code instead — Admin adds the denomination later after checking KASCoSA. States not listed below default to Traditional Stamp Paper.
            </p>
          </div>
          <button onClick={openAddTypeModal} className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            + Add
          </button>
        </div>
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "700px" }}>
          <table className="w-full">
            <thead>
              <tr style={{ background: "#F3F8FB", borderBottom: "1px solid #D8E6F0" }}>
                {["State", "Stamp Paper Type", "Actions"].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#5B7285" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {indianStates.filter((s) => s.is_configured).map((s) => (
                <tr key={s.id} className="border-t" style={{ borderColor: "#E2EBF4" }}>
                  <td className="px-5 py-2.5 text-sm font-medium" style={{ color: "#1e293b" }}>{s.state_name}</td>
                  <td className="px-5 py-2.5">
                    <span
                      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
                      style={
                        s.stamp_paper_type === "eStamp"
                          ? { background: "#E6F5EA", color: "#3D7A1F" }
                          : { background: "#E8F3FB", color: "#1E6091" }
                      }
                    >
                      {s.stamp_paper_type}
                    </span>
                  </td>
                  <td className="px-5 py-2.5">
                    <button onClick={() => openEditTypeModal(s)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#E6F5EA", color: "#3D7A1F" }}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {indianStates.length > 0 && indianStates.filter((s) => s.is_configured).length === 0 && (
                <tr><td colSpan={3} className="text-center py-10 text-sm" style={{ color: "#5B7285" }}>No states configured yet — every state currently uses Traditional Stamp Paper by default. Click + Add to set up an exception.</td></tr>
              )}
              {indianStates.length === 0 && (
                <tr><td colSpan={3} className="text-center py-10 text-sm" style={{ color: "#5B7285" }}>Loading states...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showTypeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl" style={{ background: "#fff" }}>
            <div className="px-6 py-5 border-b flex items-center justify-between" style={{ borderColor: "#E2EBF4" }}>
              <div>
                <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>{typeEditingStateId ? "Edit Stamp Paper Type" : "Add Stamp Paper Type"}</h2>
                <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>{typeEditingStateId ? "Change the stamp paper type for this state" : "Configure which stamp paper type a state uses"}</p>
              </div>
              <button onClick={closeTypeModal} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: "#E2EBF4", color: "#5B7285" }}>✕</button>
            </div>

            <div className="p-6 space-y-4">
              {typeErrors.general && (
                <div className="rounded-lg px-4 py-3 text-sm font-semibold" style={{ background: "#E8F3FB", color: "#1E6091" }}>{typeErrors.general}</div>
              )}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#5B7285" }}>State *</label>
                {typeEditingStateId ? (
                  <p className="text-sm font-semibold" style={{ color: "#1e293b" }}>{indianStates.find((s) => s.id === typeEditingStateId)?.state_name}</p>
                ) : (
                  <>
                    <select
                      name="state_id"
                      value={typeForm.state_id}
                      onChange={(e) => {
                        setTypeForm({ ...typeForm, state_id: e.target.value });
                        if (typeErrors.state_id) setTypeErrors({ ...typeErrors, state_id: "" });
                      }}
                      style={typeErrors.state_id ? errorStyle : inputStyle}
                    >
                      <option value="">Select a state</option>
                      {indianStates.filter((s) => !s.is_configured).map((s) => <option key={s.id} value={s.id}>{s.state_name}</option>)}
                    </select>
                    {typeErrors.state_id && <p className="text-xs mt-1" style={{ color: "#176B87" }}>{typeErrors.state_id}</p>}
                  </>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "#5B7285" }}>Stamp Paper Type *</label>
                  {!addingNewType && (
                    <button
                      type="button"
                      onClick={() => { setAddingNewType(true); setNewTypeName(""); setNewTypeError(""); }}
                      className="text-xs font-semibold"
                      style={{ color: "#1E6091" }}
                    >
                      + Add New Type
                    </button>
                  )}
                </div>

                {addingNewType ? (
                  <div className="rounded-lg p-3 space-y-2" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                    <input
                      type="text"
                      autoFocus
                      value={newTypeName}
                      onChange={(e) => { setNewTypeName(e.target.value); if (newTypeError) setNewTypeError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSaveNewType(); }}
                      placeholder="e.g. Judicial Stamp Paper"
                      style={newTypeError ? errorStyle : inputStyle}
                    />
                    {newTypeError && <p className="text-xs" style={{ color: "#176B87" }}>{newTypeError}</p>}
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => { setAddingNewType(false); setNewTypeName(""); setNewTypeError(""); }}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: "#fff", color: "#334155", border: "1px solid #D8E6F0" }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveNewType}
                        disabled={savingNewType}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-60"
                        style={{ background: "#1E6091" }}
                      >
                        {savingNewType ? "Saving..." : "Save Type"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {stampPaperTypes.map((option) => (
                      <label key={option} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
                        <input
                          type="radio"
                          name="stamp_paper_type"
                          checked={typeForm.stamp_paper_type === option}
                          onChange={() => setTypeForm({ ...typeForm, stamp_paper_type: option })}
                          className="w-4 h-4"
                        />
                        <span className="text-sm font-medium" style={{ color: "#1e293b" }}>{option}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t flex gap-3 justify-end" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
              <button onClick={closeTypeModal} className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors" style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#5B7285" }}>
                Cancel
              </button>
              <button onClick={handleSaveType} disabled={savingType} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
                {savingType ? "Saving..." : typeEditingStateId ? "Update" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StampDenomination;
