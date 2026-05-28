import asyncio
import websockets
import json
import time

async def test():
    uri = "wss://twosyn-signaling.onrender.com/ws"
    async with websockets.connect(uri) as ws:
        await ws.send(json.dumps({"type": "login", "id": "111222333"}))
        print("Logged in at", time.strftime("%X"))
        
        try:
            # Wait 65 seconds without sending anything
            await asyncio.wait_for(ws.recv(), timeout=65.0)
        except asyncio.TimeoutError:
            print("65 seconds passed, no message received. Connection STILL OPEN!")
        except websockets.exceptions.ConnectionClosed as e:
            print("Connection closed by server after idle:", e.code, e.reason)

asyncio.get_event_loop().run_until_complete(test())
