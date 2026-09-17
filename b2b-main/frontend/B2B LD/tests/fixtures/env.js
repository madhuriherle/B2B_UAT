// Single place every spec reads credentials/config from, so nothing in this
// suite ever hardcodes a password (see tests/.env.test.example). A role's
// tests skip themselves via the has*Creds() helpers below rather than
// failing when that role's env vars aren't set.

export const partnerCreds = {
  email: process.env.TEST_PARTNER_EMAIL || '',
  password: process.env.TEST_PARTNER_PASSWORD || '',
};

export const adminCreds = {
  email: process.env.TEST_ADMIN_EMAIL || '',
  password: process.env.TEST_ADMIN_PASSWORD || '',
};

export const memberCreds = {
  email: process.env.TEST_MEMBER_EMAIL || '',
  password: process.env.TEST_MEMBER_PASSWORD || '',
};

export const hasPartnerCreds = () => Boolean(partnerCreds.email && partnerCreds.password);
export const hasAdminCreds = () => Boolean(adminCreds.email && adminCreds.password);
export const hasMemberCreds = () => Boolean(memberCreds.email && memberCreds.password);
