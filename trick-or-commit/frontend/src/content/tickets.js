// Labels and limits for "Report a problem" tickets (must match backend/src/routes/tickets.js).
export const TICKET_CATEGORIES = [
  { id: 'bug', label: 'Something is broken', hint: 'A button, page or feature does not work', icon: 'Bug' },
  { id: 'typo', label: 'Wrong text or typo', hint: 'Spelling, wrong price, wrong info', icon: 'Type' },
  { id: 'design', label: 'Design / layout', hint: 'Looks broken, overlaps, hard to read', icon: 'Palette' },
  { id: 'feature', label: 'Feature request', hint: 'Something you wish the store did', icon: 'Lightbulb' },
  { id: 'payment', label: 'Payment or order', hint: 'Checkout, payment or an order you placed', icon: 'CreditCard' },
  { id: 'other', label: 'Something else', hint: 'Anything that does not fit above', icon: 'CircleHelp' }
];

export const TICKET_SEVERITIES = [
  { id: 'low', label: 'Low', hint: 'Cosmetic, easy to ignore' },
  { id: 'medium', label: 'Medium', hint: 'Annoying, but I can still shop' },
  { id: 'high', label: 'High', hint: 'Stops me doing something' },
  { id: 'critical', label: 'Critical', hint: 'Can’t buy, or money/data is wrong' }
];

export const TICKET_STATUS = {
  open: { label: 'Open', badge: 'purple' },
  in_progress: { label: 'In progress', badge: '' },
  resolved: { label: 'Resolved', badge: 'green' },
  closed: { label: 'Closed', badge: 'green' },
  rejected: { label: 'Rejected', badge: 'red' }
};

export const SEVERITY_BADGE = { low: 'green', medium: 'purple', high: '', critical: 'red' };

export const SITE_PAGES = ['Home page', 'Shop / product list', 'Product page', 'Cart', 'Checkout', 'Payment', 'Order confirmation', 'Sign in / account', 'Admin dashboard'];

export const MAX_SCREENSHOTS = 3;
export const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const categoryLabel = (id) => TICKET_CATEGORIES.find((c) => c.id === id)?.label || id;
export const severityLabel = (id) => TICKET_SEVERITIES.find((s) => s.id === id)?.label || id;

// Guests track tickets with a private token; remember the ones raised on this device.
const SAVED_KEY = 'toc_tickets';
export function rememberTicket(id, token) {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}');
    saved[id] = token;
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch {
    // storage blocked: the link in the success screen still works
  }
}
export function savedTicketToken(id) {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) || '{}')[id] || null;
  } catch {
    return null;
  }
}
