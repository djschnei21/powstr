import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import NDK, { NDKNip07Signer, NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import { createRoot } from 'react-dom/client';
import { Analytics } from "@vercel/analytics/react";
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

// Helper functions (make sure these are defined or imported)
function calculateAgeDays(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  const ageSeconds = now - timestamp;
  return Math.floor(ageSeconds / 86400); // 86400 seconds in a day
}

function truncateText(text, maxLength, type = 'content') {
  if (text.length <= maxLength) return text;
  if (type === 'name') {
    return text.substring(0, maxLength);
  }
  return text.substring(0, maxLength - 3) + '...';
}

function calculateTimework(workBits, timestamp) {
  const currentTime = Math.floor(Date.now() / 1000);
  const timeDifference = currentTime - timestamp;
  return workBits - (timeDifference / 259200); // 259200 seconds = 3 days
}

const Leaderboard = ({ refreshTrigger }) => {
  const { ndk } = useNostr();
  const [leaderboard, setLeaderboard] = useState([]);
  const [profilesFetched, setProfilesFetched] = useState({});

  const fetchProfileName = useCallback(async (pubkey) => {
    if (!ndk || profilesFetched[pubkey]) return;

    try {
      const filter = { kinds: [0], authors: [pubkey] };
      const profileEvents = await ndk.fetchEvents(filter);
      
      if (profileEvents.size > 0) {
        const profileEvent = Array.from(profileEvents)[0];
        const content = JSON.parse(profileEvent.content);
        const name = content.name || content.displayName || pubkey;
        setLeaderboard(prevLeaderboard =>
          prevLeaderboard.map(entry =>
            entry.pubkey === pubkey && entry.name === truncateText(pubkey, 8, 'name')
              ? { ...entry, name: truncateText(name, 8, 'name') }
              : entry
          )
        );
        setProfilesFetched(prev => ({ ...prev, [pubkey]: true }));
      } else {
        setProfilesFetched(prev => ({ ...prev, [pubkey]: true }));
      }
    } catch (error) {
      console.error(`Failed to fetch profile for ${pubkey}:`, error);
      setProfilesFetched(prev => ({ ...prev, [pubkey]: true }));
    }
  }, [ndk]);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      if (!ndk) return;
      try {
        console.log("Fetching events from labour relay...");
        const labourRelay = ndk.pool.getRelay('wss://labour.fiatjaf.com');
        const filter = { kinds: [1], limit: 500 };
        const events = await ndk.fetchEvents(filter, { relay: labourRelay });
        console.log(`Fetched ${events.size} events from labour relay`);
        
        const scoredEvents = Array.from(events).reduce((acc, event) => {
          const workBits = countLeadingZeroes(event.id);
          if (workBits >= 4) {
            const timework = calculateTimework(workBits, event.created_at);
            acc.push({ event, timework });
          }
          return acc;
        }, []);

        const topEvents = scoredEvents
          .sort((a, b) => b.timework - a.timework)
          .slice(0, 25);

        const newLeaderboard = topEvents.map(({ event, timework }) => ({
          pubkey: event.pubkey,
          name: truncateText(event.pubkey, 8, 'name'),
          content: truncateText(event.content, 30),
          score: Math.floor(timework),
          eventId: event.id,
          age: calculateAgeDays(event.created_at)
        }));

        setLeaderboard(newLeaderboard);
        setProfilesFetched({});

        // Start fetching profile names
        newLeaderboard.forEach(entry => fetchProfileName(entry.pubkey));

      } catch (error) {
        console.error("Failed to fetch leaderboard:", error);
      }
    };

    fetchLeaderboard();
  }, [ndk, refreshTrigger, fetchProfileName]);

  useEffect(() => {
    // Periodically check for unfetched profiles
    const intervalId = setInterval(() => {
      leaderboard.forEach(entry => {
        if (entry.name === truncateText(entry.pubkey, 8, 'name') && !profilesFetched[entry.pubkey]) {
          fetchProfileName(entry.pubkey);
        }
      });
    }, 5000); // Check every 5 seconds

    return () => clearInterval(intervalId);
  }, [leaderboard, profilesFetched, fetchProfileName]);

  const handleRowClick = (eventId) => {
    window.open(`https://njump.me/${eventId}`, '_blank');
  };

  return (
    <div className="leaderboard-container">
      <h2>HIGH SCORES</h2>
      <div className="leaderboard-table-container">
        <table id="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Name</th>
              <th>Content</th>
              <th>Score</th>
              <th>Age (days)</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((entry, index) => (
              <tr 
                key={`${entry.eventId}-${index}`}
                onClick={() => handleRowClick(entry.eventId)}
              >
                <td>{`${index + 1}${getOrdinal(index + 1)}`}</td>
                <td>{entry.name}</td>
                <td className="content-column">{entry.content}</td>
                <td>{entry.score}</td>
                <td>{entry.age}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

  // Define a maximum expected hash rate (adjust this value based on your observations)
  const maxExpectedHashRate = 200000; // 200,000 H/s

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
        <div className="explanation-box">
          <h3>How It Works</h3>
          <ul>
            <li>
              Each post gets points based on its PoW.
            </li>
            <li>
              Posts lose 1 point every 3 days since they were created.
            </li>
            <li>
              Newer posts can overtake older ones as time passes.
            </li>
            <li>
              The leaderboard shows the top 25 posts based on this scoring system.
            </li>
          </ul>
        </div>
        <Analytics />
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
                opacity: i < Math.min(hashrate / maxExpectedHashRate * 100, 100) ? 1 : 0.2
              }}
            />
          ))}
          <div className="gauge-value">{hashrate} H/s</div>
        </div>
      </div>
      <Leaderboard refreshTrigger={refreshTrigger} />
      <div className="explanation-box">
          <h3>How It Works</h3>
          <ul>
            <li>
              Each post gets points based on its PoW.
            </li>
            <li>
              Posts lose 1 point every 3 days since they were created.
            </li>
            <li>
              Newer posts can overtake older ones as time passes.
            </li>
            <li>
              The leaderboard shows the top 25 posts based on this scoring system.
            </li>
          </ul>
        </div>
      <Analytics />
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