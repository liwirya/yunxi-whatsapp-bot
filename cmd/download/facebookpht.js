import axios from 'axios';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ui = {
    info: '[ INFO ]',
    err: '[ ERR! ]',
    succ: '[ OKAY ]',
    wait: '[ WAIT ]',
    sep: '========================='
};

class FacebookPhotoScraper {
  constructor() {
    this.headers = {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Dest': 'document',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    };
    this.jsonRegex = /<script type="application\/json".*?>(.*?)<\/script>/gs;
  }

  parseEngagement(value) {
    if (!value) return 0;
    const str = String(value).toUpperCase().replace(/,/g, '');
    if (str.includes('K')) return Math.round(parseFloat(str) * 1000);
    if (str.includes('M')) return Math.round(parseFloat(str) * 1000000);
    return parseInt(str) || 0;
  }

  findImagesRecursive(obj, images = new Set()) {
    if (!obj || typeof obj !== 'object') return images;
    
    if (obj.uri && typeof obj.uri === 'string') {
        if (obj.uri.includes('scontent') && !obj.uri.includes('static_map')) {
            images.add(obj.uri);
        }
    }
    
    if (obj.photo_image && obj.photo_image.uri) {
        images.add(obj.photo_image.uri);
    }

    for (const key in obj) {
        this.findImagesRecursive(obj[key], images);
    }
    return images;
  }

  async scrape(url) {
    try {
      const response = await axios.get(url, { 
          headers: this.headers,
          maxRedirects: 5
      });

      let html = response.data;
      
      const storyUrlRegex = /"url"\s*:\s*"(\\\/story\.php\?[^"]+)"/;
      const storyMatch = html.match(storyUrlRegex);
      
      if (storyMatch) {
          const rawUrl = storyMatch[1].replace(/\\\//g, '/');
          const fullStoryUrl = 'https://www.facebook.com' + rawUrl;
          console.log(`${ui.info} Redirecting to Story URL: ${fullStoryUrl}`);
          
          const storyResp = await axios.get(fullStoryUrl, { headers: this.headers });
          html = storyResp.data;
      }

      const jsonScripts = [];
      let match;
      while ((match = this.jsonRegex.exec(html)) !== null) {
          try {
              jsonScripts.push(JSON.parse(match[1]));
          } catch (e) { continue; } 
      }

      const result = {
          author: 'Unknown',
          stats: { likes: 0, comments: 0, shares: 0 },
          images: []
      };

      const imageSet = new Set();

      jsonScripts.forEach(json => {
          const str = JSON.stringify(json);
          
          if (!result.author || result.author === 'Unknown') {
              if (json.author && json.author.name) result.author = json.author.name;
          }

          this.findImagesRecursive(json, imageSet);
      });

      result.images = Array.from(imageSet)
        .filter(uri => {
            return !uri.includes('_s64x64') && 
                   !uri.includes('_s48x48') && 
                   !uri.includes('cp0') &&
                   !uri.includes('p50x50');
        })
        .map(uri => uri.replace(/\\u0025/g, '%').replace(/\\/g, '')); 

      if (result.images.length === 0) {
          throw new Error('No images found. Kemungkinan Private Post atau logic berubah.');
      }

      return result;

    } catch (error) {
      throw new Error(`Scrape Failed: ${error.message}`);
    }
  }
}

let handler = async (m, { conn, args, q, command, reply }) => {
  const inputUrl = q || (args && args.length > 0 ? args.join(' ') : '');

  if (!inputUrl || !/facebook\.com|fb\.watch/i.test(inputUrl)) {
      return reply(`${ui.info} Masukkan Link Post/Photo Facebook.\nCMD: ${command} https://www.facebook.com/61566991331592/posts/pfbid0RJxE4rzRs4eUZtW3gD1CXg3hGHhMVGQqK53pv4f8fd1yx2wMAw7gPPaNeFrbfQstl/`);
  }

  reply(`${ui.wait} Sedang Proses, Harap Menunggu...`);

  const scraper = new FacebookPhotoScraper();

  try {
    const data = await scraper.scrape(inputUrl);
    
    const totalImg = data.images.length;
    let caption = `┌ ${ui.info} FB PHOTO\n`;
    caption += `│ Author : ${data.author}\n`;
    caption += `│ Found  : ${totalImg} Images\n`;
    caption += `└ ${ui.sep}`;

    
    // const limit = 10; 
    
    for (let i = 0; i < totalImg; i++) {
        /*
        if (i >= limit) {
            await conn.sendMessage(m.chat, { 
                text: `... dan ${totalImg - limit} foto lainnya distop biar ga spam.` 
            }, { quoted: m });
            break;
        }
        */

        await conn.sendMessage(m.chat, { 
            image: { url: data.images[i] }, 
            caption: i === 0 ? caption : `[ IMG ${i+1}/${totalImg} ]`
        }, { quoted: m });
        
        await new Promise(r => setTimeout(r, 1500));
    }

  } catch (e) {
    console.error('[FB Photo Error]', e);
    reply(`${ui.err} Gagal bos: ${e.message}`);
  }
};

handler.help = ['fbphoto', 'fbfoto'];
handler.tags = ['downloader'];
handler.command = /^(fbphoto|fbfoto|fp)$/i;

export default handler;
