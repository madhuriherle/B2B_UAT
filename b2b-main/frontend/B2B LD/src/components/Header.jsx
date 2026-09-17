import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { apiRequest } from "../lib/api";
import { formatCurrency } from "../lib/format";
import ChangePasswordModal from "./ChangePasswordModal";
import SuccessModal from "./SuccessModal";

// Notification list is short and low-stakes to be a minute stale, so a
// tighter poll than Dashboard.jsx's 5-minute summary refresh (order/invoice
// events are worth surfacing sooner than a dashboard stat is).
const NOTIFICATIONS_REFRESH_INTERVAL_MS = 60 * 1000;

const formatNotifTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

const Header = () => {
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [walletBalance, setWalletBalance] = useState(null);
  const [walletBlocked, setWalletBlocked] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showPasswordChangedSuccess, setShowPasswordChangedSuccess] = useState(false);
  const { user, logout } = useAuth();
  const notifRef = useRef(null);
  const profileRef = useRef(null);

  useEffect(() => {
    if (!profileOpen) return undefined;
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileOpen]);

  useEffect(() => {
    if (!notifOpen) return undefined;
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notifOpen]);

  const isPartnerUser = user?.role === "member";
  const isPartner = user?.role === "partner";
  // The notifications bell serves two separate feeds — see
  // notification_service.py / notifications.py: partner-side logins
  // ("partner"/"member") get their own org's notifications from
  // /api/notifications, Super Admin/Admin Portal ("admin"/"platform_admin")
  // get the global admin feed from /api/admin/notifications instead.
  const isPartnerLike = isPartnerUser || isPartner;
  const isAdminLike = user?.role === "admin" || user?.role === "platform_admin";
  const notifApiBase = isAdminLike ? "/api/admin/notifications" : "/api/notifications";

  useEffect(() => {
    if (!isPartnerLike) return;
    // Partner Portal (role="partner") and User Portal (role="member") each
    // have their own wallet endpoint/shape — Partner Portal's balance is the
    // organization's own wallet (/api/partner/wallet), while a Partner User
    // draws against organization_user_wallet (/api/partner-user/profile).
    const loadBalance = () =>
      (isPartner ? apiRequest("/api/partner/wallet") : apiRequest("/api/partner-user/profile"))
        .then((data) => {
          // Shows AVAILABLE balance (balance minus whatever's currently
          // blocked/reserved by pending stamp-value orders — see
          // partner._block_wallet_amount) as the headline figure, since
          // that's what a new order is actually checked against, with the
          // blocked amount called out separately when there is one.
          if (isPartner) {
            setWalletBalance(data.available_balance);
            setWalletBlocked(Number(data.blocked_amount) || 0);
          } else {
            setWalletBalance(data.wallet_available_balance);
            setWalletBlocked(data.wallet_blocked_amount || 0);
          }
        })
        .catch(() => setWalletBalance(null));

    loadBalance();
    // Placing an order deducts from the wallet server-side, but this
    // component doesn't remount or re-render on that — PartnerUserCreateOrder
    // fires this event right after a successful order so the balance shown
    // here doesn't go stale until the next full page load.
    window.addEventListener("wallet:updated", loadBalance);
    return () => window.removeEventListener("wallet:updated", loadBalance);
  }, [isPartnerLike, isPartner]);

  useEffect(() => {
    if (!isPartnerLike && !isAdminLike) return;
    const loadNotifications = () =>
      apiRequest(`${notifApiBase}?limit=20`)
        .then((data) => {
          setNotifications(data.items || []);
          setUnreadCount(data.unread_count || 0);
        })
        .catch(() => {
          setNotifications([]);
          setUnreadCount(0);
        });

    loadNotifications();
    // Same fetch-on-load + interval pattern Dashboard.jsx already uses for
    // its summary/trends — no websocket infrastructure exists in this app.
    const interval = setInterval(loadNotifications, NOTIFICATIONS_REFRESH_INTERVAL_MS);
    // A new order placed in this same tab (see wallet:updated above) should
    // reflect in the bell right away too, not wait for the next poll tick.
    window.addEventListener("wallet:updated", loadNotifications);
    return () => {
      clearInterval(interval);
      window.removeEventListener("wallet:updated", loadNotifications);
    };
  }, [isPartnerLike, isAdminLike, notifApiBase]);

  const handleToggleNotif = () => {
    const nextOpen = !notifOpen;
    setNotifOpen(nextOpen);
    // Mark-as-read the moment the dropdown is opened — matches the common
    // "seen it" convention for a notification bell, rather than requiring a
    // separate click per item.
    if (nextOpen && unreadCount > 0) {
      apiRequest(`${notifApiBase}/read-all`, { method: "POST" })
        .then(() => {
          setUnreadCount(0);
          setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        })
        .catch(() => {});
    }
  };

  const initial = (user?.full_name || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <header className="min-h-16 flex flex-wrap items-center justify-end gap-y-2 px-4 sm:px-6 py-2 relative z-10" style={{ background: "#ffffff", boxShadow: "0 2px 10px rgba(30,96,145,0.05)" }}>
      <div className="flex items-center flex-wrap gap-2 justify-end">
        {isPartnerLike && user?.organization_name && (
          <>
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg min-w-0" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1E6091" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" />
                <path d="M9 9v.01" /><path d="M9 12v.01" /><path d="M9 15v.01" /><path d="M9 18v.01" />
              </svg>
              <span className="text-sm font-semibold truncate max-w-[180px]" title={user.organization_name} style={{ color: "#0f172a" }}>{user.organization_name}</span>
            </div>
            {walletBalance !== null && (
              <div
                className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg"
                style={{ background: "#F0FBF4", border: "1px solid #C9EBD7" }}
                title={walletBlocked > 0 ? `₹${walletBlocked.toLocaleString("en-IN")} currently blocked for pending orders` : undefined}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h2" />
                </svg>
                <span className="text-sm font-semibold" style={{ color: "#16A34A" }}>{formatCurrency(walletBalance)}</span>
                {walletBlocked > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "#FEF3C7", color: "#92400E" }}>
                    {formatCurrency(walletBlocked)} blocked
                  </span>
                )}
              </div>
            )}
            <div className="w-px h-6 mx-1" style={{ background: "#D8E6F0" }} />
          </>
        )}

        {/* Notification */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={handleToggleNotif}
            className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
            style={{ background: notifOpen ? "#E2EBF4" : "transparent", border: "1px solid #D8E6F0" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: "#DC2626" }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-11 w-80 rounded-xl shadow-xl border z-50 overflow-hidden" style={{ background: "#fff", borderColor: "#D8E6F0" }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: "#E2EBF4" }}>
                <p className="font-semibold text-sm" style={{ color: "#0f172a" }}>Notifications</p>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-center" style={{ color: "#5B7285" }}>No new notifications</div>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className="px-4 py-3 border-b last:border-b-0" style={{ borderColor: "#F3F8FB", background: n.is_read ? "#fff" : "#F0F7FC" }}>
                      <p className="text-sm font-semibold" style={{ color: "#0f172a" }}>{n.title}</p>
                      {n.message && <p className="text-xs mt-0.5" style={{ color: "#5B7285" }}>{n.message}</p>}
                      <p className="text-[11px] mt-1" style={{ color: "#94A3B8" }}>{formatNotifTime(n.created_at)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 mx-1" style={{ background: "#D8E6F0" }} />

        {/* Profile */}
        <div className="relative" ref={profileRef}>
          <button onClick={() => setProfileOpen((v) => !v)} className="flex items-center gap-3 rounded-xl px-1.5 py-1 transition-colors" style={{ background: profileOpen ? "#F3F8FB" : "transparent" }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>{initial}</div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-semibold leading-none" style={{ color: "#0f172a" }}>{user?.full_name || user?.email || "..."}</p>
              <p className="text-xs mt-0.5 capitalize" style={{ color: "#5B7285" }}>{user?.role || ""}</p>
            </div>
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-11 w-52 rounded-xl shadow-xl border z-50 overflow-hidden" style={{ background: "#fff", borderColor: "#D8E6F0" }}>
              <button
                onClick={() => { setProfileOpen(false); setShowChangePassword(true); }}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-left transition-colors hover:bg-slate-50"
                style={{ color: "#1e293b" }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5B7285" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Change Password
              </button>
              <button
                onClick={logout}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium text-left border-t transition-colors hover:bg-slate-50"
                style={{ color: "#C0392B", borderColor: "#E2EBF4" }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C0392B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Logout
              </button>
            </div>
          )}
        </div>

      </div>

      {showChangePassword && (
        <ChangePasswordModal
          onClose={() => setShowChangePassword(false)}
          onChanged={() => { setShowChangePassword(false); setShowPasswordChangedSuccess(true); }}
        />
      )}

      {showPasswordChangedSuccess && (
        <SuccessModal
          title="Password Changed"
          message="Your password has been updated successfully."
          onOk={() => setShowPasswordChangedSuccess(false)}
        />
      )}
    </header>
  );
};

export default Header;
