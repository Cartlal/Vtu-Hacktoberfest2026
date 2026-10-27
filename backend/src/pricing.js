// Server-side cart pricing. The client only ever sends product ids, sizes and
// quantities; every price, discount and total is recomputed here.
const db = require('./db');
const { HttpError } = require('./errors');

const FREE_SHIPPING_MIN = 99900; // ₹999
const SHIPPING_FEE = 7900;       // ₹79
const MAX_LINES = 20;
const MAX_QTY = 10;

const COUPONS = {
  HACKTOBER26: { type: 'percent', value: 15, min: 99900, label: '15% off orders of ₹999 or more' },
  GDGVTU: { type: 'flat', value: 10000, min: 59900, label: '₹100 off orders of ₹599 or more' },
  SPOOKY10: { type: 'percent', value: 10, min: 0, label: '10% off everything' }
};

function couponDiscount(code, subtotal) {
  if (!code) return { discount: 0, coupon: null, couponError: null };
  const key = String(code).trim().toUpperCase();
  const c = COUPONS[key];
  if (!c) return { discount: 0, coupon: null, couponError: 'That coupon code does not exist.' };
  if (subtotal < c.min) {
    return { discount: 0, coupon: null, couponError: `${key} needs a subtotal of ₹${c.min / 100} or more.` };
  }
  // Percentage discounts round to whole rupees so totals never show paise.
  const discount = c.type === 'percent'
    ? Math.round((subtotal * c.value) / 100 / 100) * 100
    : Math.min(c.value, subtotal);
  return { discount, coupon: key, couponError: null };
}

/**
 * items: [{ productId, size, qty }]
 * Returns { lines, subtotal, discount, shipping, total, coupon, couponError }.
 * Throws HttpError(400) for anything the customer must fix (stock, sizes, ...).
 */
function priceCart(items, { coupon, delivery = 'shipping' } = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Your cart is empty.');
  if (items.length > MAX_LINES) throw new HttpError(400, `At most ${MAX_LINES} different items per order.`);

  const getProduct = db.get().prepare('SELECT * FROM products WHERE id = ? AND active = 1');
  const lines = [];
  const qtyByProduct = new Map();

  for (const item of items) {
    const qty = Number(item?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new HttpError(400, `Quantity must be between 1 and ${MAX_QTY}.`);
    }
    const product = db.productFromRow(getProduct.get(Number(item.productId)));
    if (!product) throw new HttpError(400, 'An item in your cart is no longer available.');
    if (!product.sizes.includes(item.size)) {
      throw new HttpError(400, `Pick a valid size for ${product.name}.`);
    }
    const total = (qtyByProduct.get(product.id) || 0) + qty;
    if (total > product.stock) {
      throw new HttpError(400, product.stock === 0
        ? `${product.name} is sold out.`
        : `Only ${product.stock} of ${product.name} left in stock.`);
    }
    qtyByProduct.set(product.id, total);
    lines.push({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      size: item.size,
      qty,
      unitPrice: product.price,
      lineTotal: product.price * qty,
      art: product.art
    });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const { discount, coupon: applied, couponError } = couponDiscount(coupon, subtotal);
  const afterDiscount = subtotal - discount;
  const shipping = delivery === 'campus_pickup' || afterDiscount >= FREE_SHIPPING_MIN ? 0 : SHIPPING_FEE;

  return { lines, subtotal, discount, shipping, total: afterDiscount + shipping, coupon: applied, couponError };
}

module.exports = { priceCart, COUPONS, FREE_SHIPPING_MIN, SHIPPING_FEE };
