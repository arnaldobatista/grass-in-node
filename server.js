const WebSocket = require('ws');
const uuid = require('uuid');
const { randomUUID } = require('crypto');
require('dotenv').config();

const userIds = [
  '6f790c7e-6af2-4c3e-abd7-1209cab9dfb6',
  '2kFYoVCJpbR8HZbWnlcwYhANMCK',
  '2lppXlnRNI4N7myfJKPqgKxapMo',
  '2os7KgveTFonBUvK0J3rJwW1WM0',
  '2p2C9jSmqYGFxXEoqwEOqI8dTDR',
  '2p4aREGDeXtAqbJMhG4K8FlAPtt',
  '2pU1mGG2xOh8U1E9s0gCaoJcpLD',
  '2pU2Qg7LmS0MUTdS3oIUxSfNm2l',
  '2pU2vPCtjcO4Fs8WbHaVTnWJqM8',
  '6d1e4465-0a54-4f94-b8ac-d4d0627fb109', // millho
  '7ac475ef-9b6f-4a49-b84f-a2c0fb2ef03a', // millho
];

const urilist = [
  'wss://proxy.wynd.network:4444/',
  'wss://proxy.wynd.network:4650/',
];

function getRandomUri() {
  return urilist[Math.floor(Math.random() * urilist.length)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectToWss(userId) {
  const deviceId = uuid.v4();
  console.log(`Conectando com Device ID: ${deviceId} para User ID: ${userId}`);

  const uri = getRandomUri();

  let ws;
  let pingInterval;
  let retryCount = 0;
  const maxRetryDelay = 60000;

  const reconnectWithBackoff = async () => {
    retryCount++;
    const delay = Math.min(1000 * Math.pow(2, retryCount), maxRetryDelay);
    console.log(
      `Tentando reconectar para User ID ${userId} em ${
        delay / 1000
      } segundos...`
    );
    await sleep(delay);
    connect();
  };

  // Função auxiliar para responder AUTH de forma dinâmica
  async function handleAuth(message) {
    const authResponse = {
      id: message.id,
      origin_action: 'AUTH',
      result: {
        browser_id: deviceId,
        user_id: userId,
        user_agent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        timestamp: Math.floor(Date.now() / 1000),
        device_type: 'extension', // mantemos algo coerente; pode ser desktop se quiser
        version: '4.26.2',
        extension_id: 'lkbnfiajjmbhnfledhphioinpickokdi', // nome do extension_id, mantenho do original
      },
    };
    ws.send(JSON.stringify(authResponse));
    console.log(
      `Resposta AUTH enviada para User ID ${userId}: ${JSON.stringify(
        authResponse
      )}`
    );
  }

  // Função auxiliar para responder HTTP_REQUEST usando a url recebida
  async function handleHttpRequest(message) {
    const { url } = message.data;
    // Simulamos uma resposta dinâmica com a mesma URL recebida:
    const httpResponse = {
      id: message.id,
      origin_action: 'HTTP_REQUEST',
      result: {
        url: url,
        status: 200,
        status_text: 'OK',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          date: new Date().toUTCString(),
          'x-powered-by': 'Dynamic-Server',
        },
        body: Buffer.from(
          JSON.stringify({ message: 'Resposta dinâmica' })
        ).toString('base64'),
      },
    };
    ws.send(JSON.stringify(httpResponse));
    console.log(
      `Resposta HTTP_REQUEST enviada para User ID ${userId}: ${JSON.stringify(
        httpResponse
      )}`
    );
  }

  // Ao receber PING do servidor, respondemos com PONG
  async function handlePing(message) {
    const pongResponse = {
      id: message.id,
      origin_action: 'PONG',
    };
    ws.send(JSON.stringify(pongResponse));
    console.log(
      `PONG enviado em resposta ao PING do servidor para User ID ${userId}: ${JSON.stringify(
        pongResponse
      )}`
    );
  }

  // Ao receber PONG do servidor (em resposta ao nosso PING), apenas registramos
  function handlePong(message) {
    console.log(
      `PONG recebido do servidor para User ID ${userId}: ${JSON.stringify(
        message
      )}`
    );
    // Não respondemos para evitar loops
  }

  // Envia PING periodicamente (a cada 2 min)
  function startPingInterval() {
    pingInterval = setInterval(() => {
      const pingMessage = {
        id: randomUUID(),
        version: '1.0.0',
        action: 'PING',
        data: {},
      };
      ws.send(JSON.stringify(pingMessage));
      console.log(
        `PING enviado para User ID ${userId}: ${JSON.stringify(pingMessage)}`
      );
    }, 2 * 60 * 1000);
  }

  const connect = () => {
    ws = new WebSocket(uri, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
        Origin: 'chrome-extension://lkbnfiajjmbhnfledhphioinpickokdi',
      },
    });

    ws.on('open', () => {
      console.log(`Conexão estabelecida com ${uri} para User ID: ${userId}`);
      startPingInterval();
    });

    ws.on('message', (data) => {
      let message;
      try {
        message = JSON.parse(data);
      } catch (error) {
        console.error(
          `Mensagem não pôde ser interpretada como JSON para User ID ${userId}: ${data}`
        );
        return;
      }

      console.log(
        `Mensagem recebida para User ID ${userId}: ${JSON.stringify(message)}`
      );

      // Identifica a ação recebida e toma ação correspondente
      switch (message.action) {
        case 'AUTH':
          handleAuth(message);
          break;
        case 'PING':
          handlePing(message);
          break;
        case 'PONG':
          handlePong(message);
          break;
        case 'HTTP_REQUEST':
          handleHttpRequest(message);
          break;
        default:
          console.log(
            `Ação não tratada recebida para User ID ${userId}: ${message.action}`
          );
          break;
      }
    });

    ws.on('close', async (code, reason) => {
      console.log(
        `Conexão encerrada para ${uri} e User ID ${userId}. Código: ${code}, Razão: ${reason}`
      );
      clearInterval(pingInterval);
      await reconnectWithBackoff();
    });

    ws.on('error', async (error) => {
      console.error(`Erro na conexão para User ID ${userId}: ${error.message}`);
      try {
        ws.close();
      } catch (e) {}
      clearInterval(pingInterval);
      await reconnectWithBackoff();
    });
  };

  connect();
}

async function main() {
  for (const userId of userIds) {
    connectToWss(userId);
    await new Promise((resolve) => setTimeout(resolve, 1 * 60 * 1000));
  }
}

main().catch((err) => console.error(err));
