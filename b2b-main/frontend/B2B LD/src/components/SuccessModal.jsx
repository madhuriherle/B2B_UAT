const checkIcon = (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const SuccessModal = ({ title = "Saved Successfully", message, onOk, children, actions }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}>
    <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl text-center" style={{ background: "#fff" }}>
      <div className="p-8">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#E6F5EA", color: "#16A34A" }}>
          {checkIcon}
        </div>
        <h2 className="text-lg font-bold mb-1" style={{ color: "#0f172a" }}>{title}</h2>
        {message && <p className="text-sm" style={{ color: "#5B7285" }}>{message}</p>}
        {children}
      </div>
      <div className="px-6 py-4 border-t flex flex-col gap-2" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
        {actions || (
          <button
            onClick={onOk}
            autoFocus
            className="w-full px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
          >
            OK
          </button>
        )}
      </div>
    </div>
  </div>
);

export default SuccessModal;
