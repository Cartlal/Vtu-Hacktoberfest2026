import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { inr, formatDate, STATUS_LABELS } from '../format';
import ProductArt, { ICON_NAMES } from '../components/ProductArt';

function Overview() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/admin/stats').then(setStats).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!stats) return <div className="loader">Loading stats…</div>;

  const peak = Math.max(1, ...stats.byDay.map((d) => d.revenue));
  return (
    <>
      <div className="kpis">
        <div className="card"><span className="muted">Revenue</span><strong>{inr(stats.revenue)}</strong></div>
        <div className="card"><span className="muted">Paid orders</span><strong>{stats.paidOrders}</strong></div>
        <div className="card"><span className="muted">Items sold</span><strong>{stats.itemsSold}</strong></div>
        <div className="card"><span className="muted">Avg. order</span><strong>{inr(stats.averageOrder)}</strong></div>
        <div className="card"><span className="muted">Awaiting payment</span><strong>{stats.pendingOrders}</strong></div>
        <div className="card"><span className="muted">Customers</span><strong>{stats.customers}</strong></div>
        <div className="card"><span className="muted">Subscribers</span><strong>{stats.subscribers}</strong></div>
        <div className="card"><span className="muted">Low-stock products</span><strong>{stats.lowStock.length}</strong></div>
      </div>
      <div className="two-col">
        <div className="card">
          <h3>Revenue, last 14 days</h3>
          {stats.byDay.length === 0 ? <p className="muted">No paid orders yet.</p> : (
            <>
              <div className="bars">
                {stats.byDay.map((d) => (
                  <div key={d.day} style={{ height: `${(d.revenue / peak) * 100}%` }} title={`${d.day}: ${inr(d.revenue)} · ${d.orders} orders`} />
                ))}
              </div>
              <div className="row muted" style={{ justifyContent: 'space-between', fontSize: '0.8rem', marginTop: 6 }}>
                <span>{stats.byDay[0].day}</span><span>{stats.byDay.at(-1).day}</span>
              </div>
            </>
          )}
        </div>
        <div className="card">
          <h3>Low stock (10 or fewer)</h3>
          {stats.lowStock.length === 0 ? <p className="muted">Everything is well stocked.</p> : stats.lowStock.map((p) => (
            <div className="summary-row" key={p.id}><span>{p.name}</span><span className={p.stock === 0 ? 'error' : 'accent'}>{p.stock} left</span></div>
          ))}
        </div>
      </div>
    </>
  );
}

