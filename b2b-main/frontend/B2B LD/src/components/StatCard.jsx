const card = { background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

const StatCard = ({ label, value, loading = false }) => (
  <div className="rounded-2xl p-4" style={card}>
    <p className="text-xs font-semibold uppercase tracking-wide truncate" style={{ color: "#5B7285" }}>{label}</p>
    <p className="text-2xl font-bold mt-1.5" style={{ color: "#0f172a" }}>{loading ? "..." : value}</p>
  </div>
);

export default StatCard;
