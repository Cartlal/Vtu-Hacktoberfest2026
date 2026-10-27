import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import ProductArt from './ProductArt';
import { inr } from '../format';

export function Rating({ value, count }) {
  return (
    <span className="rating">
      <Star size={14} fill="currentColor" aria-hidden="true" /> {value.toFixed(1)} <span>({count})</span>
    </span>
  );
}

export function Price({ price, compareAt }) {
  return (
    <span className="price">
      {inr(price)}
      {compareAt > price && <s>{inr(compareAt)}</s>}
    </span>
  );
}

export default function ProductCard({ product }) {
  return (
    <Link to={`/product/${product.slug}`} className="product-card">
      <ProductArt art={product.art} size={84}>
        {product.stock === 0
          ? <span className="badge red">Sold out</span>
          : product.badge && <span className="badge">{product.badge}</span>}
      </ProductArt>
      <h3>{product.name}</h3>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Price price={product.price} compareAt={product.compareAt} />
        <Rating value={product.rating} count={product.ratingCount} />
      </div>
    </Link>
  );
}
