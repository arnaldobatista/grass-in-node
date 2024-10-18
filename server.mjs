import WebSocket from 'ws';
import fetch from 'node-fetch';
import fetchCookie from 'fetch-cookie';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import tough from 'tough-cookie';

dotenv.config();

const cookieJar = new tough.CookieJar();
const fetchWithCookies = fetchCookie(fetch, cookieJar);

const getUnixTimestamp = () => Math.floor(Date.now() / 1000);
let websocket = null;
let lastLiveConnectionTimestamp = getUnixTimestamp();
const PING_INTERVAL = 2 * 60 * 1000;
const WEBSOCKET_URLS = [
  'wss://proxy2.wynd.network:4650',
  'wss://proxy2.wynd.network:4444',
];
let retries = 0;

let authData = null;

let deviceId = 'fe9b01ef-e09c-54f4-b5c7-c08b015e3ad9';
const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

class LogsTransporter {
  static sendLogs(logs) {
    if (websocket) {
      websocket.send(JSON.stringify({ action: 'LOGS', data: logs }));
    }
  }
}

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const performHttpRequest = async (params) => {
  const requestOptions = {
    method: params.method,
    headers: {
      ...params.headers,
      authorization: authData.accessToken,
    },
    body: params.body ? Buffer.from(params.body, 'base64') : undefined,
    agent: httpsAgent,
  };

  try {
    const response = await fetchWithCookies(params.url, requestOptions);
    const responseBody = await response.buffer();
    return {
      url: response.url,
      status: response.status,
      status_text: response.statusText,
      headers: response.headers.raw(),
      body: responseBody.toString('base64'),
    };
  } catch (error) {
    LogsTransporter.sendLogs(`HTTP request failed: ${error.message}`);
    return null;
  }
};

const authenticate = async (id) => {
  if (!authData) {
    throw new Error('Autenticação falhou: authData está vazio.');
  }

  return {
    id: id,
    origin_action: 'AUTH',
    result: {
      browser_id: deviceId,
      user_id: authData.userId,
      user_agent: userAgent,
      timestamp: getUnixTimestamp(),
      device_type: 'extension',
      version: '4.26.2',
      extension_id: 'ilehaonighjijnmpnagapkhpcdbhclfg',
    },
  };
};

const RPC_CALL_TABLE = {
  HTTP_REQUEST: performHttpRequest,
  AUTH: authenticate,
  PONG: () => {},
};

const initializeWebSocket = async () => {
  const websocketUrl = `${WEBSOCKET_URLS[0]}?token=${encodeURIComponent(
    authData.accessToken
  )}`;
  websocket = new WebSocket(websocketUrl, {
    agent: httpsAgent,
  });

  websocket.onopen = () => {
    console.log('WebSocket aberto');
    lastLiveConnectionTimestamp = getUnixTimestamp();
    retries = 0;
  };

  websocket.onmessage = async (event) => {
    lastLiveConnectionTimestamp = getUnixTimestamp();
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(event.data);
    } catch (e) {
      console.error('Erro ao parsear mensagem do WebSocket', event.data);
      return;
    }

    if (parsedMessage.action in RPC_CALL_TABLE) {
      try {
        const result = await RPC_CALL_TABLE[parsedMessage.action](
          parsedMessage.id
        );
        websocket.send(JSON.stringify(result));
      } catch (e) {
        LogsTransporter.sendLogs(`Erro RPC: ${e.message}`);
        console.error(`Erro RPC na ação ${parsedMessage.action}`, e);
      }
    } else {
      console.error(`Ação RPC não encontrada: ${parsedMessage.action}`);
    }
  };

  websocket.onclose = (event) => {
    if (event.wasClean) {
      console.log(
        `Conexão fechada limpa, código=${event.code} motivo=${event.reason}`
      );
    } else {
      console.log('Conexão morta');
      retries++;
    }
    reconnectWebSocket();
  };

  websocket.onerror = (error) => {
    console.error(`[error] ${error.message}`);
    reconnectWebSocket();
  };
};

const reconnectWebSocket = () => {
  setTimeout(() => {
    console.log('Tentando reconectar WebSocket...');
    initializeWebSocket();
  }, 5000);
};

setInterval(() => {
  const currentTimestamp = getUnixTimestamp();
  const secondsSinceLastLiveMessage =
    currentTimestamp - lastLiveConnectionTimestamp;

  if (
    secondsSinceLastLiveMessage > 129 ||
    websocket.readyState === WebSocket.CLOSED
  ) {
    console.error('WebSocket não parece estar ativo! Reiniciando a conexão...');
    try {
      websocket.close();
    } catch (e) {}
    initializeWebSocket();
  } else {
    websocket.send(
      JSON.stringify({
        id: uuidv4(),
        version: '1.0.0',
        action: 'PING',
        data: {},
      })
    );
  }
}, PING_INTERVAL);

const login = async () => {
  const response = await fetchWithCookies('https://api.getgrass.io/login', {
    headers: {
      accept: '*/*',
      'content-type': 'text/plain;charset=UTF-8',
      Referer: 'https://app.getgrass.io/',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
    body: JSON.stringify({
      username: process.env.USERNAME,
      password: process.env.PASSWORD,
    }),
    method: 'POST',
    agent: httpsAgent,
  });
  const data = await response.json();
  authData = data.result.data;

  await cookieJar.setCookie(
    `token=${authData.accessToken}`,
    'https://api.getgrass.io'
  );

  initializeWebSocket();
  return authData;
};

login()
  .then((data) => {
    console.log(data);
  })
  .catch((err) => console.error(`Erro no login: ${err.message}`));
