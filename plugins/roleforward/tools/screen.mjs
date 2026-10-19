// The scout's first screen, shared by scout.mjs (watchlist feeds) and discover.mjs (finding new employers).
// The title screen comes from workspace.yaml scout.*: every title_all pattern must match, title_none must not. The place
// screen comes from targets.country, targets.places, and targets.remote (places.mjs). Both are broad on purpose. The
// skill makes the real call against the workspace's Dealbreakers.

import { regex } from './workspace.mjs';
import { placeVerdict, placeSettings } from './places.mjs';

export function screens(cfg) {
  const TITLE_ALL = (cfg('scout.title_all', []) || []).map((p) => new RegExp(p, 'i'));
  const TITLE_NONE = regex(cfg('scout.title_none'), /$^/);
  const places = placeSettings(cfg);
  return {
    titleOk: (t) => TITLE_ALL.length > 0 && TITLE_ALL.every((r) => r.test(t)) && !TITLE_NONE.test(t),
    placeOk: (l) => placeVerdict(l, places) === 'fits',
    placeVerdict: (l) => placeVerdict(l, places),
  };
}
