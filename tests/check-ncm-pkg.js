// 深入探查 NeteaseCloudMusicApi 的导出结构
const ncm = require('NeteaseCloudMusicApi');
const serverExport = ncm.server;
console.log('typeof ncm:', typeof ncm);
console.log('typeof ncm.server:', typeof serverExport);

// 如果 server 是对象，检查内部方法
if (typeof serverExport === 'object' && serverExport !== null) {
  console.log('server keys:', Object.keys(serverExport));
  if (serverExport.serveNcmApi) console.log('typeof serveNcmApi:', typeof serverExport.serveNcmApi);
}

// 检查是否有 serveNcmApi 在顶层
if (ncm.serveNcmApi) console.log('typeof ncm.serveNcmApi:', typeof ncm.serveNcmApi);

// 检查 default 导出
if (ncm.default) {
  console.log('typeof ncm.default:', typeof ncm.default);
  if (typeof ncm.default === 'object') console.log('default keys:', Object.keys(ncm.default).slice(0, 10));
}

// 列出所有函数类型的导出
const funcs = Object.entries(ncm).filter(([k, v]) => typeof v === 'function').map(([k]) => k);
console.log('Function exports (first 15):', funcs.slice(0, 15));
