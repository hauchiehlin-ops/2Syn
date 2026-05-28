import asyncio
import websockets
import json

async def test():
    uri = "wss://twosyn-signaling.onrender.com/ws"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"type": "login", "id": "999999999"}))
        print("Logged in as 999999999")
        
        # 發送 Offer 給 231715543
        await ws.send(json.dumps({"type": "offer", "target": "231715543", "sdp": "fake", "pin": "fake"}))
        response = await ws.recv()
        print("Response:", response)

asyncio.get_event_loop().run_until_complete(test())
