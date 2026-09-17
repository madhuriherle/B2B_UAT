const Modal = ({ title, subtitle, onClose, children, width = "max-w-xl" }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-10 px-4" style={{ background: "rgba(15, 23, 42, 0.5)" }} onClick={onClose}>
      <div className={`w-full ${width} rounded-2xl`} style={{ background: "#fff" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start px-6 py-5 border-b" style={{ borderColor: "#E2EBF4" }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>{title}</h2>
            {subtitle && <p className="text-xs mt-1" style={{ color: "#5B7285" }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors" style={{ background: "#E2EBF4", color: "#5B7285" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
};

export default Modal;

