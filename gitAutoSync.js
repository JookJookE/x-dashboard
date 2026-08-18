const { exec } = require('child_process');
const path = require('path');
const { addLog } = require('./history');

let lastSyncTime = null;
let isSyncing = false;

function executeCommand(command, cwd = __dirname) {
  return new Promise((resolve, reject) => {
    // Include Git path in env if recently installed
    const env = Object.assign({}, process.env, {
      PATH: `${process.env.PATH};C:\\Users\\admin\\MinGit\\cmd;C:\\Users\\admin\\MinGit\\bin;C:\\Program Files\\Git\\cmd;C:\\Program Files\\Git\\bin;C:\\Users\\admin\\AppData\\Local\\Programs\\Git\\cmd`
    });

    exec(command, { cwd, env }, (error, stdout, stderr) => {
      if (error) {
        return reject({ error, stderr: String(stderr || '') });
      }
      resolve(String(stdout || '').trim());
    });
  });
}

/**
 * Get current Git status and commit information
 */
async function getGitInfo() {
  try {
    const branch = await executeCommand('git rev-parse --abbrev-ref HEAD');
    const commitHash = await executeCommand('git rev-parse --short HEAD');
    const commitMsg = await executeCommand('git log -1 --pretty=%B');
    const remoteUrl = await executeCommand('git config --get remote.origin.url').catch(() => '미설정');

    return {
      success: true,
      branch: branch || 'main',
      commitHash: commitHash || 'unknown',
      commitMsg: commitMsg || '',
      remoteUrl: remoteUrl || '',
      lastSyncTime: lastSyncTime || new Date().toISOString()
    };
  } catch (err) {
    return {
      success: false,
      message: err.stderr || err.error?.message || 'Git 정보를 조회할 수 없습니다.'
    };
  }
}

/**
 * Pull latest code from GitHub origin main and restart if updated
 */
async function pullAndApplyUpdates() {
  if (isSyncing) {
    return { success: false, message: '이미 깃허브 동기화가 진행 중입니다.' };
  }

  isSyncing = true;
  addLog('INFO', '🔄 깃허브(GitHub) 원격 저장소 최신 코드 동기화 확인 시작...');

  try {
    // 1. Fetch latest changes
    await executeCommand('git fetch origin');
    
    // 2. Check if local HEAD is behind origin
    const status = await executeCommand('git status -uno');
    
    if (status.includes('Your branch is up to date') || status.includes('최신 상태입니다')) {
      isSyncing = false;
      lastSyncTime = new Date().toISOString();
      addLog('INFO', '✅ 깃허브 코드가 이미 최신 상태입니다. (변경사항 없음)');
      return { success: true, updated: false, message: '이미 최신 코드입니다.' };
    }

    // 3. Pull latest commits
    const pullOutput = await executeCommand('git pull origin main --no-rebase');
    lastSyncTime = new Date().toISOString();
    addLog('SUCCESS', `🚀 깃허브 최신 코드가 서버에 적용되었습니다! (${pullOutput})`);

    // 4. Graceful restart after 1 second
    setTimeout(() => {
      addLog('INFO', '🔄 최신 코드 반영을 위해 서버 프로세스를 재시작합니다...');
      process.exit(0); // If running with PM2 or task watcher, it restarts automatically
    }, 1500);

    isSyncing = false;
    return { success: true, updated: true, message: '최신 코드를 성공적으로 가져왔습니다. 서버를 재시작합니다.' };
  } catch (err) {
    isSyncing = false;
    const errMsg = err.stderr || err.error?.message || String(err);
    addLog('WARN', `깃허브 동기화 실패: ${errMsg}`);
    return { success: false, message: errMsg };
  }
}

/**
 * Start Background Polling (checks GitHub every 30 seconds)
 */
function initGitAutoSync(intervalSeconds = 30) {
  setInterval(async () => {
    try {
      const gitInfo = await getGitInfo();
      if (gitInfo.success && gitInfo.remoteUrl && gitInfo.remoteUrl !== '미설정') {
        await pullAndApplyUpdates();
      }
    } catch (e) { }
  }, intervalSeconds * 1000);
}

module.exports = {
  getGitInfo,
  pullAndApplyUpdates,
  initGitAutoSync
};
