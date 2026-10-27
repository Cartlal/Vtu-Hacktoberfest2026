import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Bug, CircleCheck, CircleHelp, CloudUpload, Copy, CreditCard, ImagePlus, Info, Lightbulb, Palette, Send, Type, X
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import {
  IMAGE_TYPES, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS, SITE_PAGES, TICKET_CATEGORIES, rememberTicket
} from '../content/tickets';

const CATEGORY_ICONS = { Bug, Type, Palette, Lightbulb, CreditCard, CircleHelp };

function browserDetails() {
  return {
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    screen: `${window.screen.width}×${window.screen.height}`,
    language: navigator.language,
    platform: navigator.userAgentData?.platform || navigator.platform || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

const formatSize = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

function Screenshots({ files, onAdd, onRemove, error }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const full = files.length >= MAX_SCREENSHOTS;

  return (
    <div className="field">
      <label htmlFor="screenshots">Screenshots <span className="muted">(optional, up to {MAX_SCREENSHOTS}, 3 MB each)</span></label>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''} ${full ? 'full' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!full) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!full) onAdd(e.dataTransfer.files); }}
        onClick={() => !full && inputRef.current?.click()}
        role="button"
        tabIndex={full ? -1 : 0}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !full) { e.preventDefault(); inputRef.current?.click(); } }}
        aria-describedby="screenshots-help"
      >
        <CloudUpload size={30} aria-hidden="true" />
        <strong>{full ? 'Screenshot limit reached' : 'Drop images here, click to browse, or paste (Ctrl+V)'}</strong>
        <span id="screenshots-help" className="muted">PNG, JPEG, GIF or WebP</span>
        <input ref={inputRef} id="screenshots" type="file" accept={IMAGE_TYPES.join(',')} multiple hidden
          onChange={(e) => { onAdd(e.target.files); e.target.value = ''; }} />
      </div>
      {error && <span className="error">{error}</span>}
      {files.length > 0 && (
        <div className="thumbs">
          {files.map((f) => (
            <figure key={f.id} className="thumb">
              <img src={f.url} alt={`Screenshot ${f.file.name}`} />
              <figcaption><span>{f.file.name}</span><span className="muted">{formatSize(f.file.size)}</span></figcaption>
              <button type="button" className="thumb-remove" onClick={() => onRemove(f.id)} aria-label={`Remove ${f.file.name}`}><X size={14} /></button>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function Success({ result, onAnother }) {
  const [copied, setCopied] = useState(false);
  const trackUrl = `/ticket/${result.id}?token=${result.accessToken}`;
  return (
    <div className="container page" style={{ maxWidth: 640 }}>
      <div className="card stack center" style={{ padding: 32 }}>
        <CircleCheck size={52} color="var(--green)" style={{ margin: '0 auto' }} aria-hidden="true" />
        <h1 style={{ margin: 0 }}>Thanks, your report is in!</h1>
        <div className="row" style={{ justifyContent: 'center' }}>
          <span className="ticket-id">{result.id}</span>
          <button className="btn ghost small" onClick={() => {
            navigator.clipboard?.writeText(result.id).then(() => setCopied(true)).catch(() => {});
          }}><Copy size={14} /> {copied ? 'Copied' : 'Copy ID'}</button>
        </div>
        <p style={{ margin: 0 }}>
          {result.autofix
            ? 'Our AI triage is reviewing it right now. Small fixes like typos and layout glitches can go live automatically; anything bigger goes to the team.'
            : 'The store team will review it and update you on the tracking page.'}
        </p>
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>Bookmark the tracking page: it is the only way to follow this ticket if you are not signed in.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link to={trackUrl} className="btn">Track this ticket</Link>
          <button className="btn secondary" onClick={onAnother}>Report something else</button>
        </div>
      </div>
    </div>
  );
}

// No severity field: the ticketing side (AutoFix's Gemma triage or an admin) decides it.
const EMPTY = { title: '', category: '', pageUrl: '', description: '', steps: '', expected: '', actual: '' };

export default function Report() {
  const { user } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState(() => ({ ...EMPTY, pageUrl: location.state?.from || '' }));
  const [contact, setContact] = useState({ name: user?.name || '', email: user?.email || '' });
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState('');
  const [includeEnv, setIncludeEnv] = useState(true);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  // Mirrors `files` synchronously, so rapid adds (paste + drop) see the true count.
  const filesRef = useRef([]);

  const replaceFiles = useCallback((next) => {
    filesRef.current = next;
    setFiles(next);
  }, []);

  // Free the preview URLs when leaving the page.
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  const addFiles = useCallback((list) => {
    const problems = [];
    const accepted = [];
    for (const file of Array.from(list || [])) {
      if (!IMAGE_TYPES.includes(file.type)) problems.push(`${file.name || 'That file'} is not an image (PNG, JPEG, GIF or WebP).`);
      else if (file.size > MAX_SCREENSHOT_BYTES) problems.push(`${file.name} is over 3 MB.`);
      else accepted.push(file);
    }
    const room = MAX_SCREENSHOTS - filesRef.current.length;
    if (accepted.length > room) problems.push(`Only ${MAX_SCREENSHOTS} screenshots allowed; extra ones were skipped.`);
    const added = accepted.slice(0, Math.max(0, room)).map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file, url: URL.createObjectURL(file)
    }));
    replaceFiles([...filesRef.current, ...added]);
    setFileError(problems.join(' '));
  }, [replaceFiles]);

  function removeFile(id) {
    const gone = filesRef.current.find((f) => f.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    replaceFiles(filesRef.current.filter((f) => f.id !== id));
    setFileError('');
  }

  // Paste a screenshot straight from the clipboard.
  useEffect(() => {
    function onPaste(e) {
      const images = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
      if (images.length) {
        e.preventDefault();
        addFiles(images);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const set = (key) => (e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setErrors((x) => ({ ...x, [key]: undefined })); };
  const setC = (key) => (e) => { setContact((c) => ({ ...c, [key]: e.target.value })); setErrors((x) => ({ ...x, [key]: undefined })); };

  function validate() {
    // Same order as on screen, so focus lands on the first visible problem.
    const e = {};
    if (!form.category) e.category = 'Choose what kind of problem this is.';
    if (form.title.trim().length < 5) e.title = 'Give it a short title (at least 5 characters).';
    if (form.description.trim().length < 10) e.description = 'Tell us what happened (at least 10 characters).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) e.email = 'Enter an email so we can update you.';
    return e;
  }

  async function submit(e) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      document.getElementById(first === 'category' ? 'category-bug' : first)?.focus();
      return;
    }
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v.trim()));
    fd.append('name', contact.name.trim());
    fd.append('email', contact.email.trim());
    if (includeEnv) fd.append('environment', JSON.stringify({ ...browserDetails(), url: form.pageUrl }));
    files.forEach((f) => fd.append('screenshots', f.file, f.file.name));

    setBusy(true);
    setSubmitError('');
    try {
      const created = await api('/tickets', { method: 'POST', body: fd });
      rememberTicket(created.id, created.accessToken);
      setResult(created);
      window.scrollTo(0, 0);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    filesRef.current.forEach((f) => URL.revokeObjectURL(f.url));
    replaceFiles([]);
    setForm(EMPTY);
    setErrors({});
    setResult(null);
  }

  if (result) return <Success result={result} onAnother={reset} />;

  const err = (key) => errors[key] && <span className="error" id={`${key}-error`}>{errors[key]}</span>;
  const env = browserDetails();

  return (
    <div className="container page" style={{ maxWidth: 860 }}>
      <div className="stack" style={{ gap: 6, marginBottom: 24 }}>
        <span className="badge purple" style={{ justifySelf: 'start' }}><Bug size={12} /> Report a problem</span>
        <h1 style={{ margin: 0 }}>Raise a ticket</h1>
        <p style={{ margin: 0 }}>Found a bug, a typo, or something that could be better? Tell us. The more detail and screenshots, the faster it gets fixed.</p>
      </div>

      <form className="stack" style={{ gap: 20 }} onSubmit={submit} noValidate>
        <section className="card stack">
          <h3 style={{ margin: 0 }}>1. What kind of problem?</h3>
          <div className="category-grid" role="radiogroup" aria-label="Problem type">
            {TICKET_CATEGORIES.map((c) => {
              const Icon = CATEGORY_ICONS[c.icon];
              return (
                <label key={c.id} className={`radio-card ${form.category === c.id ? 'active' : ''}`}>
                  <input type="radio" name="category" id={`category-${c.id}`} value={c.id} checked={form.category === c.id} onChange={set('category')} />
                  <Icon size={20} aria-hidden="true" />
                  <span><strong>{c.label}</strong><br /><span className="muted" style={{ fontSize: '0.85rem' }}>{c.hint}</span></span>
                </label>
              );
            })}
          </div>
          {err('category')}
        </section>

        <section className="card stack">
          <h3 style={{ margin: 0 }}>2. Tell us what happened</h3>
          <div className="field">
            <label htmlFor="title">Title</label>
            <input id="title" className="input" maxLength={120} placeholder="e.g. Pay button covers the footer on mobile" value={form.title} onChange={set('title')} aria-invalid={!!errors.title} />
            {err('title')}
          </div>
          <div className="field">
            <label htmlFor="pageUrl">Where did it happen? <span className="muted">(page or link)</span></label>
            <input id="pageUrl" className="input" list="site-pages" maxLength={300} placeholder="e.g. /checkout or Product page" value={form.pageUrl} onChange={set('pageUrl')} />
            <datalist id="site-pages">{SITE_PAGES.map((p) => <option key={p} value={p} />)}</datalist>
          </div>
          <div className="field">
            <label htmlFor="description">What happened?</label>
            <textarea id="description" className="input" rows={4} maxLength={5000} placeholder="Describe the problem in your own words." value={form.description} onChange={set('description')} aria-invalid={!!errors.description} />
            <div className="row" style={{ justifyContent: 'space-between' }}>{err('description') || <span />}<span className="muted" style={{ fontSize: '0.8rem' }}>{form.description.length}/5000</span></div>
          </div>
          <div className="field">
            <label htmlFor="steps">Steps to reproduce <span className="muted">(optional)</span></label>
            <textarea id="steps" className="input" rows={3} maxLength={2000} placeholder={'1. Add a tee to the cart\n2. Open checkout on a phone\n3. Scroll down'} value={form.steps} onChange={set('steps')} />
          </div>
          <div className="form-grid">
            <div className="field"><label htmlFor="expected">What did you expect? <span className="muted">(optional)</span></label>
              <textarea id="expected" className="input" rows={2} maxLength={1000} value={form.expected} onChange={set('expected')} /></div>
            <div className="field"><label htmlFor="actual">What happened instead? <span className="muted">(optional)</span></label>
              <textarea id="actual" className="input" rows={2} maxLength={1000} value={form.actual} onChange={set('actual')} /></div>
          </div>
          <Screenshots files={files} onAdd={addFiles} onRemove={removeFile} error={fileError} />
        </section>

        <section className="card stack">
          <h3 style={{ margin: 0 }}>3. How can we reach you?</h3>
          <div className="form-grid">
            <div className="field"><label htmlFor="name">Name <span className="muted">(optional)</span></label>
              <input id="name" className="input" autoComplete="name" maxLength={80} value={contact.name} onChange={setC('name')} /></div>
            <div className="field"><label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" value={contact.email} onChange={setC('email')} aria-invalid={!!errors.email} />{err('email')}</div>
          </div>
          <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={includeEnv} onChange={(e) => setIncludeEnv(e.target.checked)} style={{ marginTop: 4 }} />
            <span>Include my browser and screen details <span className="muted">(helps us reproduce the problem)</span></span>
          </label>
          {includeEnv && (
            <details className="env-details">
              <summary><Info size={14} /> See what will be sent</summary>
              <dl>
                {Object.entries(env).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
            </details>
          )}
        </section>

        {submitError && <p className="error" role="alert" style={{ margin: 0 }}>{submitError}</p>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            <ImagePlus size={14} style={{ verticalAlign: '-2px' }} /> {files.length} screenshot{files.length === 1 ? '' : 's'} attached
          </span>
          <button className="btn" disabled={busy}><Send size={18} /> {busy ? 'Sending…' : 'Submit ticket'}</button>
        </div>
      </form>
    </div>
  );
}
