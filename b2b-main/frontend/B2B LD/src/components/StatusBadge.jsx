const DEFAULT_MAP = {
  true: { label: "Active", bg: "#E6F5EA", color: "#3D7A1F", dot: "#16A34A" },
  false: { label: "Inactive", bg: "#E8F3FB", color: "#1E6091", dot: "#176B87" },
};

// `status` can be a boolean (uses DEFAULT_MAP) or any string key into a
// custom `map` (falls back to a muted "unknown" pill if the key is missing).
const StatusBadge = ({ status, map }) => {
  const entry =
    (map || DEFAULT_MAP)[status] ||
    (typeof status === "boolean" ? DEFAULT_MAP[String(status)] : null) || {
      label: status || "Unknown",
      bg: "#E2EBF4",
      color: "#5B7285",
      dot: "#94A3B8",
    };

  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ background: entry.bg, color: entry.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: entry.dot }}></span>
      {entry.label}
    </span>
  );
};

export default StatusBadge;
