const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2' });
  const html = await page.evaluate(() => document.body.innerHTML);
  console.log(html.substring(0, 500));
  
  // also check if app-container is visible
  const style = await page.evaluate(() => {
    const el = document.querySelector('.glass-container');
    if (!el) return 'NOT_FOUND';
    return window.getComputedStyle(el).display;
  });
  console.log('glass-container display:', style);
  
  await browser.close();
})();
