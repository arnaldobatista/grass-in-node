import fetch from 'node-fetch';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

import fetchCookie from 'fetch-cookie';
import https from 'https';
import dotenv from 'dotenv';
import tough from 'tough-cookie';

dotenv.config();

const cookieJar = new tough.CookieJar();
const fetchWithCookies = fetchCookie(fetch, cookieJar);

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const getUnixTimestamp = () => Math.floor(Date.now() / 1000);

const PING_INTERVAL = 2 * 60 * 1000;

const WEBSOCKET_URLS = [
  'wss://proxy2.wynd.network:4650',
  'wss://proxy2.wynd.network:4444',
];

const STATUSES = {
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  DEAD: 'DEAD',
  CONNECTING: 'CONNECTING',
};

const localStorage = {};

function setLocalStorage(key, value) {
  localStorage[key] = JSON.stringify(value);
  return Promise.resolve();
}

let authData = null;
let websocket = null;
let lastLiveConnectionTimestamp = getUnixTimestamp();
let retries = 0;

class LogsTransporter {
  static sendLogs(logs) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(
        JSON.stringify({
          action: 'LOGS',
          data: logs,
        })
      );
    } else {
      console.warn('WebSocket não está aberto. Não é possível enviar logs.');
    }
  }
}

async function performHttpRequest(params) {
  console.log('Iniciando performHttpRequest com params:', params);

  const requestOptions = {
    method: params.method,
    headers: {
      ...params.headers,
      authorization: `Bearer ${authData.accessToken}`,
    },
    redirect: 'manual',
    agent: httpsAgent,
  };

  if (params.body) {
    const buffer = Buffer.from(params.body, 'base64');
    requestOptions.body = buffer;
  }

  try {
    const response = await fetchWithCookies(params.url, requestOptions);
    const responseBody = await response.buffer();

    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const status = response.status;
    const statusText = response.statusText;
    const url = response.url;

    console.log('Resposta do performHttpRequest:', {
      url,
      status,
      statusText,
      headers,
    });

    return {
      url,
      status,
      status_text: statusText,
      headers: headers,
      body: responseBody.toString('base64'),
    };
  } catch (error) {
    console.error(`Erro ao realizar fetch: ${error}`);
    LogsTransporter.sendLogs(`HTTP request failed: ${error.message}`);
    return {
      url: params.url,
      status: 400,
      status_text: 'Bad Request',
      headers: {},
      body: '',
    };
  }
}

async function authenticate() {
  console.log('Iniciando authenticate');

  const version = '4.26.2';
  const extension_id = 'ilehaonighjijnmpnagapkhpcdbhclfg';

  const user_agent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/115.0.0.0 Safari/537.36';

  const authenticationResponse = {
    browser_id: uuidv4(),
    user_id: authData && authData.userId ? authData.userId : null,
    user_agent: user_agent,
    timestamp: getUnixTimestamp(),
    device_type: 'extension',
    version,
    extension_id,
  };

  if (authData && authData.userId) {
    await setLocalStorage('wynd:user_id', authData.userId);
  }

  console.log('Resposta do authenticate:', authenticationResponse);

  return authenticationResponse;
}

const RPC_CALL_TABLE = {
  HTTP_REQUEST: performHttpRequest,
  AUTH: authenticate,
  PONG: () => {},
};

