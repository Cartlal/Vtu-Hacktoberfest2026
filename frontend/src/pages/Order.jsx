import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PartyPopper } from 'lucide-react';
import { api } from '../api';
import { inr, formatDate, STATUS_LABELS } from '../format';
import ProductArt from '../components/ProductArt';

export default function Order() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState({ order: null, error: '' });

  useEffect(() => {
    api(`/orders/${id}${token ? `?token=${encodeURIComponent(token)}` : ''}`)
      .then((order) => setState({ order, error: '' }))
      .catch((err) => setState({ order: null, error: err.message }));
  }, [id, token]);

  if (state.error) {
    return (
      <div className="container page empty">
        <h1>Order not found</h1>
        <p>Sign in with the account you ordered with, or use the link from your confirmation.</p>
        <Link to="/account" className="btn">Your orders</Link>
      </div>
    );
  }
  if (!state.order) return <div className="loader">Loading your order…</div>;

  const o = state.order;
  const paid = ['paid', 'shipped', 'delivered'].includes(o.status);

  return (
    <div className="container page" style={{ maxWidth: 760 }}>
      {paid && (
        <div className="center" style={{ marginBottom: 24 }}>
          <PartyPopper size={48} color="#ff7a1a" aria-hidden="true" />
          <h1 className="spooky" style={{ fontSize: '2.6rem', color: 'var(--orange)' }}>Treat secured!</h1>
          <p>Thanks, {o.name.split(' ')[0]}. Your order is confirmed. Keep your order ID handy; bookmark this page to check its status.</p>
        </div>
      )}
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>Order {o.id}</h2>
            <span className="muted">{formatDate(o.createdAt)}</span>
          </div>
          <span className={`badge ${paid ? 'green' : o.status === 'cancelled' ? 'red' : 'purple'}`}>{STATUS_LABELS[o.status]}</span>
        </div>
        {o.items.map((item) => (
          <div className="cart-line" key={`${item.productId}:${item.size}`} style={{ gridTemplateColumns: '64px 1fr auto' }}>
            <ProductArt art={item.art} size={32} />
            <span><strong>{item.name}</strong><br /><span className="muted">Size {item.size} · Qty {item.qty}</span></span>
            <strong>{inr(item.lineTotal)}</strong>
          </div>
        ))}
        <div className="summary-row"><span>Subtotal</span><span>{inr(o.subtotal)}</span></div>
        {o.discount > 0 && <div className="summary-row"><span>Discount ({o.coupon})</span><span>−{inr(o.discount)}</span></div>}
        <div className="summary-row"><span>Shipping</span><span>{o.shipping ? inr(o.shipping) : 'Free'}</span></div>
        <div className="summary-row total"><span>Total paid</span><span>{inr(o.total)}</span></div>
        <div className="muted">
          {o.delivery === 'campus_pickup'
            ? 'Campus pickup: show this order ID at the merch desk on any event day.'
            : `Shipping to ${[o.address.line1, o.address.line2, o.address.city, o.address.state, o.address.pincode].filter(Boolean).join(', ')}`}
        </div>
        {o.paymentId && <div className="muted" style={{ fontSize: '0.85rem' }}>Payment reference: {o.paymentId}</div>}
      </div>
      <div className="row" style={{ justifyContent: 'center', marginTop: 24 }}>
        <Link to="/shop" className="btn">Keep shopping</Link>
        <Link to="/account" className="btn secondary">Your orders</Link>
      </div>
    </div>
  );
}
