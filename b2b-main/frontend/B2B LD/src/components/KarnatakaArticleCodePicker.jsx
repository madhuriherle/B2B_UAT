import { ARTICLE_OPTIONS_BY_STATE } from "../lib/karnatakaArticleCodes";

// A plain constrained <select> (not a freeform autocomplete like the
// generic 415-entry Document Category SuggestInput used by plain eStamp) —
// this is a SignDesk-mandated closed set of article codes where a
// near-miss/typo is a hard API rejection, so precision matters more than
// free-text convenience. Filtered to whichever SHCIL state is passed in
// (Karnataka/Tamil Nadu/Delhi — see ARTICLE_OPTIONS_BY_STATE), so picking a
// different state never leaves a stale option from the previous one
// visible. Shared between PartnerCreateOrder.jsx and
// PartnerUserCreateOrder.jsx's "eStamp On The Fly" sections. Kept under its
// original Karnataka-only name since Karnataka is still the primary,
// fully-confirmed state this covers.
const KarnatakaArticleCodePicker = ({ state, value, onChange, className, style }) => {
  const options = ARTICLE_OPTIONS_BY_STATE[state] || [];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className} style={style}>
      <option value="">Select article code</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
};

export default KarnatakaArticleCodePicker;
