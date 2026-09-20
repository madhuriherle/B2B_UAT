import { UI_TRANSLATIONS } from "./loanI18nData";

// Reverse map for English label to key
const englishToKey = {};
if (UI_TRANSLATIONS && UI_TRANSLATIONS["English"]) {
  for (const [k, v] of Object.entries(UI_TRANSLATIONS["English"])) {
    englishToKey[v.toLowerCase().trim()] = k;
  }
}

// Global state for current language (set by LoanDocumentFlow)
window.currentLoanLanguage = "English";

export function t(text) {
  if (!text) return text;
  const lang = window.currentLoanLanguage || "English";
  if (lang === "English") return text;
  
  const key = englishToKey[text.toLowerCase().trim()];
  if (key && UI_TRANSLATIONS[lang] && UI_TRANSLATIONS[lang][key]) {
    return UI_TRANSLATIONS[lang][key];
  }
  return text;
}
