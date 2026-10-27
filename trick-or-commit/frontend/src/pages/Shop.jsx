import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SearchX } from 'lucide-react';
import { api } from '../api';
import ProductCard from '../components/ProductCard';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const PRICE_CAPS = [['', 'Any price'], ['500', 'Under ₹500'], ['1000', 'Under ₹1,000'], ['1500', 'Under ₹1,500']];

// Filters live in the URL so results are shareable and survive refresh.
export default function Shop() {
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [result, setResult] = useState({ key: null, products: [], error: '' });
  const [search, setSearch] = useState(params.get('q') || '');

  const category = params.get('category') || '';
  const size = params.get('size') || '';
  const max = params.get('max') || '';
  const sort = params.get('sort') || 'featured';
  const q = params.get('q') || '';
  const query = params.toString();

  useEffect(() => {
    api('/categories').then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    api(`/products?${query}`)
      .then((products) => !cancelled && setResult({ key: query, products, error: '' }))
      .catch((err) => !cancelled && setResult({ key: query, products: [], error: err.message }));
    return () => { cancelled = true; };
  }, [query]);

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const loading = result.key !== query;
  const heading = categories.find((c) => c.id === category)?.name || 'All products';

  return (
    <div className="container page">
      <div className="section-head">
        <div>
          <h1>{heading}</h1>
          <p style={{ margin: 0 }}>{loading ? 'Loading…' : `${result.products.length} product${result.products.length === 1 ? '' : 's'}`}</p>
        </div>
        <div className="row">
          <form className="row" onSubmit={(e) => { e.preventDefault(); setParam('q', search.trim()); }} role="search">
            <label htmlFor="shop-search" className="sr-only">Search products</label>
            <input id="shop-search" className="input" placeholder="Search tees, costumes…" value={search}
              onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
            <button className="btn secondary small" aria-label="Search"><Search size={16} /></button>
          </form>
          <label htmlFor="sort" className="sr-only">Sort by</label>
          <select id="sort" className="input" style={{ width: 'auto' }} value={sort} onChange={(e) => setParam('sort', e.target.value === 'featured' ? '' : e.target.value)}>
            <option value="featured">Featured</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="rating">Top rated</option>
            <option value="newest">Newest</option>
          </select>
        </div>
      </div>

      <div className="shop-layout">
        <aside className="filters" aria-label="Filters">
          <div>
            <h4>Category</h4>
            <div className="chip-row">
              <button className={`chip ${!category ? 'active' : ''}`} onClick={() => setParam('category', '')}>All</button>
              {categories.map((c) => (
                <button key={c.id} className={`chip ${category === c.id ? 'active' : ''}`} onClick={() => setParam('category', c.id)}>
                  {c.name} ({c.count})
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4>Size</h4>
            <div className="chip-row">
              {SIZES.map((s) => (
                <button key={s} className={`chip ${size === s ? 'active' : ''}`} onClick={() => setParam('size', size === s ? '' : s)}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <h4>Price</h4>
            <div className="chip-row">
              {PRICE_CAPS.map(([value, label]) => (
                <button key={label} className={`chip ${max === value ? 'active' : ''}`} onClick={() => setParam('max', value)}>{label}</button>
              ))}
            </div>
          </div>
          {(category || size || max || q) && (
            <button className="btn ghost small" onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear all filters</button>
          )}
        </aside>

        <div>
          {result.error && <p className="error">{result.error}</p>}
          {!loading && !result.error && result.products.length === 0 ? (
            <div className="empty card">
              <SearchX size={40} aria-hidden="true" />
              <h3>Nothing spooky here</h3>
              <p>No products match these filters. Try clearing a few.</p>
            </div>
          ) : (
            <div className="product-grid" style={{ opacity: loading ? 0.5 : 1 }}>
              {result.products.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
