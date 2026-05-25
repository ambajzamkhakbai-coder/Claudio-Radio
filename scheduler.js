const cron = require('node-cron');
const context = require('./context');
const socket = require('./socket');

let lastRoutine = '';

/**
 * 启动节律调度器
 * 自动在后台扫描作息时间变动，实现像真实电台一样的智能节律
 */
function start() {
  console.log('[Scheduler] Rhythm Scheduler started.');
  
  // 每 30 秒扫描一次时钟（比 Cron 更为即时，且免除复杂配置，利于本地测试）
  setInterval(() => {
    try {
      const currentRoutine = context.getActiveRoutine(new Date());
      
      // 检测到日常作息发生跃迁（例如：从 极客编程 跨入 午休充电）
      if (lastRoutine && lastRoutine !== currentRoutine) {
        console.log(`[Scheduler] Routine Shift detected! "${lastRoutine}" -> "${currentRoutine}"`);
        
        // 向前端广播时段跃迁事件，前端可在当前歌曲结束后强制触发新一轮的 AI DJ 播报
        socket.broadcast('ROUTINE_SHIFT', {
          oldRoutine: lastRoutine,
          newRoutine: currentRoutine,
          message: `时段已切换至「${currentRoutine}」，AI DJ 克劳迪奥正在为你准备专属节目。`
        });
      }
      
      lastRoutine = currentRoutine;
    } catch (err) {
      console.error('[Scheduler] Scanning loop error:', err.message);
    }
  }, 30000);
}

module.exports = {
  start
};
