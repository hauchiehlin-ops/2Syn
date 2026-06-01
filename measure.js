const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({headless: "new"});
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 800});
  await page.goto('file:///Users/barretlin/GitProjects/2syn/desktop/index.html', {waitUntil: 'networkidle0'});
  
  const metrics = await page.evaluate(() => {
    const getRect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {x: r.x, y: r.y, width: r.width, height: r.height};
    };
    return {
      main: getRect(document.querySelector('.main-content')),
      controlPanel: getRect(document.querySelector('.control-panel')),
      monitorPanel: getRect(document.querySelector('.monitor-panel')),
      hostCol: getRect(document.querySelector('.host-col')),
      clientCol: getRect(document.querySelector('.client-col'))
    };
  });
  console.log(JSON.stringify(metrics, null, 2));
  await browser.close();
})();
