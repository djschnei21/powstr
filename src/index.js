import NDK, { NDKEvent, NDKNip07Signer } from "@nostr-dev-kit/ndk";
import { Analytics } from "@vercel/analytics/react";
import './styles.css';

const RELAY_URL = 'wss://labour.fiatjaf.com/';
let ndk;
let user;
let miningWorker;
let startTime;
let hashCount = 0;
let bestPoW = 0;
let maxHashRate = 400000; // Initial value, will be updated dynamically

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
}

async function initNDK() {
    const nip07signer = new NDKNip07Signer();
    ndk = new NDK({
        explicitRelayUrls: [RELAY_URL],
        signer: nip07signer
    });
    await ndk.connect();
}

async function login() {
    if (!ndk) await initNDK();
    try {
        user = await ndk.signer.user();
        if (user && user.npub) {
            console.log("Permission granted to read public key:", user.npub);
            document.getElementById('login-section').style.display = 'none';
            document.getElementById('post-section').style.display = 'block';
            document.getElementById('mining-status').style.display = 'block';
            updateLeaderboard();
        } else {
            throw new Error('Failed to get user public key');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. Please make sure you have a Nostr extension installed and try again.');
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
                try {
                    await minedEvent.publish();
                    alert('Note posted successfully!');
                    updateLeaderboard();
                } catch (error) {
                    console.error('Error posting note:', error);
                    alert('Error posting note. Please try again.');
                }
                document.getElementById('post-button').disabled = false;
            } else if (e.data.type === 'progress') {
                hashCount = e.data.hashRate * ((Date.now() - startTime) / 1000);
                bestPoW = e.data.bestLeadingZeroes;
                document.getElementById('best-pow').textContent = bestPoW;
                updateHashRate();
            }
        };
    } else {
        alert('Your browser doesn\'t support Web Workers. Mining will be slow.');
        // Fallback to single-threaded mining (previous implementation)
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
    const filter = { kinds: [1], limit: 100 };
    const events = await ndk.fetchEvents(filter);

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