async function initialize() {
  console.log('Iniciando WebSocket...');

  if (!authData || !authData.accessToken) {
    console.error('authData ou authData.accessToken está vazio!');
    return;
  }

  const accessToken = encodeURIComponent(authData.accessToken);

  const websocketUrl = `${
    WEBSOCKET_URLS[retries % WEBSOCKET_URLS.length]
  }?token=${accessToken}`;
  console.log('WebSocket URL:', websocketUrl);

  const headers = {
    Origin: 'https://app.getgrass.io',
  };

  websocket = new WebSocket(websocketUrl, {
    agent: httpsAgent,
    headers: headers,
  });

  websocket.on('open', async function () {
    console.log('WebSocket aberto');
    lastLiveConnectionTimestamp = getUnixTimestamp();
    await setLocalStorage('wynd:status', STATUSES.CONNECTED);
  });

  websocket.on('message', async function (data) {
    console.log('Mensagem recebida do WebSocket:', data);
    lastLiveConnectionTimestamp = getUnixTimestamp();

    let parsed_message;
    try {
      parsed_message = JSON.parse(data);
    } catch (e) {
      console.error('Não foi possível parsear a mensagem do WebSocket!', data);
      console.error(e);
      return;
    }

    if (parsed_message.action in RPC_CALL_TABLE) {
      try {
        console.log('Executando ação RPC:', parsed_message.action);
        const result = await RPC_CALL_TABLE[parsed_message.action](
          parsed_message.data
        );
        console.log('Resultado da ação RPC:', result);
        websocket.send(
          JSON.stringify({
            id: parsed_message.id,
            origin_action: parsed_message.action,
            result: result,
          })
        );
      } catch (e) {
        LogsTransporter.sendLogs(
          `RPC encountered error for message ${JSON.stringify(
            parsed_message
          )}: ${e}, ${e.stack}`
        );
        console.error(
          `RPC action ${parsed_message.action} encountered error: `,
          e
        );
      }
    } else {
      console.error(`No RPC action ${parsed_message.action}!`);
    }
  });

  websocket.on('close', async function (code, reason) {
    console.log(`[close] Connection closed, code=${code} reason=${reason}`);
    await setLocalStorage('wynd:status', STATUSES.DEAD);
    retries++;
    reconnectWebSocket();
  });

  websocket.on('error', function (error) {
    console.error(`[error] ${error.message}`);
    reconnectWebSocket();
  });
}

const reconnectWebSocket = () => {
  console.log('Tentando reconectar WebSocket em 5 segundos...');
  setTimeout(() => {
    initialize();
  }, 5000);
};

setInterval(async () => {
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    await setLocalStorage('wynd:status', STATUSES.CONNECTED);
  } else if (websocket && websocket.readyState === WebSocket.CLOSED) {
    await setLocalStorage('wynd:status', STATUSES.DISCONNECTED);
  }

  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    console.log(
      'WebSocket não está em estado apropriado para verificação de atividade...'
    );
    return;
  }

  const current_timestamp = getUnixTimestamp();
  const seconds_since_last_live_message =
    current_timestamp - lastLiveConnectionTimestamp;

  if (
    seconds_since_last_live_message > 129 ||
    websocket.readyState === WebSocket.CLOSED
  ) {
    console.error('WebSocket não parece estar ativo! Reiniciando a conexão...');

    try {
      websocket.close();
    } catch (e) {}
    initialize();
    return;
  }

  console.log('Enviando PING...');
  websocket.send(
    JSON.stringify({
      id: uuidv4(),
      version: '1.0.0',
      action: 'PING',
      data: {},
    })
  );
}, PING_INTERVAL);

const login = async () => {
  console.log('Iniciando login...');
  try {
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

    console.log('Resposta do login status:', response.status);

    const data = await response.json();
    console.log('Dados recebidos do login:', data);

    if (response.status !== 200) {
      console.error(
        `Login falhou com status ${response.status}: ${
          data.message || 'Sem mensagem de erro'
        }`
      );
      throw new Error(
        `Login falhou com status ${response.status}: ${
          data.message || 'Sem mensagem de erro'
        }`
      );
    }

    if (!data.result || !data.result.data) {
      console.error('Dados de autenticação não encontrados na resposta.');
      throw new Error('Dados de autenticação não encontrados na resposta.');
    }

    authData = data.result.data;
    console.log('authData obtido:', authData);

    await cookieJar.setCookie(
      `token=${authData.accessToken}`,
      'https://api.getgrass.io'
    );

    await setLocalStorage('accessToken', authData.accessToken);
    await setLocalStorage('refreshToken', authData.refreshToken);

    await setLocalStorage('wynd:user_id', authData.userId);

    return authData;
  } catch (error) {
    console.error('Erro durante o login:', error);
    throw error;
  }
};

login()
  .then(() => {
    console.log('Login bem-sucedido. authData:', authData);
    initialize();
  })
  .catch((err) => console.error(`Erro durante o login: ${err.message}`));
