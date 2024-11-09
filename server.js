import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const STORAGE_FILE = path.resolve('./storage.json');
const PING_INTERVAL = 2 * 60 * 1000;
const VERSION = '4.26.2';
const EXTENSION_ID = 'lkbnfiajjmbhnfledhphioinpickokdi';
const WEBSOCKET_URLS = [
  'wss://proxy2.wynd.network:4444',
  'wss://proxy2.wynd.network:4650',
];

const MAX_RETRIES = 5;
const RETRY_DELAY = 5000;
const MAX_RETRY_DELAY = 60000;

function getUnixTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function isUUID(id) {
  return typeof id === 'string' && id.length === 36;
}

function parseValue(value) {
  try {
    return JSON.parse(value);
  } catch (e) {
    return value;
  }
}

class Storage {
  constructor() {
    this.data = {};
    this.load();
  }

  load() {
    if (fs.existsSync(STORAGE_FILE)) {
      const content = fs.readFileSync(STORAGE_FILE, 'utf8');
      this.data = JSON.parse(content);
    }
  }

  save() {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(this.data, null, 2));
  }

  get(key) {
    return this.data[key] || null;
  }

  async set(key, value) {
    this.data[key] = value;
    this.save();
  }
}

const storage = new Storage();

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
    user_id: null,
    user_agent: customHeaders['User-Agent'],
    timestamp: getUnixTimestamp(),
    device_type: 'extension',
    version,
    extension_id,
  };

  if (user_id) {
    authenticationResponse.user_id = user_id;
  }

  return authenticationResponse;
}

let websocket = null;
let lastLiveConnectionTimestamp = getUnixTimestamp();
let retries = 0;
let retryDelay = RETRY_DELAY;
let pingIntervalHandle = null;

const customHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/119.0.0.0 Safari/537.36',
};

async function initialize(userId, accessToken) {
  const hasPermissions = true;
  if (!hasPermissions) {
    console.warn(
      '[INITIALIZE] Permissions are disabled. Cancelling connection...'
    );
    return;
  }

  const websocketUrl = WEBSOCKET_URLS[retries % WEBSOCKET_URLS.length];
  console.log(`Connecting to WebSocket URL: ${websocketUrl}`);

  if (websocket) {
    try {
      websocket.terminate();
    } catch (e) {
      console.error('Error terminating existing WebSocket:', e);
    }
    websocket = null;
  }

  websocket = new WebSocket(websocketUrl, {
    headers: {
      Origin: `chrome-extension://${EXTENSION_ID}`,
      'User-Agent': customHeaders['User-Agent'],
      Authorization: accessToken,
    },
    rejectUnauthorized: false,
  });

  websocket.on('open', async () => {
    console.log('WebSocket connection opened');
    lastLiveConnectionTimestamp = getUnixTimestamp();
    retries = 0;
    retryDelay = RETRY_DELAY;

    if (!pingIntervalHandle) {
      pingIntervalHandle = setInterval(sendPing, PING_INTERVAL);
    }
  });

  websocket.on('message', async (data) => {
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
        console.log(
          `Sending authentication response: ${JSON.stringify(response)}`
        );
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
  });

  websocket.on('close', async (code, reason) => {
    console.log(
      `WebSocket connection closed. Code: ${code}, Reason: ${reason}`
    );
    await handleReconnection(userId, accessToken);
  });

  websocket.on('error', async (error) => {
    console.error(`WebSocket error: ${error.message}`);
    await handleReconnection(userId, accessToken);
  });
}

async function handleReconnection(userId, accessToken) {
  if (pingIntervalHandle) {
    clearInterval(pingIntervalHandle);
    pingIntervalHandle = null;
  }

  if (retries < MAX_RETRIES) {
    retries++;
    console.log(`Attempting to reconnect in ${retryDelay / 1000} seconds...`);
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    initialize(userId, accessToken);
  } else {
    console.error('Max reconnection attempts reached. Stopping reconnection.');
  }
}

function sendPing() {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    const current_timestamp = getUnixTimestamp();
    const seconds_since_last_live_message =
      current_timestamp - lastLiveConnectionTimestamp;

    if (seconds_since_last_live_message > 129) {
      console.error(
        'WebSocket does not appear to be live! Restarting the WebSocket connection...'
      );
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
    console.error('Username or password is not set in environment variables.');
    return;
  }

  try {
    const { userId, accessToken } = await login(username, password);
    await storage.set('wynd:user_id', userId);
    await storage.set('accessToken', accessToken);

    await initialize(userId, accessToken);
  } catch (error) {
    console.error('Failed to start the application:', error.message);

    await handleLoginReconnection();
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
  let retries = 0;
  let retryDelay = RETRY_DELAY;

  while (retries < MAX_RETRIES) {
    retries++;
    console.log(`Retrying login in ${retryDelay / 1000} seconds...`);
    await new Promise((resolve) => setTimeout(resolve, retryDelay));

    try {
      await main();
      return;
    } catch (error) {
      console.error('Login retry failed:', error.message);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    }
  }

  console.error('Max login attempts reached. Exiting application.');
  process.exit(1);
}

main();
