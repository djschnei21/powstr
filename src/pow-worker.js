importScripts('https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js');

self.onmessage = function(e) {
    const { event, difficulty } = e.data;
    minePoW(event, difficulty);
};

async function minePoW(event, difficulty) {
    let nonce = 0;
    const startTime = Date.now();
    let lastReportTime = startTime;
    let hashCount = 0;
    let bestLeadingZeroes = 0;
    let bestHash = '';

    while (true) {
        event.tags[0][1] = nonce.toString();
        event.created_at = Math.floor(Date.now() / 1000);

        const eventId = calculateId(event);
        const leadingZeroes = countLeadingZeroes(eventId);
        hashCount++;

        if (leadingZeroes > bestLeadingZeroes) {
            bestLeadingZeroes = leadingZeroes;
            bestHash = eventId;
        }

        if (Date.now() - lastReportTime > 1000) {
            reportProgress(startTime, hashCount, bestHash, bestLeadingZeroes);
            lastReportTime = Date.now();
        }

        if (leadingZeroes === difficulty) {
            event.id = eventId;
            self.postMessage({ type: 'result', event });
            break;
        }

        nonce++;
    }
}

function calculateId(event) {
    const eventData = [
        0,
        event.pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.content
    ];
    const serialized = JSON.stringify(eventData);
    const hash = CryptoJS.SHA256(serialized);
    return hash.toString(CryptoJS.enc.Hex);
}

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

function reportProgress(startTime, hashCount, bestHash, bestLeadingZeroes) {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    const hashRate = hashCount / elapsedSeconds;
    self.postMessage({
        type: 'progress',
        hashRate,
        bestHash,
        bestLeadingZeroes
    });
}