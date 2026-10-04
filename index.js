require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const axios = require('axios');

const config = {
  channelAccessToken: (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim(),
  channelSecret: (process.env.LINE_CHANNEL_SECRET || '').trim(),
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const app = express();

const API_BASE = (process.env.PROMPTPAY_API_BASE || 'https://my-promptpay-api.onrender.com').trim();
const PROMPTPAY_ID = (process.env.PROMPTPAY_NUMBER || '').trim();
const ADMIN_LINE_URL = (process.env.ADMIN_LINE_URL || 'https://line.me/ti/p/~YOUR_ADMIN_ID').trim();

// เช็กและปลุก Render API
async function ensureApiAwake() {
  const maxRetries = 10;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await axios.get(API_BASE + '/health', { timeout: 10000 });
      if (res.status === 200) {
        console.log('[Warm-up] API is Awake and ready!');
        return true;
      }
    } catch (err) {
      console.log(`[Warm-up] API sleeping... Retry \({i + 1}/\){maxRetries}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  return false;
}

// ฟังก์ชันแปลงเวลา
function parseTimeToMinutes(text) {
  if (!text) return null;
  const cleanText = text.trim();

  // 1. รูปแบบ hh:mm เช่น "2:30"
  const hhmmMatch = cleanText.match(/^(\d+):(\d+)$/);
  if (hhmmMatch) {
    return parseInt(hhmmMatch[1], 10) * 60 + parseInt(hhmmMatch[2], 10);
  }

  // 2. รูปแบบทศนิยมระบุหน่วยชม. เช่น "8.30ชม", "2.5ชม"
  const dotHrMatch = cleanText.match(/^(\d+)\.(\d+)\s*(?:ชม|ชั่วโมง)$/);
  if (dotHrMatch) {
    const hours = parseInt(dotHrMatch[1], 10);
    const minPart = dotHrMatch[2];
    if (minPart.length === 1) {
      const parsedMin = Math.round(parseFloat('0.' + minPart) * 60);
      return hours * 60 + parsedMin;
    }
    return hours * 60 + parseInt(minPart, 10);
  }

  // 3. รูปแบบปกติ "X ชม Y นาที"
  let hours = 0;
  let minutes = 0;

  const hrMatch = cleanText.match(/(\d+)\s*(?:ชม|ชั่วโมง)/);
  const minMatch = cleanText.match(/(\d+)\s*นาที/);

  if (hrMatch) hours = parseInt(hrMatch[1], 10);
  if (minMatch) minutes = parseInt(minMatch[1], 10);

  if (hrMatch || minMatch) {
    return hours * 60 + minutes;
  }

  // 4. รูปแบบตัวเลขทศนิยมล้วน เช่น "8.30"
  const decimalMatch = cleanText.match(/^(\d+)\.(\d+)$/);
  if (decimalMatch) {
    const hours = parseInt(decimalMatch[1], 10);
    const minPart = decimalMatch[2];
    if (minPart.length === 1) {
      return hours * 60 + Math.round(parseFloat('0.' + minPart) * 60);
    }
    return hours * 60 + parseInt(minPart, 10);
  }

  // 5. ตัวเลขจำนวนเต็มล้วน
  if (/^\d+$/.test(cleanText)) {
    return parseInt(cleanText, 10);
  }

  return null;
}

// สูตรคำนวณราคา
function calculatePrice(totalMinutes) {
  const MINUTE_RATE = 15 / 60;
  const PACKAGE_8HR_PRICE = 100;

  if (totalMinutes < 480) {
    const normalPrice = totalMinutes * MINUTE_RATE;
    return Math.min(normalPrice, PACKAGE_8HR_PRICE);
  }

  const extraMinutes = totalMinutes - 480;
  const extraPrice = extraMinutes * MINUTE_RATE;

  return PACKAGE_8HR_PRICE + extraPrice;
}

// Flex Message ต้อนรับสมาชิกใหม่
function createWelcomeFlexMessage() {
  return {
    type: 'flex',
    altText: 'ยินดีต้อนรับ! อัตราค่าบริการรับดันฟีดห้องไลฟ์สด 📌',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#06C755',
        contents: [
          {
            type: 'text',
            text: 'ยินดีต้อนรับครับ! 👋',
            weight: 'bold',
            color: '#FFFFFF',
            size: 'sm'
          },
          {
            type: 'text',
            text: 'บริการรับดันฟีดห้องไลฟ์สด 📌',
            weight: 'bold',
            color: '#FFFFFF',
            size: 'lg',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          // กล่องแจ้งเตือนผู้ใช้งานใหม่
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#FFF3E0',
            paddingAll: 'md',
            cornerRadius: 'md',
            borderColor: '#FF9800',
            borderWidth: '1px',
            contents: [
              {
                type: 'text',
                text: '📌 สำหรับผู้ใช้งานใหม่ (ยังไม่เคยใช้บริการ):',
                weight: 'bold',
                size: 'xs',
                color: '#E65100',
                wrap: true
              },
              {
                type: 'text',
                text: 'กรุณาทักหาแอดมินก่อนเพื่อตั้งค่าระบบ โดยแจ้งรายละเอียดดังนี้:\n1. โปรโมชันที่ต้องการ\n2. เลข ID THLive\n3. ชื่อบัญชี THLive',
                size: 'xxs',
                color: '#5D4037',
                wrap: true,
                margin: 'xs'
              }
            ]
          },
          {
            type: 'text',
            text: '💵 อัตราค่าบริการ',
            weight: 'bold',
            size: 'md',
            color: '#111111',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            backgroundColor: '#F8F9FA',
            paddingAll: 'md',
            cornerRadius: 'md',
            contents: [
              {
                type: 'text',
                text: '🔹 รายชั่วโมง: ชั่วโมงละ 15 บาท',
                size: 'xs',
                color: '#333333',
                wrap: true
              },
              {
                type: 'text',
                text: '🔹 เหมาสุดคุ้ม (8 ชม.): เพียง 100 บาท',
                size: 'xs',
                color: '#1DB446',
                weight: 'bold',
                wrap: true
              },
              {
                type: 'text',
                text: '(ตก ชม. ละ 12.5 บาท จากปกติ 120.-)',
                size: 'xxs',
                color: '#777777',
                wrap: true,
                margin: 'none'
              },
              {
                type: 'text',
                text: '🔹 เกิน 8 ชม.: ชม. ที่ 9 ขึ้นไป +15 บาท/ชม.',
                size: 'xs',
                color: '#333333',
                wrap: true
              }
            ]
          },
          {
            type: 'text',
            text: '💡 ตัวอย่างคำนวณราคา',
            weight: 'bold',
            size: 'sm',
            color: '#111111',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'xs',
            contents: [
              {
                type: 'text',
                text: '• ไลฟ์ 4 ชม. = 60 บาท (15 x 4)',
                size: 'xs',
                color: '#555555'
              },
              {
                type: 'text',
                text: '• ไลฟ์ 8 ชม. = 100 บาท (ราคาเหมา)',
                size: 'xs',
                color: '#555555'
              },
              {
                type: 'text',
                text: '• ไลฟ์ 9 ชม. = 115 บาท (100 + 15)',
                size: 'xs',
                color: '#555555'
              }
            ]
          },
          {
            type: 'separator',
            margin: 'md'
          },
          {
            type: 'text',
            text: '👉 ลูกค้าเดิม สามารถพิมพ์เวลาที่ไลฟ์เข้ามาในแชท (เช่น 8.30ชม หรือ 2:30) ระบบจะสร้าง QR Code ชำระเงินให้ทันทีครับ!',
            size: 'xs',
            color: '#06C755',
            wrap: true,
            weight: 'bold',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#FFF8E1',
            paddingAll: 'sm',
            cornerRadius: 'sm',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: '⚠️ แอดมินอาจจะตอบช้า แนะนำทักมาอีกรอบช่วง 17:00 น. - 23:00 น. ครับ',
                size: 'xxs',
                color: '#D97706',
                wrap: true,
                weight: 'bold'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '💬 ติดต่อแอดมิน (ตั้งค่า/แจ้งข้อมูล)',
              uri: ADMIN_LINE_URL
            },
            color: '#06C755'
          }
        ],
        flex: 0
      }
    },
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'uri',
            label: '💬 คุยกับแอดมิน',
            uri: ADMIN_LINE_URL
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: '❓ วิธีใช้งาน',
            text: 'วิธีใช้งาน'
          }
        }
      ]
    }
  };
}

// Flex Message สรุปยอดชำระเงิน
function createFlexMessage(timeSummary, totalMinutes, totalPrice, promoNote) {
  return {
    type: 'flex',
    altText: 'สรุปยอดชำระบริการรับดันฟีดห้องไลฟ์ ' + totalPrice.toLocaleString('th-TH') + ' บาท',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F8F9FA',
        contents: [
          {
            type: 'text',
            text: 'สรุปยอดชำระเงิน',
            weight: 'bold',
            color: '#1DB446',
            size: 'sm'
          },
          {
            type: 'text',
            text: 'บริการรับดันฟีดห้องไลฟ์ 📌',
            weight: 'bold',
            size: 'lg',
            margin: 'xs',
            color: '#111111'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: '⏱️ เวลาไลฟ์',
                color: '#888888',
                size: 'sm',
                flex: 3
              },
              {
                type: 'text',
                text: timeSummary + ' (' + totalMinutes + ' นาที)',
                wrap: true,
                color: '#333333',
                size: 'sm',
                flex: 5,
                align: 'end',
                weight: 'bold'
              }
            ]
          },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: '💰 ยอดชำระ',
                color: '#888888',
                size: 'sm',
                flex: 3
              },
              {
                type: 'text',
                text: totalPrice.toLocaleString('th-TH') + ' บาท',
                wrap: true,
                color: '#1DB446',
                size: 'xl',
                flex: 5,
                align: 'end',
                weight: 'bold'
              }
            ]
          },
          promoNote ? {
            type: 'text',
            text: promoNote,
            size: 'xs',
            color: '#FF5555',
            align: 'center',
            margin: 'sm'
          } : { type: 'spacer', size: 'xs' }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '💬 ติดต่อแอดมิน / ส่งสลิป',
              uri: ADMIN_LINE_URL
            },
            color: '#06C755'
          }
        ],
        flex: 0
      }
    },
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'uri',
            label: '💬 คุยกับแอดมิน',
            uri: ADMIN_LINE_URL
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: '❓ วิธีใช้งาน',
            text: 'วิธีใช้งาน'
          }
        }
      ]
    }
  };
}

app.get('/', (req, res) => {
  res.send('LINE Bot Server is running!');
});

app.post('/webhook', line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error('Webhook Handling Error:', err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  // 1. Event เมื่อเพิ่มเพื่อน (Follow Event)
  if (event.type === 'follow') {
    const welcomeFlex = createWelcomeFlexMessage();
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [welcomeFlex],
    });
  }

  // 2. Normal Text Message Event
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userText = event.message.text;

  // เมนูขอตารางราคา / วิธีใช้งาน
  if (userText === 'วิธีใช้งาน' || userText === 'ราคา' || userText === 'อัตราค่าบริการ') {
    const welcomeFlex = createWelcomeFlexMessage();
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [welcomeFlex],
    });
  }

  const totalMinutes = parseTimeToMinutes(userText);

  if (totalMinutes === null || totalMinutes <= 0) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: 'text',
          text: '⚠ รูปแบบเวลาไม่ถูกต้องครับ\nกรุณาพิมพ์ เช่น:\n- 8.30ชม\n- 2:30\n- 4 ชม\n- 8 ชม 30 นาที',
          quickReply: {
            items: [
              {
                type: 'action',
                action: {
                  type: 'message',
                  label: '💰 ดูราคา / วิธีใช้งาน',
                  text: 'วิธีใช้งาน'
                }
              },
              {
                type: 'action',
                action: {
                  type: 'uri',
                  label: '💬 ติดต่อแอดมิน',
                  uri: ADMIN_LINE_URL
                }
              }
            ]
          }
        }
      ]
    });
  }

  const rawPrice = calculatePrice(totalMinutes);
  const totalPrice = Math.round(rawPrice * 100) / 100;

  const hoursDisplay = Math.floor(totalMinutes / 60);
  const minsDisplay = totalMinutes % 60;
  let timeSummary = '';
  if (hoursDisplay > 0) timeSummary += hoursDisplay + ' ชม. ';
  if (minsDisplay > 0 || hoursDisplay === 0) timeSummary += minsDisplay + ' นาที';

  let promoNote = '';
  if (totalMinutes >= 480) {
    promoNote = '🎉 ปรับใช้โปรเหมา 8 ชม. 100 บาท';
  }

  const encodedId = encodeURIComponent(PROMPTPAY_ID);
  const qrImageUrl = API_BASE + '/qr/' + encodedId + '/' + totalPrice + '?format=card&lang=th';

  console.log('Generated QR Image URL:', qrImageUrl);

  try {
    await ensureApiAwake();

    const flexMsg = createFlexMessage(timeSummary, totalMinutes, totalPrice, promoNote);

    return await client.replyMessage({
      replyToken: event.replyToken,
      messages: [
        flexMsg,
        {
          type: 'image',
          originalContentUrl: qrImageUrl,
          previewImageUrl: qrImageUrl
        }
      ]
    });
  } catch (error) {
    console.error('Error replying LINE message:', error?.response?.data || error);
    return null;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});