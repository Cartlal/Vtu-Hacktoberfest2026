import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Menu, ShoppingBag, User, X } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { EVENT } from '../content/event';

function Header() {
  const { count } = useCart();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);  // every nav link closes the mobile menu

  return (
    <>
      <div className="announce">
        {EVENT.name} on campus at {EVENT.campus} · Free campus pickup · Code SPOOKY10 for 10% off
      </div>
      <header className="header">
        <div className="container header-inner">
          <Link to="/" className="logo spooky" onClick={close}>Trick or Commit</Link>
          <button className="btn ghost menu-btn" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
          <nav className={`nav ${open ? 'open' : ''}`} aria-label="Main">
            <NavLink to="/shop" end onClick={close}>Shop all</NavLink>
            <NavLink to="/shop?category=tees" onClick={close}>Tees</NavLink>
            <NavLink to="/shop?category=costumes" onClick={close}>Costumes</NavLink>
            <a href="/#event" onClick={close}>Event</a>
            {user?.role === 'admin' && <NavLink to="/admin" onClick={close}>Admin</NavLink>}
            <NavLink to={user ? '/account' : '/login'} onClick={close} aria-label="Account">
              <span className="row" style={{ gap: 6 }}><User size={18} /> {user ? user.name.split(' ')[0] : 'Sign in'}</span>
            </NavLink>
            <NavLink to="/cart" className="cart-link" onClick={close} aria-label={`Cart, ${count} items`}>
              <ShoppingBag size={20} />
              {count > 0 && <span className="cart-count">{count}</span>}
            </NavLink>
          </nav>
        </div>
      </header>
    </>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="logo spooky" style={{ marginBottom: 10 }}>Trick or Commit</div>
            <p>Halloween costumes and {EVENT.name} tees for the {EVENT.campus} on-campus event, powered by {EVENT.host}.</p>
          </div>
          <div>
            <h4>Shop</h4>
            <Link to="/shop?category=tees">Hacktoberfest tees</Link>
            <Link to="/shop?category=costumes">Halloween costumes</Link>
            <Link to="/shop?category=accessories">Accessories</Link>
          </div>
          <div>
            <h4>Help</h4>
            <a href="/#faq">FAQ</a>
            <Link to="/account">Your orders</Link>
            <a href="/#event">Event schedule</a>
          </div>
        </div>
        <small>
          Unofficial demo store built for Hackfest 2026. Not affiliated with, or endorsed by, DigitalOcean
          (Hacktoberfest) or Google (GDG on Campus). Payments run in test mode; no real money is charged.
        </small>
      </div>
    </footer>
  );
}

export default function Layout() {
  return (
    <>
      <Header />
      <main><Outlet /></main>
      <Footer />
    </>
  );
}
