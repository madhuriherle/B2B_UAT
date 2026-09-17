const ConfirmModal = ({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmTone = "danger",
  busy = false,
  onConfirm,
  onClose,
}) => {
  const confirmBg = confirmTone === "danger" ? "#C0392B" : "#1E6091";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "#fff" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b" style={{ borderColor: "#E2EBF4" }}>
          <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>{title}</h2>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm leading-relaxed" style={{ color: "#334155" }}>{message}</p>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-2" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
            style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#5B7285" }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: confirmBg }}
          >
            {busy ? "Please wait..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
