const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({headless: "new"});
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 800});
  await page.goto('file:///Users/barretlin/GitProjects/2syn/desktop/index.html', {waitUntil: 'networkidle0'});
  await page.screenshot({path: '/Users/barretlin/.gemini/antigravity/brain/9d6eeacf-b68a-4e90-9bfd-7f7cf38edb2a/artifacts/current_layout.png'});
  await browser.close();
})();
