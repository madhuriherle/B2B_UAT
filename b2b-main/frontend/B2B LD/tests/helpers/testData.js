// Every value this suite writes to the real database is generated here and
// tagged with the "PW-Test-" prefix + a run-unique suffix, so test rows are
// obviously test data and never collide across parallel runs/retries.
export const uniqueSuffix = () => `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

export const testUserPayload = () => {
  const suffix = uniqueSuffix();
  return {
    fullName: `PW-Test-User-${suffix}`,
    email: `pw-test-${suffix}@example.com`,
    mobile: '9' + String(Math.floor(100000000 + Math.random() * 899999999)),
  };
};

// Dealer org — Customer Onboard Step 1. Its Step-2 user becomes a role='partner'
// login (Partner Portal) per organizations.create_or_link_organization_user.
export const testDealerOrgPayload = () => {
  const suffix = uniqueSuffix();
  return {
    organizationName: `PW-Test-Dealer-${suffix}`,
    email: `pw-test-dealer-org-${suffix}@example.com`,
    mobile: '9' + String(Math.floor(100000000 + Math.random() * 899999999)),
  };
};

// The Dealer org's Step-2 user — created with a real password so it's
// immediately loginable (no email-invite/set-password step needed).
export const testPartnerUserPayload = () => {
  const suffix = uniqueSuffix();
  return {
    fullName: `PW-Test-Partner-${suffix}`,
    email: `pw-test-partner-${suffix}@example.com`,
    mobile: '9' + String(Math.floor(100000000 + Math.random() * 899999999)),
    password: `PwTest-${suffix}!`,
  };
};

// Retailer org — its own onboarding user is created directly as role='member'
// (User Portal), with the password captured on the org form itself. Retailer
// orgs skip the Partner Portal entirely by design.
export const testRetailerOrgPayload = () => {
  const suffix = uniqueSuffix();
  return {
    organizationName: `PW-Test-Retailer-${suffix}`,
    email: `pw-test-retailer-org-${suffix}@example.com`,
    mobile: '9' + String(Math.floor(100000000 + Math.random() * 899999999)),
    password: `PwTest-${suffix}!`,
  };
};
