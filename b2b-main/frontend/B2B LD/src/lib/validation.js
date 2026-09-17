// Indian mobile numbers are always 10 digits — strip anything non-numeric as
// the user types and cap length, so the field can never hold more than that.
export const sanitizeMobileInput = (value) => value.replace(/\D/g, "").slice(0, 10);

export const isValidMobile = (value) => /^\d{10}$/.test(value);

// Deliberately simple (not RFC 5322) — just enough to catch the obvious
// mistakes (missing @, no domain, stray extra @) before they round-trip to
// the server as a 422 the user can't easily interpret.
export const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_HINT = "Min. 8 characters, with a letter, a number and a special character";

// Mirrors app.auth.validate_password_strength on the backend — every
// password-setting screen (partner/user creation, self-service change,
// invite bootstrap) shares this same policy. Returns the specific unmet
// requirement, or "" if `value` is fine.
export const passwordStrengthError = (value) => {
  if (!value || value.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (!/[A-Za-z]/.test(value)) return "Password must include at least one letter";
  if (!/\d/.test(value)) return "Password must include at least one number";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must include at least one special character";
  return "";
};
