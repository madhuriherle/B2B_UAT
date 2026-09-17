// Shared design tokens for the User Portal (role="member", base /user).
// Restored to the original blue/green brand palette used across the app —
// only card shape, spacing and section structure differ from other roles.
export const theme = {
  navy: "#1E6091",
  navyDark: "#1E6091",
  navyLight: "#176B87",
  gold: "#1E6091",
  goldSoft: "#E8F3FB",
  ink: "#0f172a",
  slate: "#5B7285",
  bg: "#F3F8FB",
  card: "#FFFFFF",
  border: "#D8E6F0",
  success: "#3D7A1F",
  successSoft: "#E6F5EA",
  danger: "#C0392B",
  dangerSoft: "#FDECEC",
};

export const serif = undefined;

export const card = { background: theme.card, border: `1px solid ${theme.border}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };

export const inputStyle = { background: theme.bg, border: `1px solid ${theme.border}`, color: "#1e293b" };

export const tag = (color, soft) => ({
  background: soft,
  color,
  border: `1px solid ${color}33`,
});
