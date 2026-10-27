// Event details shown on the marketing pages. Edit these to match the real
// event; everything else on the site reads from here.
export const EVENT = {
  name: 'Hacktoberfest 2026',
  host: 'GDG on Campus VTU',
  campus: 'VTU',
  venue: 'VTU campus, Jnana Sangama, Belagavi',
  // Halloween hack night: drives the countdown on the home page.
  hackNight: '2026-10-31T18:00:00+05:30',
  tagline: 'Ship pull requests all October. Haunt the campus on the 31st.',
  schedule: [
    { date: 'Oct 1', title: 'Hacktoberfest kicks off', text: 'Register, pick your first issues, and join the GDG on Campus VTU contributor channel.' },
    { date: 'Oct 10', title: 'First-PR workshop', text: 'A hands-on session on forking, branching and opening a clean pull request.' },
    { date: 'Oct 24', title: 'Maintainer office hours', text: 'Bring your stuck PRs. Mentors review live and help you get them merged.' },
    { date: 'Oct 31', title: 'Halloween hack night', text: 'Costumes on, laptops open. Merch pickup, costume contest and a midnight merge party.' }
  ],
  faqs: [
    { q: 'Is this the official Hacktoberfest store?', a: 'No. This is an unofficial campus merch store for the VTU on-campus event, run with GDG on Campus VTU. Hacktoberfest itself is organised by DigitalOcean.' },
    { q: 'Can I pick up my order on campus?', a: 'Yes. Choose "Campus pickup" at checkout and collect it at the merch desk during any event day. Pickup is always free.' },
    { q: 'How much is shipping?', a: 'Free on orders of ₹999 or more after discounts, otherwise a flat ₹79 anywhere in India.' },
    { q: 'Which payment methods work?', a: 'UPI, cards, net banking and wallets through Razorpay. This demo build runs payments in test mode, so no real money is charged.' },
    { q: 'What sizes do the tees come in?', a: 'XS to XXL in a unisex fit. Costumes come in S to XL. Each product page lists the sizes in stock.' }
  ]
};
