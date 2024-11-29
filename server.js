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
 // console.log(`Conectando com Device ID: ${deviceId} para User ID: ${userId}`);

  const uri = getRandomUri();

  let ws;
  let pingInterval;

  const connect = () => {
    ws = new WebSocket(uri, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, como Gecko) Chrome/114.0.0.0 Safari/537.36',
        Origin: 'chrome-extension://lkbnfiajjmbhnfledhphioinpickokdi',
      },
    });

    ws.on('open', () => {
    //  console.log(`Conexão estabelecida com ${uri} para User ID: ${userId}`);
      pingInterval = setInterval(() => {
        const pingMessage = {
          id: randomUUID(),
          version: '1.0.0',
          action: 'PING',
          data: {},
        };
        ws.send(JSON.stringify(pingMessage));
     //   console.log(
     //     `PING enviado para User ID ${userId}: ${JSON.stringify(pingMessage)}`
     //   );
      }, 5000);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        // console.log(
        //   `Mensagem recebida para User ID ${userId}: ${JSON.stringify(message)}`
        // );

        if (message.action === 'AUTH') {
          const authResponse = {
            id: message.id,
            origin_action: 'AUTH',
            result: {
              browser_id: deviceId,
              user_id: userId,
              user_agent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, como Gecko) Chrome/114.0.0.0 Safari/537.36',
              timestamp: Math.floor(Date.now() / 1000),
              device_type: 'desktop',
              version: '4.26.2',
              desktop_id: 'lkbnfiajjmbhnfledhphioinpickokdi',
            },
          };
          ws.send(JSON.stringify(authResponse));
          // console.log(`Resposta AUTH enviada para User ID ${userId}: ${JSON.stringify(authResponse)}`);
        }

        if (message.action === 'PONG') {
          const pongResponse = {
            id: message.id,
            origin_action: 'PONG',
          };
          ws.send(JSON.stringify(pongResponse));
          // console.log(
          //   `Resposta PONG enviada para User ID ${userId}: ${JSON.stringify(
          //     pongResponse
          //   )}`
          // );
        }
      } catch (error) {
        console.error(
          `Erro ao processar mensagem para User ID ${userId}: ${error.message}`
        );
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
      ws.close();
      clearInterval(pingInterval);
      await reconnectWithBackoff();
    });
  };

  let retryCount = 0;
  const maxRetryDelay = 60000;

  const reconnectWithBackoff = async () => {
    retryCount++;
    const delay = Math.min(1000 * Math.pow(2, retryCount), maxRetryDelay);
    // console.log(
    //   `Tentando reconectar para User ID ${userId} em ${
    //     delay / 1000
    //   } segundos...`
    // );
    await sleep(delay);
    connect();
  };

  connect();
}

async function main() {
  for (const userId of userIds) {
    connectToWss(userId);
  }
}

main().catch((err) => console.error(err));
