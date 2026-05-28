import asyncio
import websockets
import json

async def test():
    uri = "wss://twosyn-signaling.onrender.com/ws"
    async with websockets.connect(uri) as ws:
        print("Connected")
        await ws.send(json.dumps({"type": "login", "id": "999999999"}))
        print("Sent login")
        
        await ws.send(json.dumps({"type": "ping"}))
        print("Sent ping")
        
        try:
            res = await asyncio.wait_for(ws.recv(), timeout=2.0)
            print("Received:", res)
        except asyncio.TimeoutError:
            print("No response to ping")
            
        print("Waiting to see if connection drops...")
        try:
            res = await asyncio.wait_for(ws.recv(), timeout=5.0)
            print("Received:", res)
        except asyncio.TimeoutError:
            print("Still alive")
        except websockets.exceptions.ConnectionClosed as e:
            print("Connection closed by server:", e)

asyncio.get_event_loop().run_until_complete(test())
