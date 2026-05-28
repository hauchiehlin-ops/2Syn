import asyncio
import websockets
import json

async def test():
    uri = "wss://twosyn-signaling.onrender.com/ws"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"type": "login", "id": "999999999"}))
        print("Sent login")
        await asyncio.sleep(1)
        
        await ws.send(json.dumps({"type": "ping"}))
        print("Sent ping")
        
        try:
            # wait to see if it's closed
            await ws.recv()
        except websockets.exceptions.ConnectionClosed as e:
            print("CLOSED:", e.code, e.reason)

asyncio.get_event_loop().run_until_complete(test())
