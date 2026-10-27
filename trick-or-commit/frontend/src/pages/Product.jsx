import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Minus, Plus, ShoppingBag, Store, Truck } from 'lucide-react';
import { api } from '../api';
import { useCart } from '../context/CartContext';
import ProductArt from '../components/ProductArt';
import ProductCard, { Price, Rating } from '../components/ProductCard';

export default function Product() {
  const { slug } = useParams();
  const { add } = useCart();
  const [state, setState] = useState({ slug: null, product: null, error: '' });
  const [size, setSize] = useState('');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [sizeError, setSizeError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api(`/products/${slug}`)
      .then((product) => {
        if (cancelled) return;
        setState({ slug, product, error: '' });
        setSize(product.sizes.length === 1 ? product.sizes[0] : '');
        setQty(1);
        setAdded(false);
      })
      .catch((err) => !cancelled && setState({ slug, product: null, error: err.message }));
    return () => { cancelled = true; };
  }, [slug]);

  if (state.slug !== slug) return <div className="loader">Summoning product…</div>;
  if (state.error) {
    return (
      <div className="container page empty">
        <h1>Product not found</h1>
        <p>{state.error}</p>
        <Link to="/shop" className="btn">Back to the shop</Link>
      </div>
    );
  }

  const p = state.product;
  const soldOut = p.stock === 0;

  function addToCart() {
    if (!size) {
      setSizeError('Pick a size first.');
      return;
    }
    add(p, size, qty);
    setAdded(true);
  }

  return (
    <div className="container page">
      <p><Link to="/shop" className="muted">Shop</Link> / <Link to={`/shop?category=${p.category}`} className="muted">{p.category}</Link> / {p.name}</p>
      <div className="pdp">
        <ProductArt art={p.art} size={200}>
          {p.badge && <span className="badge" style={{ position: 'absolute', top: 16, left: 16, zIndex: 1 }}>{p.badge}</span>}
        </ProductArt>
        <div className="stack" style={{ alignContent: 'start', gap: 18 }}>
          <div>
            <h1>{p.name}</h1>
            <Rating value={p.rating} count={p.ratingCount} />
          </div>
          <div style={{ fontSize: '1.6rem' }}>
            <Price price={p.price} compareAt={p.compareAt} />
            {p.compareAt > p.price && (
              <span className="badge green" style={{ marginLeft: 10, fontSize: '0.8rem' }}>
                Save {Math.round(((p.compareAt - p.price) / p.compareAt) * 100)}%
              </span>
            )}
            <div className="muted" style={{ fontSize: '0.85rem' }}>Inclusive of all taxes</div>
          </div>
          <p style={{ margin: 0 }}>{p.description}</p>

          <div>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <strong>Size</strong>
              {sizeError && <span className="error">{sizeError}</span>}
            </div>
            <div className="size-row" role="radiogroup" aria-label="Size">
              {p.sizes.map((s) => (
                <button key={s} role="radio" aria-checked={size === s} className={`size-btn ${size === s ? 'active' : ''}`}
                  onClick={() => { setSize(s); setSizeError(''); setAdded(false); }}>{s}</button>
              ))}
            </div>
          </div>

          <div className="row">
            <div className="qty" aria-label="Quantity">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity"><Minus size={16} /></button>
              <span>{qty}</span>
              <button onClick={() => setQty((q) => Math.min(10, p.stock, q + 1))} aria-label="Increase quantity"><Plus size={16} /></button>
            </div>
            <button className="btn" onClick={addToCart} disabled={soldOut} style={{ flex: 1 }}>
              {soldOut ? 'Sold out' : added ? <><Check size={18} /> Added to cart</> : <><ShoppingBag size={18} /> Add to cart</>}
            </button>
          </div>
          {added && <Link to="/cart" className="btn secondary">Go to cart</Link>}
          <p className={p.stock <= 10 && !soldOut ? 'accent' : 'muted'} style={{ margin: 0 }}>
            {soldOut ? 'Sold out. Restocks are announced to subscribers first.' : p.stock <= 10 ? `Only ${p.stock} left!` : 'In stock'}
          </p>

          <div className="card stack" style={{ gap: 8 }}>
            <span className="row"><Store size={18} aria-hidden="true" /> Free campus pickup at the merch desk</span>
            <span className="row"><Truck size={18} aria-hidden="true" /> Free shipping on orders of ₹999 or more</span>
          </div>
        </div>
      </div>

      {p.related.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>You might also like</h2></div>
          <div className="product-grid">{p.related.map((r) => <ProductCard key={r.id} product={r} />)}</div>
        </section>
      )}
    </div>
  );
}
