import {
  Bug, Code, Coffee, Crown, Droplet, Ghost, GitMerge, GitPullRequest, Moon, Shirt, Skull,
  Sparkles, Sticker, Terminal, WandSparkles
} from 'lucide-react';

// Explicit map (not `import *`) so the bundle only ships the icons we use.
const ICONS = { Bug, Code, Coffee, Crown, Droplet, Ghost, GitMerge, GitPullRequest, Moon, Shirt, Skull, Sparkles, Sticker, Terminal, WandSparkles };
export const ICON_NAMES = Object.keys(ICONS);

// The demo store has no product photos, so each product is drawn from its
// `art` record: an icon on a coloured tile.
export default function ProductArt({ art, size = 96, children, className = '' }) {
  const Icon = ICONS[art?.icon] || Shirt;
  return (
    <div className={`product-art ${className}`} style={{ background: art?.bg || '#2b1748' }}>
      {children}
      <Icon size={size} color={art?.fg || '#ff7a1a'} strokeWidth={1.4} aria-hidden="true" />
    </div>
  );
}
