// The stored/matched identifier for this rail is still literally "Zelle"
// everywhere it participates in data — route_reports.rail_used, the
// RAIL_STYLES/RAIL_COLORS/RAIL_ORDER lookup keys, the banks.zelle_participant
// column — none of that changed. Only the user-facing label did: the
// feature is branded "P2P Payments" now (with room to fold in Venmo/Cash
// App/PayPal later without another rename), while the directory backing it
// today is still Zelle's own. Call this at the point a raw rail identifier
// is about to be rendered as visible text — never use it as a lookup key.
export function railDisplayName(rail: string): string {
  return rail === "Zelle" ? "P2P Payments" : rail;
}
