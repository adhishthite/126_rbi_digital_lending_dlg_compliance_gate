import time
from collections.abc import Callable
from typing import Any


class BaseAgent:
    def __init__(
        self,
        name: str,
        role: str,
        event_callback: Callable[[dict[str, Any]], None] | None = None,
    ):
        self.name = name
        self.role = role
        self.event_callback = event_callback
        self.thoughts: list[str] = []

    def log_thought(self, thought: str):
        """
        Record a thought during execution.
        """
        self.thoughts.append(thought)

    def emit_event(
        self,
        task: str,
        status: str,
        results: dict[str, Any] | None = None,
        latency_ms: float = 0.0,
    ):
        """
        Emit a structured event to the callback/queue.
        """
        event = {
            "author": self.name,
            "role": self.role,
            "task": task,
            "thoughts": list(self.thoughts),
            "status": status,
            "results": results or {},
            "latency_ms": round(latency_ms, 2),
            "timestamp": time.time(),
        }
        if self.event_callback:
            self.event_callback(event)

    def run(self, *args, **kwargs) -> Any:
        raise NotImplementedError("Subclasses must implement run()")
