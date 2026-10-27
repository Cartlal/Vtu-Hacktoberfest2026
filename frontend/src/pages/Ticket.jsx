import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Bot, MessageSquare, Paperclip, Send, ShieldCheck, User } from 'lucide-react';
import { api, apiBlobUrl } from '../api';
import { formatDate } from '../format';
import {
  SEVERITY_BADGE, TICKET_STATUS, categoryLabel, savedTicketToken, severityLabel
} from '../content/tickets';

// Reporters load screenshots with their private token in the URL; signed-in
// owners and admins fetch them with their login and get a temporary blob URL.
function TicketImage({ ticketId, attachment, token }) {
  const path = `/tickets/${ticketId}/attachments/${attachment.id}`;
  const direct = token ? `/api${path}?token=${encodeURIComponent(token)}` : null;
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    if (direct) return undefined;
    let cancelled = false;
    let url = null;
    apiBlobUrl(path)
      .then((u) => { if (cancelled) URL.revokeObjectURL(u); else { url = u; setBlobUrl(u); } })
      .catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [path, direct]);

  const src = direct || blobUrl;
  return (
    <figure className="thumb">
      {src
        ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Screenshot ${attachment.filename}`} /></a>
        : <div className="thumb-placeholder" aria-label="Loading screenshot" />}
      <figcaption><span>{attachment.filename}</span><span className="muted">{Math.max(1, Math.round(attachment.size / 1024))} KB</span></figcaption>
    </figure>
  );
}

const ROLE_ICON = { reporter: User, admin: ShieldCheck, autofix: Bot };
const ROLE_LABEL = { reporter: 'Reporter', admin: 'Store team', autofix: 'AI' };

function Timeline({ updates }) {
  return (
    <ol className="timeline-list">
      {updates.map((u) => {
        const Icon = ROLE_ICON[u.authorRole] || MessageSquare;
        return (
          <li key={u.id} className={`tl-${u.authorRole}`}>
            <span className="tl-icon"><Icon size={16} aria-hidden="true" /></span>
            <div>
              <div className="row" style={{ gap: 8 }}>
                <strong>{u.author}</strong>
                <span className={`badge ${u.authorRole === 'autofix' ? 'purple' : u.authorRole === 'admin' ? 'green' : ''}`}>{ROLE_LABEL[u.authorRole]}</span>
                <span className="muted" style={{ fontSize: '0.8rem' }}>{formatDate(u.createdAt)}</span>
              </div>
              {u.statusTo && (
                <div className="muted" style={{ fontSize: '0.9rem' }}>
                  {u.statusFrom ? <>Status: {TICKET_STATUS[u.statusFrom]?.label} → <strong>{TICKET_STATUS[u.statusTo]?.label}</strong></> : <>Status: <strong>{TICKET_STATUS[u.statusTo]?.label}</strong></>}
                </div>
              )}
              {u.message && <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{u.message}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function AdminControls({ ticket, onSaved }) {
  const [status, setStatus] = useState(ticket.status);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (status === 'rejected' && !message.trim()) return setError('Tell the reporter why it is rejected.');
    if (status === ticket.status && !message.trim()) return setError('Change the status or write a note.');
    setBusy(true);
    setError('');
    try {
      const updated = status === ticket.status
        ? await api(`/tickets/${ticket.id}/comments`, { method: 'POST', body: { message } })
        : await api(`/tickets/${ticket.id}`, { method: 'PATCH', body: { status, message } });
      setMessage('');
      onSaved(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h3 style={{ margin: 0 }}>Triage</h3>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`status-${ticket.id}`}>Status</label>
          <select id={`status-${ticket.id}`} className="input" value={status} onChange={(e) => { setStatus(e.target.value); setError(''); }}>
            {Object.entries(TICKET_STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
          </select>
        </div>
        <div className="field full">
          <label htmlFor={`note-${ticket.id}`}>Note to the reporter {status !== 'rejected' && <span className="muted">(optional)</span>}</label>
          <textarea id={`note-${ticket.id}`} className="input" rows={2} value={message} onChange={(e) => { setMessage(e.target.value); setError(''); }} />
        </div>
      </div>
      {error && <span className="error">{error}</span>}
      <button className="btn small" style={{ justifySelf: 'start' }} disabled={busy}>{busy ? 'Saving…' : 'Update ticket'}</button>
    </form>
  );
}

export function TicketView({ id, token, admin = false, onChange }) {
  const [state, setState] = useState({ ticket: null, error: '' });
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => api(`/tickets/${id}${token ? `?token=${encodeURIComponent(token)}` : ''}`), [id, token]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((ticket) => !cancelled && setState({ ticket, error: '' }))
      .catch((err) => !cancelled && setState({ ticket: null, error: err.message }));
    return () => { cancelled = true; };
  }, [load]);

  function updated(ticket) {
    setState({ ticket, error: '' });
    onChange?.(ticket);
  }

  async function sendComment(e) {
    e.preventDefault();
    if (!comment.trim()) return setCommentError('Write a message first.');
    setSending(true);
    try {
      updated(await api(`/tickets/${id}/comments`, { method: 'POST', body: { message: comment, token } }));
      setComment('');
      setCommentError('');
    } catch (err) {
      setCommentError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (state.error) return <p className="error">{state.error}</p>;
  if (!state.ticket) return <div className="loader">Loading ticket…</div>;
  const t = state.ticket;
  const closed = ['closed', 'rejected'].includes(t.status);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span className="ticket-id">{t.id}</span>
            <h2 style={{ margin: '8px 0 4px' }}>{t.title}</h2>
            <span className="muted">Raised {formatDate(t.createdAt)}{admin && ` by ${t.name || 'a visitor'} (${t.email})`}</span>
          </div>
          <div className="row">
            <span className={`badge ${TICKET_STATUS[t.status].badge}`}>{TICKET_STATUS[t.status].label}</span>
            <span className={`badge ${SEVERITY_BADGE[t.severity]}`}>{severityLabel(t.severity)} severity</span>
          </div>
        </div>
        <dl className="ticket-facts">
          <div><dt>Type</dt><dd>{categoryLabel(t.category)}</dd></div>
          <div><dt>Where</dt><dd>{t.pageUrl || '—'}</dd></div>
          {t.autofixId && <div><dt>AutoFix</dt><dd>{t.autofixId}</dd></div>}
        </dl>
        <div><h4>What happened</h4><p style={{ whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{t.description}</p></div>
        {t.steps && <div><h4>Steps to reproduce</h4><p style={{ whiteSpace: 'pre-wrap' }}>{t.steps}</p></div>}
        {(t.expected || t.actual) && (
          <div className="form-grid">
            {t.expected && <div><h4>Expected</h4><p>{t.expected}</p></div>}
            {t.actual && <div><h4>Actual</h4><p>{t.actual}</p></div>}
          </div>
        )}
        {t.attachments.length > 0 && (
          <div>
            <h4 className="row" style={{ gap: 6 }}><Paperclip size={16} /> Screenshots ({t.attachments.length})</h4>
            <div className="thumbs">{t.attachments.map((a) => <TicketImage key={a.id} ticketId={t.id} attachment={a} token={token} />)}</div>
          </div>
        )}
        {admin && t.environment && (
          <details className="env-details">
            <summary>Browser details</summary>
            <dl>{Object.entries(t.environment).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </details>
        )}
      </div>

      {admin && <AdminControls key={t.status} ticket={t} onSaved={updated} />}

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Activity</h3>
        <Timeline updates={t.updates} />
        {!admin && !closed && (
          <form className="stack" onSubmit={sendComment}>
            <label htmlFor="comment" className="sr-only">Add a comment</label>
            <textarea id="comment" className="input" rows={2} maxLength={2000} placeholder="Add more detail or reply to the team…" value={comment} onChange={(e) => { setComment(e.target.value); setCommentError(''); }} />
            {commentError && <span className="error">{commentError}</span>}
            <button className="btn small secondary" style={{ justifySelf: 'start' }} disabled={sending}><Send size={14} /> {sending ? 'Sending…' : 'Send'}</button>
          </form>
        )}
        {!admin && closed && <p className="muted" style={{ margin: 0 }}>This ticket is closed. Raise a new one if the problem comes back.</p>}
      </div>
    </div>
  );
}

export default function Ticket() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const token = params.get('token') || savedTicketToken(id);
  return (
    <div className="container page" style={{ maxWidth: 860 }}>
      <p><Link to="/report" className="muted">Report a problem</Link> / Ticket {id}</p>
      <TicketView id={id} token={token} />
    </div>
  );
}
