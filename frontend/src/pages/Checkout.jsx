import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { CreditCard, Lock, Store, Truck } from 'lucide-react';
import { api } from '../api';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { Summary, savedCoupon, useQuote } from './Cart';
import { inr } from '../format';

const STATES = ['Karnataka', 'Andhra Pradesh', 'Goa', 'Kerala', 'Maharashtra', 'Tamil Nadu', 'Telangana', 'Delhi', 'Gujarat', 'Other'];

function validate(form) {
  const errors = {};
  if (form.name.trim().length < 2) errors.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'Enter a valid email.';
  if (!/^[6-9]\d{9}$/.test(form.phone.replace(/[\s-]/g, '').replace(/^\+91/, ''))) errors.phone = 'Enter a 10-digit mobile number.';
  if (form.delivery === 'shipping') {
    if (!form.line1.trim()) errors.line1 = 'Enter your address.';
    if (!form.city.trim()) errors.city = 'Enter your city.';
    if (!/^\d{6}$/.test(form.pincode.trim())) errors.pincode = 'Enter a 6-digit PIN code.';
  }
  return errors;
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

// Stand-in for a real gateway when no Razorpay keys are configured.
function DemoGateway({ amount, onPay, onCancel, busy }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="demo-pay-title">
      <div className="modal stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 id="demo-pay-title" style={{ margin: 0 }}>Demo payment</h3>
          <span className="badge purple">Test mode</span>
        </div>
        <p style={{ margin: 0 }}>No real money moves. Add Razorpay test keys on the server to use the real Razorpay checkout.</p>
        <div className="field"><label htmlFor="demo-card">Card number</label><input id="demo-card" className="input" value="4111 1111 1111 1111" readOnly /></div>
        <div className="form-grid">
          <div className="field"><label htmlFor="demo-exp">Expiry</label><input id="demo-exp" className="input" value="12/30" readOnly /></div>
          <div className="field"><label htmlFor="demo-cvv">CVV</label><input id="demo-cvv" className="input" value="123" readOnly /></div>
        </div>
        <button className="btn block" onClick={onPay} disabled={busy}><Lock size={16} /> Pay {inr(amount)}</button>
        <button className="btn ghost block" style={{ color: '#5b5170' }} onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

// Waits for the signed-in user so the form can start pre-filled with them.
export default function Checkout() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loader">Loading…</div>;
  return <CheckoutForm user={user} />;
}

function CheckoutForm({ user }) {
  const { items, apiItems, clear } = useCart();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: user?.name || '', email: user?.email || '', phone: '', delivery: 'shipping',
    line1: '', line2: '', city: '', state: 'Karnataka', pincode: ''
  });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(null);
  const [coupon] = useState(savedCoupon);
  const { quote, error: quoteError } = useQuote(apiItems, coupon, form.delivery);

  if (items.length === 0 && !demo) return <Navigate to="/cart" replace />;

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((errs) => ({ ...errs, [key]: undefined }));
  };

  async function confirmPayment(order, payload) {
    const paid = await api(`/checkout/${order.orderId}/verify`, { method: 'POST', body: { accessToken: order.accessToken, ...payload } });
    // Navigate first so the empty-cart redirect on this page never wins the race.
    navigate(`/order/${paid.id}?token=${order.accessToken}`, { replace: true });
    clear();
    try { sessionStorage.removeItem('toc_coupon'); } catch { /* storage blocked */ }
  }

  async function placeOrder(e) {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setSubmitError('');
    try {
      const order = await api('/checkout', {
        method: 'POST',
        body: {
          items: apiItems, coupon: quote?.coupon || undefined,
          name: form.name, email: form.email, phone: form.phone, delivery: form.delivery,
          address: { line1: form.line1, line2: form.line2, city: form.city, state: form.state, pincode: form.pincode }
        }
      });

      if (order.payment.provider === 'demo') {
        setDemo(order);
        setBusy(false);
        return;
      }

      if (!(await loadRazorpay())) throw new Error('Could not load Razorpay. Check your connection and try again.');
      const rzp = new window.Razorpay({
        key: order.payment.keyId,
        amount: order.payment.amount,
        currency: order.payment.currency,
        order_id: order.payment.razorpayOrderId,
        name: 'Trick or Commit',
        description: `Order ${order.orderId}`,
        prefill: order.prefill,
        theme: { color: '#ff7a1a' },
        handler: (resp) => confirmPayment(order, resp).catch((err) => { setSubmitError(err.message); setBusy(false); }),
        modal: { ondismiss: () => { setBusy(false); setSubmitError('Payment cancelled. Your cart is still here.'); } }
      });
      rzp.on('payment.failed', (resp) => setSubmitError(resp.error?.description || 'Payment failed. Try another method.'));
      rzp.open();
    } catch (err) {
      setSubmitError(err.message);
      setBusy(false);
    }
  }

  const fieldError = (key) => errors[key] && <span className="error">{errors[key]}</span>;

  return (
    <div className="container page">
      <h1>Checkout</h1>
      {!user && <p>Have an account? <Link to="/login?next=/checkout" className="accent">Sign in</Link> to see this order in your history.</p>}
      <form className="two-col" onSubmit={placeOrder} noValidate>
        <div className="stack" style={{ gap: 20 }}>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Contact</h3>
            <div className="form-grid">
              <div className="field full"><label htmlFor="name">Full name</label><input id="name" className="input" autoComplete="name" value={form.name} onChange={set('name')} />{fieldError('name')}</div>
              <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} />{fieldError('email')}</div>
              <div className="field"><label htmlFor="phone">Mobile number</label><input id="phone" className="input" type="tel" autoComplete="tel" placeholder="98765 43210" value={form.phone} onChange={set('phone')} />{fieldError('phone')}</div>
            </div>
          </div>

          <div className="card stack">
            <h3 style={{ margin: 0 }}>Delivery</h3>
            <div className="form-grid">
              <label className={`radio-card ${form.delivery === 'shipping' ? 'active' : ''}`}>
                <input type="radio" name="delivery" value="shipping" checked={form.delivery === 'shipping'} onChange={set('delivery')} />
                <span><strong className="row" style={{ gap: 6 }}><Truck size={16} /> Ship to me</strong><span className="muted">Free over ₹999, else ₹79</span></span>
              </label>
              <label className={`radio-card ${form.delivery === 'campus_pickup' ? 'active' : ''}`}>
                <input type="radio" name="delivery" value="campus_pickup" checked={form.delivery === 'campus_pickup'} onChange={set('delivery')} />
                <span><strong className="row" style={{ gap: 6 }}><Store size={16} /> Campus pickup</strong><span className="muted">Free · merch desk</span></span>
              </label>
            </div>
            {form.delivery === 'shipping' && (
              <div className="form-grid">
                <div className="field full"><label htmlFor="line1">Address</label><input id="line1" className="input" autoComplete="address-line1" value={form.line1} onChange={set('line1')} />{fieldError('line1')}</div>
                <div className="field full"><label htmlFor="line2">Apartment, hostel, landmark (optional)</label><input id="line2" className="input" autoComplete="address-line2" value={form.line2} onChange={set('line2')} /></div>
                <div className="field"><label htmlFor="city">City</label><input id="city" className="input" autoComplete="address-level2" value={form.city} onChange={set('city')} />{fieldError('city')}</div>
                <div className="field"><label htmlFor="pincode">PIN code</label><input id="pincode" className="input" inputMode="numeric" autoComplete="postal-code" value={form.pincode} onChange={set('pincode')} />{fieldError('pincode')}</div>
                <div className="field full"><label htmlFor="state">State</label>
                  <select id="state" className="input" value={form.state} onChange={set('state')}>{STATES.map((s) => <option key={s}>{s}</option>)}</select>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="stack">
          {quote ? (
            <Summary quote={quote}>
              {quote.lines.map((l) => (
                <div className="summary-row" key={`${l.productId}:${l.size}`} style={{ fontSize: '0.9rem' }}>
                  <span>{l.qty} × {l.name} ({l.size})</span><span>{inr(l.lineTotal)}</span>
                </div>
              ))}
              <button className="btn block" disabled={busy}><CreditCard size={18} /> {busy ? 'Processing…' : `Pay ${inr(quote.total)}`}</button>
              <span className="muted row" style={{ fontSize: '0.8rem', gap: 6 }}><Lock size={14} /> Secured by Razorpay · test mode</span>
            </Summary>
          ) : <div className="card loader">{quoteError || 'Pricing your order…'}</div>}
          {submitError && <p className="error" role="alert">{submitError}</p>}
        </div>
      </form>

      {demo && (
        <DemoGateway
          amount={demo.total}
          busy={busy}
          onPay={() => { setBusy(true); confirmPayment(demo, {}).catch((err) => { setSubmitError(err.message); setBusy(false); setDemo(null); }); }}
          onCancel={() => { setDemo(null); setSubmitError('Payment cancelled. Your cart is still here.'); }}
        />
      )}
    </div>
  );
}
