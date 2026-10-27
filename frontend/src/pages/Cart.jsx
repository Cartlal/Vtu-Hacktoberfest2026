import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ghost, Minus, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useCart } from '../context/CartContext';
import ProductArt from '../components/ProductArt';
import { inr } from '../format';

// Shared by the cart and checkout pages: asks the server to price the cart.
export function useQuote(apiItems, coupon, delivery) {
  const [state, setState] = useState({ key: null, quote: null, error: '' });
  const key = JSON.stringify({ apiItems, coupon, delivery });

  useEffect(() => {
    if (apiItems.length === 0) return;
    let cancelled = false;
    const body = JSON.parse(key);
    api('/checkout/quote', { method: 'POST', body: { items: body.apiItems, coupon: body.coupon, delivery: body.delivery } })
      .then((quote) => !cancelled && setState({ key, quote, error: '' }))
      .catch((err) => !cancelled && setState({ key, quote: null, error: err.message }));
    return () => { cancelled = true; };
  }, [key, apiItems.length]);

  return { ...state, loading: state.key !== key };
}

export function Summary({ quote, children }) {
  return (
    <div className="card summary">
      <h3 style={{ margin: 0 }}>Order summary</h3>
      <div className="summary-row"><span>Subtotal</span><span>{inr(quote.subtotal)}</span></div>
      {quote.discount > 0 && <div className="summary-row"><span>Discount ({quote.coupon})</span><span className="success">−{inr(quote.discount)}</span></div>}
      <div className="summary-row"><span>Shipping</span><span>{quote.shipping === 0 ? 'Free' : inr(quote.shipping)}</span></div>
      <div className="summary-row total"><span>Total</span><span>{inr(quote.total)}</span></div>
      <span className="muted" style={{ fontSize: '0.8rem' }}>Prices include GST.</span>
      {children}
    </div>
  );
}

const COUPON_KEY = 'toc_coupon';

// The applied coupon carries over from the cart to checkout for this tab.
export function savedCoupon() {
  try {
    return sessionStorage.getItem(COUPON_KEY) || '';
  } catch {
    return '';
  }
}

export default function Cart() {
  const { items, apiItems, update, remove } = useCart();
  const navigate = useNavigate();
  const [coupon, setCoupon] = useState(savedCoupon);
  const [couponInput, setCouponInput] = useState(coupon);
  const { quote, error, loading } = useQuote(apiItems, coupon, 'shipping');

  function applyCoupon(e) {
    e.preventDefault();
    const code = couponInput.trim().toUpperCase();
    setCoupon(code);
    try { sessionStorage.setItem(COUPON_KEY, code); } catch { /* storage blocked */ }
  }

  if (items.length === 0) {
    return (
      <div className="container page empty">
        <Ghost size={56} aria-hidden="true" />
        <h1>Your cart is a ghost town</h1>
        <p>Nothing in here yet. Go find something spooky.</p>
        <Link to="/shop" className="btn">Start shopping</Link>
      </div>
    );
  }

  return (
    <div className="container page">
      <h1>Your cart</h1>
      <div className="two-col">
        <div>
          {items.map((item) => (
            <div className="cart-line" key={item.key}>
              <Link to={`/product/${item.slug}`}><ProductArt art={item.art} size={40} /></Link>
              <div className="stack" style={{ gap: 6 }}>
                <Link to={`/product/${item.slug}`}><strong>{item.name}</strong></Link>
                <span className="muted">Size {item.size} · {inr(item.price)} each</span>
                <div className="row">
                  <div className="qty" aria-label={`Quantity of ${item.name}`}>
                    <button onClick={() => update(item.key, item.qty - 1)} aria-label="Decrease quantity"><Minus size={14} /></button>
                    <span>{item.qty}</span>
                    <button onClick={() => update(item.key, item.qty + 1)} aria-label="Increase quantity"><Plus size={14} /></button>
                  </div>
                  <button className="btn ghost small" onClick={() => remove(item.key)} aria-label={`Remove ${item.name}`}><Trash2 size={16} /> Remove</button>
                </div>
              </div>
              <strong>{inr(item.price * item.qty)}</strong>
            </div>
          ))}
          {error && <p className="error" style={{ marginTop: 16 }}>{error}</p>}
        </div>

        <div className="stack">
          <form className="card stack" onSubmit={applyCoupon}>
            <label htmlFor="coupon"><strong>Coupon code</strong></label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id="coupon" className="input" placeholder="HACKTOBER26" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} />
              <button className="btn secondary small">Apply</button>
            </div>
            {quote?.couponError && <span className="error">{quote.couponError}</span>}
            {quote?.coupon && <span className="success">{quote.coupon} applied.</span>}
          </form>
          {quote ? (
            <Summary quote={quote}>
              <button className="btn block" disabled={loading || !!error} onClick={() => navigate('/checkout')}>Checkout</button>
              <span className="muted" style={{ fontSize: '0.8rem' }}>Shipping shown for delivery; campus pickup is free.</span>
            </Summary>
          ) : !error && <div className="card loader">Pricing your cart…</div>}
        </div>
      </div>
    </div>
  );
}
