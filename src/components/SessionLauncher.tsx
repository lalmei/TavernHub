import { useState } from 'react';

export function SessionLauncher() {
  const [name, setName] = useState('Friday One Shot');
  const [joinId, setJoinId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createSession() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (!response.ok) {
        throw new Error('Failed to create session');
      }
      const data = await response.json();
      window.location.href = `/dm/${data.session.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setBusy(false);
    }
  }

  function joinSession() {
    if (!joinId.trim()) return;
    window.location.href = `/dm/${joinId.trim()}`;
  }

  return (
    <section className="panel" style={{ padding: 24, maxWidth: 780, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>AuVTT</h1>
      <p>Private DM board + public player view with realtime token vision.</p>

      <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        <label>
          Session name
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ marginLeft: 12, width: 280 }} />
        </label>
        <button disabled={busy} onClick={createSession}>
          {busy ? 'Creating…' : 'Create Session'}
        </button>
      </div>

      <hr style={{ borderColor: '#e7dece', margin: '24px 0' }} />

      <div style={{ display: 'grid', gap: 12 }}>
        <label>
          Existing Session ID
          <input value={joinId} onChange={(e) => setJoinId(e.target.value)} style={{ marginLeft: 12, width: 280 }} />
        </label>
        <button onClick={joinSession}>Open DM Board</button>
      </div>

      {error && <p style={{ color: '#a12121' }}>{error}</p>}
    </section>
  );
}
