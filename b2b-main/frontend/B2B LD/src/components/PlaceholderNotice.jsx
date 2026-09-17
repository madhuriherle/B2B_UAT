const PlaceholderNotice = ({ title = "Not available yet", message }) => (
  <div className="rounded-xl p-10 text-center" style={{ background: "#F3F8FB", border: "1px dashed #D8E6F0" }}>
    <p className="text-sm font-semibold" style={{ color: "#5B7285" }}>{title}</p>
    {message && <p className="text-xs mt-1.5 max-w-md mx-auto" style={{ color: "#94A3B8" }}>{message}</p>}
  </div>
);

export default PlaceholderNotice;
