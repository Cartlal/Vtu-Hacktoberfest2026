import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Bug, LogOut, Package } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { inr, formatDate, STATUS_LABELS } from '../format';
import { TICKET_STATUS } from '../content/tickets';

export default function Account() {
  const { user, loading, signOut } = useAuth();
  const [orders, setOrders] = useState(null);
  const [tickets, setTickets] = useState(null);

  useEffect(() => {
    if (!user) return;
    api('/orders/mine').then(setOrders).catch(() => setOrders([]));
    api('/tickets/mine').then(setTickets).catch(() => setTickets([]));
  }, [user]);

  if (loading) return <div className="loader">Loading…</div>;
  if (!user) return <Navigate to="/login?next=/account" replace />;

  return (
    <div className="container page">
      <div className="section-head">
        <div>
          <h1>Hi, {user.name.split(' ')[0]}</h1>
          <p style={{ margin: 0 }}>{user.email}{user.role === 'admin' && ' · admin'}</p>
        </div>
        <div className="row">
          {user.role === 'admin' && <Link to="/admin" className="btn secondary small">Admin dashboard</Link>}
          <button className="btn ghost small" onClick={signOut}><LogOut size={16} /> Sign out</button>
        </div>
      </div>

      <h2>Your orders</h2>
      {orders === null ? <div className="loader">Loading orders…</div> : orders.length === 0 ? (
        <div className="card empty">
          <Package size={40} aria-hidden="true" />
          <h3>No orders yet</h3>
          <p>Orders you place while signed in show up here.</p>
          <Link to="/shop" className="btn">Browse the shop</Link>
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/order/${o.id}`} className="accent">{o.id}</Link></td>
                  <td>{formatDate(o.createdAt)}</td>
                  <td>{o.items.reduce((n, i) => n + i.qty, 0)}</td>
                  <td>{inr(o.total)}</td>
                  <td>{STATUS_LABELS[o.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-head" style={{ marginTop: 40 }}>
        <h2 style={{ margin: 0 }}>Your reports</h2>
        <Link to="/report" className="btn secondary small"><Bug size={16} /> Report a problem</Link>
      </div>
      {tickets === null ? <div className="loader">Loading reports…</div> : tickets.length === 0 ? (
        <p className="muted">You haven't reported any problems. Spotted something off? Use the Report a bug button on any page.</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Ticket</th><th>Title</th><th>Raised</th><th>Status</th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td><Link to={`/ticket/${t.id}`} className="accent">{t.id}</Link></td>
                  <td>{t.title}</td>
                  <td>{formatDate(t.createdAt)}</td>
                  <td><span className={`badge ${TICKET_STATUS[t.status].badge}`}>{TICKET_STATUS[t.status].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
