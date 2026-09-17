import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";

const PAGE_SIZE = 20;

// Only populated for a multi-category feed (see EditPartnerModal.jsx's
// per-partner Price History, fetchUrl `/api/price-history?organization_id=`)
// — a single-series fetchUrl (per-service, per-document, per-denomination)
// never returns a `category`/`label`, so this badge simply never renders
// there.
const CATEGORY_STYLES = {
  "Service Pricing": { background: "#E6F5EA", color: "#3D7A1F" },
  "Document Pricing": { background: "#F3E8FB", color: "#7E22CE" },
};

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-";

// A fetchUrl may already carry its own query string (e.g. `?organization_id=`)
// — append with `&` in that case instead of a second `?`.
const withPaging = (fetchUrl, limit, offset) =>
  `${fetchUrl}${fetchUrl.includes("?") ? "&" : "?"}limit=${limit}&offset=${offset}`;

// Mount a fresh instance per fetchUrl (render with key={fetchUrl}) so state
// resets cleanly instead of trying to reconcile pagination across targets.
const PriceHistoryModal = ({ title, fetchUrl, priceField = "price", onClose }) => {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiRequest(withPaging(fetchUrl, PAGE_SIZE, 0))
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchUrl]);

  const handleLoadMore = () => {
    setLoadingMore(true);
    apiRequest(withPaging(fetchUrl, PAGE_SIZE, items.length))
      .then((data) => {
        setItems((prev) => [...prev, ...data.items]);
        setTotal(data.total);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingMore(false));
  };

  const hasMore = total !== null && items.length < total;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ background: "#fff", maxHeight: "85vh" }}>
        <div className="px-6 py-5 border-b flex items-center justify-between shrink-0" style={{ borderColor: "#E2EBF4" }}>
          <div className="min-w-0">
            <h2 className="text-lg font-bold" style={{ color: "#0f172a" }}>Price History</h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: "#5B7285" }}>{title}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0" style={{ background: "#E2EBF4", color: "#5B7285" }}>✕</button>
        </div>

        <div className="p-6 overflow-y-auto">
          {error && <p className="text-sm" style={{ color: "#176B87" }}>{error}</p>}
          {!error && loading && <p className="text-sm" style={{ color: "#5B7285" }}>Loading...</p>}
          {!error && !loading && items.length === 0 && <p className="text-sm" style={{ color: "#5B7285" }}>No price history yet.</p>}
          {!error && !loading && items.length > 0 && (
            <>
              {total !== null && (
                <p className="text-xs mb-3" style={{ color: "#94A3B8" }}>
                  Showing {items.length} of {total} change{total === 1 ? "" : "s"}
                </p>
              )}
              <div className="space-y-3">
                {(() => {
                  // A multi-category feed (organization-scoped: several
                  // services/documents interleaved) has its own independent
                  // "current" price per label, not just one overall — a
                  // service that hasn't changed in a year is still its own
                  // current price, even though row 0 is some other service's
                  // more recent change. Track the first time each label is
                  // seen (list is already newest-first) instead of hardcoding
                  // i === 0. Single-series callers never set `label`, so
                  // every entry shares the same key and behavior is
                  // unchanged: only the true first row is "current".
                  const seenLabels = new Set();
                  return items.map((entry, i) => {
                    const key = entry.label ?? "__single_series__";
                    const isCurrent = !seenLabels.has(key);
                    seenLabels.add(key);
                    const isOldestLoaded = i === items.length - 1;
                    // "Created" only means anything once we know we've seen
                    // that label's very first entry — for a single series
                    // that's simply "every row is loaded"; a multi-category
                    // feed would need a per-label count the backend doesn't
                    // return, so it's left as "Updated" there instead of
                    // guessing.
                    const isKnownCreated = !entry.category && isOldestLoaded && items.length === total;
                    return (
                    <div key={entry.id} className="flex items-center gap-3 rounded-xl p-3" style={{ background: isCurrent ? "#E6F5EA" : "#F3F8FB", border: `1px solid ${isCurrent ? "#16A34A" : "#D8E6F0"}` }}>
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: isCurrent ? "#16A34A" : "#1E6091" }}></div>
                      <div className="flex-1 min-w-0">
                        {(entry.category || entry.label) && (
                          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                            {entry.category && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={CATEGORY_STYLES[entry.category] || { background: "#E2EBF4", color: "#334155" }}>
                                {entry.category}
                              </span>
                            )}
                            {entry.label && <span className="text-xs font-medium truncate" style={{ color: "#334155" }}>{entry.label}</span>}
                          </div>
                        )}
                        <p className="text-sm font-bold" style={{ color: "#0f172a" }}>{formatCurrency(entry[priceField])}</p>
                        <p className="text-xs" style={{ color: "#5B7285" }}>
                          {formatDate(entry.effective_from)}
                          {entry.changed_by_name ? ` · by ${entry.changed_by_name}` : ""}
                        </p>
                      </div>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ background: isCurrent ? "#16A34A" : "#E2EBF4", color: isCurrent ? "#fff" : "#5B7285" }}>
                        {isKnownCreated ? "Created" : "Updated"}{isCurrent ? " (Current)" : ""}
                      </span>
                    </div>
                    );
                  });
                })()}
              </div>
            </>
          )}
        </div>

        {hasMore && (
          <div className="px-6 py-4 border-t flex items-center shrink-0" style={{ borderColor: "#E2EBF4", background: "#F3F8FB" }}>
            <button onClick={handleLoadMore} disabled={loadingMore} className="text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-60" style={{ background: "#fff", border: "1px solid #D8E6F0", color: "#1E6091" }}>
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PriceHistoryModal;
