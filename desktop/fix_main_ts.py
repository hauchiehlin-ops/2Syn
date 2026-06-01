import re

ts_path = "src/main.ts"
with open(ts_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Remove applySmartSnapping function entirely
content = re.sub(r"\s*function applySmartSnapping[\s\S]*?return \{ x, y \};\n  }", "", content)

# 2. Remove all remote-cursor references
# Like: const cursorEl = document.getElementById("remote-cursor");
# if (cursorEl) ...
content = re.sub(r"const cursorEl = document\.getElementById\(\"remote-cursor\"\);", "", content)
content = re.sub(r"if \(cursorEl \|\|.*?\).*?return;", "", content)
content = re.sub(r"if \(!cursorEl.*?\).*?return;", "", content)
content = re.sub(r"if \(cursorEl\) cursorEl\.style\.display = \"none\";", "", content)
content = re.sub(r"if \(cursorEl\) \{\s*cursorEl\.style\.display.*?\s*cursorEl\.style\.left.*?\s*cursorEl\.style\.top.*?\s*\}", "", content)
content = re.sub(r"cursorEl\.style\.display = \"block\";", "", content)
content = re.sub(r"cursorEl\.style\.left = .*?;", "", content)
content = re.sub(r"cursorEl\.style\.top = .*?;", "", content)
content = re.sub(r"if \(cursorEl\) \{\s*cursorEl\.style\.display = \"block\";\s*cursorEl\.style\.width = \"20px\";\s*cursorEl\.style\.height = \"20px\";\s*cursorEl\.innerHTML = `[\s\S]*?`;\s*\}", "", content)
content = re.sub(r"if \(cursorEl\) \{\s*if \(isClicking\) \{\s*cursorEl\.style\.width = \"12px\";\s*cursorEl\.style\.height = \"12px\";\s*cursorEl\.innerHTML = `[\s\S]*?`;\s*\}\s*\}", "", content)
content = re.sub(r"if \(!isDirectTouchMode\) \{\s*cursorEl\.style\.display = \"block\";\s*\} else \{\s*cursorEl\.style\.display = \"none\";\s*\}", "", content)

# Try a more aggressive regex for the cursorEl blocks if they are multi-line
content = re.sub(r"if \(cursorEl\) \{[^{}]*\}", "", content)
# And the complex nested one in setupDesktopVideoInteraction
content = re.sub(r"if \(cursorEl\) \{\s*if \(isClicking\).*?\}\s*\}", "", content, flags=re.DOTALL)

# 3. Add visualViewport listener inside setupDesktopVideoInteraction or initialization
viewport_logic = """
  // 監聽 VisualViewport 以應對 iOS 鍵盤彈出
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      const vv = window.visualViewport;
      if (!vv) return;
      if (vv.height < window.innerHeight * 0.8) {
        // 鍵盤彈出
        const offset = window.innerHeight - vv.height;
        container.style.transform = `translateY(-${offset / 2}px)`; // 往上推一半，避免過度
      } else {
        // 鍵盤收合
        container.style.transform = `translateY(0px)`;
      }
    });
    window.visualViewport.addEventListener("scroll", () => {
       const vv = window.visualViewport;
       if (vv && vv.offsetTop > 0) {
           // 鎖定在頂部
           window.scrollTo(0, 0);
       }
    });
  }
"""

if "function setupDesktopVideoInteraction()" in content:
    content = content.replace("function setupDesktopVideoInteraction() {", "function setupDesktopVideoInteraction() {\n" + viewport_logic)

with open(ts_path, "w", encoding="utf-8") as f:
    f.write(content)

print("main.ts cleaned up.")
