// The stored/matched identifier for this rail is still literally "Zelle"
// everywhere it participates in data — route_reports.rail_used, the
// RAIL_STYLES/RAIL_COLORS/RAIL_ORDER lookup keys, the banks.zelle_participant
// column — none of that changed. Only the user-facing label did: displayed
// as "P2P - Zelle" (P2P framing, honest about what's actually behind it —
// there's no official directory for Venmo/Cash App/PayPal to expand into,
// and even a community-reported version wouldn't carry much signal since
// those apps link to almost any bank). Call this at the point a raw rail
// identifier is about to be rendered as visible text — never use it as a
// lookup key.
export function railDisplayName(rail: string): string {
  return rail === "Zelle" ? "P2P - Zelle" : rail;
}
