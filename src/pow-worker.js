importScripts('https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js');

self.onmessage = function(e) {
  const { content, difficulty, pubkey, created_at, kind, tags } = e.data;
  minePoW({ content, difficulty, pubkey, created_at, kind, tags });
};

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

async function minePoW(event) {
  let nonce = 0;
  const startTime = Date.now();
  let lastReportTime = startTime;
  let hashCount = 0;
  let bestPoW = 0;

  while (true) {
    const eventWithNonce = {
      ...event,
      tags: event.tags.map(tag => tag[0] === 'nonce' ? ['nonce', nonce.toString(), event.difficulty.toString()] : tag),
      created_at: Math.floor(Date.now() / 1000)
    };

    const eventId = calculateId(eventWithNonce);
    const leadingZeroes = countLeadingZeroes(eventId);
    hashCount++;

    if (leadingZeroes > bestPoW) {
      bestPoW = leadingZeroes;
    }

    if (hashCount % 1000 === 0 && Date.now() - lastReportTime > 1000) {
      reportProgress(startTime, hashCount, bestPoW);
      lastReportTime = Date.now();
    }

    if (leadingZeroes >= event.difficulty) {
      eventWithNonce.id = eventId;
      self.postMessage({ type: 'result', event: eventWithNonce });
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

function reportProgress(startTime, hashCount, bestPoW) {
  const elapsedSeconds = (Date.now() - startTime) / 1000;
  const hashRate = hashCount / elapsedSeconds;
  self.postMessage({
    type: 'progress',
    hashRate,
    hashCount,
    bestPoW
  });
}