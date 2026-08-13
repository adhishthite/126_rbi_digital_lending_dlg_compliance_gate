import asyncio
import json
import os

from fastapi import FastAPI, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

import config
import database
from orchestrator import Orchestrator
from schema import RawTransactionPayload, TransactionResponse

app = FastAPI(
    title="RBI DLG Compliance Gate Backend",
    description="Backend service enforcing 5% digital lending guarantee cap, statutory guardrails, and SHA-256 ledger chaining.",
    version="1.0.0",
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/execute-transaction", response_model=TransactionResponse)
def execute_transaction(payload: RawTransactionPayload):
    """
    Executes compliance validation and settlement for a single transaction synchronously.
    """
    orchestrator = Orchestrator()
    response, _ = orchestrator.execute_transaction_sync(payload)
    return response


@app.get("/api/stream")
async def stream_transaction(
    payload: str = Query(
        ..., description="URL-encoded JSON string of RawTransactionPayload"
    ),
):
    """
    Server-Sent Events (SSE) endpoint streaming real-time logs/events from the compliance pipeline.
    """
    try:
        payload_dict = json.loads(payload)
        raw_payload = RawTransactionPayload(**payload_dict)
    except (json.JSONDecodeError, ValidationError) as e:
        error_msg = str(e)

        async def error_generator():
            yield f"data: {json.dumps({'error': f'Validation/Parsing failed: {error_msg}'})}\n\n"

        return StreamingResponse(error_generator(), media_type="text/event-stream")

    orchestrator = Orchestrator()

    async def event_generator():
        try:
            async for event in orchestrator.stream_transaction_events(raw_payload):
                yield f"data: {json.dumps(event)}\n\n"
                await asyncio.sleep(0.02)
        except Exception as ex:  # noqa: BLE001
            yield f"data: {json.dumps({'error': f'Streaming exception: {ex!s}'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/ledger")
def get_ledger():
    """
    Returns the list of all stored ledger records.
    """
    return database.get_ledger_records()


@app.get("/api/logs")
def get_logs():
    """
    Returns the raw JSONL audit trail contents.
    """
    if not os.path.exists(database.LEDGER_FILE_PATH):
        return Response("", media_type="text/plain")

    with open(database.LEDGER_FILE_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    return Response(content, media_type="text/plain")


@app.get("/api/config")
def get_config():
    """
    Returns the current environment and configuration parameters.
    """
    return {
        "MODE": config.MODE,
        "GCP_PROJECT": config.GCP_PROJECT,
        "GCP_LOCATION": config.GCP_LOCATION,
        "GEMINI_MODEL": config.GEMINI_MODEL,
        "PORT": config.PORT,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=config.PORT)
