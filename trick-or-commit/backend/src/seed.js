// Starting catalogue. Prices are in paise (₹1 = 100 paise) so all money math
// stays in integers. `art` drives the product illustration on the frontend
// (icon name from lucide-react + two colours), since the demo has no photos.

const TEE_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const COSTUME_SIZES = ['S', 'M', 'L', 'XL'];
const ONE_SIZE = ['One size'];

const PRODUCTS = [
  // --- Hacktoberfest 2026 tees & apparel ---
  {
    slug: 'hacktoberfest-2026-classic-tee', name: 'Hacktoberfest 2026 Classic Tee', category: 'tees',
    description: 'The official-look campus tee for Hacktoberfest 2026 at VTU. 180 GSM combed cotton, screen-printed front and back, pre-shrunk.',
    price: 59900, compareAt: 79900, sizes: TEE_SIZES, stock: 120, badge: 'Bestseller',
    rating: 4.8, ratingCount: 214, featured: true, art: { icon: 'Shirt', bg: '#2b1748', fg: '#ff7a1a' }
  },
  {
    slug: 'pumpkin-pull-request-tee', name: 'Pumpkin Pull Request Tee', category: 'tees',
    description: 'A jack-o\'-lantern opening its very first pull request. Soft-wash black cotton with glow-in-the-dark ink.',
    price: 64900, sizes: TEE_SIZES, stock: 80, badge: 'Glows in the dark',
    rating: 4.7, ratingCount: 96, featured: true, art: { icon: 'GitPullRequest', bg: '#14100f', fg: '#ff8c2b' }
  },
  {
    slug: 'merge-conflict-monster-tee', name: 'Merge Conflict Monster Tee', category: 'tees',
    description: '<<<<<<< HEAD meets a very hungry monster. Relaxed fit, 100% cotton.',
    price: 64900, sizes: TEE_SIZES, stock: 60,
    rating: 4.6, ratingCount: 71, art: { icon: 'GitMerge', bg: '#1d2b1a', fg: '#9be15d' }
  },
  {
    slug: 'git-commit-boo-tee', name: 'git commit -m "boo" Tee', category: 'tees',
    description: 'The scariest commit message ever pushed to main. Monospace print on heather grey.',
    price: 59900, sizes: TEE_SIZES, stock: 75,
    rating: 4.5, ratingCount: 58, art: { icon: 'Terminal', bg: '#30303a', fg: '#f4f4f5' }
  },
  {
    slug: 'gdg-on-campus-vtu-crew-tee', name: 'GDG on Campus VTU Crew Tee', category: 'tees',
    description: 'Crew tee for the GDG on Campus VTU volunteers and community. Four-colour print, unisex fit.',
    price: 69900, sizes: TEE_SIZES, stock: 50, badge: 'Crew edition',
    rating: 4.9, ratingCount: 43, featured: true, art: { icon: 'Code', bg: '#0f2747', fg: '#5cc8ff' }
  },
  {
    slug: 'open-source-spirits-oversized-tee', name: 'Open Source Spirits Oversized Tee', category: 'tees',
    description: 'Oversized drop-shoulder tee with friendly ghosts contributing to open source. 220 GSM.',
    price: 79900, compareAt: 89900, sizes: TEE_SIZES, stock: 40,
    rating: 4.7, ratingCount: 37, art: { icon: 'Ghost', bg: '#3b2a5c', fg: '#e9e3ff' }
  },
  {
    slug: 'hacktoberfest-2026-hoodie', name: 'Hacktoberfest 2026 Hoodie', category: 'tees',
    description: 'Heavyweight fleece hoodie for late-night hacking. Kangaroo pocket, embroidered chest logo.',
    price: 149900, compareAt: 179900, sizes: TEE_SIZES, stock: 35, badge: 'Limited',
    rating: 4.9, ratingCount: 88, featured: true, art: { icon: 'Moon', bg: '#1b1230', fg: '#ffb347' }
  },

  // --- Halloween costumes ---
  {
    slug: 'classic-vampire-cape-set', name: 'Classic Vampire Cape Set', category: 'costumes',
    description: 'Satin-lined floor-length cape with stand-up collar, plus clip-on fangs. Reusable and machine washable.',
    price: 119900, compareAt: 139900, sizes: COSTUME_SIZES, stock: 30,
    rating: 4.6, ratingCount: 52, art: { icon: 'Droplet', bg: '#3a0d12', fg: '#ff4d5e' }
  },
  {
    slug: 'witch-hat-and-broom-costume', name: 'Witch Hat & Broom Costume', category: 'costumes',
    description: 'Wide-brim velvet witch hat, starry cape and a collapsible broom that fits in a backpack.',
    price: 99900, sizes: COSTUME_SIZES, stock: 28, badge: 'New',
    rating: 4.5, ratingCount: 31, art: { icon: 'WandSparkles', bg: '#21143a', fg: '#c38bff' }
  },
  {
    slug: 'glow-skeleton-suit', name: 'Glow-in-the-Dark Skeleton Suit', category: 'costumes',
    description: 'Full-body stretch jumpsuit with a skeleton print that glows for hours after a few minutes of light.',
    price: 134900, sizes: COSTUME_SIZES, stock: 22, badge: 'Glows in the dark',
    rating: 4.8, ratingCount: 64, featured: true, art: { icon: 'Skull', bg: '#101014', fg: '#d9ffe0' }
  },
  {
    slug: 'pumpkin-king-costume', name: 'Pumpkin King Costume', category: 'costumes',
    description: 'Padded pumpkin tunic, vine crown and matching gloves. Comfortable enough for a full day on campus.',
    price: 109900, sizes: COSTUME_SIZES, stock: 18,
    rating: 4.4, ratingCount: 19, art: { icon: 'Crown', bg: '#4a2405', fg: '#ff9d2e' }
  },
  {
    slug: 'ghost-hoodie-costume', name: 'Ghost Hoodie Costume', category: 'costumes',
    description: 'A cosy white hoodie with a stitched ghost face on the hood. A costume you will keep wearing in November.',
    price: 89900, sizes: COSTUME_SIZES, stock: 45,
    rating: 4.7, ratingCount: 49, art: { icon: 'Ghost', bg: '#e9e6f5', fg: '#2b2340' }
  },
  {
    slug: 'zombie-developer-costume-kit', name: 'Zombie Developer Costume Kit', category: 'costumes',
    description: 'Torn hoodie, "deadline survivor" lanyard and washable zombie makeup. For when the build has been red since Friday.',
    price: 124900, sizes: COSTUME_SIZES, stock: 15, badge: 'Fan favourite',
    rating: 4.9, ratingCount: 27, art: { icon: 'Bug', bg: '#1f2a12', fg: '#b6f36a' }
  },

  // --- Accessories ---
  {
    slug: 'spooky-sticker-pack', name: 'Spooky Dev Sticker Pack (12)', category: 'accessories',
    description: 'Twelve waterproof vinyl stickers: pumpkins, ghosts, bats and a few cursed regexes. Laptop-safe adhesive.',
    price: 14900, sizes: ONE_SIZE, stock: 300,
    rating: 4.8, ratingCount: 152, art: { icon: 'Sticker', bg: '#2a1a3f', fg: '#ffd166' }
  },
  {
    slug: 'bat-wing-headband', name: 'Bat Wing Headband', category: 'accessories',
    description: 'Lightweight headband with felt bat wings. Instant costume for the last-minute hacker.',
    price: 24900, sizes: ONE_SIZE, stock: 90,
    rating: 4.3, ratingCount: 40, art: { icon: 'Sparkles', bg: '#18181b', fg: '#a78bfa' }
  },
  {
    slug: 'led-jack-o-lantern-mug', name: 'LED Jack-o\'-Lantern Mug', category: 'accessories',
    description: '350 ml ceramic mug whose pumpkin face lights up when filled with something hot.',
    price: 39900, compareAt: 49900, sizes: ONE_SIZE, stock: 55, badge: 'Gift pick',
    rating: 4.6, ratingCount: 33, art: { icon: 'Coffee', bg: '#3d1f05', fg: '#ffa94d' }
  }
];

const CATEGORIES = [
  { id: 'tees', name: 'Hacktoberfest Tees', blurb: 'Tees and hoodies for Hacktoberfest 2026 on campus.' },
  { id: 'costumes', name: 'Halloween Costumes', blurb: 'Costumes for the Halloween hack night.' },
  { id: 'accessories', name: 'Accessories', blurb: 'Stickers, mugs and small spooky extras.' }
];

module.exports = { PRODUCTS, CATEGORIES };
