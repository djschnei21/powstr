import React, { createContext, useContext, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import NDK from '@nostr-dev-kit/ndk';
import './styles.css';

// Nostr context
const NostrContext = createContext();
const useNostr = () => useContext(NostrContext);

// NostrProvider component
const NostrProvider = ({ children }) => {
  const [ndk, setNdk] = useState(null);
  const [publicKey, setPublicKey] = useState(null);
  const [relays, setRelays] = useState([]);

  useEffect(() => {
    const initNDK = async () => {
      const newNdk = new NDK();
      await newNdk.connect();
      setNdk(newNdk);
      const key = await newNdk.signer.user.getPublicKey();
      setPublicKey(key);
      const userRelays = await newNdk.pool.getRelays();
      setRelays(Array.from(userRelays.keys()));
    };
    initNDK();
  }, []);

  return (
    <NostrContext.Provider value={{ ndk, publicKey, relays }}>
      {children}
    </NostrContext.Provider>
  );
};

// Leaderboard component
const Leaderboard = () => {
  const { ndk } = useNostr();
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      if (!ndk) return;
      const events = await ndk.fetchEvents({
        kinds: [1],
        '#t': ['powstr'],
        limit: 100,
      });
      const scores = Array.from(events).reduce((acc, event) => {
        const pow = event.tags.find(tag => tag[0] === 'pow')?.[1];
        if (pow) {
          const score = parseInt(pow, 10);
          if (!acc[event.pubkey] || score > acc[event.pubkey].score) {
            acc[event.pubkey] = { name: event.pubkey.slice(0, 8), score };
          }
        }
        return acc;
      }, {});
      const sortedLeaderboard = Object.values(scores)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      setLeaderboard(sortedLeaderboard);
    };
    fetchLeaderboard();
  }, [ndk]);

  return (
    <div>
      <h2>HIGH SCORES</h2>
      <table id="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>PoW</th>
          </tr>
        </thead>
        <tbody>
          {leaderboard.map((entry, index) => (
            <tr key={entry.name}>
              <td>{`${index + 1}${getOrdinal(index + 1)}`}</td>
              <td>{entry.name}</td>
              <td>{entry.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Helper function for ordinal suffixes
function getOrdinal(n) {
  const s = ["TH", "ST", "ND", "RD"];
  const v = n % 100;
  return (s[(v - 20) % 10] || s[v] || s[0]);
}

// Main App component
const App = () => {
  const { ndk, publicKey } = useNostr();
  const [content, setContent] = useState('');
  const [difficulty, setDifficulty] = useState(0);
  const [isMining, setIsMining] = useState(false);
  const [hashrate, setHashrate] = useState(0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!ndk || !publicKey) return;
    
    setIsMining(true);
    const startTime = Date.now();
    let hashes = 0;

    const worker = new Worker('pow-worker.js');
    worker.postMessage({ content, difficulty });

    worker.onmessage = async (event) => {
      if (event.data.type === 'result') {
        const { nonce, hash } = event.data;
        worker.terminate();
        setIsMining(false);

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000; // in seconds
        const finalHashrate = Math.round(hashes / duration);
        setHashrate(finalHashrate);

        const tags = [
          ['t', 'powstr'],
          ['pow', difficulty.toString()],
          ['nonce', nonce.toString()],
        ];

        const event = {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: tags,
          content: content,
          pubkey: publicKey,
        };

        await ndk.publish(event);
        setContent('');
        setDifficulty(0);
      } else if (event.data.type === 'hashrate') {
        hashes = event.data.hashes;
        setHashrate(Math.round(hashes / ((Date.now() - startTime) / 1000)));
      }
    };
  };

  return (
    <div id="app">
      <h1>PoWstr</h1>
      <form onSubmit={handleSubmit}>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Enter your message"
        />
        <input
          type="number"
          value={difficulty}
          onChange={(e) => setDifficulty(parseInt(e.target.value))}
          placeholder="Difficulty"
        />
        <button type="submit" disabled={isMining}>
          {isMining ? 'Mining...' : 'Mine and Post'}
        </button>
      </form>
      <div id="mining-status">
        <h3>Mining Status</h3>
        <p>Status: {isMining ? 'Mining' : 'Idle'}</p>
        <p>Hashrate: {hashrate} H/s</p>
      </div>
      <div id="hashrate-gauge">
        <div className="gauge-label">Hashrate</div>
        <div className="gauge-container">
          <div className="gauge-bar" style={{ width: `${Math.min(hashrate / 100, 100)}%` }}></div>
          <div className="gauge-value">{hashrate} H/s</div>
        </div>
      </div>
      <Leaderboard />
    </div>
  );
};

// Render the app
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <NostrProvider>
        <App />
      </NostrProvider>
    </React.StrictMode>
  );
} else {
  console.error('Failed to find the root element');
}