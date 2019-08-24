'use strict';

const express = require('express');
const line = require('@line/bot-sdk');
const PORT = process.env.PORT || 3000;
const ambient = require("ambient-lib");
const { promisify } = require("util");

const heartRateLimit = 140;
const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.ACCESS_TOKEN,
  ambientChannelId: process.env.AMBIENT_CHANNEL_ID,
  ambientWriteKey: process.env.AMBIENT_WRITE_KEY
};

const app = express();
app.get('/', (req, res) => res.send('Hello LINE BOT!'));
app.post('/webhook', line.middleware(config), (req, res) => {
  console.log(req.body.events);
  // 接続確認用
  if (req.body.events[0].replyToken === '00000000000000000000000000000000' && req.body.events[1].replyToken === 'ffffffffffffffffffffffffffffffff') {
    res.send('Hello LINE BOT!(POST)');
    console.log('疎通確認用');
    return;
  }
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result));
});

const client = new line.Client(config);
ambient.connect(config.ambientChannelId, config.ambientWriteKey);
const ambientSendAsync = promisify(ambient.send);
// ESP32からデータを複数回に分けて受信するため、リクエストをまたいでデータを保持するオブジェクトをグローバルに保持
let sendData = {};

async function handleEvent(event) {
  console.log('---');
  console.log(event);
  let message = "";
  if (event.type !== 'things') {
    return Promise.resolve(null);
  }
  if (event.type === 'things' && event.things.type === 'link') {
    message = 'デバイスと接続しました。';
  } else if (event.type === 'things' && event.things.type === 'unlink') {
    message = 'デバイスとの接続を解除しました。';
  } else {
    const thingsData = event.things.result;
    if (!thingsData.bleNotificationPayload) {
      return Promise.resolve(null);
    }
    // 受信データをデコード
    const buffer = new Buffer.from(thingsData.bleNotificationPayload, 'base64');
    const data = buffer.toString('ascii');
    if (data === "start") {
      // データ送信開始信号
      sendData.created = Date.now();
    } else if (data.includes(',')) {
      // GPSデータ
      const cordinates = data.split(',');
      sendData.lat = cordinates[0];
      sendData.lng = cordinates[1];
    } else if (data.includes(";")) {
      // 心拍データ
      const BPM = data.split(';')[0];
      sendData.d1 = BPM;
      await ambientSendAsync(sendData);
      // 次の受信に備えてデータをリセット
      sendData = {};
      if (parseInt(BPM) > heartRateLimit) {
        message = `心拍数が上がりすぎています。ペースを落としましょう。BPM: ${BPM}`;
      }
    }
  }
  if (message) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: message
    });
  }
  return Promise.resolve(null);
}

(process.env.NOW_REGION) ? module.exports = app : app.listen(PORT);
console.log(`Server running at ${PORT}`);