import subprocess
import time
import json
import urllib.request
import urllib.error
import sys

server_process = None

def start_server():
    global server_process
    print("正在背景啟動 2syn 授權驗證伺服器...")
    server_process = subprocess.Popen(
        ["cargo", "run", "--package", "syn-signaling"],
        cwd="/Users/barretlin/GitProjects/2syn",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    # 等待伺服器啟動與埠口接聽
    time.sleep(3)
    print("伺服器啟動流程已觸發。")

def stop_server():
    global server_process
    if server_process:
        print("正在關閉背景授權驗證伺服器...")
        server_process.terminate()
        try:
            stdout, stderr = server_process.communicate(timeout=3)
            print("--- 伺服器 Standard Output ---")
            print(stdout)
            print("--- 伺服器 Standard Error ---")
            print(stderr)
        except subprocess.TimeoutExpired:
            server_process.kill()
            stdout, stderr = server_process.communicate()
            print("--- 伺服器 Standard Output (Killed) ---")
            print(stdout)
            print("--- 伺服器 Standard Error (Killed) ---")
            print(stderr)
        print("伺服器已關閉。")

def send_post(path, data):
    url = f"http://127.0.0.1:8080{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as response:
            status = response.status
            body_bytes = response.read()
            try:
                body = json.loads(body_bytes.decode("utf-8"))
            except Exception as e:
                print(f"解析成功響應 JSON 失敗: {e}, 原始響應: {body_bytes}")
                body = {"success": False, "message": body_bytes.decode("utf-8")}
            return status, body
    except urllib.error.HTTPError as e:
        status = e.code
        body_bytes = e.read()
        try:
            body = json.loads(body_bytes.decode("utf-8"))
        except Exception as json_err:
            print(f"解析錯誤響應 JSON 失敗: {json_err}, 原始響應: {body_bytes}")
            body = {"success": False, "message": body_bytes.decode("utf-8")}
        return status, body
    except Exception as general_err:
        print(f"發送請求發生異常: {general_err}")
        return 500, {"success": False, "message": str(general_err)}

def run_tests():
    print("\n==================================================")
    print("         2syn 買斷授權多設備防弊機制整合測試         ")
    print("==================================================\n")

    license_key = "BUYOUT-KEY-12345"
    
    # 測試 1：依序啟用 5 台不同設備，預期全部成功
    print("【測試 1】依序註冊啟用 5 台裝置 (限制額度內)...")
    for i in range(1, 6):
        hwid = f"hwid-device-mock-uuid-00{i}"
        status, res = send_post("/activate", {"license_key": license_key, "hwid": hwid})
        print(f" -> 註冊裝置 #{i} ({hwid}): Status={status}, Success={res.get('success')}, Msg={res.get('message')}")
        if status != 200:
            print(f"測試失敗，原始響應內容: {res}")
            sys.exit(1)
        assert status == 200
        assert res.get("success") is True
        assert res.get("ticket") is not None
    print(" -> 測試 1 通過：5 台裝置已成功註冊啟用。\n")

    # 測試 2：嘗試啟用第 6 台設備，預期被伺服器防弊機制拒絕 (HTTP 400)
    print("【測試 2】嘗試註冊啟用第 6 台裝置 (超出 5 台限制)...")
    hwid_6 = "hwid-device-mock-uuid-006"
    status, res = send_post("/activate", {"license_key": license_key, "hwid": hwid_6})
    print(f" -> 註冊裝置 #6 ({hwid_6}): Status={status}, Success={res.get('success')}, Msg={res.get('message')}")
    assert status == 400
    assert res.get("success") is False
    print(" -> 測試 2 通過：第 6 台裝置註冊成功被攔截拒絕。\n")

    # 測試 3：解除註冊裝置 #1 (Deactivate)，預期成功釋放額度
    print("【測試 3】解除綁定註冊裝置 #1 (釋放授權額度)...")
    hwid_1 = "hwid-device-mock-uuid-001"
    status, res = send_post("/deactivate", {"license_key": license_key, "hwid": hwid_1})
    print(f" -> 解除綁定裝置 #1 ({hwid_1}): Status={status}, Success={res.get('success')}, Msg={res.get('message')}")
    assert status == 200
    assert res.get("success") is True
    print(" -> 測試 3 通過：裝置 #1 已解綁成功。\n")

    # 測試 4：立即嘗試解除綁定裝置 #2，預期被防弊冷卻時間 (Cooldown) 攔截
    print("【測試 4】立即嘗試解除綁定裝置 #2 (驗證解綁冷卻防弊)...")
    hwid_2 = "hwid-device-mock-uuid-002"
    status, res = send_post("/deactivate", {"license_key": license_key, "hwid": hwid_2})
    print(f" -> 立即解除裝置 #2 ({hwid_2}): Status={status}, Success={res.get('success')}, Msg={res.get('message')}")
    assert status == 400
    assert res.get("success") is False
    assert "防弊機制攔截" in res.get("message")
    print(" -> 測試 4 通過：解綁冷卻時間防弊機制成功攔截頻繁操作。\n")

    # 測試 5：等待 10 秒冷卻時間過後，或者因為剛才已釋放了裝置 1，此時嘗試註冊裝置 #6 應能成功
    print("【測試 5】因為額度已釋放，嘗試再次註冊裝置 #6...")
    status, res = send_post("/activate", {"license_key": license_key, "hwid": hwid_6})
    print(f" -> 註冊裝置 #6 ({hwid_6}): Status={status}, Success={res.get('success')}, Msg={res.get('message')}")
    assert status == 200
    assert res.get("success") is True
    assert res.get("ticket") is not None
    print(" -> 測試 5 通過：裝置 #6 註冊成功，取代原先裝置 #1 的槽位。\n")

    # 測試 6：再次嘗試註冊裝置 #1 (此時已達 5 台限制：2, 3, 4, 5, 6)，預期拒絕
    print("【測試 6】再次嘗試註冊原裝置 #1...")
    status, res = send_post("/activate", {"license_key": license_key, "hwid": hwid_1})
    print(f" -> 註冊裝置 #1 ({hwid_1}): Status={status}, Success={res.get('success')}, Msg={res.get('message')}")
    assert status == 400
    assert res.get("success") is False
    print(" -> 測試 6 通過：再次註冊裝置 #1 成功被攔截。\n")

    print("==================================================")
    print("          恭喜！所有授權限制與防弊測試全數通過！          ")
    print("==================================================\n")

if __name__ == "__main__":
    try:
        start_server()
        run_tests()
    finally:
        stop_server()
