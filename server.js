const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: '*' } });
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 5000; 
const NUM_FILES = 5;
const FILE_SIZE = 1024 * 1024; // 1MB
const MAX_UPLOAD_SIZE = 5 * FILE_SIZE; // 5MB maximale Upload-Größe

// Testdateien erstellen
function createTestFiles() {
  const dir = 'testfiles'; 
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
  for (let i = 0; i < NUM_FILES; i++) {
    const filename = path.join(dir, `test_${i}.bin`);
    if (!fs.existsSync(filename)) {
      fs.writeFileSync(filename, crypto.randomBytes(FILE_SIZE));
    }
  }
}

createTestFiles();

app.use(express.static('public')); 
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/download/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const filename = path.join('testfiles', `test_${fileId}.bin`);
  res.download(filename);
});

app.post('/upload', (req, res) => {
  let receivedSize = 0;

  req.on('data', chunk => {
    receivedSize += chunk.length;
    if (receivedSize > MAX_UPLOAD_SIZE) {
      req.connection.destroy(); 
      res.status(413).send('Datei zu groß');
      return;
    }
  });

  req.on('end', () => {
    res.send('Upload erfolgreich');
  });
});

io.on('connection', (socket) => {
  console.log('Client connected');

  let pingInterval;
  let downloadStartTime;
  let uploadStartTime;
  let clientIP = socket.handshake.address;
  let clientPort = socket.handshake.headers['x-forwarded-port'] || socket.handshake.port;
  const clientId = generateClientId();

  // Variablen initialisieren
  let averagePing = null; // averagePing als globale Variable
  let downloadSpeed = null;
  let uploadSpeed = null;
  let jitter = null; 
  let pingIds = new Set(); 
  let pings = []; // pings als globale Variable

  socket.on('ping', (data) => {
    const pingId = data.id;
    socket.emit('pong', { time: data.time, id: pingId });
  });

  socket.on('start_ping_test', () => {
    console.log('Ping-Test gestartet');
    let pingCount = 10;
    pingInterval = setInterval(() => {
      const pingId = generatePingId();
      pingIds.add(pingId);
      const startTime = Date.now();
      socket.emit('ping', { time: startTime, id: pingId });
      socket.once('pong', (data) => {
        if (pingIds.has(data.id)) {
          pingIds.delete(data.id);
          const endTime = Date.now();
          const ping = endTime - data.time;
          pings.push(ping);
          pingCount--;
          if (pingCount === 0) {
            clearInterval(pingInterval);
            averagePing = pings.reduce((a, b) => a + b, 0) / pings.length;

            // Jitter berechnen
            if (pings.length > 1) {
              const meanPing = averagePing;
              const squaredDifferences = pings.map(ping => Math.pow(ping - meanPing, 2));
              const variance = squaredDifferences.reduce((a, b) => a + b, 0) / (pings.length - 1);
              jitter = Math.sqrt(variance);
            }

            // averagePing und jitter im ping_result Event senden
            console.log('Ping-Test abgeschlossen, sende ping_result Event');
            socket.emit('ping_result', { ping: averagePing, jitter: jitter }); 
          }
        }
      });
    }, 100);
  });

  socket.on('download_start', () => {
    console.log('Download-Test gestartet');
    downloadStartTime = Date.now();
    const fileOrder = Array.from({ length: NUM_FILES }, (_, i) => i).sort(() => 0.5 - Math.random()); 
    socket.emit('download_order', { order: fileOrder });
  });

  socket.on('download_end', () => {
    console.log('Download-Test abgeschlossen');
    const downloadTime = (Date.now() - downloadStartTime) / 1000;
    downloadSpeed = (NUM_FILES * FILE_SIZE * 8) / (downloadTime * 1000 * 1000);
    socket.emit('download_result', { speed: downloadSpeed });
  });

  socket.on('upload_start', () => {
    console.log('Upload-Test gestartet');
    uploadStartTime = Date.now();
    socket.emit('upload_chunk_size', { size: FILE_SIZE });
  });

  // upload_result Callback zum Speichern der Ergebnisse
  socket.on('upload_end', () => {
    console.log('Upload-Test abgeschlossen');
    const uploadTime = (Date.now() - uploadStartTime) / 1000;
    uploadSpeed = (NUM_FILES * FILE_SIZE * 8) / (uploadTime * 1000 * 1000);
    socket.emit('upload_result', { speed: uploadSpeed });

    // Ergebnisse speichern
    const results = {
      ClientId: clientId,
      IP: clientIP,
      Port: clientPort,
      Ping: averagePing !== null ? averagePing.toFixed(2) + ' ms' : 'nicht gemessen',
      Jitter: jitter !== null ? jitter.toFixed(2) + ' ms' : 'nicht gemessen', // jitter verwenden
      Download: downloadSpeed !== null ? downloadSpeed.toFixed(2) + ' Mbps' : 'nicht gemessen',
      Upload: uploadSpeed !== null ? uploadSpeed.toFixed(2) + ' Mbps' : 'nicht gemessen',
      Timestamp: new Date()
    };

    const resultsFilePath = path.resolve('results.json');
    console.log("Schreibe in Datei:", resultsFilePath);

    let resultsData = [];
    try {
      console.log("Versuche, die Datei zu lesen:", resultsFilePath);
      resultsData = JSON.parse(fs.readFileSync(resultsFilePath));
      console.log("Datei erfolgreich gelesen");
    } catch (err) {
      console.error("Fehler beim Lesen der Datei:", err);
    }
    resultsData.push(results);

    try {
      console.log("Versuche, die Datei zu schreiben:", resultsFilePath);
      fs.writeFileSync(resultsFilePath, JSON.stringify(resultsData, null, 2));
      console.log(`Messergebnisse gespeichert in ${resultsFilePath}`);
    } catch (err) {
      console.error("Fehler beim Schreiben der Datei:", err);
    }
  });
});

http.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

function generateClientId() {
  return crypto.randomBytes(16).toString('hex');
}

function generatePingId() {
  return crypto.randomBytes(8).toString('hex');
}
