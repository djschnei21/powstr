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
      <table>
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

function getOrdinal(n) {
  const s = ["TH", "ST", "ND", "RD"];
  const v = n % 100;
  return (s[(v - 20) % 10] || s[v] || s[0]);
}

// Main App component
const App = () => {
  return (
    <div>
      <h1>PoWstr</h1>
      {/* Add other components and UI elements here */}
      <Leaderboard />
    </div>
  );
};

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <NostrProvider>
      <App />
    </NostrProvider>
  </React.StrictMode>
);