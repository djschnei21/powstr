import NDK, { NDKEvent, NDKNip07Signer, NDKRelay } from "@nostr-dev-kit/ndk";
import { Analytics } from "@vercel/analytics/react";
import './styles.css';

const LABOUR_RELAY_URL = 'wss://labour.fiatjaf.com/';
const MAX_RETRIES = 5;
const RETRY_DELAY = 5000; // 5 seconds

let ndk;
let user;
let miningWorker;
let startTime;
let hashCount = 0;
let bestPoW = 0;
let maxHashRate = 400000; // Initial value, will be updated dynamically
let isConnected = false;
let reconnectAttempts = 0;

document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

function initializeApp() {
  document.getElementById('login-button').addEventListener('click', login);
  document.getElementById('post-button').addEventListener('click', postNote);
  
  // Initialize the gauge
  const gaugeContainer = document.querySelector('.gauge-container');
  
  // Show mining status div on page load
  document.getElementById('mining-status').style.display = 'block';
  
  initNDK();
}

async function initNDK() {
  const nip07signer = new NDKNip07Signer();
  ndk = new NDK({
    signer: nip07signer
  });

  ndk.on('ndkRelay:connect', (relay) => {
    console.log(`Connected to relay: ${relay.url}`);
    if (relay.url === LABOUR_RELAY_URL) {
      isConnected = true;
      reconnectAttempts = 0;
      updateConnectionStatus('Connected to Labour Relay');
    }
  });

  ndk.on('ndkRelay:disconnect', (relay) => {
    console.log(`Disconnected from relay: ${relay.url}`);
    if (relay.url === LABOUR_RELAY_URL) {
      isConnected = false;
      updateConnectionStatus('Disconnected from Labour Relay');
      attemptReconnect();
    }
  });

  await connectWithRetry();
}

