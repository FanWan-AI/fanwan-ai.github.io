const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'data/ai/trade/trade-daily.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const content = data[0].markdown_content.zh;
console.log(content);
