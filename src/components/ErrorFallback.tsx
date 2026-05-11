export default function ErrorFallback() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '32rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
        <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>The app hit an unrecoverable error and was unloaded. Reloading usually fixes it. If it persists, please send feedback.</p>
        <button onClick={() => window.location.reload()} style={{ padding: '0.5rem 1rem', borderRadius: '0.375rem', background: '#2563eb', color: 'white', border: 'none', cursor: 'pointer' }}>
          Reload
        </button>
      </div>
    </div>
  );
}
