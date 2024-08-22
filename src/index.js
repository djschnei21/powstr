import React, { createContext, useContext, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import NDK, { NDKNip07Signer, NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import './styles.css';

// Nostr context
const NostrContext = createContext();
const useNostr = () => useContext(NostrContext);

// NostrProvider component
const NostrProvider = ({ children }) => {
  const [ndk, setNdk] = useState(null);
  const [publicKey, setPublicKey] = useState(null);
  const [relays, setRelays] = useState([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const explicitRelays = [
    'wss://labour.fiatjaf.com',
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.snort.social'
  ];

  const login = async () => {
    try {
      const signer = new NDKNip07Signer();
      const newNdk = new NDK({
        explicitRelayUrls: explicitRelays,
        signer
      });

      await newNdk.connect();
      setNdk(newNdk);

      const user = await signer.user();
      if (user && user.pubkey) {
        setPublicKey(user.pubkey);
      } else {
        throw new Error("Unable to get public key");
      }

      setRelays(explicitRelays);
      setIsLoggedIn(true);
    } catch (error) {
      console.error("Failed to login:", error);
    }
  };

  return (
    <NostrContext.Provider value={{ ndk, publicKey, relays, isLoggedIn, login }}>
      {children}
    </NostrContext.Provider>
  );
};

// Helper function to count leading zeroes
function countLeadingZeroes(hex) {
  let count = 0;
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16);
    if (nibble === 0) {
      count += 4;
    } else {
      count += Math.clz32(nibble) - 28;
      break;
    }
  }
  return count;
}

// Leaderboard component
const Leaderboard = ({ refreshTrigger }) => {
  const { ndk } = useNostr();
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      if (!ndk) return;
      try {
        console.log("Fetching events from labour relay...");
        const labourRelay = ndk.pool.getRelay('wss://labour.fiatjaf.com');
        const filter = { kinds: [1], limit: 500 };
        const events = await ndk.fetchEvents(filter, { relay: labourRelay });
        console.log(`Fetched ${events.size} events from labour relay`);
        
        const scores = Array.from(events).reduce((acc, event) => {
          const nonceTag = event.tags.find(tag => tag[0] === 'nonce');
          if (nonceTag && nonceTag.length >= 3) {
            const targetDifficulty = parseInt(nonceTag[2], 10);
            const actualDifficulty = countLeadingZeroes(event.id);
            if (!isNaN(targetDifficulty) && actualDifficulty >= targetDifficulty) {
              if (!acc[event.pubkey] || actualDifficulty > acc[event.pubkey].score) {
                acc[event.pubkey] = { pubkey: event.pubkey, score: actualDifficulty };
              }
            }
          }
          return acc;
        }, {});
        
        const sortedScores = Object.values(scores)
          .sort((a, b) => b.score - a.score)
          .slice(0, 10);

        // Fetch user profiles
        const userProfiles = await Promise.all(sortedScores.map(async (score) => {
          const filter = { kinds: [0], authors: [score.pubkey] };
          const profileEvents = await ndk.fetchEvents(filter);
          let name = score.pubkey.slice(0, 8);
          if (profileEvents.size > 0) {
            const profileEvent = Array.from(profileEvents)[0];
            const content = JSON.parse(profileEvent.content);
            name = content.name || content.displayName || name;
          }
          return { ...score, name };
        }));

        console.log("Sorted leaderboard:", userProfiles);
        setLeaderboard(userProfiles);
      } catch (error) {
        console.error("Failed to fetch leaderboard:", error);
      }
    };
    fetchLeaderboard();
  }, [ndk, refreshTrigger]);

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
            <tr key={entry.pubkey}>
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
  const { ndk, publicKey, isLoggedIn, login } = useNostr();
  const [content, setContent] = useState('');
  const [difficulty, setDifficulty] = useState(0);
  const [miningStatus, setMiningStatus] = useState('idle');
  const [bestPoW, setBestPoW] = useState(0);
  const [hashrate, setHashrate] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!ndk || !publicKey) return;
    
    setMiningStatus('mining');
    setBestPoW(0);
    const startTime = Date.now();
    let hashes = 0;

    const worker = new Worker('pow-worker.js');
    worker.postMessage({ 
      content, 
      difficulty,
      pubkey: publicKey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [['nonce', '0', difficulty.toString()]]
    });

    worker.onmessage = async (event) => {
      if (event.data.type === 'result') {
        const { event: minedEvent } = event.data;
        worker.terminate();
        setMiningStatus('complete');
        setBestPoW(difficulty);

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000; // in seconds
        const finalHashrate = Math.round(hashes / duration);
        setHashrate(finalHashrate);

        await postNote(minedEvent);
        setContent('');
        setDifficulty(0);
        setRefreshTrigger(prev => prev + 1);
      } else if (event.data.type === 'progress') {
        hashes = event.data.hashCount;
        setHashrate(Math.round(event.data.hashRate));
        setBestPoW(Math.max(bestPoW, event.data.bestPoW));
      }
    };
  };

  const postNote = async (minedEvent) => {
    try {
      console.log("Posting mined note to all relays...");
      const ndkEvent = new NDKEvent(ndk, minedEvent);
      await ndkEvent.publish();
      console.log("Note posted successfully");
    } catch (error) {
      console.error("Failed to post note:", error);
    }
  };

  if (!isLoggedIn) {
    return (
      <div id="app">
        <h1>PoWstr</h1>
        <button onClick={login}>Login with Nostr</button>
      </div>
    );
  }

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
          onChange={(e) => setDifficulty(Math.max(0, parseInt(e.target.value) || 0))}
          placeholder="Difficulty"
        />
        <button type="submit" disabled={miningStatus === 'mining'}>
          {miningStatus === 'mining' ? 'Mining...' : 'Mine and Post'}
        </button>
      </form>
      <div id="mining-status">
        <h3>Mining Status</h3>
        <p>Status: {miningStatus.charAt(0).toUpperCase() + miningStatus.slice(1)}</p>
        <p>Best PoW: {bestPoW}</p>
      </div>
      <div id="hashrate-gauge">
        <div className="gauge-label">Hashrate</div>
        <div className="gauge-container">
          {[...Array(100)].map((_, i) => (
            <div
              key={i}
              className="gauge-segment"
              style={{
                backgroundColor: `rgb(${Math.min(255, i * 2.55)}, ${Math.max(0, 255 - i * 2.55)}, 0)`,
                opacity: i < Math.min(hashrate / 100, 100) ? 1 : 0.2
              }}
            />
          ))}
          <div className="gauge-value">{hashrate} H/s</div>
        </div>
      </div>
      <Leaderboard refreshTrigger={refreshTrigger} />
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