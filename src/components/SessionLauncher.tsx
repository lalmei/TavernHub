import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

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
    <section className="ui-grid" style={{ gap: 16 }}>
      <header className="hero">
        <h1>TavernHub</h1>
        <p>Private DM board + public player view with realtime token vision.</p>
      </header>

      <div className="launcher-grid">
        <Card>
          <CardHeader>
            <CardTitle>Create Session</CardTitle>
            <CardDescription>Start a new DM board and share a player view link.</CardDescription>
          </CardHeader>
          <CardContent className="ui-grid">
            <label className="ui-label" htmlFor="session-name">
              Session name
              <Input id="session-name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <Button disabled={busy} onClick={createSession}>
              {busy ? 'Creating...' : 'Create Session'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Join Existing Session</CardTitle>
            <CardDescription>Open a DM board by session id.</CardDescription>
          </CardHeader>
          <CardContent className="ui-grid">
            <label className="ui-label" htmlFor="join-id">
              Session ID
              <Input
                id="join-id"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') joinSession();
                }}
              />
            </label>
            <Button variant="outline" onClick={joinSession}>
              Open DM Board
            </Button>
          </CardContent>
        </Card>
      </div>

      {error && (
        <Card>
          <CardContent>
            <p className="error-text">{error}</p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
