require('dotenv').config();
const { writeFileSync, readFileSync } = require('fs');
const puppeteer = require('puppeteer');
const jsdom = require('jsdom');
const nodeFetch = require('node-fetch');

const WIDTH = 1920;
const HEIGHT = 1080;

const data = readFileSync('db.json', { encoding:'utf8', flag: 'r' });

const pastResults = new Set(JSON.parse(data) || []);
console.log('pastResults:', pastResults);
const newResults = new Set();
const houses = [];
const { CHAT_ID, BOT_API } = process.env;

const urls = [
    "https://www.funda.nl/en/zoeken/huur?selected_area=%5B%22rotterdam%22%5D"
]

const runTask = async () => {
    for (const url of urls) await runPuppeteer(url)

    console.log(`[Custom Logger]: ${newResults}`)

    if (newResults.size > 0) {
        writeFileSync('db.json', JSON.stringify(Array.from([
            ...newResults,
            ...pastResults,
        ])));

        console.log('[Custom Logger] Sending messages to Telegram')

        const date = (new Date()).toISOString().split('T')[0];

        houses.forEach(({
            path,
            price,
            full_address,
            postalCode,
        }) => {
            let text = ``;

            if (price) {
                text = `
Full Address: *${full_address}*                
Price: *${price}*
Date: *${date}*
Link: **[click here](${path})**
                `;
            }

            console.log(text)

            nodeFetch(`https://api.telegram.org/bot${BOT_API}/sendMessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text,
                    chat_id : CHAT_ID,
                    parse_mode : 'markdown',
                }),
            });
        });
    }
};

const runPuppeteer = async (url) => {
    console.log('[Custom Logger] Opening headless browser')

    const browser = await puppeteer.launch({
        headless: true,
        args: [`--window-size=${WIDTH},${HEIGHT}`],
        defaultViewport: {
            width: WIDTH,
            height: HEIGHT,
        },
    })

    const page = await browser.newPage();
    // https://stackoverflow.com/a/51732046/4307769 https://stackoverflow.com/a/68780400/4307769
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.157 Safari/537.36');

    console.log('[Custom Logger] Going to funda.nl')

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const htmlString = await page.content();
    const dom = await new jsdom.JSDOM(htmlString);

    const result = dom.window.document.querySelectorAll('[data-testid="listingDetailsAddress"]')
    console.log('[Custom Logger] Parsing funda.nl data');

    for (const element of result) {
        let parent = element.parentElement; // Начинаем с родительского элемента
        let detectedParent = null

        // Поднимаемся по дереву DOM, пока не найдём элемент с классом border-b
        while (parent) {
            if (parent.classList && parent.classList.contains('border-b')) {
                detectedParent = parent
                break; // Выходим из цикла, если нашли
            }
            parent = parent.parentElement; // Переходим к следующему родителю
        }

        const urlPath = `https://www.funda.nl/en${element.getAttribute('href')}`
        const price = detectedParent?.querySelector('div.font-semibold.mt-2.mb-0')?.textContent.trim()
        const full_address = element.textContent.trim()

        if (urlPath && !pastResults.has(urlPath) && !newResults.has(urlPath)) {
            let extraDetails = {}

            extraDetails = { price, full_address }

            newResults.add(urlPath)

            houses.push({
                ...extraDetails,
                path: urlPath
            })
        }
    }

    console.log('[Custom Logger] Closing browser');
    await browser.close();
};

if (CHAT_ID && BOT_API) {
    runTask();
} else {
    console.log('[Custom Logger] Missing Telegram API keys');
}
