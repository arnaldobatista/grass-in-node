/* eslint-disable react/prop-types */
/* eslint-disable react-hooks/exhaustive-deps */
import React, { createContext, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';

const WebSocketContext = createContext();

const urilist = ['wss://proxy.wynd.network:4444/', 'wss://proxy.wynd.network:4650/'];

const userIds = [
  '6f790c7e-6af2-4c3e-abd7-1209cab9dfb6',
  '2kFYoVCJpbR8HZbWnlcwYhANMCK',
  '2lppXlnRNI4N7myfJKPqgKxapMo',
  '2os7KgveTFonBUvK0J3rJwW1WM0',
  '2p2C9jSmqYGFxXEoqwEOqI8dTDR',
  '2p4aREGDeXtAqbJMhG4K8FlAPtt',
  '2pU1mGG2xOh8U1E9s0gCaoJcpLD',
  '2pU2Qg7LmS0MUTdS3oIUxSfNm2l',
  '2pU2vPCtjcO4Fs8WbHaVTnWJqM8'
];

function getRandomUri() {
  return urilist[Math.floor(Math.random() * urilist.length)];
}

const WebSocketProvider = ({ children }) => {
  const connections = useRef([]); // Mantém as conexões ativas

  useEffect(() => {
    const connectToWss = (userId) => {
      const deviceId = uuidv4();
      const uri = getRandomUri();
      let ws;
      let pingInterval;

      const connect = () => {
        ws = new WebSocket(uri);

        ws.onopen = () => {
          console.log(`Conectado a ${uri} para User ID: ${userId}`);
          // Envia PING periodicamente
          pingInterval = setInterval(() => {
            const pingMessage = {
              id: uuidv4(),
              version: '1.0.0',
              action: 'PING',
              data: {}
            };
            ws.send(JSON.stringify(pingMessage));
          }, 5000);
        };

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          console.log(`Mensagem recebida para User ID ${userId}:`, message);

          if (message.action === 'AUTH') {
            ws.send(
              JSON.stringify({
                id: message.id,
                origin_action: 'AUTH',
                result: {
                  browser_id: deviceId,
                  user_id: userId,
                  timestamp: Math.floor(Date.now() / 1000)
                }
              })
            );
          }
        };

        ws.onclose = () => {
          clearInterval(pingInterval);
          console.log(`Conexão encerrada para User ID: ${userId}`);
        };

        ws.onerror = (error) => {
          console.error(`Erro na conexão para User ID: ${userId}`, error);
        };
      };

      connect();
      connections.current.push(ws); // Armazena a conexão
    };

    // Inicia as conexões WebSocket para cada User ID
    userIds.forEach((userId) => connectToWss(userId));

    // Limpeza ao desmontar o componente
    return () => {
      connections.current.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) ws.close();
      });
      connections.current = [];
    };
  }, []);

  return <WebSocketContext.Provider value={{}}>{children}</WebSocketContext.Provider>;
};

export { WebSocketContext, WebSocketProvider };
