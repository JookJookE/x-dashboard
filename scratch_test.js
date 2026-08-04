const axios = require('axios');

function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function testRss() {
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent('IT뉴스 when:2d') + '&hl=ko&gl=KR&ceid=KR:ko';
  const res = await axios.get(url);
  const items = [...res.data.matchAll(/<item>[\s\S]*?<\/item>/gi)];

  items.slice(0, 5).forEach(it => {
    const titleMatch = it[0].match(/<title>(.*?)<\/title>/i);
    const descMatch = it[0].match(/<description>(.*?)<\/description>/i);
    const title = titleMatch ? cleanHtml(titleMatch[1]) : '';
    const snippet = descMatch ? cleanHtml(descMatch[1]) : '';

    console.log('Title:', title);
    console.log('Body Snippet:', snippet);
    console.log('--------------------------------------------------');
  });
}

testRss();
