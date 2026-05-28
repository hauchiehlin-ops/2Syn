import asyncio
import websockets
import json

async def test():
    uri = "wss://twosyn-signaling.onrender.com/ws"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"type": "login", "id": "231715543"}))
        print("Logged in as 231715543")
        
        # Keep it alive
        while True:
            await asyncio.sleep(1)

asyncio.get_event_loop().run_until_complete(test())