async function connectWithRetry() {
  while (reconnectAttempts < MAX_RETRIES) {
    try {
      await ndk.connect();
      return;
    } catch (error) {
      console.error('Connection failed:', error);
      reconnectAttempts++;
      updateConnectionStatus(`Reconnecting (Attempt ${reconnectAttempts}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
  }
  updateConnectionStatus('Connection failed. Please try again later.');
}

function attemptReconnect() {
  if (!isConnected && reconnectAttempts < MAX_RETRIES) {
    reconnectAttempts++;
    updateConnectionStatus(`Reconnecting (Attempt ${reconnectAttempts}/${MAX_RETRIES})`);
    setTimeout(() => connectWithRetry(), RETRY_DELAY);
  }
}

function updateConnectionStatus(status) {
  const statusElement = document.getElementById('connection-status');
  if (statusElement) {
    statusElement.textContent = status;
  }
}

async function login() {
  try {
    user = await ndk.signer.user();
    if (user && user.npub) {
      console.log("Permission granted to read public key:", user.npub);
      document.getElementById('login-section').style.display = 'none';
      document.getElementById('post-section').style.display = 'block';
      document.getElementById('mining-status').style.display = 'block';
      await connectToUserRelays();
      updateLeaderboard();
    } else {
      throw new Error('Failed to get user public key');
    }
  } catch (error) {
    console.error('Login error:', error);
    alert('Login failed. Please make sure you have a Nostr extension installed and try again.');
  }
}

async function connectToUserRelays() {
  try {
    const relayList = await ndk.fetchRelayList(user);
    if (relayList) {
      const writeRelays = relayList.filter(relay => relay.write);
      for (const relay of writeRelays) {
        await connectToRelay(relay.url);
      }
    }
    // Always connect to the labour relay
    await connectToRelay(LABOUR_RELAY_URL);
  } catch (error) {
    console.error('Error connecting to user relays:', error);
  }
}

async function connectToRelay(url) {
  try {
    const relay = ndk.pool.getRelay(url);
    if (relay) {
      await relay.connect();
      if (relay.url === LABOUR_RELAY_URL) {
        isConnected = true;
        updateConnectionStatus('Connected to Labour Relay');
      }
    } else {
      const newRelay = await ndk.addRelay(url);
      await newRelay.connect();
      if (newRelay.url === LABOUR_RELAY_URL) {
        isConnected = true;
        updateConnectionStatus('Connected to Labour Relay');
      }
    }
  } catch (error) {
    console.error(`Error connecting to relay ${url}:`, error);
  }
}

async function postNote() {
  const content = document.getElementById('note-content').value;
  const difficulty = parseInt(document.getElementById('pow-target').value);
  if (!content || isNaN(difficulty)) {
    alert('Please enter both note content and PoW target');
    return;
  }

  document.getElementById('post-button').disabled = true;
  const ndkEvent = new NDKEvent(ndk);
  ndkEvent.kind = 1;
  ndkEvent.content = content;
  ndkEvent.tags = [["nonce", "0"]];

  startTime = Date.now();
  hashCount = 0;
  bestPoW = 0;
  updateHashRate(); // Initial update

  if (window.Worker) {
    miningWorker = new Worker(new URL('./pow-worker.js', import.meta.url));
    miningWorker.postMessage({ event: ndkEvent.rawEvent(), difficulty });
    miningWorker.onmessage = async function(e) {
      if (e.data.type === 'result') {
        const minedEvent = new NDKEvent(ndk, e.data.event);
        await publishWithRetry(minedEvent);
      } else if (e.data.type === 'progress') {
        hashCount = e.data.hashRate * ((Date.now() - startTime) / 1000);
        bestPoW = e.data.bestLeadingZeroes;
        document.getElementById('best-pow').textContent = bestPoW;
        updateHashRate();
      }
    };
  } else {
    alert('Your browser doesn\'t support Web Workers. Mining will be slow.');
    // Fallback to single-threaded mining (implementation not shown)
  }
}

async function publishWithRetry(event, retries = 0) {
  try {
    // Ensure we're connected before attempting to publish
    if (!isConnected) {
      await connectWithRetry();
    }

    // Publish to labour relay
    const labourRelay = ndk.getRelayList().find(relay => relay.url === LABOUR_RELAY_URL);
    if (labourRelay) {
      await event.publish(labourRelay);
    } else {
      throw new Error('Labour relay not found in the pool');
    }

    // Publish to user's write relays
    const userWriteRelays = ndk.getRelayList().filter(relay => relay.url !== LABOUR_RELAY_URL);
    await event.publish(userWriteRelays);

    alert('Note posted successfully to labour and user write relays!');
    updateLeaderboard();
  } catch (error) {
    console.error('Error posting note:', error);
    if (retries < MAX_RETRIES) {
      console.log(`Retrying post... (Attempt ${retries + 1}/${MAX_RETRIES})`);
      setTimeout(() => publishWithRetry(event, retries + 1), RETRY_DELAY);
    } else {
      alert('Failed to post note after multiple attempts. Please try again later.');
    }
  } finally {
    document.getElementById('post-button').disabled = false;
  }
}

function updateHashRate() {
  const elapsedTime = (Date.now() - startTime) / 1000; // in seconds
  const hashRate = Math.round(hashCount / elapsedTime);
  const percentage = (hashRate / maxHashRate) * 100;
  document.querySelector('.gauge-bar').style.width = `${percentage}%`;
  document.querySelector('.gauge-value').textContent = `${hashRate} H/s`;
}

async function updateLeaderboard() {
  const leaderboardList = document.getElementById('leaderboard-list');
  leaderboardList.innerHTML = ''; // Clear existing entries
  const filter = { kinds: [1], limit: 500 }; // Fetch up to 500 events
  let events;

  try {
    // Ensure we're connected before fetching events
    if (!isConnected) {
      await connectWithRetry();
    }

    // Fetch events only from the labour relay
    const labourRelay = ndk.pool.relays.find(relay => relay.url === LABOUR_RELAY_URL);
    if (labourRelay) {
      events = await ndk.fetchEvents(filter, { relays: [labourRelay] });
    } else {
      throw new Error('Labour relay not found in the pool');
    }
  } catch (error) {
    console.error('Error fetching events:', error);
    return;
  }

  // Process all events first
  const powMap = new Map();
  events.forEach(event => {
    const pow = countLeadingZeroBits(event.id);
    const currentBest = powMap.get(event.pubkey);
    if (!currentBest || pow > currentBest.pow) {
      powMap.set(event.pubkey, { pow, event });
    }
  });

  // Sort and get top 10
  const top10 = Array.from(powMap.values())
    .sort((a, b) => b.pow - a.pow)
    .slice(0, 10);

  // Now render the top 10
  for (let index = 0; index < top10.length; index++) {
    const { pow, event } = top10[index];
    const tr = document.createElement('tr');
    const rankTd = document.createElement('td');
    const nameTd = document.createElement('td');
    const scoreTd = document.createElement('td');

    rankTd.textContent = `${index + 1}${getOrdinalSuffix(index + 1)}`;
    let displayName = event.pubkey.slice(0, 8); // Default to truncated pubkey

    try {
      const user = ndk.getUser({ pubkey: event.pubkey });
      // Fetch profile from all relays
      await user.fetchProfile();
      const userProfile = user.profile;
      if (userProfile) {
        displayName = userProfile.displayName || userProfile.name || displayName;
      }
    } catch (error) {
      console.error(`Error fetching profile for ${event.pubkey}:`, error);
    }

    nameTd.textContent = displayName;
    scoreTd.textContent = pow.toString().padStart(2, '0');

    tr.appendChild(rankTd);
    tr.appendChild(nameTd);
    tr.appendChild(scoreTd);
    tr.style.cursor = 'pointer';
    tr.onclick = () => {
      window.open(`https://njump.me/${event.id}`, '_blank');
    };

    leaderboardList.appendChild(tr);
  }
}

function countLeadingZeroBits(hex) {
  let bits = 0;
  for (let i = 0; i < hex.length; i++) {
    const nibble = parseInt(hex[i], 16);
    if (nibble === 0) {
      bits += 4;
    } else {
      bits += Math.clz32(nibble) - 28;
      break;
    }
  }
  return bits;
}

function getOrdinalSuffix(i) {
  var j = i % 10,
    k = i % 100;
  if (j == 1 && k != 11) {
    return "ST";
  }
  if (j == 2 && k != 12) {
    return "ND";
  }
  if (j == 3 && k != 13) {
    return "RD";
  }
  return "TH";
}