import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const STORAGE_FILE = path.resolve('./storage.json');
const PING_INTERVAL = 2 * 60 * 1000; // 2 minutos
const VERSION = '4.26.2';
const EXTENSION_ID = 'lkbnfiajjmbhnfledhphioinpickokdi';
const WEBSOCKET_URLS = [
  'wss://proxy2.wynd.network:4444',
  'wss://proxy2.wynd.network:4650',
];
const RETRY_DELAY_BASE = 5000; // 5 segundos
const MAX_MEMORY_USAGE = 800 * 1024 * 1024; // 800 MB

function getUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function isUUID(id) {
  return typeof id === 'string' && id.length === 36;
}

class Storage {
  constructor() {
    this.data = {};
    this.load();
  }

  load() {
    if (fs.existsSync(STORAGE_FILE)) {
      try {
        const content = fs.readFileSync(STORAGE_FILE, 'utf8');
        this.data = JSON.parse(content);
      } catch (e) {
        console.error('Erro ao carregar storage.json:', e);
        this.data = {};
      }
    }
  }

  save() {
    try {
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('Erro ao salvar storage.json:', e);
    }
  }

  get(key) {
    return this.data[key] || null;
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }
}

const storage = new Storage();

const customHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/119.0.0.0 Safari/537.36',
};

async function authenticate() {
  let browser_id = storage.get('wynd:browser_id');
  const user_id = storage.get('wynd:user_id');
  const version = VERSION;
  const extension_id = EXTENSION_ID;

  if (!isUUID(browser_id)) {
    browser_id = uuidv4();
    await storage.set('wynd:browser_id', browser_id);
    console.log(`Generated new browser_id: ${browser_id}`);
  }

  const authenticationResponse = {
    browser_id,
    user_id: user_id || null,
    user_agent: customHeaders['User-Agent'],
    timestamp: getUnixTimestamp(),
    device_type: 'extension',
    version,
    extension_id,
  };

  return authenticationResponse;
}

let websocket = null;
let lastLiveConnectionTimestamp = getUnixTimestamp();
let pingIntervalHandle = null;

// Função para monitorar o uso de memória
function monitorMemory() {
  const memoryUsage = process.memoryUsage().heapUsed;
  if (memoryUsage > MAX_MEMORY_USAGE) {
    console.warn('Uso de memória excedeu o limite. Reiniciando a aplicação...');
    process.exit(1); // Reinicia a aplicação via um gerenciador de processos (e.g., PM2)
  }
}

// Intervalo para monitorar a memória a cada minuto
setInterval(monitorMemory, 60 * 1000);

async function initialize(userId, accessToken) {
  const hasPermissions = true;
  if (!hasPermissions) {
    console.warn('[INITIALIZE] Permissions are disabled. Cancelling connection...');
    return;
  }

  const websocketUrl = WEBSOCKET_URLS[Math.floor(Math.random() * WEBSOCKET_URLS.length)];
  console.log(`Connecting to WebSocket URL: ${websocketUrl}`);

  if (websocket) {
    try {
      websocket.terminate();
    } catch (e) {
      console.error('Error terminating existing WebSocket:', e);
    }
    websocket = null;
  }

  try {
    websocket = new WebSocket(websocketUrl, {
      headers: {
        Origin: `chrome-extension://${EXTENSION_ID}`,
        'User-Agent': customHeaders['User-Agent'],
        Authorization: accessToken,
      },
      rejectUnauthorized: false,
    });

    websocket.on('open', onOpen);
    websocket.on('message', onMessage);
    websocket.on('close', onClose);
    websocket.on('error', onError);
  } catch (e) {
    console.error('Erro ao inicializar WebSocket:', e);
    scheduleReconnection(userId, accessToken);
  }
}

async function onOpen() {
  console.log('WebSocket connection opened');
  lastLiveConnectionTimestamp = getUnixTimestamp();

  if (!pingIntervalHandle) {
    pingIntervalHandle = setInterval(sendPing, PING_INTERVAL);
  }
}

async function onMessage(data) {
  lastLiveConnectionTimestamp = getUnixTimestamp();
  let parsed_message;
  try {
    parsed_message = JSON.parse(data);
  } catch (e) {
    console.error('Could not parse WebSocket message!', data);
    return;
  }

  if (parsed_message.action === 'AUTH') {
    try {
      const result = await authenticate();
      const response = {
        id: parsed_message.id,
        origin_action: parsed_message.action,
        result,
      };
      console.log(`Sending authentication response: ${JSON.stringify(response)}`);
      websocket.send(JSON.stringify(response));
    } catch (e) {
      console.error(`Error during authentication: ${e}`);
    }
  } else if (parsed_message.action === 'PING') {
    const pongResponse = { id: parsed_message.id, origin_action: 'PONG' };
    console.log(`Sending PONG response: ${JSON.stringify(pongResponse)}`);
    websocket.send(JSON.stringify(pongResponse));
  } else if (parsed_message.action === 'PONG') {
    console.log('Received PONG response from server');
  } else {
    console.log(`Received unknown action: ${parsed_message.action}`);
  }
}

