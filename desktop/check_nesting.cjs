const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5174', { waitUntil: 'networkidle2' });
  const result = await page.evaluate(() => {
    const parent = document.getElementById('remote-video-container');
    const child = document.querySelector('.glass-container');
    const isInside = parent.contains(child);
    
    // also check visibility of glass-container
    const rect = child.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0;
    
    // check if parent display is none
    const parentDisplay = window.getComputedStyle(parent).display;
    
    return { isInside, isVisible, rect, parentDisplay, parentOuter: parent.outerHTML.substring(0, 100) };
  });
  console.log(result);
  await browser.close();
  process.exit(0);
})();
