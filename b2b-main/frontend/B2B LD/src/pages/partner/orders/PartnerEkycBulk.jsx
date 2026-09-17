import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, apiUpload, downloadFile } from "../../../lib/api";
import { STATUS_STYLES } from "./orderShared";
import { theme, serif, card } from "../../../lib/userPortalTheme";

// Outline style shared by every secondary action in the header button row
// (Download Template, Import History) so they read as equal-weight actions
// next to the one primary action (Import Excel) — only the primary action
// gets the filled navy background.
const outlineButtonStyle = { background: "#fff", border: `1px solid ${theme.navy}`, color: theme.navy };

const inputClass = "w-full px-4 py-2.5 text-sm rounded outline-none transition-all";
const inputStyle = { background: "#fff", border: `1px solid ${theme.border}`, color: theme.ink };

const DOC_TYPE_LABELS = { aadhaar_card: "Aadhaar Card", pan_card: "PAN Card" };

// Reuses the same status colors every other order table in this portal
// already uses (STATUS_STYLES) so a Bulk eKYC row's badge never looks like
// a different design system — "Not Initiated" is the one status unique to
// this table (an eKYC order hasn't been created yet), styled the same
// neutral gray as "Draft".
const statusBadge = (status) => (
  <span
    className="inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold"
    style={status === "Not Initiated" ? { background: theme.bg, color: theme.slate } : STATUS_STYLES[status] || { background: theme.bg, color: theme.slate }}
  >
    {status}
  </span>
);

