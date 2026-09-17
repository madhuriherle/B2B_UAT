const Tabs = ({ tabs, activeKey, onChange }) => (
  <div className="flex flex-wrap gap-1 mb-6 p-1 rounded-xl overflow-x-auto" style={{ background: "#E2EBF4" }}>
    {tabs.map((tab) => (
      <button
        key={tab.key}
        type="button"
        onClick={() => onChange(tab.key)}
        className="px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors"
        style={
          activeKey === tab.key
            ? { background: "#fff", color: "#1E6091", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }
            : { background: "transparent", color: "#5B7285" }
        }
      >
        {tab.label}
      </button>
    ))}
  </div>
);

export default Tabs;
