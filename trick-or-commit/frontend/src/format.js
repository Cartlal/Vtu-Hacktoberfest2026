// All money from the API is in paise.
export function inr(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: paise % 100 ? 2 : 0
  }).format(paise / 100);
}

export const STATUS_LABELS = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled'
};

export function formatDate(sqliteDate) {
  if (!sqliteDate) return '';
  return new Date(sqliteDate.replace(' ', 'T') + 'Z').toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}
