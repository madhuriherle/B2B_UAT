const HAPPY_PATH = ["Draft", "Submitted", "In Progress", "Completed"];

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

const OrderStatusTracker = ({ status, updatedAt }) => {
  const isTerminalBad = status === "Failed" || status === "Cancelled";
  const currentIndex = HAPPY_PATH.indexOf(status);

  return (
    <div>
      <div className="flex items-start">
        {HAPPY_PATH.map((step, i) => {
          const reached = !isTerminalBad && currentIndex >= i;
          const connectorFilled = !isTerminalBad && currentIndex > i;
          return (
            <div key={step} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center" style={{ minWidth: 84 }}>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: reached ? "#1E6091" : "#D8E6F0", color: reached ? "#fff" : "#5B7285" }}
                >
                  {i + 1}
                </div>
                <span className="text-xs mt-1.5 font-medium text-center" style={{ color: reached ? "#1E6091" : "#5B7285" }}>
                  {step}
                </span>
              </div>
              {i < HAPPY_PATH.length - 1 && (
                <div className="flex-1 h-0.5 mx-1" style={{ background: connectorFilled ? "#1E6091" : "#D8E6F0", marginBottom: "18px" }} />
              )}
            </div>
          );
        })}
      </div>
      {isTerminalBad && (
        <div className="mt-4 px-4 py-3 rounded-xl text-sm font-semibold" style={{ background: "#FEE2E2", color: "#B91C1C" }}>
          Order {status.toLowerCase()}{updatedAt ? ` on ${formatDate(updatedAt)}` : ""}.
        </div>
      )}
      {!isTerminalBad && (
        <p className="text-xs mt-4" style={{ color: "#5B7285" }}>Last updated {formatDate(updatedAt)}</p>
      )}
    </div>
  );
};

export default OrderStatusTracker;

