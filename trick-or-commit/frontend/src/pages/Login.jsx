import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { user, signIn, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/') ? params.get('next') : '/account';
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const set = (key) => (e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setError(''); };

  async function submit(e) {
    e.preventDefault();
    if (mode === 'register' && form.name.trim().length < 2) return setError('Enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Enter a valid email address.');
    if (form.password.length < (mode === 'register' ? 8 : 1)) {
      return setError(mode === 'register' ? 'Password must be at least 8 characters.' : 'Enter your password.');
    }
    setBusy(true);
    try {
      if (mode === 'register') await register(form.name, form.email, form.password);
      else await signIn(form.email, form.password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container page" style={{ maxWidth: 440 }}>
      <div className="card stack">
        <div className="tabs" role="tablist" style={{ marginBottom: 4 }}>
          <button role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setError(''); }}>Sign in</button>
          <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Create account</button>
        </div>
        <form className="stack" onSubmit={submit} noValidate>
          {mode === 'register' && (
            <div className="field"><label htmlFor="name">Name</label><input id="name" className="input" autoComplete="name" value={form.name} onChange={set('name')} /></div>
          )}
          <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} /></div>
          <div className="field"><label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} />
          </div>
          {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
          <button className="btn block" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
