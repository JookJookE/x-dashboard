const localtunnel = require('localtunnel');
const fs = require('fs');
const path = require('path');
const { addLog } = require('./history');

const PORT = 3000;
const URL_FILE = path.join(__dirname, 'data', 'external_url.txt');

async function startTunnel() {
  try {
    console.log('🌐 외부(모바일/LTE) 접속용 공개 URL을 생성하는 중입니다...');
    const tunnel = await localtunnel({ port: PORT });

    const publicUrl = tunnel.url;
    fs.writeFileSync(URL_FILE, publicUrl, 'utf8');

    console.log(`=======================================================`);
    console.log(`📱 스마트폰(모바일/LTE) 외부 접속 URL 생성 완료!`);
    console.log(`👉 모바일 주소: ${publicUrl}`);
    console.log(`=======================================================`);
    addLog('SUCCESS', `모바일 외부 접속 주소 생성 완료: ${publicUrl}`);

    tunnel.on('close', () => {
      console.log('외부 터널 연결이 종료되었습니다.');
      addLog('WARN', '모바일 외부 접속 터널 연결이 종료되었습니다.');
    });

    return publicUrl;
  } catch (err) {
    console.error('localtunnel 실행 실패:', err.message);
    addLog('ERROR', `외부 터널 생성 실패: ${err.message}`);
  }
}

if (require.main === module) {
  startTunnel();
}

module.exports = { startTunnel };
