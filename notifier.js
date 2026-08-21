const axios = require('axios');
const nodemailer = require('nodemailer');
const { getConfig } = require('./config');
const { addLog } = require('./history');

async function sendTelegramMessage(message, tokenOverride, chatIdOverride) {
  const config = getConfig();
  const rawToken = tokenOverride !== undefined ? tokenOverride : config.telegramBotToken;
  const rawChatId = chatIdOverride !== undefined ? chatIdOverride : config.telegramChatId;

  const token = (rawToken || '').toString().trim();
  const chatId = (rawChatId || '').toString().trim();

  if (!token || !chatId) {
    throw new Error('텔레그램 봇 토큰과 Chat ID를 모두 입력해 주세요.');
  }

  // Handle case where user accidentally pastes "bot" in token
  const cleanToken = token.startsWith('bot') ? token.slice(3) : token;
  const url = `https://api.telegram.org/bot${cleanToken}/sendMessage`;

  try {
    const response = await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    }, { timeout: 10000 });

    return response.data;
  } catch (err) {
    const telegramErr = err.response?.data?.description;
    if (telegramErr) {
      if (telegramErr.includes('chat not found')) {
        throw new Error('Chat ID를 찾을 수 없습니다. 텔레그램 앱에서 만드신 봇에게 대화 시작(/start) 버튼이나 메시지를 1회 발송해 주셔야 알림 전송이 가능합니다!');
      }
      if (telegramErr.includes('Not Found') || telegramErr.includes('Unauthorized') || telegramErr.includes('invalid token')) {
        throw new Error('봇 토큰이 올바르지 않습니다. @BotFather에서 발급받은 API Token(숫자:문자열 형태)을 다시 확인해 주세요.');
      }
      if (telegramErr.includes('bot was blocked')) {
        throw new Error('봇이 차단되어 있습니다. 텔레그램에서 해당 봇 차단을 해제해 주세요.');
      }
      throw new Error(`텔레그램 API 오류 (${err.response.status}): ${telegramErr}`);
    }
    throw err;
  }
}

async function sendEmailMessage(subject, htmlContent, customConfig) {
  const config = getConfig();
  const host = customConfig?.emailHost || config.emailHost || 'smtp.gmail.com';
  const port = customConfig?.emailPort || config.emailPort || 587;
  const user = customConfig?.emailUser || config.emailUser;
  const pass = customConfig?.emailPass || config.emailPass;
  const to = customConfig?.emailTo || config.emailTo;

  if (!user || !pass || !to) {
    throw new Error('이메일 계정(User/Password) 및 수신자(To) 정보가 설정되지 않았습니다.');
  }

  const transporter = nodemailer.createTransport({
    host: host,
    port: Number(port),
    secure: Number(port) === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });

  const mailOptions = {
    from: `"X Tweet Generator" <${user}>`,
    to: to,
    subject: subject,
    html: htmlContent
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

async function notifyNewTunnelUrl(tunnelUrl) {
  const config = getConfig();
  const username = config.authUsername || 'la5454';
  const password = config.authPassword || 'rudghlWkd!';

  // 1. Telegram Notification
  if (config.telegramEnabled && config.telegramBotToken && config.telegramChatId) {
    try {
      const msg = `🚀 <b>X 트윗 생성기 대시보드 서버가 시작되었습니다!</b>\n\n` +
        `🌐 <b>외부 접속 링크:</b>\n${tunnelUrl}\n\n` +
        `🔑 <b>로그인 계정:</b> ${username} / ${password}\n\n` +
        `📱 위 링크를 누르면 스마트폰에서 대시보드로 바로 접속할 수 있습니다.`;
      await sendTelegramMessage(msg);
      addLog('SUCCESS', `📲 [텔레그램 알림] 외부 접속 링크가 텔레그램으로 발송되었습니다.`);
    } catch (err) {
      addLog('WARN', `⚠️ [텔레그램 알림 실패] ${err.message}`);
    }
  }

  // 2. Email Notification
  if (config.emailEnabled && config.emailUser && config.emailPass && config.emailTo) {
    try {
      const subject = `🚀 [X Dashboard] 서버 구동 완료 - 외부 접속 링크 안내`;
      const html = `
        <div style="font-family: sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #1d9bf0;">🚀 X 트윗 생성기 대시보드 구동 완료</h2>
          <p>서버가 성공적으로 구동되었으며 외부 접속 터널이 생성되었습니다.</p>
          <div style="background-color: #f7f9f9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-weight: bold; color: #333;">🌐 외부 접속 링크 (클릭하여 이동):</p>
            <p style="margin: 10px 0 0 0; font-size: 16px;"><a href="${tunnelUrl}" target="_blank" style="color: #1d9bf0; font-weight: bold;">${tunnelUrl}</a></p>
          </div>
          <p style="color: #555;">🔑 <b>보안 로그인:</b> 아이디 <code>${username}</code> / 비밀번호 <code>${password}</code></p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888;">이 메일은 서버 실행 시 자동으로 발송되는 알림 메일입니다.</p>
        </div>
      `;
      await sendEmailMessage(subject, html);
      addLog('SUCCESS', `📧 [이메일 알림] 외부 접속 링크가 이메일(${config.emailTo})로 발송되었습니다.`);
    } catch (err) {
      addLog('WARN', `⚠️ [이메일 알림 실패] ${err.message}`);
    }
  }
}

module.exports = {
  sendTelegramMessage,
  sendEmailMessage,
  notifyNewTunnelUrl
};
