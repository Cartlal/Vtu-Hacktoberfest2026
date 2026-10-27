import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const CART_KEY = 'toc_cart';
const CartContext = createContext(null);

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

const lineKey = (productId, size) => `${productId}:${size}`;

// The cart lives in the browser. Prices stored here are only for display;
// the server re-prices everything at checkout.
export function CartProvider({ children }) {
  const [items, setItems] = useState(loadCart);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch {
      // storage blocked: cart lasts for this tab only
    }
  }, [items]);

  const add = useCallback((product, size, qty = 1) => {
    setItems((current) => {
      const key = lineKey(product.id, size);
      const existing = current.find((i) => i.key === key);
      if (existing) {
        return current.map((i) => (i.key === key ? { ...i, qty: Math.min(10, i.qty + qty) } : i));
      }
      return [...current, {
        key, productId: product.id, slug: product.slug, name: product.name,
        size, qty, price: product.price, art: product.art
      }];
    });
  }, []);

  const update = useCallback((key, qty) => {
    setItems((current) => current.map((i) => (i.key === key ? { ...i, qty: Math.max(1, Math.min(10, qty)) } : i)));
  }, []);

  const remove = useCallback((key) => setItems((current) => current.filter((i) => i.key !== key)), []);
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(() => ({
    items,
    count: items.reduce((n, i) => n + i.qty, 0),
    estimate: items.reduce((n, i) => n + i.qty * i.price, 0),
    apiItems: items.map(({ productId, size, qty }) => ({ productId, size, qty })),
    add, update, remove, clear
  }), [items, add, update, remove, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  return useContext(CartContext);
}
