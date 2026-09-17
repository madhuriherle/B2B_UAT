import { useState } from "react";

// Pencil control that opens a styled rename modal (used for Service Master /
// Charge Master names). `locked` (with `lockedReason`) is available for
// callers that want to disable it for specific entries, but nothing
// currently passes it — every service and charge name is freely renameable.
const InlineRenameButton = ({ currentName, locked = false, lockedReason, onRename }) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const openModal = () => {
    setValue(currentName);
    setErr("");
    setOpen(true);
  };

  const closeModal = () => {
    if (busy) return;
    setOpen(false);
    setErr("");
  };

  const handleSave = async () => {
    const next = value.trim();
    if (!next || next === currentName) return;
    setBusy(true);
    setErr("");
    try {
      await onRename(next);
      setOpen(false);
    } catch (e) {
      setErr(e.message || "Could not rename");
    } finally {
      setBusy(false);
    }
  };

  if (locked) {
    return (
      <span
        title={lockedReason || "This name is locked"}
        className="w-6 h-6 flex items-center justify-center flex-shrink-0 text-xs"
        style={{ color: "#CBD5E1" }}
      >
        🔒
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        title="Rename"
        onClick={openModal}
        className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 transition-colors"
        style={{ background: "#E2EBF4", color: "#5B7285" }}
      >
        ✎
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
            style={{ background: "#fff" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b" style={{ borderColor: "#E2EBF4" }}>
              <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>Rename</h2>
              <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>Current name: {currentName}</p>
            </div>

            <div className="px-6 py-5 space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "#5B7285" }}>New name</label>
                <input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") closeModal();
                    if (e.key === "Enter") handleSave();
                  }}
                  className="w-full px-3 py-2.5 text-sm rounded-xl outline-none"
                  style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" }}
                />
              </div>
              {err && (
                <p className="text-xs font-medium px-3 py-2 rounded-lg" style={{ background: "#FDECEC", color: "#C0392B" }}>{err}</p>
              )}
            </div>

            <div className="px-6 py-4 border-t flex justify-end gap-2" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
              <button
                type="button"
                onClick={closeModal}
                disabled={busy}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
                style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#5B7285" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!value.trim() || value.trim() === currentName || busy}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "#1E6091" }}
              >
                {busy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default InlineRenameButton;
