const PORTAL_BASE = {
  platform_admin: "/admin",
  admin: "/superadmin",
  partner: "/partner",
  member: "/user",
};

export const portalBase = (user) => PORTAL_BASE[user?.role] || "/superadmin";

export const homeFor = (user) => {
  const base = portalBase(user);
  return `${base}/dashboard`;
};