async function onClose(code, reason) {
  console.log(`WebSocket connection closed. Code: ${code}, Reason: ${reason}`);
  cleanupWebSocket();
  const { userId, accessToken } = await getStoredCredentials();
  scheduleReconnection(userId, accessToken);
}

async function onError(error) {
  console.error(`WebSocket error: ${error.message}`);
  cleanupWebSocket();
  const { userId, accessToken } = await getStoredCredentials();
  scheduleReconnection(userId, accessToken);
}

function cleanupWebSocket() {
  if (websocket) {
    websocket.removeAllListeners();
    websocket = null;
  }
  if (pingIntervalHandle) {
    clearInterval(pingIntervalHandle);
    pingIntervalHandle = null;
  }
}

function sendPing() {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    const current_timestamp = getUnixTimestamp();
    const seconds_since_last_live_message = current_timestamp - lastLiveConnectionTimestamp;

    if (seconds_since_last_live_message > 129) {
      console.error('WebSocket does not appear to be live! Restarting the WebSocket connection...');
      try {
        websocket.terminate();
      } catch (e) {
        console.error('Error terminating WebSocket:', e);
      }
      return;
    }

    const pingMessage = JSON.stringify({
      id: uuidv4(),
      version: '1.0.0',
      action: 'PING',
      data: {},
    });
    console.log(`Sending PING message: ${pingMessage}`);
    websocket.send(pingMessage);
  }
}

async function main() {
  const username = process.env.USERNAME;
  const password = process.env.PASSWORD;

  if (!username || !password) {
    console.error('Username ou password não estão definidos nas variáveis de ambiente.');
    process.exit(1); // Encerra a aplicação caso as credenciais não estejam disponíveis
  }

  while (true) {
    try {
      const { userId, accessToken } = await login(username, password);
      await storage.set('wynd:user_id', userId);
      await storage.set('accessToken', accessToken);

      await initialize(userId, accessToken);

      // Aguardamos até que a conexão WebSocket seja fechada para tentar reconectar
      await waitForWebSocketClose();

    } catch (error) {
      console.error('Falha ao iniciar a aplicação ou durante a conexão:', error.message);
      await delayWithMemoryCheck(RETRY_DELAY_BASE);
    }
  }
}

function waitForWebSocketClose() {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (!websocket || websocket.readyState === WebSocket.CLOSED) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
  });
}

async function scheduleReconnection(userId, accessToken) {
  // Implementa um atraso exponencial para reconexão
  let attempt = 0;
  while (true) {
    const delay = Math.min(RETRY_DELAY_BASE * 2 ** attempt, 30000); // Até 30 segundos
    console.log(`Tentando reconectar em ${delay / 1000} segundos... (Tentativa ${attempt + 1})`);
    await delayWithMemoryCheck(delay);
    try {
      await initialize(userId, accessToken);
      return; // Se a reconexão for bem-sucedida, saímos do loop
    } catch (error) {
      console.error(`Tentativa de reconexão ${attempt + 1} falhou: ${error.message}`);
      attempt += 1;
    }
  }
}

async function login(username, password) {
  console.log('Attempting to log in...');
  try {
    const response = await fetch('https://api.getgrass.io/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
      },
      body: JSON.stringify({ username, password }),
    });

    const result = await response.json();

    console.log('Login response:', result);

    if (response.ok && result.result && result.result.data) {
      const { userId, accessToken } = result.result.data;
      console.log('Login successful.');
      return { userId, accessToken };
    } else {
      console.error('Login failed:', result);
      throw new Error('Login failed');
    }
  } catch (error) {
    console.error('Error during login:', error.message);
    throw error;
  }
}

async function handleLoginReconnection() {
  // Não mais necessário com a nova lógica de reconexão
}

async function getStoredCredentials() {
  const userId = storage.get('wynd:user_id');
  const accessToken = storage.get('accessToken');
  if (!userId || !accessToken) {
    console.error('Credenciais não encontradas. Tentando fazer login novamente.');
    throw new Error('Credenciais ausentes');
  }
  return { userId, accessToken };
}

function delayWithMemoryCheck(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

main();
