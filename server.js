const WebSocket = require('ws');
const uuid = require('uuid');
const { randomUUID } = require('crypto');

const userId = '6f790c7e-6af2-4c3e-abd7-1209cab9dfb6';

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

async function connectToWss() {
  const deviceId = uuid.v4();
  console.log(`Conectando com Device ID: ${deviceId}`);

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
      console.log(`Conexão estabelecida com ${uri}`);
      pingInterval = setInterval(() => {
        const pingMessage = {
          id: randomUUID(),
          version: '1.0.0',
          action: 'PING',
          data: {},
        };
        ws.send(JSON.stringify(pingMessage));
        console.log(`PING enviado: ${JSON.stringify(pingMessage)}`);
      }, 5000);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        console.log(`Mensagem recebida: ${JSON.stringify(message)}`);

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
          console.log(`Resposta AUTH enviada: ${JSON.stringify(authResponse)}`);
        }

        if (message.action === 'PONG') {
          const pongResponse = {
            id: message.id,
            origin_action: 'PONG',
          };
          ws.send(JSON.stringify(pongResponse));
          console.log(`Resposta PONG enviada: ${JSON.stringify(pongResponse)}`);
        }
      } catch (error) {
        console.error(`Erro ao processar mensagem: ${error.message}`);
      }
    });

    ws.on('close', async (code, reason) => {
      console.log(`Conexão encerrada para ${uri}. Código: ${code}, Razão: ${reason}`);
      clearInterval(pingInterval);
      await reconnectWithBackoff();
    });

    ws.on('error', async (error) => {
      console.error(`Erro na conexão: ${error.message}`);
      ws.close();
      clearInterval(pingInterval);
      await reconnectWithBackoff();
    });
  };

  let retryCount = 0;
  const maxRetryDelay = 60000; // 1 minuto

  const reconnectWithBackoff = async () => {
    retryCount++;
    const delay = Math.min(1000 * Math.pow(2, retryCount), maxRetryDelay);
    console.log(`Tentando reconectar em ${delay / 1000} segundos...`);
    await sleep(delay);
    connect();
  };

  connect();
}

async function main() {
  await connectToWss();
}

main().catch((err) => console.error(err));