function Orders() {
  const [orders, setOrders] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api(`/admin/orders${filter ? `?status=${filter}` : ''}`)
      .then((o) => !cancelled && setOrders(o))
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [filter]);

  async function setStatus(order, status) {
    if (status === 'cancelled' && !window.confirm(`Cancel ${order.id}? Paid stock goes back on the shelf; refund the payment in Razorpay separately.`)) return;
    try {
      const updated = await api(`/admin/orders/${order.id}`, { method: 'PATCH', body: { status } });
      setOrders((list) => list.map((o) => (o.id === updated.id ? updated : o)));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <label htmlFor="order-filter" className="muted">Status</label>
        <select id="order-filter" className="input" style={{ width: 'auto' }} value={filter} onChange={(e) => { setFilter(e.target.value); setOrders(null); }}>
          <option value="">All</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {orders === null ? <div className="loader">Loading orders…</div> : orders.length === 0 ? <p className="muted">No orders.</p> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Delivery</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/order/${o.id}`} className="accent">{o.id}</Link></td>
                  <td>{formatDate(o.createdAt)}</td>
                  <td>{o.name}<br /><span className="muted">{o.email} · {o.phone}</span></td>
                  <td>{o.delivery === 'campus_pickup' ? 'Pickup' : `${o.address?.city || ''}`}</td>
                  <td>{inr(o.total)}{o.coupon && <><br /><span className="muted">{o.coupon}</span></>}</td>
                  <td>
                    <select className="input" value={o.status} onChange={(e) => setStatus(o, e.target.value)} aria-label={`Status of ${o.id}`}>
                      {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

const EMPTY_PRODUCT = { name: '', category: 'tees', description: '', price: '', stock: '', sizes: 'XS,S,M,L,XL,XXL', badge: '', icon: 'Shirt', bg: '#2b1748', fg: '#ff7a1a' };

function Products() {
  const [products, setProducts] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(EMPTY_PRODUCT);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => api('/admin/products').then(setProducts).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function patch(id, body) {
    try {
      const updated = await api(`/admin/products/${id}`, { method: 'PATCH', body });
      setProducts((list) => list.map((p) => (p.id === id ? updated : p)));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }

  async function create(e) {
    e.preventDefault();
    const price = Math.round(Number(draft.price) * 100);
    const stock = Number(draft.stock);
    if (draft.name.trim().length < 3) return setFormError('Name must be at least 3 characters.');
    if (!(price >= 100)) return setFormError('Price must be at least ₹1.');
    if (!Number.isInteger(stock) || stock < 0) return setFormError('Stock must be a whole number.');
    try {
      await api('/admin/products', {
        method: 'POST',
        body: {
          name: draft.name, category: draft.category, description: draft.description, price, stock,
          sizes: draft.sizes.split(',').map((s) => s.trim()).filter(Boolean), badge: draft.badge || null,
          art: { icon: draft.icon, bg: draft.bg, fg: draft.fg }
        }
      });
      setDraft(EMPTY_PRODUCT);
      setFormError('');
      load();
    } catch (err) {
      setFormError(err.message);
    }
  }

  const set = (key) => (e) => { setDraft((d) => ({ ...d, [key]: e.target.value })); setFormError(''); };

  return (
    <div className="stack" style={{ gap: 24 }}>
      {error && <p className="error">{error}</p>}
      {products === null ? <div className="loader">Loading products…</div> : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th></th><th>Product</th><th>Price (₹)</th><th>Stock</th><th>Featured</th><th>Live</th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                  <td style={{ width: 56 }}><ProductArt art={p.art} size={24} /></td>
                  <td><strong>{p.name}</strong><br /><span className="muted">{p.category}</span></td>
                  <td style={{ width: 120 }}>
                    <input className="input" type="number" min="1" defaultValue={p.price / 100} aria-label={`Price of ${p.name}`}
                      onBlur={(e) => { const v = Math.round(Number(e.target.value) * 100); if (v !== p.price) patch(p.id, { price: v }); }} />
                  </td>
                  <td style={{ width: 100 }}>
                    <input className="input" type="number" min="0" defaultValue={p.stock} aria-label={`Stock of ${p.name}`}
                      onBlur={(e) => { const v = Number(e.target.value); if (v !== p.stock) patch(p.id, { stock: v }); }} />
                  </td>
                  <td><input type="checkbox" checked={p.featured} onChange={(e) => patch(p.id, { featured: e.target.checked })} aria-label={`Feature ${p.name}`} /></td>
                  <td><input type="checkbox" checked={p.active} onChange={(e) => patch(p.id, { active: e.target.checked })} aria-label={`${p.name} visible in shop`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="card stack" onSubmit={create} noValidate>
        <h3 style={{ margin: 0 }}>Add a product</h3>
        <div className="form-grid">
          <div className="field"><label htmlFor="np-name">Name</label><input id="np-name" className="input" value={draft.name} onChange={set('name')} /></div>
          <div className="field"><label htmlFor="np-cat">Category</label>
            <select id="np-cat" className="input" value={draft.category} onChange={set('category')}>
              <option value="tees">Hacktoberfest tees</option><option value="costumes">Halloween costumes</option><option value="accessories">Accessories</option>
            </select>
          </div>
          <div className="field full"><label htmlFor="np-desc">Description</label><textarea id="np-desc" className="input" rows="2" value={draft.description} onChange={set('description')} /></div>
          <div className="field"><label htmlFor="np-price">Price (₹)</label><input id="np-price" className="input" type="number" min="1" value={draft.price} onChange={set('price')} /></div>
          <div className="field"><label htmlFor="np-stock">Stock</label><input id="np-stock" className="input" type="number" min="0" value={draft.stock} onChange={set('stock')} /></div>
          <div className="field"><label htmlFor="np-sizes">Sizes (comma-separated)</label><input id="np-sizes" className="input" value={draft.sizes} onChange={set('sizes')} /></div>
          <div className="field"><label htmlFor="np-badge">Badge (optional)</label><input id="np-badge" className="input" value={draft.badge} onChange={set('badge')} /></div>
          <div className="field"><label htmlFor="np-icon">Icon</label>
            <select id="np-icon" className="input" value={draft.icon} onChange={set('icon')}>{ICON_NAMES.map((n) => <option key={n}>{n}</option>)}</select>
          </div>
          <div className="row">
            <div className="field"><label htmlFor="np-bg">Tile</label><input id="np-bg" type="color" value={draft.bg} onChange={set('bg')} /></div>
            <div className="field"><label htmlFor="np-fg">Icon colour</label><input id="np-fg" type="color" value={draft.fg} onChange={set('fg')} /></div>
            <div style={{ width: 64 }}><ProductArt art={{ icon: draft.icon, bg: draft.bg, fg: draft.fg }} size={28} /></div>
          </div>
        </div>
        {formError && <p className="error" style={{ margin: 0 }}>{formError}</p>}
        <button className="btn" style={{ justifySelf: 'start' }}>Add product</button>
      </form>
    </div>
  );
}

export default function Admin() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState('overview');
  if (loading) return <div className="loader">Loading…</div>;
  if (!user) return <Navigate to="/login?next=/admin" replace />;
  if (user.role !== 'admin') return <div className="container page empty"><h1>Admins only</h1><p>This account can't open the dashboard.</p></div>;

  return (
    <div className="container page">
      <h1>Store dashboard</h1>
      <div className="tabs" role="tablist">
        {[['overview', 'Overview'], ['orders', 'Orders'], ['products', 'Products']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'orders' && <Orders />}
      {tab === 'products' && <Products />}
    </div>
  );
}
