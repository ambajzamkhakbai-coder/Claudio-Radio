const { WebSocketServer } = require('ws');

let wss = null;
const clients = new Set();

/**
 * 初始化 WebSocket 服务端，并绑定至 Express 的 HTTP 实例
 * @param {Object} server - HTTP Server 实例
 */
function init(server) {
  wss = new WebSocketServer({ noServer: true });

  // 绑定特定路径 `/stream`
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    
    if (pathname === '/stream') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] New PWA client connected. Active clients: ${clients.size}`);

    ws.on('message', (message) => {
      try {
        const event = JSON.parse(message);
        console.log('[WS] Received client event:', event.type);
        // 在这里我们可以处理客户端主动发送的 prefetch 成功等业务回执
      } catch (err) {
        console.error('[WS] Failed to parse client message:', err.message);
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected. Active clients: ${clients.size}`);
    });

    // 握手成功发送状态确认
    ws.send(JSON.stringify({
      type: 'INIT_ACK',
      data: { connected: true, timestamp: Date.now() }
    }));
  });
}

/**
 * 全局事件广播接口
 * @param {string} type - 事件名 (如 'PREFETCH_TRIGGER', 'VOLUME_DUCKING')
 * @param {Object} data - 事件负载负载数据
 */
function broadcast(type, data = {}) {
  if (!wss) return;
  const payload = JSON.stringify({ type, data, timestamp: Date.now() });
  
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN 状态
      client.send(payload);
    }
  }
}

module.exports = {
  init,
  broadcast
};
