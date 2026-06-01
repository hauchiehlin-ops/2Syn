import sys

ts_path = "src/main.ts"
with open(ts_path, "r", encoding="utf-8") as f:
    content = f.read()

viewport_logic = """
// 監聽 VisualViewport 以應對 iOS 鍵盤彈出與自適應縮放
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    const vv = window.visualViewport;
    if (!vv) return;
    if (vv.height < window.innerHeight * 0.8) {
      // 鍵盤彈出
      const offset = window.innerHeight - vv.height;
      keyboardOffsetUpdateY = -offset; // 往上推動整個鍵盤的高度
      applyVideoTransform();
    } else {
      // 鍵盤收合
      keyboardOffsetUpdateY = 0;
      applyVideoTransform();
    }
  });
  window.visualViewport.addEventListener("scroll", () => {
     const vv = window.visualViewport;
     // 防止 iOS 自動滾動整個頁面導致黑屏
     if (vv && vv.offsetTop > 0) {
         window.scrollTo(0, 0);
     }
  });
}
"""

if "window.visualViewport.addEventListener" not in content:
    with open(ts_path, "a", encoding="utf-8") as f:
        f.write("\n" + viewport_logic + "\n")
    print("Viewport logic appended to main.ts")
else:
    print("Viewport logic already exists!")