const emptyIcon = (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

const STATUS_FILTERS = ["All", "Not Initiated", "In Progress", "Completed", "Failed"];
const PAGE_SIZE = 20;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "21 Aug 2026, 1:30 PM" — matches how dates read elsewhere in this portal,
// rather than the browser-locale-dependent format toLocaleString gives.
const formatDateTime = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hours}:${minutes} ${ampm}`;
  } catch {
    return iso;
  }
};

// One-line status breakdown for a batch's Import History row, e.g.
// "5 Completed · 3 In Progress · 2 Not Initiated" — zero-count statuses
// are omitted so a fresh, untouched batch just reads "10 Not Initiated".
const progressSummary = (b) => {
  const parts = [];
  if (b.completed_count) parts.push(`${b.completed_count} Completed`);
  if (b.in_progress_count) parts.push(`${b.in_progress_count} In Progress`);
  if (b.failed_count) parts.push(`${b.failed_count} Failed`);
  if (b.not_initiated_count) parts.push(`${b.not_initiated_count} Not Initiated`);
  return parts.length ? parts.join(" · ") : "—";
};

const PartnerEkycBulk = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // "records" = customers belonging to selectedBatchId (defaults to the
  // most recent batch on load — see the mount effect below). "history" =
  // every batch ever imported for this org, one row per Excel upload,
  // reached via the "Import History" button. Clicking a batch row there
  // sets selectedBatchId and switches back to "records".
  const [view, setView] = useState("records");
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [selectedBatchInfo, setSelectedBatchInfo] = useState(null);
  // The most-recently-imported batch's id, independent of which batch is
  // currently selected — lets the "Current Import" banner tell the two
  // apart from "you're looking at an older batch via Import History".
  const [latestBatchId, setLatestBatchId] = useState(null);
  const [hasAnyBatches, setHasAnyBatches] = useState(null); // null = not checked yet

  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  const [batches, setBatches] = useState([]);
  const [batchesTotal, setBatchesTotal] = useState(0);
  const [batchesPage, setBatchesPage] = useState(1);
  const [batchesLoading, setBatchesLoading] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState("");
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  const loadRecords = (overrides = {}) => {
    if (!selectedBatchId) return;
    setLoading(true);
    const pageValue = overrides.page ?? page;
    const searchValue = overrides.search ?? search;
    const params = { page: pageValue, page_size: PAGE_SIZE, batch_id: selectedBatchId };
    if (searchValue.trim()) params.search = searchValue.trim();
    if (statusFilter !== "All") params.status = statusFilter;
    const query = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString();
    apiRequest(`/api/partner/ekyc-bulk/records?${query}`)
      .then((data) => {
        setRecords(data.records || []);
        setTotal(data.total || 0);
      })
      .catch(() => {
        setRecords([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  };

  // On first load: find the most recently imported batch and select it, so
  // the page shows the current batch's customers without relying on any
  // client-side memory of "the last upload" (that used to reset to nothing
  // on every reload — the exact bug being fixed here).
  useEffect(() => {
    apiRequest("/api/partner/ekyc-bulk/batches?page=1&page_size=1")
      .then((data) => {
        const latest = data.batches?.[0] || null;
        setHasAnyBatches((data.total || 0) > 0);
        if (latest) {
          setSelectedBatchId(latest.id);
          setSelectedBatchInfo(latest);
          setLatestBatchId(latest.id);
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        setHasAnyBatches(false);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (view !== "records") return;
    if (!selectedBatchId) return;
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedBatchId, page]);

  useEffect(() => {
    if (view !== "history") return;
    setBatchesLoading(true);
    const query = new URLSearchParams({ page: String(batchesPage), page_size: String(PAGE_SIZE) }).toString();
    apiRequest(`/api/partner/ekyc-bulk/batches?${query}`)
      .then((data) => {
        setBatches(data.batches || []);
        setBatchesTotal(data.total || 0);
      })
      .catch(() => {
        setBatches([]);
        setBatchesTotal(0);
      })
      .finally(() => setBatchesLoading(false));
  }, [view, batchesPage]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadRecords({ page: 1 });
  };

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearch(value);
    if (value.trim() === "" && search.trim() !== "") {
      setPage(1);
      loadRecords({ search: "", page: 1 });
    }
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true);
    setImportError("");
    try {
      await downloadFile("/api/partner/ekyc-bulk/template", "ekyc_bulk_template.xlsx");
    } catch (err) {
      setImportError(err.message);
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same filename later
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setImportError("Please select the .xlsx template file (see Download Template).");
      return;
    }
    setImporting(true);
    setImportError("");
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const result = await apiUpload("/api/partner/ekyc-bulk/import", formData);
      setImportResult(result);
      setSearch("");
      setStatusFilter("All");
      setPage(1);
      setView("records");
      if (result.batch_id) {
        setHasAnyBatches(true);
        setLatestBatchId(result.batch_id);
        setSelectedBatchInfo({
          id: result.batch_id,
          filename: file.name,
          created_at: new Date().toISOString(),
          total_rows: result.total_rows,
          imported_rows: result.imported_rows,
          skipped_rows: (result.total_rows || 0) - (result.imported_rows || 0),
          not_initiated_count: result.imported_rows,
          in_progress_count: 0,
          completed_count: 0,
          failed_count: 0,
        });
        // If this new batch happens to share the previously-selected id
        // (impossible in practice — every import creates a fresh batch —
        // but kept for safety) the effect below wouldn't refire on its own
        // since the id wouldn't change, so refresh explicitly either way.
        if (result.batch_id === selectedBatchId) loadRecords();
        else setSelectedBatchId(result.batch_id);
      } else {
        setRecords([]);
        setTotal(0);
      }
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const openHistory = () => {
    setView("history");
    setBatchesPage(1);
  };

  const selectBatch = (batch) => {
    setSelectedBatchId(batch.id);
    setSelectedBatchInfo(batch);
    setSearch("");
    setStatusFilter("All");
    setPage(1);
    setView("records");
  };

  const rowAction = (record) => {
    if (!record.order_id) {
      return (
        <button
          onClick={() =>
            // No dedicated /orders/create/eKYC route on this portal (see
            // PartnerCreateOrder.jsx) — it's a single /orders/create page
            // with an in-page service dropdown, so the prefill handoff goes
            // there directly via router state alone.
            navigate("/partner/orders/create", {
              state: {
                prefill: {
                  customer_name: record.customer_name,
                  customer_email: record.customer_email,
                  customer_mobile: record.customer_mobile,
                  doc_type: record.doc_type,
                },
                bulk_record_id: record.id,
              },
            })
          }
          className="px-3 py-1.5 rounded text-xs font-semibold text-white"
          style={{ background: theme.navy }}
        >
          Initiate eKYC
        </button>
      );
    }
    return (
      <button
        onClick={() => navigate(`/partner/orders/${record.order_id}`)}
        className="px-3 py-1.5 rounded text-xs font-semibold"
        style={{ background: theme.goldSoft, color: theme.navy }}
      >
        View
      </button>
    );
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const batchesTotalPages = Math.max(1, Math.ceil(batchesTotal / PAGE_SIZE));
  const showEmptyState = view === "records" && hasAnyBatches === false;

  return (
    <div>
      <div className="mb-6 pb-4 border-b flex items-start justify-between gap-4" style={{ borderColor: theme.border }}>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: theme.ink, fontFamily: serif }}>eKYC</h1>
          <p className="text-sm mt-1" style={{ color: theme.slate }}>
            {view === "history"
              ? "Every Excel file imported for your organization. Click a batch to see its customers."
              : "Download the template, fill it in, then import it to complete eKYC for each customer through the usual eKYC form."}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileSelected} />
          <button
            onClick={openFilePicker}
            disabled={importing}
            className="px-4 py-2.5 rounded text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: theme.navy }}
          >
            {importing ? "Importing..." : "Import Excel"}
          </button>
          <button
            onClick={handleDownloadTemplate}
            disabled={downloadingTemplate}
            className="px-4 py-2.5 rounded text-sm font-semibold disabled:opacity-60"
            style={outlineButtonStyle}
          >
            {downloadingTemplate ? "Downloading..." : "Download Template"}
          </button>
          <button
            onClick={openHistory}
            className="px-4 py-2.5 rounded text-sm font-semibold"
            style={outlineButtonStyle}
          >
            Import History
          </button>
        </div>
      </div>

      {importError && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm font-semibold" style={{ background: "#FEE2E2", color: "#B91C1C" }}>{importError}</div>
      )}

      {importResult && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm" style={{ background: theme.bg, border: `1px solid ${theme.border}`, color: theme.ink }}>
          <p className="font-semibold">
            Imported {importResult.imported_rows} of {importResult.total_rows} row{importResult.total_rows === 1 ? "" : "s"}.
          </p>
          {importResult.skipped_duplicates?.length > 0 && (
            <p className="mt-1" style={{ color: theme.slate }}>
              Skipped {importResult.skipped_duplicates.length} duplicate row{importResult.skipped_duplicates.length === 1 ? "" : "s"}: row{" "}
              {importResult.skipped_duplicates.map((d) => d.row).join(", ")}.
            </p>
          )}
          {importResult.errors?.length > 0 && (
            <div className="mt-2">
              <p className="font-semibold" style={{ color: "#B91C1C" }}>{importResult.errors.length} row{importResult.errors.length === 1 ? "" : "s"} could not be imported:</p>
              <ul className="mt-1 list-disc list-inside" style={{ color: "#B91C1C" }}>
                {importResult.errors.map((e) => (
                  <li key={e.row}>Row {e.row}: {e.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {view === "history" ? (
        <div className="rounded-lg overflow-hidden" style={card}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ background: theme.bg, borderBottom: `1px solid ${theme.border}` }}>
                  {["Uploaded On", "Customers", "Status / Progress", "Action"].map((h) => (
                    <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: theme.slate }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: theme.border }}>
                    <td className="px-5 py-4 text-sm font-medium whitespace-nowrap" style={{ color: theme.ink }}>{formatDateTime(b.created_at)}</td>
                    <td className="px-5 py-4 text-sm" style={{ color: theme.ink }}>{b.imported_rows} customer{b.imported_rows === 1 ? "" : "s"}</td>
                    <td className="px-5 py-4 text-sm" style={{ color: theme.slate }}>{progressSummary(b)}</td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => selectBatch(b)}
                        className="px-3 py-1.5 rounded text-xs font-semibold"
                        style={{ background: theme.goldSoft, color: theme.navy }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
                {!batchesLoading && batches.length === 0 && (
                  <tr>
                    <td colSpan="4" className="text-center py-12 text-sm" style={{ color: theme.slate }}>No imports yet.</td>
                  </tr>
                )}
                {batchesLoading && (
                  <tr>
                    <td colSpan="4" className="text-center py-12 text-sm" style={{ color: theme.slate }}>Loading...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: theme.border }}>
            <p className="text-sm" style={{ color: theme.slate }}>
              {batchesTotalPages > 1 && <>Page <span className="font-semibold" style={{ color: theme.ink }}>{batchesPage}</span> of {batchesTotalPages} · </>}
              {batchesTotal} import{batchesTotal === 1 ? "" : "s"}
            </p>
            {batchesTotalPages > 1 && (
              <div className="flex gap-2">
                <button onClick={() => setBatchesPage((p) => Math.max(1, p - 1))} disabled={batchesPage <= 1} className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40" style={{ background: theme.bg, color: theme.slate }}>Previous</button>
                <button onClick={() => setBatchesPage((p) => Math.min(batchesTotalPages, p + 1))} disabled={batchesPage >= batchesTotalPages} className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40" style={{ background: theme.bg, color: theme.slate }}>Next</button>
              </div>
            )}
          </div>
        </div>
      ) : showEmptyState ? (
        <div className="rounded-lg" style={card}>
          <div className="text-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: theme.bg }}>{emptyIcon}</div>
              <p className="font-semibold" style={{ color: theme.slate }}>No customers imported yet. Download the template, fill it in, and import it.</p>
              <div className="mt-2 flex items-center justify-center gap-2">
                <button onClick={handleDownloadTemplate} disabled={downloadingTemplate} className="px-4 py-2 rounded text-sm font-semibold disabled:opacity-60" style={outlineButtonStyle}>
                  {downloadingTemplate ? "Downloading..." : "Download Template"}
                </button>
                <button onClick={openFilePicker} className="px-4 py-2 rounded text-sm font-semibold text-white" style={{ background: theme.navy }}>Import Excel</button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {selectedBatchInfo && (
            <div className="mb-4 rounded-lg px-4 py-3 flex items-center justify-between gap-3" style={{ background: theme.bg, border: `1px solid ${theme.border}` }}>
              <div>
                <p className="text-sm font-semibold" style={{ color: theme.ink }}>
                  {selectedBatchId === latestBatchId ? "Current Import" : "Import"} — {formatDateTime(selectedBatchInfo.created_at)}
                </p>
                <p className="text-sm mt-0.5" style={{ color: theme.slate }}>
                  {selectedBatchInfo.imported_rows} customer{selectedBatchInfo.imported_rows === 1 ? "" : "s"} imported
                </p>
              </div>
              <button onClick={openHistory} className="text-xs font-semibold underline whitespace-nowrap shrink-0" style={{ color: theme.navy }}>Import History</button>
            </div>
          )}

          <form onSubmit={handleSearch} className="rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-center" style={card}>
            <input
              value={search}
              onChange={handleSearchChange}
              placeholder="Search by name, mobile, or email..."
              className={`flex-1 min-w-48 ${inputClass}`}
              style={inputStyle}
            />
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className={inputClass}
              style={{ ...inputStyle, width: 180 }}
            >
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="submit" className="px-4 py-2.5 rounded text-sm font-semibold text-white" style={{ background: theme.navy }}>Search</button>
          </form>

          <div className="rounded-lg overflow-hidden" style={card}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: theme.bg, borderBottom: `1px solid ${theme.border}` }}>
                    {["Customer Name", "Mobile", "Document Type", "Account Number", "Status", "Action"].map((h) => (
                      <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: theme.slate }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-t transition-colors hover:bg-slate-50/50" style={{ borderColor: theme.border }}>
                      <td className="px-5 py-4 text-sm font-medium" style={{ color: theme.ink }}>{r.customer_name}</td>
                      <td className="px-5 py-4 text-sm" style={{ color: theme.ink }}>{r.customer_mobile}</td>
                      <td className="px-5 py-4 text-sm" style={{ color: theme.ink }}>{DOC_TYPE_LABELS[r.doc_type] || "—"}</td>
                      <td className="px-5 py-4 text-sm" style={{ color: theme.ink }}>{r.account_number || "—"}</td>
                      <td className="px-5 py-4">{statusBadge(r.status)}</td>
                      <td className="px-5 py-4">{rowAction(r)}</td>
                    </tr>
                  ))}
                  {!loading && records.length === 0 && (
                    <tr>
                      <td colSpan="6" className="text-center py-12 text-sm" style={{ color: theme.slate }}>No records match this search/filter.</td>
                    </tr>
                  )}
                  {loading && (
                    <tr>
                      <td colSpan="6" className="text-center py-12 text-sm" style={{ color: theme.slate }}>Loading...</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center px-5 py-4 border-t" style={{ borderColor: theme.border }}>
              <p className="text-sm" style={{ color: theme.slate }}>
                {totalPages > 1 && <>Page <span className="font-semibold" style={{ color: theme.ink }}>{page}</span> of {totalPages} · </>}
                {total} record{total === 1 ? "" : "s"}
              </p>
              {totalPages > 1 && (
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40" style={{ background: theme.bg, color: theme.slate }}>Previous</button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1.5 rounded text-xs font-semibold disabled:opacity-40" style={{ background: theme.bg, color: theme.slate }}>Next</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PartnerEkycBulk;
