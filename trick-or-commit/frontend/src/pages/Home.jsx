import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Ghost, MapPin, Shirt, Sparkles, Store, Tag, Truck } from 'lucide-react';
import { api } from '../api';
import { EVENT } from '../content/event';
import ProductArt from '../components/ProductArt';
import ProductCard from '../components/ProductCard';

function useCountdown(target) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = Math.max(0, new Date(target).getTime() - now);
  return {
    done: ms === 0,
    days: Math.floor(ms / 86400000),
    hours: Math.floor(ms / 3600000) % 24,
    minutes: Math.floor(ms / 60000) % 60,
    seconds: Math.floor(ms / 1000) % 60
  };
}

function Countdown() {
  const t = useCountdown(EVENT.hackNight);
  if (t.done) return <p className="accent"><strong>Hack night is live. See you on campus!</strong></p>;
  return (
    <div className="countdown" aria-label="Time until Halloween hack night">
      {[['days', t.days], ['hours', t.hours], ['mins', t.minutes], ['secs', t.seconds]].map(([label, value]) => (
        <div key={label}><strong>{String(value).padStart(2, '0')}</strong><span>{label}</span></div>
      ))}
    </div>
  );
}

function Newsletter() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });

  async function submit(e) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState({ status: 'error', message: 'Enter a valid email address.' });
      return;
    }
    setState({ status: 'loading', message: '' });
    try {
      await api('/marketing/subscribe', { method: 'POST', body: { email } });
      setState({ status: 'done', message: 'You are on the list. Watch your inbox for drop alerts.' });
      setEmail('');
    } catch (err) {
      setState({ status: 'error', message: err.message });
    }
  }

  return (
    <div className="card newsletter">
      <div>
        <h2 className="spooky" style={{ fontSize: '2rem' }}>Don't miss the midnight drop</h2>
        <p style={{ marginBottom: 0 }}>Get restock alerts, new costume drops and hack night updates. No spam, only treats.</p>
      </div>
      <form onSubmit={submit} noValidate>
        <label htmlFor="newsletter-email" className="sr-only">Email address</label>
        <input id="newsletter-email" className="input" type="email" placeholder="you@college.edu" value={email}
          onChange={(e) => { setEmail(e.target.value); setState({ status: 'idle', message: '' }); }} />
        <button className="btn" disabled={state.status === 'loading'}>Subscribe</button>
      </form>
      {state.message && <p className={state.status === 'error' ? 'error' : 'success'} style={{ gridColumn: '1 / -1', margin: 0 }}>{state.message}</p>}
    </div>
  );
}

export default function Home() {
  const [featured, setFeatured] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api('/products?featured=1').then(setFeatured).catch(() => setFeatured([]));
    api('/marketing/stats').then(setStats).catch(() => setStats(null));
  }, []);

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="row" style={{ marginBottom: 16 }}>
              <span className="badge">{EVENT.name}</span>
              <span className="badge purple">On campus · {EVENT.campus}</span>
              <span className="badge green">Powered by {EVENT.host}</span>
            </div>
            <h1 className="spooky">Trick or Commit</h1>
            <p className="lead">{EVENT.tagline} Grab the official-look campus tees, hoodies and Halloween costumes for hack night.</p>
            <Countdown />
            <div className="row">
              <Link to="/shop" className="btn">Shop the merch <ArrowRight size={18} /></Link>
              <a href="#event" className="btn secondary">See the event</a>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <ProductArt art={{ icon: 'Shirt', bg: '#2b1748', fg: '#ff7a1a' }} size={110} />
            <ProductArt art={{ icon: 'Ghost', bg: '#e9e6f5', fg: '#2b2340' }} size={110} />
            <ProductArt art={{ icon: 'GitPullRequest', bg: '#14100f', fg: '#ff8c2b' }} size={110} />
            <ProductArt art={{ icon: 'Skull', bg: '#101014', fg: '#d9ffe0' }} size={110} />
          </div>
        </div>
      </section>

      <div className="container">
        <div className="stats-strip">
          <div className="stat"><strong>{stats ? stats.orders : '—'}</strong><span>orders placed</span></div>
          <div className="stat"><strong>{stats ? stats.teesSold : '—'}</strong><span>tees sold</span></div>
          <div className="stat"><strong>{stats ? stats.products : '—'}</strong><span>spooky products</span></div>
          <div className="stat"><strong>{stats ? stats.subscribers : '—'}</strong><span>on the drop list</span></div>
        </div>

        <section className="section">
          <div className="section-head">
            <div>
              <h2>Fan favourites</h2>
              <p style={{ margin: 0 }}>The pieces everyone wants for hack night.</p>
            </div>
            <Link to="/shop" className="btn secondary small">View all <ArrowRight size={16} /></Link>
          </div>
          <div className="product-grid">
            {featured.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2>Shop by vibe</h2></div>
          <div className="cat-grid">
            <Link to="/shop?category=tees" className="cat-card">
              <Shirt size={32} color="#ff7a1a" aria-hidden="true" />
              <h3>Hacktoberfest tees</h3>
              <p style={{ margin: 0 }}>Campus tees and hoodies to wear while your PRs get merged.</p>
            </Link>
            <Link to="/shop?category=costumes" className="cat-card">
              <Ghost size={32} color="#9b6dff" aria-hidden="true" />
              <h3>Halloween costumes</h3>
              <p style={{ margin: 0 }}>Vampires, witches, skeletons and one very tired zombie developer.</p>
            </Link>
            <Link to="/shop?category=accessories" className="cat-card">
              <Sparkles size={32} color="#ffd166" aria-hidden="true" />
              <h3>Accessories</h3>
              <p style={{ margin: 0 }}>Sticker packs, bat wings and a mug that glows when it's full.</p>
            </Link>
          </div>
        </section>

        <section className="section" id="event">
          <div className="section-head">
            <div>
              <h2>{EVENT.name} on campus</h2>
              <p style={{ margin: 0 }} className="row"><MapPin size={16} aria-hidden="true" /> {EVENT.venue} · hosted by {EVENT.host}</p>
            </div>
          </div>
          <div className="timeline">
            {EVENT.schedule.map((s) => (
              <div className="card" key={s.title}>
                <strong>{s.date}</strong>
                <h3 style={{ marginTop: 8 }}>{s.title}</h3>
                <p style={{ margin: 0 }}>{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="perks">
            <div className="card"><Store size={26} aria-hidden="true" /><h3 style={{ marginTop: 10 }}>Free campus pickup</h3><p style={{ margin: 0 }}>Collect at the merch desk on any event day.</p></div>
            <div className="card"><Truck size={26} aria-hidden="true" /><h3 style={{ marginTop: 10 }}>Free shipping over ₹999</h3><p style={{ margin: 0 }}>Flat ₹79 below that, anywhere in India.</p></div>
            <div className="card"><Tag size={26} aria-hidden="true" /><h3 style={{ marginTop: 10 }}>Contributor coupons</h3><p style={{ margin: 0 }}>HACKTOBER26 takes 15% off orders of ₹999 or more.</p></div>
          </div>
        </section>

        <section className="section faq" id="faq">
          <div className="section-head"><h2>Questions</h2></div>
          {EVENT.faqs.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>

        <section className="section">
          <Newsletter />
        </section>
      </div>
    </>
  );
}
