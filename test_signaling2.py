import asyncio
import websockets
import json

async def test():
    uri = "wss://twosyn-signaling.onrender.com/ws"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"type": "offer", "target": "231715543", "sdp": "fake", "pin": "fake"}))
        try:
            response = await asyncio.wait_for(ws.recv(), timeout=5.0)
            print("Response:", response)
        except asyncio.TimeoutError:
            print("Target IS online (no error returned)")

asyncio.get_event_loop().run_until_complete(test())
